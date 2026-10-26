import type pg from 'pg';
import { z } from 'zod';
import type { Db } from '../../db.js';
import { AppError, ValidationError, one, q } from '../../db.js';
import type { ActionContext } from '../audit/audit.js';
import { recordAudit } from '../audit/audit.js';
import type { Actor } from '../identity/permissions.js';
import { coversRegion, has } from '../identity/permissions.js';
import { closeDeadlines } from '../deadlines/engine.js';
import { emitEvent } from '../outbox/outbox.js';
import { routeStages, ruleRef } from '../policy/engine.js';
import type { StageDef } from '../policy/schema.js';
import type { PolicyVersion } from '../policy/service.js';
import type { AppRow, StageRow, WorkflowRow } from '../workflow/workflow.js';
import {
  eligibleAssignees, enterStage, evaluateCompletion, loadWorkflowContext, recordTransition, setApplicationState, setStageState,
} from '../workflow/workflow.js';
import { assertVersion, bumpVersion, loadVisibleApplication } from './service.js';
import type { CaseContext, CommandDef } from './command-kit.js';
import { LIVE_WORK_STATES, assignedOwnerGuard, deny, loadCaseExtras, markStarted } from './command-kit.js';
import { M2_COMMANDS } from './commands-m2.js';
import { EVC_COMMANDS } from '../evc/commands.js';

export type { CaseContext, Denial } from './command-kit.js';

const assignStage: CommandDef<z.ZodObject<any>> = {
  name: 'ASSIGN_STAGE',
  label: 'Assign or reassign the current stage',
  input: z.object({ userId: z.string().uuid(), reason: z.string().trim().min(5).max(500) }),
  guard(c) {
    if (!has(c.actor, 'STAGE_ASSIGN')) return deny(403, 'MISSING_CAPABILITY', 'Your role cannot assign stages');
    if (!coversRegion(c.actor, c.app.region_id)) return deny(403, 'OUT_OF_SCOPE', 'This case is outside your region');
    if (!c.stage) return deny(409, 'NO_ACTIVE_STAGE', 'The case has no active stage');
    if (!['QUEUED', 'ASSIGNED', 'IN_PROGRESS'].includes(c.stage.state)) return deny(409, 'STAGE_NOT_ASSIGNABLE', 'The current stage cannot be reassigned now');
    return null;
  },
  async run(tx, c, ctx, input) {
    const stage = c.stage!;
    const eligible = await eligibleAssignees(tx, c.stageDef!, c.app.region_id, ctx.at);
    const target = eligible.find((e) => e.user_id === input.userId);
    if (!target) throw new ValidationError('That user is not eligible for this stage', [{ field: 'userId', message: 'Choose an eligible user' }]);
    if (target.user_id === stage.assignee_user_id) throw new ValidationError('The stage is already assigned to that user');
    await tx.query('UPDATE stage_assignments SET ended_at = $2 WHERE stage_instance_id = $1 AND ended_at IS NULL', [stage.id, ctx.at]);
    await tx.query(
      `INSERT INTO stage_assignments (stage_instance_id, user_id, assigned_by, method, reason, assigned_at) VALUES ($1,$2,$3,'MANUAL',$4,$5)`,
      [stage.id, target.user_id, ctx.actor!.userId, input.reason, ctx.at],
    );
    const before = { assigneeUserId: stage.assignee_user_id, state: stage.state };
    await tx.query('UPDATE stage_instances SET assignee_user_id = $2, committee_id = $3 WHERE id = $1', [stage.id, target.user_id, target.committee_id]);
    if (stage.state === 'QUEUED') await setStageState(tx, stage, 'ASSIGNED');
    await recordAudit(tx, ctx, {
      entityType: 'stage', entityId: stage.id, action: 'STAGE_REASSIGNED', before,
      after: { assigneeUserId: target.user_id, state: stage.state }, reason: input.reason,
      applicationId: c.app.id, institutionId: c.app.institution_id, policyVersionId: c.policy!.id, ruleRef: stage.rule_ref,
    });
    await recordTransition(tx, ctx, {
      applicationId: c.app.id, workflowId: c.workflow!.id, command: 'ASSIGN_STAGE', fromStage: stage.stage_key, toStage: stage.stage_key,
      fromState: before.state, toState: stage.state, reason: input.reason, policyVersionId: c.policy!.id, ruleRef: stage.rule_ref,
    });
    await emitEvent(tx, ctx, 'STAGE_ASSIGNED', 'stage', stage.id, {
      applicationId: c.app.id, appNo: c.app.app_no, stageKey: stage.stage_key, stageName: c.stageDef!.name, assigneeUserId: target.user_id,
      regionId: c.app.region_id,
    });
    return { assigneeUserId: target.user_id };
  },
};

