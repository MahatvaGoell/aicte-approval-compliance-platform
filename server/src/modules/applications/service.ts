import type pg from 'pg';
import type { Db } from '../../db.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError, maybe, one, q } from '../../db.js';
import { canonicalJson, sha256 } from '../../lib/crypto.js';
import type { ActionContext } from '../audit/audit.js';
import { recordAudit } from '../audit/audit.js';
import type { Actor } from '../identity/permissions.js';
import { applicationScopeSql, has } from '../identity/permissions.js';
import { emitEvent } from '../outbox/outbox.js';
import { activePolicy } from '../policy/service.js';
import type { AppRow } from '../workflow/workflow.js';
import { setApplicationState, startWorkflow } from '../workflow/workflow.js';
import type { z } from 'zod';
import { FORM_SCHEMA_VERSION, createApplicationSchema, submissionProblems, updateDraftSchema } from './forms.js';

/**
 * Loads an application the actor may see. A case outside the actor's scope is reported as not found,
 * so its existence is not revealed.
 */
export async function loadVisibleApplication(db: Db, actor: Actor, id: string, forUpdate = false): Promise<AppRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError('Application not found');
  const params: unknown[] = [id];
  const scope = applicationScopeSql(actor, params);
  const row = await maybe<AppRow>(
    db,
    `SELECT a.* FROM applications a WHERE a.id = $1 AND ${scope} ${forUpdate ? 'FOR UPDATE OF a' : ''}`,
    params,
  );
  if (!row) throw new NotFoundError('Application not found');
  return row;
}

export function assertVersion(app: { row_version: number }, expected: number) {
  if (app.row_version !== expected) {
    throw new ConflictError('This record changed since you loaded it. Refresh and try again.', {
      code: 'STALE_VERSION', expectedVersion: expected, currentVersion: app.row_version,
    });
  }
}

export async function bumpVersion(tx: Db, appId: string, at: Date) {
  const r = await one<{ row_version: number }>(
    tx, 'UPDATE applications SET row_version = row_version + 1, updated_at = $2 WHERE id = $1 RETURNING row_version', [appId, at],
  );
  return r.row_version;
}

export async function createDraft(tx: pg.PoolClient, ctx: ActionContext, input: z.infer<typeof createApplicationSchema>) {
  const actor = ctx.actor!;
  if (!has(actor, 'APPLICATION_CREATE') || !actor.institutionId) throw new ForbiddenError();
  const policy = await activePolicy(tx);
  if (!policy.doc.categories.some((c) => c.code === input.categoryCode)) {
    throw new ValidationError('Unknown application category', [{ field: 'categoryCode', message: 'Choose a listed category' }]);
  }
  const cycle = await maybe(tx, 'SELECT code FROM cycles WHERE code = $1', [input.cycleCode]);
  if (!cycle) throw new ValidationError('Unknown cycle', [{ field: 'cycleCode', message: 'Choose a listed cycle' }]);
  const inst = await one(tx, 'SELECT id, region_id FROM institutions WHERE id = $1', [actor.institutionId]);
  const seq = await one<{ n: number }>(tx, `SELECT nextval('application_no_seq')::int AS n`);
  const appNo = `APP-${input.cycleCode}-${String(seq.n).padStart(5, '0')}`;
  const app = await one<AppRow>(
    tx,
    `INSERT INTO applications (app_no, institution_id, region_id, cycle_code, lifecycle_state, form_schema_version, draft_data, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$8) RETURNING *`,
    [appNo, inst.id, inst.region_id, input.cycleCode, FORM_SCHEMA_VERSION, JSON.stringify(input.draftData), actor.userId, ctx.at],
  );
  await tx.query('INSERT INTO proposals (application_id, category_code, details, created_at) VALUES ($1,$2,$3,$4)', [
    app.id, input.categoryCode, JSON.stringify(input.details), ctx.at,
  ]);
  await recordAudit(tx, ctx, {
    entityType: 'application', entityId: app.id, action: 'DRAFT_CREATED',
    after: { appNo, categoryCode: input.categoryCode, cycleCode: input.cycleCode },
    applicationId: app.id, institutionId: app.institution_id, visibility: 'INSTITUTION',
  });
  return app;
}

