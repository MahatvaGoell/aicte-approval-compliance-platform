import { z } from 'zod';
import type { Db } from '../../db.js';
import { AppError, ValidationError, one, q } from '../../db.js';
import { recordAudit } from '../audit/audit.js';
import { coversRegion, has } from '../identity/permissions.js';
import { emitEvent } from '../outbox/outbox.js';
import { ruleRef } from '../policy/engine.js';
import type { ClassificationTrace } from '../policy/engine.js';
import { enterStage, recordTransition, setApplicationState, setStageState } from '../workflow/workflow.js';
import type { WorkflowRow } from '../workflow/workflow.js';
import type { CaseContext, CommandDef, FindingRow } from './command-kit.js';
import { assignedOwnerGuard, deny, markStarted } from './command-kit.js';

// Milestone 2 commands: findings and returns, re-scrutiny attempts, amendments, manual classification, appeals.

const REASON_CODES = ['MISSING_DOCUMENT', 'INCOMPLETE_INFORMATION', 'NON_COMPLIANCE', 'CLARIFICATION', 'OTHER'] as const;

/** Institution-visible findings on the live stage attempt that can be sent back to the institution. */
function returnable(c: CaseContext) {
  return c.findings.filter((f) => f.stage_instance_id === c.stage?.id && f.visibility === 'INSTITUTION' && (f.state === 'OPEN' || f.state === 'NOT_RESOLVED'));
}

/** Findings raised at the current stage (any attempt) that the stage owner can still close. */
function reviewable(c: CaseContext, states: FindingRow['state'][]) {
  return c.findings.filter((f) => f.stage_key === c.stage?.stage_key && states.includes(f.state));
}

function findingOf(c: CaseContext, id: string) {
  const f = c.findings.find((x) => x.id === id);
  if (!f) throw new ValidationError('That finding does not belong to this case', [{ field: 'findingId', message: 'Unknown finding' }]);
  return f;
}

const raiseFinding: CommandDef<z.ZodObject<any>> = {
  name: 'RAISE_FINDING',
  label: 'Raise a finding',
  input: z.object({
    checklistCode: z.string().max(60).optional(),
    reasonCode: z.enum(REASON_CODES),
    explanation: z.string().trim().min(10).max(4000),
    requestedEvidence: z.string().trim().max(1000).optional(),
    visibility: z.enum(['INSTITUTION', 'INTERNAL']),
    requestsAmendment: z.boolean().default(false),
  }),
  guard(c) {
    if (!has(c.actor, 'FINDING_RAISE')) return deny(403, 'MISSING_CAPABILITY', 'Your role cannot raise findings');
    return assignedOwnerGuard(c);
  },
  async run(tx, c, ctx, input) {
    const stage = c.stage!;
    if (input.checklistCode && !c.stageDef!.checklist.some((i) => i.code === input.checklistCode)) {
      throw new ValidationError('Not a checklist item of this stage', [{ field: 'checklistCode', message: 'Choose an item of this stage' }]);
    }
    if (input.requestsAmendment && input.visibility !== 'INSTITUTION') {
      throw new ValidationError('Only an institution-visible finding can ask for an amendment', [{ field: 'requestsAmendment', message: 'Make the finding visible to the institution' }]);
    }
    const f = await one(
      tx,
      `INSERT INTO findings (application_id, workflow_id, stage_instance_id, stage_key, checklist_code, reason_code, explanation,
         requested_evidence, responsible_party, visibility, requests_amendment, state, raised_by, raised_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'OPEN',$12,$13) RETURNING id`,
      [c.app.id, c.workflow!.id, stage.id, stage.stage_key, input.checklistCode ?? null, input.reasonCode, input.explanation,
        input.requestedEvidence ?? null, input.visibility === 'INSTITUTION' ? 'INSTITUTION' : 'OFFICE', input.visibility,
        input.requestsAmendment, ctx.actor!.userId, ctx.at],
    );
    await markStarted(tx, c, ctx);
    await recordAudit(tx, ctx, {
      entityType: 'finding', entityId: f.id, action: 'FINDING_RAISED',
      after: { reasonCode: input.reasonCode, checklistCode: input.checklistCode ?? null, visibility: input.visibility, requestsAmendment: input.requestsAmendment },
      reason: input.explanation, applicationId: c.app.id, institutionId: c.app.institution_id, policyVersionId: c.policy!.id, ruleRef: stage.rule_ref,
    });
    return { findingId: f.id };
  },
};