const checklistItemInput = z.object({
  code: z.string(),
  status: z.enum(['PENDING', 'SATISFIED', 'DEFICIENT', 'NOT_APPLICABLE']),
  observation: z.string().trim().max(2000).optional(),
});

const saveChecklist: CommandDef<z.ZodObject<any>> = {
  name: 'SAVE_CHECKLIST',
  label: 'Record checklist results',
  input: z.object({ items: z.array(checklistItemInput).min(1).max(100) }),
  guard(c) {
    if (!has(c.actor, 'STAGE_WORK')) return deny(403, 'MISSING_CAPABILITY', 'Your role cannot work on stages');
    const d = assignedOwnerGuard(c);
    if (d) return d;
    if (c.stageDef!.checklist.length === 0) return deny(409, 'NO_CHECKLIST', 'This stage has no checklist');
    return null;
  },
  async run(tx, c, ctx, input) {
    const stage = c.stage!;
    const existing = await q(tx, 'SELECT code, status, observation FROM checklist_items WHERE stage_instance_id = $1', [stage.id]);
    const byCode = new Map(existing.map((e) => [e.code, e]));
    const problems: Array<{ field: string; message: string }> = [];
    for (const item of input.items) {
      if (!byCode.has(item.code)) problems.push({ field: item.code, message: 'Not a checklist item of this stage' });
      if ((item.status === 'DEFICIENT' || item.status === 'NOT_APPLICABLE') && !item.observation) {
        problems.push({ field: item.code, message: 'An observation is required for deficient or not-applicable items' });
      }
    }
    if (problems.length) throw new ValidationError('Some checklist entries are invalid', problems);
    const changed: Array<{ code: string; before: unknown; after: unknown }> = [];
    for (const item of input.items) {
      const prev = byCode.get(item.code);
      if (prev.status === item.status && (prev.observation ?? '') === (item.observation ?? '')) continue;
      await tx.query(
        `UPDATE checklist_items SET status = $3, observation = $4, updated_by = $5, updated_at = $6 WHERE stage_instance_id = $1 AND code = $2`,
        [stage.id, item.code, item.status, item.observation ?? null, ctx.actor!.userId, ctx.at],
      );
      changed.push({ code: item.code, before: { status: prev.status, observation: prev.observation }, after: { status: item.status, observation: item.observation ?? null } });
    }
    if (changed.length) {
      await markStarted(tx, c, ctx);
      await recordAudit(tx, ctx, {
        entityType: 'stage', entityId: stage.id, action: 'CHECKLIST_RECORDED',
        before: changed.map((x) => ({ code: x.code, ...(x.before as object) })),
        after: changed.map((x) => ({ code: x.code, ...(x.after as object) })),
        applicationId: c.app.id, institutionId: c.app.institution_id, policyVersionId: c.policy!.id, ruleRef: stage.rule_ref,
      });
    }
    return { changed: changed.length };
  },
};

