import type pg from 'pg';
import type { z } from 'zod';
import type { Db } from '../../db.js';
import { q } from '../../db.js';
import type { ActionContext } from '../audit/audit.js';
import type { Actor } from '../identity/permissions.js';
import type { StageDef } from '../policy/schema.js';
import type { PolicyVersion } from '../policy/service.js';
import type { AppRow, StageRow, WorkflowRow } from '../workflow/workflow.js';
import { setStageState } from '../workflow/workflow.js';

// Shared building blocks for case commands (M1 commands in commands.ts, M2 commands in commands-m2.ts).

export interface FindingRow {
  id: string;
  stage_instance_id: string;
  stage_key: string;
  checklist_code: string | null;
  visibility: 'INTERNAL' | 'INSTITUTION';
  responsible_party: 'INSTITUTION' | 'OFFICE';
  requests_amendment: boolean;
  state: 'OPEN' | 'RESPONSE_PENDING' | 'RESPONSE_SUBMITTED' | 'RESOLVED' | 'NOT_RESOLVED';
}

export interface CaseContext {
  actor: Actor;
  app: AppRow;
  workflow: WorkflowRow | null;
  policy: PolicyVersion | null;
  stage: StageRow | null;
  stageDef: StageDef | null;
  /** Findings of the current workflow instance. */
  findings: FindingRow[];
  /** The decision recorded on the current workflow, if any. */
  decision: { id: string; outcome: string; issued_at: Date } | null;
  /** True if that decision has already been appealed. */
  appealed: boolean;
  workflowKind: 'PRIMARY' | 'APPEAL' | null;
  /** Clocks of the case that are still running. */
  activeDeadlineIds: string[];
  evcVisit: { id: string; state: string; ends_at: Date; institution_acknowledged_at: Date | null; pending_members: number } | null;
  evcMember: boolean;
  evcMemberConfirmed: boolean;
}

export interface Denial {
  status: 403 | 409;
  code: string;
  message: string;
}

export interface CommandDef<S extends z.ZodTypeAny> {
  name: string;
  label: string;
  input: S;
  /** Who may run it and in what state. Evaluated without input, so it also drives "permitted actions". */
  guard(c: CaseContext): Denial | null;
  run(tx: pg.PoolClient, c: CaseContext, ctx: ActionContext, input: z.infer<S>): Promise<Record<string, unknown>>;
}

export const deny = (status: 403 | 409, code: string, message: string): Denial => ({ status, code, message });
export const LIVE_WORK_STATES = ['ASSIGNED', 'IN_PROGRESS'];

/** Shared guard: the actor is the assigned owner of the live stage and holds the stage's owner role. */
export function assignedOwnerGuard(c: CaseContext): Denial | null {
  if (!c.stage || !c.stageDef) return deny(409, 'NO_ACTIVE_STAGE', 'The case has no active stage');
  if (c.actor.role !== c.stage.owner_role) {
    return deny(403, 'NOT_STAGE_OWNER_ROLE', `This stage is owned by the ${c.stage.owner_role.replace(/_/g, ' ').toLowerCase()} role`);
  }
  if (c.stage.assignee_user_id !== c.actor.userId) return deny(403, 'NOT_ASSIGNED', 'You are not assigned to this stage');
  if (!LIVE_WORK_STATES.includes(c.stage.state)) return deny(409, 'STAGE_NOT_WORKABLE', `The stage is ${c.stage.state.toLowerCase().replace(/_/g, ' ')}`);
  return null;
}

export async function markStarted(tx: Db, c: CaseContext, ctx: ActionContext) {
  if (c.stage && c.stage.state === 'ASSIGNED') {
    await setStageState(tx, c.stage, 'IN_PROGRESS', { started_at: ctx.at });
  }
}


export async function loadCaseExtras(db: Db, app: AppRow, workflow: WorkflowRow | null) {
  const activeDeadlineIds = (await q(db, `SELECT id FROM deadlines WHERE application_id = $1 AND state = 'ACTIVE'`, [app.id])).map((r) => r.id as string);
  const evcVisit = workflow?.current_stage_id ? (await q(db, `SELECT v.id, v.state, v.ends_at, v.institution_acknowledged_at,
    (SELECT count(*)::int FROM visit_members m WHERE m.visit_id = v.id AND m.confirmed_at IS NULL) AS pending_members
    FROM evc_visits v WHERE v.stage_instance_id = $1 AND v.state NOT IN ('CANCELLED','RESCHEDULED')`, [workflow.current_stage_id]))[0] ?? null : null;
  if (!workflow) return { findings: [] as FindingRow[], decision: null, appealed: false, workflowKind: null, activeDeadlineIds, evcVisit };
  const findings = await q<FindingRow>(
    db,
    `SELECT id, stage_instance_id, stage_key, checklist_code, visibility, responsible_party, requests_amendment, state
       FROM findings WHERE workflow_id = $1 ORDER BY raised_at`,
    [workflow.id],
  );
  const decision = (await q(db, 'SELECT id, outcome, issued_at FROM decisions WHERE workflow_id = $1', [workflow.id]))[0] ?? null;
  const appealed = decision ? (await q(db, 'SELECT 1 FROM appeals WHERE decision_id = $1', [decision.id])).length > 0 : false;
  const kind = (await q(db, 'SELECT kind FROM workflow_instances WHERE id = $1', [workflow.id]))[0].kind;
  return { findings, decision, appealed, workflowKind: kind, activeDeadlineIds, evcVisit };
}