const returnToInstitution: CommandDef<z.ZodObject<any>> = {
  name: 'RETURN_TO_INSTITUTION',
  label: 'Return the case to the institution for a response',
  input: z.object({
    reason: z.string().trim().min(10).max(2000),
    responseDueNote: z.string().trim().min(3).max(500),
  }),
  guard(c) {
    if (!has(c.actor, 'CASE_RETURN')) return deny(403, 'MISSING_CAPABILITY', 'Your role cannot return cases');
    const d = assignedOwnerGuard(c);
    if (d) return d;
    if (!c.stageDef!.allowReturn) return deny(409, 'RETURN_NOT_ALLOWED', `The policy does not allow ${c.stageDef!.name} to return a case`);
    if (returnable(c).length === 0) return deny(409, 'NO_FINDING_TO_RETURN', 'Raise at least one finding visible to the institution first');
    return null;
  },
  async run(tx, c, ctx, input) {
    const stage = c.stage!;
    const ids = returnable(c).map((f) => f.id);
    await tx.query(
      `UPDATE findings SET state = 'RESPONSE_PENDING', returned_at = $2, response_due_note = $3, closed_by = NULL, closed_at = NULL
        WHERE id = ANY($1::uuid[])`,
      [ids, ctx.at, input.responseDueNote],
    );
    const from = stage.state;
    await setStageState(tx, stage, 'AWAITING_RESPONSE');
    await recordAudit(tx, ctx, {
      entityType: 'stage', entityId: stage.id, action: 'CASE_RETURNED',
      before: { state: from }, after: { state: 'AWAITING_RESPONSE', findingIds: ids, responseDueNote: input.responseDueNote },
      reason: input.reason, applicationId: c.app.id, institutionId: c.app.institution_id, policyVersionId: c.policy!.id, ruleRef: stage.rule_ref,
      visibility: 'INSTITUTION',
    });
    await recordTransition(tx, ctx, {
      applicationId: c.app.id, workflowId: c.workflow!.id, command: 'RETURN_TO_INSTITUTION', fromStage: stage.stage_key, toStage: stage.stage_key,
      fromState: from, toState: 'AWAITING_RESPONSE', reason: input.reason, policyVersionId: c.policy!.id, ruleRef: stage.rule_ref,
    });
    await emitEvent(tx, ctx, 'CASE_RETURNED', 'application', c.app.id, {
      applicationId: c.app.id, appNo: c.app.app_no, institutionId: c.app.institution_id, findingCount: ids.length, stageKey: stage.stage_key,
    });
    return { returnedFindings: ids.length };
  },
};

