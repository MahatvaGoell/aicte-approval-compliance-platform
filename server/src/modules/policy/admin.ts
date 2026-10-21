import type pg from 'pg';
import type { Db } from '../../db.js';
import { AppError, ConflictError, NotFoundError, ValidationError, maybe, one, q } from '../../db.js';
import { canonicalJson, sha256 } from '../../lib/crypto.js';
import type { ActionContext } from '../audit/audit.js';
import { recordAudit } from '../audit/audit.js';
import { startOfLocalDay } from '../deadlines/calendar.js';
import { diffPolicies } from './diff.js';
import { validatePolicy } from './schema.js';

// Policy change control. POLICY_DRAFT edits drafts; POLICY_PUBLISH publishes; neither sees cases.
// Published versions are immutable. Cases keep the version they were submitted under.

const UUID = /^[0-9a-f-]{36}$/i;

async function loadVersion(db: Db, id: string, forUpdate = false) {
  if (!UUID.test(id)) throw new NotFoundError('Policy version not found');
  const row = await maybe(db, `SELECT * FROM policy_versions WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  if (!row) throw new NotFoundError('Policy version not found');
  return row;
}

export async function listVersions(db: Db) {
  return q(
    db,
    `SELECT v.id, v.version_no, v.label, v.status, v.effective_from, v.created_at, v.published_at, v.change_note, v.based_on_id,
            cu.name AS created_by_name, pu.name AS published_by_name,
            (SELECT count(*)::int FROM workflow_instances w WHERE w.policy_version_id = v.id) AS case_count
       FROM policy_versions v
       LEFT JOIN users cu ON cu.id = v.created_by
       LEFT JOIN users pu ON pu.id = v.published_by
      ORDER BY v.version_no DESC`,
  );
}

export async function versionDetail(db: Db, id: string) {
  const row = await loadVersion(db, id);
  const { issues } = validatePolicy(row.document);
  const names = await q(db, 'SELECT id, name FROM users WHERE id = ANY($1::uuid[])', [[row.created_by, row.published_by].filter(Boolean)]);
  const name = (uid: string | null) => names.find((n) => n.id === uid)?.name ?? null;
  return {
    id: row.id, versionNo: row.version_no, label: row.label, status: row.status, effectiveFrom: row.effective_from,
    createdAt: row.created_at, createdBy: name(row.created_by), publishedAt: row.published_at, publishedBy: name(row.published_by),
    changeNote: row.change_note, basedOnId: row.based_on_id, rowVersion: row.row_version, checksum: row.checksum,
    document: row.document, issues,
  };
}

export async function createDraft(tx: pg.PoolClient, ctx: ActionContext, basedOnId: string, label: string) {
  const base = await loadVersion(tx, basedOnId);
  // Version numbers are allocated under a lock so two drafts never collide.
  await tx.query('SELECT pg_advisory_xact_lock(7302)');
  const next = await one<{ n: number }>(tx, `SELECT coalesce(max(version_no), 0) + 1 AS n FROM policy_versions WHERE policy_key = $1`, [base.policy_key]);
  const row = await one(
    tx,
    `INSERT INTO policy_versions (policy_key, version_no, label, status, document, checksum, created_by, created_at, based_on_id)
     VALUES ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8) RETURNING id, version_no`,
    [base.policy_key, next.n, label, JSON.stringify(base.document), sha256(canonicalJson(base.document)), ctx.actor!.userId, ctx.at, base.id],
  );
  await recordAudit(tx, ctx, {
    entityType: 'policy_version', entityId: row.id, action: 'POLICY_DRAFT_CREATED',
    after: { versionNo: row.version_no, basedOnVersionNo: base.version_no, label }, policyVersionId: row.id,
  });
  return { id: row.id, versionNo: row.version_no };
}

export async function updateDraft(tx: pg.PoolClient, ctx: ActionContext, id: string, input: { document?: unknown; label?: string; expectedVersion: number }) {
  const row = await loadVersion(tx, id, true);
  if (row.status !== 'DRAFT') throw new ConflictError('Published versions cannot be changed; create a new draft', { code: 'NOT_A_DRAFT' });
  if (row.row_version !== input.expectedVersion) {
    throw new ConflictError('This draft changed since you loaded it. Refresh and try again.', { code: 'STALE_VERSION', currentVersion: row.row_version });
  }
  if (!input.document || typeof input.document !== 'object' || Array.isArray(input.document)) {
    throw new ValidationError('The policy document must be a JSON object');
  }
  const { issues } = validatePolicy(input.document);
  const changes = diffPolicies(row.document, input.document);
  const updated = await one(
    tx,
    `UPDATE policy_versions SET document = $2, checksum = $3, label = $4, row_version = row_version + 1 WHERE id = $1 RETURNING row_version`,
    [id, JSON.stringify(input.document), sha256(canonicalJson(input.document)), input.label ?? row.label],
  );
  await recordAudit(tx, ctx, {
    entityType: 'policy_version', entityId: id, action: 'POLICY_DRAFT_UPDATED',
    after: { changes: changes.map((c) => c.summary), errors: issues.filter((i) => i.level === 'error').length }, policyVersionId: id,
  });
  return { rowVersion: updated.row_version, issues, changes };
}

export async function publishVersion(tx: pg.PoolClient, ctx: ActionContext, id: string, input: { effectiveFrom: string; changeNote: string; expectedVersion: number }) {
  const row = await loadVersion(tx, id, true);
  if (row.status !== 'DRAFT') throw new ConflictError('Only a draft can be published', { code: 'NOT_A_DRAFT' });
  if (row.row_version !== input.expectedVersion) {
    throw new ConflictError('This draft changed since you loaded it. Refresh and try again.', { code: 'STALE_VERSION', currentVersion: row.row_version });
  }
  const { doc, issues } = validatePolicy(row.document);
  const errors = issues.filter((i) => i.level === 'error');
  if (!doc || errors.length) throw new AppError(422, 'POLICY_INVALID', `The draft has ${errors.length} validation error(s) and cannot be published`, errors);
  const effective = startOfLocalDay(input.effectiveFrom, doc.calendar.timezone);
  const previous = await maybe(
    tx,
    `SELECT id, version_no, document FROM policy_versions WHERE policy_key = $1 AND status = 'PUBLISHED' ORDER BY effective_from DESC, version_no DESC LIMIT 1`,
    [row.policy_key],
  );
  await tx.query(
    `UPDATE policy_versions SET status = 'PUBLISHED', document = $2, checksum = $3, effective_from = $4, published_by = $5, published_at = $6,
       change_note = $7, row_version = row_version + 1 WHERE id = $1`,
    [id, JSON.stringify(doc), sha256(canonicalJson(doc)), effective, ctx.actor!.userId, ctx.at, input.changeNote],
  );
  const changes = previous ? diffPolicies(previous.document, doc) : [];
  await recordAudit(tx, ctx, {
    entityType: 'policy_version', entityId: id, action: 'POLICY_PUBLISHED',
    before: previous ? { versionNo: previous.version_no } : null,
    after: { versionNo: row.version_no, effectiveFrom: effective.toISOString(), changes: changes.map((c) => c.summary) },
    reason: input.changeNote, policyVersionId: id,
  });
  return { versionNo: row.version_no, effectiveFrom: effective, changes };
}

export async function diffVersions(db: Db, fromId: string, toId: string) {
  const [a, b] = await Promise.all([loadVersion(db, fromId), loadVersion(db, toId)]);
  return {
    from: { id: a.id, versionNo: a.version_no, label: a.label, status: a.status },
    to: { id: b.id, versionNo: b.version_no, label: b.label, status: b.status },
    changes: diffPolicies(a.document, b.document),
  };
}

export async function listSources(db: Db) {
  return q(db, 'SELECT * FROM policy_sources ORDER BY provenance, id');
}