export async function updateDraft(tx: pg.PoolClient, ctx: ActionContext, appId: string, input: z.infer<typeof updateDraftSchema>) {
  const actor = ctx.actor!;
  const app = await loadVisibleApplication(tx, actor, appId, true);
  if (!has(actor, 'APPLICATION_CREATE')) throw new ForbiddenError();
  if (app.lifecycle_state !== 'DRAFT') {
    throw new ConflictError('A submitted application is frozen. Changes must be made through a linked amendment.', {
      code: 'SNAPSHOT_FROZEN',
    });
  }
  assertVersion(app, input.expectedVersion);
  if (input.categoryCode) {
    const policy = await activePolicy(tx);
    if (!policy.doc.categories.some((c) => c.code === input.categoryCode)) {
      throw new ValidationError('Unknown application category', [{ field: 'categoryCode', message: 'Choose a listed category' }]);
    }
  }
  const proposal = await one(tx, 'SELECT * FROM proposals WHERE application_id = $1 ORDER BY created_at LIMIT 1', [app.id]);
  await tx.query('UPDATE applications SET draft_data = $2 WHERE id = $1', [app.id, JSON.stringify(input.draftData)]);
  await tx.query('UPDATE proposals SET category_code = $2, details = $3 WHERE id = $1', [
    proposal.id, input.categoryCode ?? proposal.category_code, JSON.stringify(input.details ?? proposal.details),
  ]);
  const version = await bumpVersion(tx, app.id, ctx.at);
  await recordAudit(tx, ctx, {
    entityType: 'application', entityId: app.id, action: 'DRAFT_UPDATED',
    before: { draftData: app.draft_data, categoryCode: proposal.category_code, details: proposal.details },
    after: { draftData: input.draftData, categoryCode: input.categoryCode ?? proposal.category_code, details: input.details ?? proposal.details },
    applicationId: app.id, institutionId: app.institution_id, visibility: 'INSTITUTION',
  });
  return { rowVersion: version };
}

/** Validates, freezes the snapshot, classifies under the policy in effect, and opens the first stage. */
export async function submitApplication(tx: pg.PoolClient, ctx: ActionContext, appId: string, expectedVersion: number) {
  const actor = ctx.actor!;
  const app = await loadVisibleApplication(tx, actor, appId, true);
  if (!has(actor, 'APPLICATION_SUBMIT')) throw new ForbiddenError('Only the institution can submit its application');
  if (app.lifecycle_state !== 'DRAFT') {
    throw new ConflictError(`This application is already ${app.lifecycle_state.toLowerCase().replace(/_/g, ' ')}`, { code: 'INVALID_TRANSITION' });
  }
  assertVersion(app, expectedVersion);
  const proposal = await one(tx, 'SELECT * FROM proposals WHERE application_id = $1 ORDER BY created_at LIMIT 1', [app.id]);
  const problems = submissionProblems(app.draft_data, proposal.category_code, proposal.details);
  if (problems.length) throw new ValidationError('The application is incomplete', problems);

  const policy = await activePolicy(tx);
  const institution = await one(tx, 'SELECT id, name, aicte_permanent_id, address, district, state FROM institutions WHERE id = $1', [app.institution_id]);
  const snapshot = {
    formSchemaVersion: FORM_SCHEMA_VERSION,
    appNo: app.app_no,
    cycleCode: app.cycle_code,
    institution,
    proposal: { categoryCode: proposal.category_code, details: proposal.details },
    form: app.draft_data,
    submittedAt: ctx.at.toISOString(),
    submittedBy: actor.userId,
  };
  const snapshotHash = sha256(canonicalJson(snapshot));
  await tx.query(
    `UPDATE applications SET submitted_snapshot = $2, snapshot_sha256 = $3, submitted_at = $4, submitted_by = $5 WHERE id = $1`,
    [app.id, JSON.stringify(snapshot), snapshotHash, ctx.at, actor.userId],
  );
  await setApplicationState(tx, ctx, app, 'SUBMITTED', 'Submitted by the institution');
  await recordAudit(tx, ctx, {
    entityType: 'application', entityId: app.id, action: 'SUBMITTED',
    after: { snapshotSha256: snapshotHash, policyVersion: policy.versionNo },
    reason: 'Application submitted and snapshot frozen',
    applicationId: app.id, institutionId: app.institution_id, policyVersionId: policy.id, visibility: 'INSTITUTION',
  });
  await emitEvent(tx, ctx, 'APPLICATION_SUBMITTED', 'application', app.id, { applicationId: app.id, appNo: app.app_no, regionId: app.region_id });
  await startWorkflow(tx, ctx, app, policy);
  const version = await bumpVersion(tx, app.id, ctx.at);
  return { rowVersion: version };
}