const respondToFinding: CommandDef<z.ZodObject<any>> = {
  name: 'RESPOND_TO_FINDING',
  label: 'Respond to a finding',
  input: z.object({ findingId: z.string().uuid(), text: z.string().trim().min(10).max(4000) }),
  guard(c) {
    if (!has(c.actor, 'FINDING_RESPOND')) return deny(403, 'MISSING_CAPABILITY', 'Only the institution responds to findings');
    if (c.actor.institutionId !== c.app.institution_id) return deny(403, 'OUT_OF_SCOPE', 'This case belongs to another institution');
    if (!c.stage || c.stage.state !== 'AWAITING_RESPONSE') return deny(409, 'NOT_AWAITING_RESPONSE', 'The case is not waiting for your response');
    if (!c.findings.some((f) => f.state === 'RESPONSE_PENDING' && f.visibility === 'INSTITUTION')) return deny(409, 'NOTHING_TO_ANSWER', 'No finding is waiting for a response');
    return null;
  },
  async run(tx, c, ctx, input) {
    const f = findingOf(c, input.findingId);
    if (f.visibility !== 'INSTITUTION' || f.state !== 'RESPONSE_PENDING') {
      throw new AppError(409, 'FINDING_NOT_PENDING', 'This finding is not waiting for a response');
    }
    const r = await one(
      tx,
      `INSERT INTO finding_responses (finding_id, application_id, text, submitted_by, submitted_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [f.id, c.app.id, input.text, ctx.actor!.userId, ctx.at],
    );
    await tx.query(`UPDATE findings SET state = 'RESPONSE_SUBMITTED' WHERE id = $1`, [f.id]);
    f.state = 'RESPONSE_SUBMITTED';
    await recordAudit(tx, ctx, {
      entityType: 'finding', entityId: f.id, action: 'FINDING_RESPONDED', after: { responseId: r.id },
      reason: input.text, applicationId: c.app.id, institutionId: c.app.institution_id, visibility: 'INSTITUTION',
    });

    // Once every returned finding has an answer, the returned attempt closes and a new attempt opens.
    const stillPending = c.findings.filter((x) => x.state === 'RESPONSE_PENDING' && x.stage_instance_id === c.stage!.id);
    if (stillPending.length > 0) return { responseId: r.id, reopened: false, stillPending: stillPending.length };

    const old = c.stage!;
    await setStageState(tx, old, 'COMPLETED', { completed_at: ctx.at, outcome: 'RETURNED', outcome_reason: 'Returned to the institution; all findings answered' });
    await tx.query('UPDATE stage_assignments SET ended_at = $2 WHERE stage_instance_id = $1 AND ended_at IS NULL', [old.id, ctx.at]);
    await recordTransition(tx, ctx, {
      applicationId: c.app.id, workflowId: c.workflow!.id, command: 'RESPONSES_COMPLETE', fromStage: old.stage_key, toStage: old.stage_key,
      fromState: 'AWAITING_RESPONSE', toState: 'COMPLETED', reason: 'All returned findings answered', policyVersionId: c.policy!.id, ruleRef: old.rule_ref,
    });
    const next = await enterStage(tx, ctx, c.app, c.workflow!, c.policy!, old.route_position, old.attempt_no + 1,
      `Re-scrutiny after the institution answered ${c.findings.filter((x) => x.stage_instance_id === old.id && x.state === 'RESPONSE_SUBMITTED').length} finding(s)`,
      { preferredUserId: old.assignee_user_id, carryFromStageId: old.id });
    return { responseId: r.id, reopened: true, newAttempt: next.attempt_no, newStageId: next.id };
  },
};

function closeFinding(name: 'RESOLVE_FINDING' | 'REJECT_FINDING_RESPONSE'): CommandDef<z.ZodObject<any>> {
  const resolving = name === 'RESOLVE_FINDING';
  return {
    name,
    label: resolving ? 'Mark a finding resolved' : 'Record that a response does not resolve a finding',
    input: z.object({ findingId: z.string().uuid(), note: z.string().trim().min(5).max(2000) }),
    guard(c) {
      if (!has(c.actor, 'FINDING_RAISE')) return deny(403, 'MISSING_CAPABILITY', 'Your role cannot review findings');
      const d = assignedOwnerGuard(c);
      if (d) return d;
      const states: FindingRow['state'][] = resolving ? ['OPEN', 'RESPONSE_SUBMITTED'] : ['RESPONSE_SUBMITTED'];
      if (reviewable(c, states).length === 0) {
        return deny(409, 'NO_FINDING_TO_REVIEW', resolving ? 'No open or answered finding at this stage' : 'No answered finding is waiting for review');
      }
      return null;
    },
    async run(tx, c, ctx, input) {
      const f = findingOf(c, input.findingId);
      const allowed: FindingRow['state'][] = resolving ? ['OPEN', 'RESPONSE_SUBMITTED'] : ['RESPONSE_SUBMITTED'];
      if (f.stage_key !== c.stage!.stage_key || !allowed.includes(f.state)) {
        throw new AppError(409, 'FINDING_NOT_REVIEWABLE', `The finding is ${f.state.toLowerCase().replace(/_/g, ' ')} and cannot be ${resolving ? 'resolved' : 'rejected'} now`);
      }
      const to = resolving ? 'RESOLVED' : 'NOT_RESOLVED';
      await tx.query('UPDATE findings SET state = $2, closed_by = $3, closed_at = $4, closure_note = $5 WHERE id = $1', [f.id, to, ctx.actor!.userId, ctx.at, input.note]);
      await markStarted(tx, c, ctx);
      await recordAudit(tx, ctx, {
        entityType: 'finding', entityId: f.id, action: resolving ? 'FINDING_RESOLVED' : 'FINDING_NOT_RESOLVED',
        before: { state: f.state }, after: { state: to }, reason: input.note,
        applicationId: c.app.id, institutionId: c.app.institution_id, policyVersionId: c.policy!.id, ruleRef: c.stage!.rule_ref,
        visibility: f.visibility === 'INSTITUTION' ? 'INSTITUTION' : 'INTERNAL',
      });
      return { findingId: f.id, state: to };
    },
  };
}

const AMENDABLE_FIELDS = ['campusAddress', 'landAreaAcres', 'programmes'] as const;

const requestAmendment: CommandDef<z.ZodObject<any>> = {
  name: 'REQUEST_AMENDMENT',
  label: 'Submit an amendment requested by a finding',
  input: z.object({
    findingId: z.string().uuid(),
    changes: z.object({
      campusAddress: z.string().trim().min(5).max(500).optional(),
      landAreaAcres: z.number().positive().max(10000).optional(),
      programmes: z.array(z.object({ name: z.string().trim().min(2).max(200), level: z.enum(['DIPLOMA', 'UG', 'PG']), intake: z.number().int().min(1).max(2000) })).min(1).max(30).optional(),
    }).refine((x) => Object.keys(x).length > 0, 'Change at least one field'),
    note: z.string().trim().min(10).max(2000),
  }),
  guard(c) {
    if (!has(c.actor, 'FINDING_RESPOND')) return deny(403, 'MISSING_CAPABILITY', 'Only the institution submits amendments');
    if (c.actor.institutionId !== c.app.institution_id) return deny(403, 'OUT_OF_SCOPE', 'This case belongs to another institution');
    if (!c.findings.some((f) => f.requests_amendment && f.state === 'RESPONSE_PENDING')) {
      return deny(409, 'NO_AMENDMENT_REQUESTED', 'No pending finding asks for an amendment');
    }
    return null;
  },
  async run(tx, c, ctx, input) {
    const f = findingOf(c, input.findingId);
    if (!f.requests_amendment || f.state !== 'RESPONSE_PENDING') throw new AppError(409, 'AMENDMENT_NOT_REQUESTED', 'This finding does not ask for an amendment');
    const snapshot = (await one(tx, 'SELECT submitted_snapshot FROM applications WHERE id = $1', [c.app.id])).submitted_snapshot;
    const form = snapshot?.form ?? {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of AMENDABLE_FIELDS) {
      if (input.changes[k] !== undefined) changes[k] = { from: form[k] ?? null, to: input.changes[k] };
    }
    const a = await one(
      tx,
      `INSERT INTO amendments (application_id, finding_id, changes, note, submitted_by, submitted_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [c.app.id, f.id, JSON.stringify(changes), input.note, ctx.actor!.userId, ctx.at],
    );
    await recordAudit(tx, ctx, {
      entityType: 'amendment', entityId: a.id, action: 'AMENDMENT_SUBMITTED', after: { findingId: f.id, changes },
      reason: input.note, applicationId: c.app.id, institutionId: c.app.institution_id, visibility: 'INSTITUTION',
    });
    return { amendmentId: a.id };
  },
};

const classifyManually: CommandDef<z.ZodObject<any>> = {
  name: 'CLASSIFY',
  label: 'Classify the application and choose its route',
  input: z.object({ routeKey: z.string().min(1).max(60), reason: z.string().trim().min(10).max(2000) }),
  guard(c) {
    if (!has(c.actor, 'CLASSIFY')) return deny(403, 'MISSING_CAPABILITY', 'Your role cannot classify applications');
    if (!coversRegion(c.actor, c.app.region_id)) return deny(403, 'OUT_OF_SCOPE', 'This case is outside your region');
    if (c.app.lifecycle_state !== 'AWAITING_CLASSIFICATION' || c.workflow?.state !== 'AWAITING_CLASSIFICATION') {
      return deny(409, 'NOT_AWAITING_CLASSIFICATION', 'The application already has a route');
    }
    return null;
  },
  async run(tx, c, ctx, input) {
    const policy = c.policy!;
    const route = policy.doc.routes[input.routeKey];
    if (!route) throw new ValidationError('Choose a route from the case policy version', [{ field: 'routeKey', message: 'Unknown route' }]);
    const wf = c.workflow!;
    const auto = wf.classification_trace;
    const trace: ClassificationTrace & { manual: unknown } = {
      ...auto,
      status: 'CLASSIFIED',
      routeKey: input.routeKey,
      matchedRuleId: null,
      ruleRef: ruleRef(policy.versionNo, `routes/${input.routeKey}`),
      provenance: route.provenance,
      explanation: `Classified manually by ${ctx.actor!.name} to route "${route.name}": ${route.stages.map((s) => policy.doc.stages[s].name).join(' → ')}. Reason: ${input.reason}. Automatic result: ${auto.explanation}`,
      manual: { byUserId: ctx.actor!.userId, byRole: ctx.actor!.role, reason: input.reason, at: ctx.at, automaticStatus: auto.status },
    };
    await tx.query(`UPDATE workflow_instances SET route_key = $2, classification_trace = $3, state = 'ACTIVE' WHERE id = $1`, [wf.id, input.routeKey, JSON.stringify(trace)]);
    wf.route_key = input.routeKey;
    wf.classification_trace = trace;
    wf.state = 'ACTIVE';
    await tx.query(`UPDATE proposals SET classification_status = 'CLASSIFIED' WHERE id = $1`, [wf.proposal_id]);
    await recordAudit(tx, ctx, {
      entityType: 'workflow', entityId: wf.id, action: 'ROUTE_SELECTED_MANUALLY',
      before: { status: auto.status }, after: { routeKey: input.routeKey }, reason: input.reason,
      applicationId: c.app.id, institutionId: c.app.institution_id, policyVersionId: policy.id, ruleRef: trace.ruleRef, visibility: 'INSTITUTION',
    });
    await recordTransition(tx, ctx, {
      applicationId: c.app.id, workflowId: wf.id, command: 'CLASSIFY', fromState: 'AWAITING_CLASSIFICATION', toState: 'ACTIVE',
      reason: input.reason, policyVersionId: policy.id, ruleRef: trace.ruleRef,
    });
    const first = await enterStage(tx, ctx, c.app, wf, policy, 0, 1, 'Route selected by manual classification');
    return { routeKey: input.routeKey, firstStageKey: first.stage_key };
  },
};

const fileAppeal: CommandDef<z.ZodObject<any>> = {
  name: 'FILE_APPEAL',
  label: 'File an appeal against the decision',
  input: z.object({ grounds: z.string().trim().min(20).max(6000) }),
  guard(c) {
    if (!has(c.actor, 'APPEAL_FILE')) return deny(403, 'MISSING_CAPABILITY', 'Only the institution can file an appeal');
    if (c.actor.institutionId !== c.app.institution_id) return deny(403, 'OUT_OF_SCOPE', 'This case belongs to another institution');
    const appeal = c.policy?.doc.appeal;
    if (!appeal) return deny(409, 'NO_APPEAL_ROUTE', 'The policy of this case has no appeal route');
    if (!c.decision) return deny(409, 'NO_DECISION', 'There is no recorded decision to appeal');
    if (c.workflowKind === 'APPEAL') return deny(409, 'ALREADY_AN_APPEAL', 'A decision on an appeal cannot be appealed again here');
    if (!appeal.appealableOutcomes.includes(c.decision.outcome as any)) return deny(409, 'NOT_APPEALABLE', `A ${c.decision.outcome.toLowerCase().replace(/_/g, ' ')} decision cannot be appealed under the policy`);
    if (c.appealed) return deny(409, 'ALREADY_APPEALED', 'This decision has already been appealed');
    return null;
  },
  async run(tx, c, ctx, input) {
    const policy = c.policy!;
    const appeal = policy.doc.appeal!;
    const decision = c.decision!;
    const deadline = new Date(new Date(decision.issued_at).getTime() + appeal.windowDays * 86_400_000);
    if (ctx.at > deadline) {
      throw new AppError(409, 'APPEAL_WINDOW_CLOSED', `The ${appeal.windowDays}-day appeal window (demo rule) closed on ${deadline.toISOString().slice(0, 10)}`);
    }
    const route = policy.doc.routes[appeal.routeKey];
    const ref = ruleRef(policy.versionNo, 'appeal');
    const trace: ClassificationTrace = {
      status: 'CLASSIFIED', routeKey: appeal.routeKey, matchedRuleId: 'appeal', ruleRef: ref, provenance: appeal.provenance, evaluated: [],
      explanation: `Appeal against decision of ${new Date(decision.issued_at).toISOString().slice(0, 10)} (${decision.outcome}) follows the configured appeal route "${route.name}": ${route.stages.map((s) => policy.doc.stages[s].name).join(' → ')}.`,
    };
    const primary = c.workflow!;
    const wf = await one<WorkflowRow>(
      tx,
      `INSERT INTO workflow_instances (application_id, proposal_id, kind, appeal_of_decision_id, policy_version_id, route_key, classification_trace, state, created_at)
       VALUES ($1,$2,'APPEAL',$3,$4,$5,$6,'ACTIVE',$7) RETURNING *`,
      [c.app.id, primary.proposal_id, decision.id, policy.id, appeal.routeKey, JSON.stringify(trace), ctx.at],
    );
    const a = await one(
      tx,
      `INSERT INTO appeals (application_id, decision_id, workflow_id, grounds, filed_by, filed_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [c.app.id, decision.id, wf.id, input.grounds, ctx.actor!.userId, ctx.at],
    );
    await tx.query('UPDATE applications SET current_workflow_id = $2 WHERE id = $1', [c.app.id, wf.id]);
    c.app.current_workflow_id = wf.id;
    await recordAudit(tx, ctx, {
      entityType: 'appeal', entityId: a.id, action: 'APPEAL_FILED', after: { decisionId: decision.id, workflowId: wf.id, routeKey: appeal.routeKey },
      reason: input.grounds, applicationId: c.app.id, institutionId: c.app.institution_id, policyVersionId: policy.id, ruleRef: ref, visibility: 'INSTITUTION',
    });
    await recordTransition(tx, ctx, {
      applicationId: c.app.id, workflowId: wf.id, command: 'FILE_APPEAL', toState: 'ACTIVE', reason: input.grounds, policyVersionId: policy.id, ruleRef: ref,
    });
    await emitEvent(tx, ctx, 'APPEAL_FILED', 'application', c.app.id, { applicationId: c.app.id, appNo: c.app.app_no, decisionId: decision.id, regionId: c.app.region_id });
    await enterStage(tx, ctx, c.app, wf, policy, 0, 1, 'Appeal filed');
    return { appealId: a.id, workflowId: wf.id };
  },
};

export const M2_COMMANDS: CommandDef<any>[] = [
  raiseFinding,
  returnToInstitution,
  respondToFinding,
  closeFinding('RESOLVE_FINDING'),
  closeFinding('REJECT_FINDING_RESPONSE'),
  requestAmendment,
  classifyManually,
  fileAppeal,
];

/** Findings of every workflow of the case, with their responses; internal findings only for internal viewers. */
export async function findingsForView(db: Db, appId: string, internal: boolean) {
  const rows = await q(
    db,
    `SELECT f.*, s.attempt_no, u.name AS raised_by_name, cu.name AS closed_by_name
       FROM findings f JOIN stage_instances s ON s.id = f.stage_instance_id
       JOIN users u ON u.id = f.raised_by LEFT JOIN users cu ON cu.id = f.closed_by
      WHERE f.application_id = $1 ${internal ? '' : `AND f.visibility = 'INSTITUTION'`}
      ORDER BY f.raised_at`,
    [appId],
  );
  const responses = rows.length
    ? await q(db, `SELECT r.*, u.name AS submitted_by_name FROM finding_responses r JOIN users u ON u.id = r.submitted_by WHERE r.finding_id = ANY($1::uuid[]) ORDER BY r.submitted_at`, [rows.map((r) => r.id)])
    : [];
  return rows.map((f) => ({
    id: f.id, workflowId: f.workflow_id, stageKey: f.stage_key, attemptNo: f.attempt_no, checklistCode: f.checklist_code, reasonCode: f.reason_code,
    explanation: f.explanation, requestedEvidence: f.requested_evidence, responsibleParty: f.responsible_party, visibility: f.visibility,
    requestsAmendment: f.requests_amendment, state: f.state, raisedAt: f.raised_at, raisedBy: internal ? f.raised_by_name : null,
    returnedAt: f.returned_at, responseDueNote: f.response_due_note, closedAt: f.closed_at, closedBy: internal ? f.closed_by_name : null,
    closureNote: f.closure_note,
    responses: responses.filter((r) => r.finding_id === f.id).map((r) => ({ id: r.id, text: r.text, submittedAt: r.submitted_at, submittedBy: r.submitted_by_name })),
  }));
}
