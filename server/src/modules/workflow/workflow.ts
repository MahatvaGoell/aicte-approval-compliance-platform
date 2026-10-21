import type { Db } from '../../db.js';
import { one, q } from '../../db.js';
import type { ActionContext } from '../audit/audit.js';
import { recordAudit } from '../audit/audit.js';
import { emitEvent } from '../outbox/outbox.js';
import type { ClassificationTrace } from '../policy/engine.js';
import { classify, routeStages, ruleRef } from '../policy/engine.js';
import type { StageDef } from '../policy/schema.js';
import type { PolicyVersion } from '../policy/service.js';
import { getPolicyVersion } from '../policy/service.js';
import type { ApplicationState, StageState } from './states.js';
import { assertApplicationTransition, assertStageTransition } from './states.js';

export interface AppRow {
  id: string;
  app_no: string;
  institution_id: string;
  region_id: string;
  cycle_code: string;
  lifecycle_state: ApplicationState;
  draft_data: any;
  submitted_snapshot: any;
  decision_outcome: string | null;
  compliance_status: string;
  current_workflow_id: string | null;
  row_version: number;
}

export interface WorkflowRow {
  id: string;
  application_id: string;
  proposal_id: string;
  policy_version_id: string;
  route_key: string | null;
  classification_trace: ClassificationTrace;
  state: string;
  current_stage_id: string | null;
}

export interface StageRow {
  id: string;
  workflow_id: string;
  application_id: string;
  stage_key: string;
  stage_kind: string;
  route_position: number;
  attempt_no: number;
  state: StageState;
  owner_role: string;
  committee_id: string | null;
  assignee_user_id: string | null;
  rule_ref: string;
  entered_at: Date;
  started_at: Date | null;
}

export async function setApplicationState(tx: Db, ctx: ActionContext, app: AppRow, to: ApplicationState, reason: string) {
  if (app.lifecycle_state === to) return;
  assertApplicationTransition(app.lifecycle_state, to);
  await tx.query('UPDATE applications SET lifecycle_state = $2, updated_at = $3 WHERE id = $1', [app.id, to, ctx.at]);
  await recordAudit(tx, ctx, {
    entityType: 'application', entityId: app.id, action: 'LIFECYCLE_CHANGED',
    before: { lifecycleState: app.lifecycle_state }, after: { lifecycleState: to }, reason,
    applicationId: app.id, institutionId: app.institution_id, visibility: 'INSTITUTION',
  });
  app.lifecycle_state = to;
}