export interface ListFilters {
  q?: string;
  institutionId?: string;
  regionId?: string;
  categoryCode?: string;
  stageKey?: string;
  assigneeUserId?: string;
  lifecycleState?: string;
  decisionOutcome?: string;
  submittedFrom?: string;
  submittedTo?: string;
  assignedToMe?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listApplications(db: Db, actor: Actor, f: ListFilters) {
  const params: unknown[] = [];
  const where = [applicationScopeSql(actor, params)];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.q) {
    params.push(`%${f.q}%`);
    where.push(`(a.app_no ILIKE $${params.length} OR i.name ILIKE $${params.length})`);
  }
  if (f.institutionId) add('a.institution_id = ?', f.institutionId);
  if (f.regionId) add('a.region_id = ?', f.regionId);
  if (f.categoryCode) add('p.category_code = ?', f.categoryCode);
  if (f.stageKey) add('si.stage_key = ?', f.stageKey);
  if (f.assigneeUserId) add('si.assignee_user_id = ?', f.assigneeUserId);
  if (f.assignedToMe) {
    if (actor.committeeKind === 'EVC') add(`EXISTS (SELECT 1 FROM evc_visits ev JOIN visit_members vm ON vm.visit_id = ev.id
      WHERE ev.stage_instance_id = si.id AND ev.state NOT IN ('CANCELLED','RESCHEDULED') AND vm.expert_user_id = ?)`, actor.userId);
    else add('si.assignee_user_id = ?', actor.userId);
  }
  if (f.lifecycleState) add('a.lifecycle_state = ?', f.lifecycleState);
  if (f.decisionOutcome) add('a.decision_outcome = ?', f.decisionOutcome);
  if (f.submittedFrom) add('a.submitted_at >= ?', f.submittedFrom);
  if (f.submittedTo) add(`a.submitted_at < (?::date + 1)`, f.submittedTo);
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const page = Math.max(f.page ?? 1, 1);
  const base = `FROM applications a
      JOIN institutions i ON i.id = a.institution_id
      JOIN LATERAL (SELECT * FROM proposals p WHERE p.application_id = a.id ORDER BY p.created_at LIMIT 1) p ON true
      LEFT JOIN workflow_instances w ON w.id = a.current_workflow_id
      LEFT JOIN stage_instances si ON si.id = w.current_stage_id
      LEFT JOIN users u ON u.id = si.assignee_user_id
     WHERE ${where.join(' AND ')}`;
  const total = await one<{ n: number }>(db, `SELECT count(*)::int AS n ${base}`, params);
  const rows = await q(
    db,
    `SELECT a.id, a.app_no, a.lifecycle_state, a.decision_outcome, a.compliance_status, a.submitted_at, a.updated_at,
            a.region_id, a.cycle_code, a.row_version, i.id AS institution_id, i.name AS institution_name,
            p.category_code, w.route_key, si.stage_key, si.state AS stage_state, si.entered_at AS stage_entered_at,
            si.owner_role, u.name AS assignee_name, si.assignee_user_id
       ${base}
      ORDER BY a.updated_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  );
  return { total: total.n, page, pageSize, rows };
}

export async function withdrawDraft(tx: pg.PoolClient, ctx: ActionContext, appId: string, expectedVersion: number, reason: string) {
  const actor = ctx.actor!;
  const app = await loadVisibleApplication(tx, actor, appId, true);
  if (!has(actor, 'APPLICATION_SUBMIT')) throw new ForbiddenError();
  if (app.lifecycle_state !== 'DRAFT') throw new AppError(409, 'INVALID_TRANSITION', 'Only drafts can be withdrawn here');
  assertVersion(app, expectedVersion);
  await setApplicationState(tx, ctx, app, 'WITHDRAWN', reason);
  return { rowVersion: await bumpVersion(tx, app.id, ctx.at) };
}
