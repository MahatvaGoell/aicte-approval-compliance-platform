import type { Db } from '../../db.js';
import { q } from '../../db.js';
import { canonicalJson, sha256 } from '../../lib/crypto.js';
import type { Actor } from '../identity/permissions.js';

export const GENESIS_HASH = '0'.repeat(64);
// Serialises audit appends so the hash chain has a single, gap-free order.
const AUDIT_LOCK_KEY = 7301;

/** Who is acting and under which request. Shared by every write in one command. */
export interface ActionContext {
  actor: Actor | null; // null = the system (scheduler, worker)
  correlationId: string;
  at: Date;
}

export interface AuditInput {
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  applicationId?: string | null;
  institutionId?: string | null;
  policyVersionId?: string | null;
  ruleRef?: string | null;
  documentIds?: string[];
  visibility?: 'INTERNAL' | 'INSTITUTION';
}

interface HashedFields {
  at: string;
  actor_user_id: string | null;
  actor_role: string;
  actor_grant_id: string | null;
  institution_id: string | null;
  application_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  before_state: unknown;
  after_state: unknown;
  reason: string | null;
  policy_version_id: string | null;
  rule_ref: string | null;
  document_ids: string[];
  correlation_id: string;
  visibility: string;
}

function computeHash(prevHash: string, f: HashedFields) {
  return sha256(prevHash + canonicalJson(f));
}

/** Appends one audit event. Must be called inside the transaction that made the change. */
export async function recordAudit(tx: Db, ctx: ActionContext, input: AuditInput) {
  await tx.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_LOCK_KEY]);
  const last = await q<{ hash: string }>(tx, 'SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1');
  const prevHash = last[0]?.hash ?? GENESIS_HASH;
  const fields: HashedFields = {
    at: ctx.at.toISOString(),
    actor_user_id: ctx.actor?.userId ?? null,
    actor_role: ctx.actor?.role ?? 'SYSTEM',
    actor_grant_id: ctx.actor?.grantId ?? null,
    institution_id: input.institutionId ?? null,
    application_id: input.applicationId ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    before_state: normalise(input.before),
    after_state: normalise(input.after),
    reason: input.reason ?? null,
    policy_version_id: input.policyVersionId ?? null,
    rule_ref: input.ruleRef ?? null,
    document_ids: input.documentIds ?? [],
    correlation_id: ctx.correlationId,
    visibility: input.visibility ?? 'INTERNAL',
  };
  const hash = computeHash(prevHash, fields);
  const rows = await q<{ id: number }>(
    tx,
    `INSERT INTO audit_events (at, actor_user_id, actor_role, actor_grant_id, institution_id, application_id,
       entity_type, entity_id, action, before_state, after_state, reason, policy_version_id, rule_ref,
       document_ids, correlation_id, visibility, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
    [
      fields.at, fields.actor_user_id, fields.actor_role, fields.actor_grant_id, fields.institution_id,
      fields.application_id, fields.entity_type, fields.entity_id, fields.action,
      fields.before_state === null ? null : JSON.stringify(fields.before_state),
      fields.after_state === null ? null : JSON.stringify(fields.after_state),
      fields.reason, fields.policy_version_id, fields.rule_ref, fields.document_ids, fields.correlation_id,
      fields.visibility, prevHash, hash,
    ],
  );
  return rows[0].id;
}

function normalise(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  // Round-trip through canonical JSON so what we hash is exactly what jsonb gives back.
  return JSON.parse(canonicalJson(v));
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  firstBrokenId: number | null;
  problem: string | null;
}

/** Recomputes the hash chain from the stored rows. Detects edits made by anyone able to bypass the trigger. */
export async function verifyChain(db: Db): Promise<ChainVerification> {
  const rows = await q(db, 'SELECT * FROM audit_events ORDER BY id');
  let prev = GENESIS_HASH;
  for (const r of rows) {
    if (r.prev_hash !== prev) {
      return { ok: false, checked: rows.length, firstBrokenId: r.id, problem: 'prev_hash does not match the previous event' };
    }

    if (storedAuditHash(prev,r) !== r.hash) {
      return { ok: false, checked: rows.length, firstBrokenId: r.id, problem: 'stored content does not match its hash' };
    }
    prev = r.hash;
  }
  return { ok: true, checked: rows.length, firstBrokenId: null, problem: null };
}

export function storedAuditHash(prev:string,r:any) {
  const fields: HashedFields = {
      at: new Date(r.at).toISOString(),
      actor_user_id: r.actor_user_id,
      actor_role: r.actor_role,
      actor_grant_id: r.actor_grant_id,
      institution_id: r.institution_id,
      application_id: r.application_id,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      action: r.action,
      before_state: r.before_state,
      after_state: r.after_state,
      reason: r.reason,
      policy_version_id: r.policy_version_id,
      rule_ref: r.rule_ref,
      document_ids: r.document_ids ?? [],
      correlation_id: r.correlation_id,
      visibility: r.visibility,
    };
  return computeHash(prev,fields);
}