export async function setStageState(tx: Db, stage: StageRow, to: StageState, extra: Record<string, unknown> = {}) {
  assertStageTransition(stage.state, to);
  const sets = ['state = $2'];
  const params: unknown[] = [stage.id, to];
  for (const [k, v] of Object.entries(extra)) {
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  await tx.query(`UPDATE stage_instances SET ${sets.join(', ')} WHERE id = $1`, params);
  stage.state = to;
}

export async function recordTransition(
  tx: Db,
  ctx: ActionContext,
  t: {
    applicationId: string; workflowId: string | null; command: string; fromStage?: string | null; toStage?: string | null;
    fromState?: string | null; toState?: string | null; reason?: string | null; policyVersionId?: string | null; ruleRef?: string | null;
  },
) {
  await tx.query(
    `INSERT INTO transitions (application_id, workflow_id, command, from_stage, to_stage, from_state, to_state,
       actor_user_id, actor_role, reason, policy_version_id, rule_ref, at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      t.applicationId, t.workflowId, t.command, t.fromStage ?? null, t.toStage ?? null, t.fromState ?? null,
      t.toState ?? null, ctx.actor?.userId ?? null, ctx.actor?.role ?? 'SYSTEM', t.reason ?? null,
      t.policyVersionId ?? null, t.ruleRef ?? null, ctx.at,
    ],
  );
}

/**
 * Users who may own a stage for this application, least loaded first.
 * Committee stages draw from members of a committee of the configured kind in the case's region.
 */
export async function eligibleAssignees(db: Db, def: StageDef, regionId: string, at: Date) {
  const params: unknown[] = [def.ownerRole, at, regionId];
  let scope: string;
  if (def.ownerRole === 'COMMITTEE_MEMBER') {
    params.push(def.committeeKind);
    scope = `c.kind = $4 AND (c.region_id IS NULL OR c.region_id = $3)`;
  } else {
    scope = `(g.scope_all OR $3 = ANY(g.region_ids))`;
  }
  return q<{ user_id: string; name: string; committee_id: string | null; open_load: number }>(
    db,
    `SELECT DISTINCT ON (u.id) u.id AS user_id, u.name, g.committee_id,
            (SELECT count(*)::int FROM stage_instances si
              WHERE si.assignee_user_id = u.id AND si.state IN ('ASSIGNED','IN_PROGRESS')) AS open_load
       FROM users u
       JOIN capability_grants g ON g.user_id = u.id
       LEFT JOIN committees c ON c.id = g.committee_id
      WHERE u.is_active AND g.role = $1 AND g.revoked_at IS NULL
        AND g.valid_from <= $2 AND (g.valid_to IS NULL OR g.valid_to > $2)
        AND ${scope}
      ORDER BY u.id`,
    params,
  ).then((rows) => rows.sort((a, b) => a.open_load - b.open_load || a.name.localeCompare(b.name)));
}

/** Opens a stage attempt at a route position and assigns it if an eligible owner exists. */
export async function enterStage(
  tx: Db,
  ctx: ActionContext,
  app: AppRow,
  workflow: WorkflowRow,
  policy: PolicyVersion,
  position: number,
  attemptNo = 1,
  reason = 'Previous stage completed',
): Promise<StageRow> {
  const stages = routeStages(policy.doc, workflow.route_key!);
  const { key, def } = stages[position];
  const ref = ruleRef(policy.versionNo, `stages/${key}`);
  const candidates = await eligibleAssignees(tx, def, app.region_id, ctx.at);
  const assignee = candidates[0] ?? null;
  const stage = await one<StageRow>(
    tx,
    `INSERT INTO stage_instances (workflow_id, application_id, stage_key, stage_kind, route_position, attempt_no, state,
       owner_role, committee_id, assignee_user_id, rule_ref, entered_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      workflow.id, app.id, key, def.kind, position, attemptNo, assignee ? 'ASSIGNED' : 'QUEUED', def.ownerRole,
      assignee?.committee_id ?? null, assignee?.user_id ?? null, ref, ctx.at,
    ],
  );
  for (const item of def.checklist) {
    await tx.query(
      `INSERT INTO checklist_items (stage_instance_id, code, requirement, rule_ref, provenance, evidence_doc_type)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [stage.id, item.code, item.requirement, ruleRef(policy.versionNo, `stages/${key}/checklist/${item.code}`),
        item.provenance, item.evidenceDocType ?? null],
    );
  }
  if (assignee) {
    await tx.query(
      `INSERT INTO stage_assignments (stage_instance_id, user_id, assigned_by, method, reason, assigned_at)
       VALUES ($1, $2, NULL, 'AUTO_LEAST_LOADED', $3, $4)`,
      [stage.id, assignee.user_id, `Least open stages among ${candidates.length} eligible ${def.ownerRole} user(s)`, ctx.at],
    );
  }
  await tx.query('UPDATE workflow_instances SET current_stage_id = $2 WHERE id = $1', [workflow.id, stage.id]);
  workflow.current_stage_id = stage.id;

  await recordTransition(tx, ctx, {
    applicationId: app.id, workflowId: workflow.id, command: 'ENTER_STAGE', toStage: key, toState: stage.state,
    reason, policyVersionId: policy.id, ruleRef: ref,
  });
  await recordAudit(tx, ctx, {
    entityType: 'stage', entityId: stage.id, action: 'STAGE_ENTERED',
    after: { stageKey: key, attemptNo, state: stage.state, assigneeUserId: assignee?.user_id ?? null },
    reason, applicationId: app.id, institutionId: app.institution_id, policyVersionId: policy.id, ruleRef: ref,
    visibility: 'INSTITUTION',
  });
  if (assignee) {
    await recordAudit(tx, ctx, {
      entityType: 'stage', entityId: stage.id, action: 'STAGE_ASSIGNED',
      after: { assigneeUserId: assignee.user_id, method: 'AUTO_LEAST_LOADED' },
      reason: 'Automatic assignment to the least-loaded eligible user',
      applicationId: app.id, institutionId: app.institution_id, policyVersionId: policy.id, ruleRef: ref,
    });
  }
  await emitEvent(tx, ctx, assignee ? 'STAGE_ASSIGNED' : 'STAGE_QUEUED', 'stage', stage.id, {
    applicationId: app.id, appNo: app.app_no, stageKey: key, stageName: def.name, assigneeUserId: assignee?.user_id ?? null,
    regionId: app.region_id,
  });
  await setApplicationState(tx, ctx, app, def.kind === 'DECISION' ? 'AWAITING_DECISION' : 'IN_PROCESS', `Entered stage ${def.name}`);
  return stage;
}

/** Classifies the submitted proposal under the given policy and starts its workflow instance. */
export async function startWorkflow(tx: Db, ctx: ActionContext, app: AppRow, policy: PolicyVersion) {
  const proposal = await one(tx, 'SELECT * FROM proposals WHERE application_id = $1 ORDER BY created_at LIMIT 1', [app.id]);
  const trace = classify(policy.doc, policy.versionNo, { categoryCode: proposal.category_code, details: proposal.details });
  const classified = trace.status === 'CLASSIFIED';
  const workflow = await one<WorkflowRow>(
    tx,
    `INSERT INTO workflow_instances (application_id, proposal_id, policy_version_id, route_key, classification_trace, state, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [app.id, proposal.id, policy.id, trace.routeKey, JSON.stringify(trace), classified ? 'ACTIVE' : 'AWAITING_CLASSIFICATION', ctx.at],
  );
  await tx.query('UPDATE proposals SET classification_status = $2 WHERE id = $1', [
    proposal.id, classified ? 'CLASSIFIED' : 'NEEDS_CLASSIFICATION',
  ]);
  await tx.query('UPDATE applications SET current_workflow_id = $2 WHERE id = $1', [app.id, workflow.id]);
  app.current_workflow_id = workflow.id;
  await recordAudit(tx, ctx, {
    entityType: 'workflow', entityId: workflow.id, action: classified ? 'ROUTE_SELECTED' : 'CLASSIFICATION_REQUIRED',
    after: { routeKey: trace.routeKey, status: trace.status, matchedRuleId: trace.matchedRuleId },
    reason: trace.explanation, applicationId: app.id, institutionId: app.institution_id,
    policyVersionId: policy.id, ruleRef: trace.ruleRef, visibility: 'INSTITUTION',
  });
  await recordTransition(tx, ctx, {
    applicationId: app.id, workflowId: workflow.id, command: 'CLASSIFY_AUTOMATIC', toState: workflow.state,
    reason: trace.explanation, policyVersionId: policy.id, ruleRef: trace.ruleRef,
  });
  if (classified) {
    await enterStage(tx, ctx, app, workflow, policy, 0, 1, 'Route selected on submission');
  } else {
    await setApplicationState(tx, ctx, app, 'AWAITING_CLASSIFICATION', trace.explanation);
    await emitEvent(tx, ctx, 'CLASSIFICATION_REQUIRED', 'application', app.id, { applicationId: app.id, appNo: app.app_no, regionId: app.region_id });
  }
  return workflow;
}

export interface ConditionResult {
  condition: string;
  met: boolean;
  detail: string;
}

/** Evaluates the configured completion conditions of a stage attempt. */
export async function evaluateCompletion(db: Db, stage: StageRow, def: StageDef): Promise<ConditionResult[]> {
  const results: ConditionResult[] = [];
  for (const condition of def.completion) {
    if (condition === 'CHECKLIST_COMPLETE') {
      const items = await q(db, 'SELECT code, status FROM checklist_items WHERE stage_instance_id = $1', [stage.id]);
      const pending = items.filter((i) => i.status === 'PENDING').map((i) => i.code);
      const deficient = items.filter((i) => i.status === 'DEFICIENT').map((i) => i.code);
      const met = pending.length === 0 && deficient.length === 0;
      results.push({
        condition, met,
        detail: met
          ? `All ${items.length} checklist items are satisfied or not applicable`
          : [pending.length ? `${pending.length} pending (${pending.join(', ')})` : '', deficient.length ? `${deficient.length} deficient (${deficient.join(', ')}) — return the case or resolve them` : '']
              .filter(Boolean).join('; '),
      });
    } else if (condition === 'RECOMMENDATION_RECORDED') {
      const rec = await q(db, 'SELECT id FROM recommendations WHERE stage_instance_id = $1 LIMIT 1', [stage.id]);
      results.push({ condition, met: rec.length > 0, detail: rec.length ? 'Recommendation recorded' : 'No recommendation recorded for this stage yet' });
    } else if (condition === 'NO_OPEN_FINDING') {
      const open = await openFindingCount(db, stage.application_id);
      results.push({ condition, met: open === 0, detail: open === 0 ? 'No open findings' : `${open} finding(s) still open` });
    } else if (condition === 'EVC_REPORT_ACCEPTED') {
      const accepted = await evcReportAccepted(db, stage.id);
      results.push({ condition, met: accepted, detail: accepted ? 'Visit report accepted' : 'No accepted EVC visit report on record' });
    }
  }
  return results;
}

// Findings and EVC visits are added in later migrations; these checks degrade safely until the tables exist.
async function openFindingCount(db: Db, applicationId: string): Promise<number> {
  const exists = await q(db, `SELECT to_regclass('public.findings') AS t`);
  if (!exists[0].t) return 0;
  const rows = await q(db, `SELECT count(*)::int AS n FROM findings WHERE application_id = $1 AND state <> 'RESOLVED'`, [applicationId]);
  return rows[0].n;
}

async function evcReportAccepted(db: Db, stageId: string): Promise<boolean> {
  const exists = await q(db, `SELECT to_regclass('public.evc_visits') AS t`);
  if (!exists[0].t) return false;
  const rows = await q(db, `SELECT 1 FROM evc_visits WHERE stage_instance_id = $1 AND state = 'REPORT_ACCEPTED'`, [stageId]);
  return rows.length > 0;
}

export async function loadWorkflowContext(db: Db, app: AppRow) {
  if (!app.current_workflow_id) return { workflow: null, policy: null, stage: null, stageDef: null };
  const workflow = await one<WorkflowRow>(db, 'SELECT * FROM workflow_instances WHERE id = $1', [app.current_workflow_id]);
  const policy = await getPolicyVersion(db, workflow.policy_version_id);
  const stage = workflow.current_stage_id
    ? await one<StageRow>(db, 'SELECT * FROM stage_instances WHERE id = $1', [workflow.current_stage_id])
    : null;
  const stageDef = stage ? policy.doc.stages[stage.stage_key] : null;
  return { workflow, policy, stage, stageDef };
}