const recordRecommendation: CommandDef<z.ZodObject<any>> = {
  name: 'RECORD_RECOMMENDATION',
  label: 'Record a recommendation',
  input: z.object({
    recommendation: z.enum(['RECOMMEND_APPROVAL', 'RECOMMEND_APPROVAL_WITH_CONDITIONS', 'RECOMMEND_REJECTION', 'RECOMMEND_DEFERRAL']),
    text: z.string().trim().min(10).max(4000),
    proposedConditions: z.array(z.string().trim().min(5).max(500)).max(20).default([]),
  }),
  guard(c) {
    if (!has(c.actor, 'RECOMMEND')) return deny(403, 'MISSING_CAPABILITY', 'Your role cannot record recommendations');
    const d = assignedOwnerGuard(c);
    if (d) return d;
    if (!c.stageDef!.completion.includes('RECOMMENDATION_RECORDED')) return deny(409, 'NOT_REQUIRED', 'This stage does not take a recommendation');
    return null;
  },
  async run(tx, c, ctx, input) {
    if (input.recommendation === 'RECOMMEND_APPROVAL_WITH_CONDITIONS' && input.proposedConditions.length === 0) {
      throw new ValidationError('Add at least one proposed condition', [{ field: 'proposedConditions', message: 'Required for a conditional recommendation' }]);
    }
    const rec = await one(
      tx,
      `INSERT INTO recommendations (application_id, stage_instance_id, author_user_id, author_role, committee_id, recommendation, text, proposed_conditions, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [c.app.id, c.stage!.id, ctx.actor!.userId, ctx.actor!.role, c.stage!.committee_id, input.recommendation, input.text,
        JSON.stringify(input.proposedConditions), ctx.at],
    );
    await markStarted(tx, c, ctx);
    await recordAudit(tx, ctx, {
      entityType: 'recommendation', entityId: rec.id, action: 'RECOMMENDATION_RECORDED',
      after: { recommendation: input.recommendation, proposedConditions: input.proposedConditions },
      reason: input.text, applicationId: c.app.id, institutionId: c.app.institution_id, policyVersionId: c.policy!.id, ruleRef: c.stage!.rule_ref,
    });
    return { recommendationId: rec.id };
  },
};

const completeStage: CommandDef<z.ZodObject<any>> = {
  name: 'COMPLETE_STAGE',
  label: 'Complete this stage and move to the next required stage',
  input: z.object({ note: z.string().trim().max(1000).optional() }),
  guard(c) {
    if (!has(c.actor, 'STAGE_WORK')) return deny(403, 'MISSING_CAPABILITY', 'Your role cannot complete stages');
    const d = assignedOwnerGuard(c);
    if (d) return d;
    if (c.stage!.stage_kind === 'DECISION') return deny(409, 'USE_DECISION', 'A decision stage is completed by recording a decision');
    return null;
  },
  async run(tx, c, ctx, input) {
    const stage = c.stage!;
    const conditions = await evaluateCompletion(tx, stage, c.stageDef!);
    const unmet = conditions.filter((x) => !x.met);
    if (unmet.length) {
      throw new AppError(422, 'COMPLETION_CONDITIONS_NOT_MET', 'The stage cannot be completed yet', unmet);
    }
    const from = stage.state;
    await setStageState(tx, stage, 'COMPLETED', { completed_at: ctx.at, completed_by: ctx.actor!.userId, outcome: 'COMPLETED', outcome_reason: input.note ?? null });
    await closeDeadlines(tx, ctx, stage.id, 'MET', `${c.stageDef!.name} completed`);
    await tx.query('UPDATE stage_assignments SET ended_at = $2 WHERE stage_instance_id = $1 AND ended_at IS NULL', [stage.id, ctx.at]);
    await recordAudit(tx, ctx, {
      entityType: 'stage', entityId: stage.id, action: 'STAGE_COMPLETED',
      before: { state: from }, after: { state: 'COMPLETED', conditions }, reason: input.note ?? 'Completion conditions met',
      applicationId: c.app.id, institutionId: c.app.institution_id, policyVersionId: c.policy!.id, ruleRef: stage.rule_ref,
      visibility: 'INSTITUTION',
    });
    await recordTransition(tx, ctx, {
      applicationId: c.app.id, workflowId: c.workflow!.id, command: 'COMPLETE_STAGE', fromStage: stage.stage_key,
      fromState: from, toState: 'COMPLETED', reason: input.note ?? null, policyVersionId: c.policy!.id, ruleRef: stage.rule_ref,
    });
    const stages = routeStages(c.policy!.doc, c.workflow!.route_key!);
    const nextPosition = stage.route_position + 1;
    if (nextPosition >= stages.length) {
      // Validation guarantees every route ends in a decision stage, so this cannot be reached by a valid policy.
      throw new AppError(500, 'ROUTE_END_WITHOUT_DECISION', 'Route ended without a decision stage');
    }
    const next = await enterStage(tx, ctx, c.app, c.workflow!, c.policy!, nextPosition, 1, `${c.stageDef!.name} completed`);
    return { nextStageKey: next.stage_key, nextStageState: next.state };
  },
};

const recordDecision: CommandDef<z.ZodObject<any>> = {
  name: 'RECORD_DECISION',
  label: 'Record the decision',
  input: z.object({
    outcome: z.enum(['APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'DEFERRED']),
    reason: z.string().trim().min(10).max(4000),
    conditions: z.array(z.object({ text: z.string().trim().min(5).max(1000), dueInDays: z.number().int().min(1).max(1095).optional() })).max(20).default([]),
  }),
  guard(c) {
    if (!has(c.actor, 'DECISION_RECORD')) return deny(403, 'MISSING_CAPABILITY', 'Only a competent authority can record decisions');
    if (!coversRegion(c.actor, c.app.region_id)) return deny(403, 'OUT_OF_SCOPE', 'This case is outside your delegated scope');
    if (!c.stage || c.stage.stage_kind !== 'DECISION') return deny(409, 'NOT_AT_DECISION', 'The case has not reached the decision stage');
    if (!LIVE_WORK_STATES.includes(c.stage.state)) return deny(409, 'STAGE_NOT_WORKABLE', 'The decision stage is not open');
    if (c.stage.assignee_user_id !== c.actor.userId) return deny(403, 'NOT_ASSIGNED', 'The decision is assigned to another authority');
    return null;
  },
  async run(tx, c, ctx, input) {
    const policy = c.policy!;
    if (!policy.doc.decision.outcomes.includes(input.outcome)) {
      throw new ValidationError('That outcome is not permitted by the policy', [{ field: 'outcome', message: 'Not permitted' }]);
    }
    if (policy.doc.decision.conditionsRequiredFor.includes(input.outcome) && input.conditions.length === 0) {
      throw new ValidationError('Add at least one condition', [{ field: 'conditions', message: 'Required for this outcome' }]);
    }
    if (!policy.doc.decision.conditionsRequiredFor.includes(input.outcome) && input.conditions.length > 0) {
      throw new ValidationError('Conditions can only be attached to a conditional outcome', [{ field: 'conditions', message: 'Remove conditions or change the outcome' }]);
    }
    // Every earlier stage of this workflow must be completed: no stage can be skipped.
    const open = await q(tx, `SELECT stage_key FROM stage_instances WHERE workflow_id = $1 AND stage_kind <> 'DECISION' AND state NOT IN ('COMPLETED','CANCELLED')`, [c.workflow!.id]);
    if (open.length) throw new AppError(409, 'PRIOR_STAGES_OPEN', 'Earlier stages are still open', open);
    const stage = c.stage!;
    const ref = ruleRef(policy.versionNo, 'decision');
    const decision = await one(
      tx,
      `INSERT INTO decisions (application_id, workflow_id, stage_instance_id, outcome, reason, conditions, authority_user_id, authority_grant_id,
         policy_version_id, rule_ref, issued_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [c.app.id, c.workflow!.id, stage.id, input.outcome, input.reason, JSON.stringify(input.conditions), ctx.actor!.userId, ctx.actor!.grantId,
        policy.id, ref, ctx.at],
    );
    const from = stage.state;
    await setStageState(tx, stage, 'COMPLETED', { completed_at: ctx.at, completed_by: ctx.actor!.userId, outcome: input.outcome, outcome_reason: input.reason });
    await closeDeadlines(tx, ctx, stage.id, 'MET', 'Decision recorded');
    await tx.query('UPDATE stage_assignments SET ended_at = $2 WHERE stage_instance_id = $1 AND ended_at IS NULL', [stage.id, ctx.at]);
    await tx.query(`UPDATE workflow_instances SET state = 'COMPLETED', completed_at = $2 WHERE id = $1`, [c.workflow!.id, ctx.at]);
    await tx.query('UPDATE applications SET decision_outcome = $2, compliance_status = $3 WHERE id = $1', [
      c.app.id, input.outcome, input.conditions.length ? 'OPEN' : 'NONE',
    ]);
    await setApplicationState(tx, ctx, c.app, 'DECISION_RECORDED', `Decision recorded: ${input.outcome}`);
    await recordAudit(tx, ctx, {
      entityType: 'decision', entityId: decision.id, action: 'DECISION_RECORDED',
      after: { outcome: input.outcome, conditions: input.conditions }, reason: input.reason,
      applicationId: c.app.id, institutionId: c.app.institution_id, policyVersionId: policy.id, ruleRef: ref, visibility: 'INSTITUTION',
    });
    await recordTransition(tx, ctx, {
      applicationId: c.app.id, workflowId: c.workflow!.id, command: 'RECORD_DECISION', fromStage: stage.stage_key,
      fromState: from, toState: 'COMPLETED', reason: input.reason, policyVersionId: policy.id, ruleRef: ref,
    });
    await emitEvent(tx, ctx, 'DECISION_RECORDED', 'application', c.app.id, {
      applicationId: c.app.id, appNo: c.app.app_no, outcome: input.outcome, institutionId: c.app.institution_id,
    });
    return { decisionId: decision.id, outcome: input.outcome };
  },
};

export const COMMANDS: Record<string, CommandDef<any>> = Object.fromEntries(
  [assignStage, saveChecklist, recordRecommendation, completeStage, recordDecision, ...M2_COMMANDS, ...EVC_COMMANDS].map((c) => [c.name, c]),
);

export async function loadCaseContext(db: Db, actor: Actor, appId: string, forUpdate: boolean): Promise<CaseContext> {
  const app = await loadVisibleApplication(db, actor, appId, forUpdate);
  const wf = await loadWorkflowContext(db, app);
  const extras = await loadCaseExtras(db, app, wf.workflow);
  const member = extras.evcVisit && actor.committeeKind === 'EVC' ? (await q(db, 'SELECT confirmed_at FROM visit_members WHERE visit_id = $1 AND expert_user_id = $2 AND committee_id = $3', [extras.evcVisit.id, actor.userId, actor.committeeId]))[0] : null;
  return { actor, app, ...wf, ...extras, evcMember: !!member, evcMemberConfirmed: !!member?.confirmed_at };
}

export function permittedCommands(c: CaseContext) {
  return Object.values(COMMANDS).map((cmd) => {
    const d = cmd.guard(c);
    return { command: cmd.name, label: cmd.label, allowed: !d, reason: d?.message ?? null };
  });
}

/** Executes a case command: lock → version check → guard → validate → run, all in the caller's transaction. */
export async function executeCommand(tx: pg.PoolClient, ctx: ActionContext, appId: string, body: { command: string; expectedVersion: number; [k: string]: unknown }) {
  const actor = ctx.actor!;
  const def = COMMANDS[body.command];
  if (!def) throw new ValidationError(`Unknown command ${body.command}`);
  const c = await loadCaseContext(tx, actor, appId, true);
  assertVersion(c.app, body.expectedVersion);
  const denial = def.guard(c);
  if (denial) throw new AppError(denial.status, denial.code, denial.message);
  const { command: _c, expectedVersion: _v, ...rest } = body;
  const parsed = def.input.safeParse(rest);
  if (!parsed.success) {
    throw new ValidationError('Invalid command input', parsed.error.issues.map((i: z.ZodIssue) => ({ field: i.path.join('.'), message: i.message })));
  }
  const result = await def.run(tx, c, ctx, parsed.data);
  const rowVersion = await bumpVersion(tx, appId, ctx.at);
  return { command: def.name, rowVersion, result };
}
