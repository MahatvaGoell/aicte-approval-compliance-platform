import type { Db } from '../../db.js';
import { AppError, NotFoundError, getPool, one, q, withTx } from '../../db.js';
import { config } from '../../config.js';
import { now, realNow } from '../../lib/clock.js';
import { sha256 } from '../../lib/crypto.js';
import { recordAudit, type ActionContext } from '../audit/audit.js';
import { has, type Actor } from '../identity/permissions.js';
import { loadVisibleApplication } from '../applications/service.js';
import { endOfLocalDateExclusive } from '../deadlines/calendar.js';
import { LocalStorageAdapter, type StorageAdapter } from './storage.js';

let injectedStorage: StorageAdapter | null = null;
export function setDocumentStorage(storage: StorageAdapter | null) { injectedStorage = storage; }
export function documentStorage(): StorageAdapter { return injectedStorage ?? new LocalStorageAdapter(config.storageDir); }
export const UPLOAD_LOCK = 7335;
export async function visibleRecord(db: Db, actor: Actor, id: string, applicationId?: string) {
  const row = (await q(db, 'SELECT * FROM document_records WHERE id = $1', [id]))[0];
  if (!row || (applicationId && row.application_id !== applicationId)) throw new NotFoundError('Document not found');
  await loadVisibleApplication(db, actor, row.application_id);
  if (row.visibility === 'INTERNAL' && !has(actor, 'INTERNAL_NOTES_VIEW')) throw new NotFoundError('Document not found');
  return row;
}
export async function visibleVersion(db: Db, actor: Actor, id: string, applicationId?: string) {
  const v = (await q(db, `SELECT v.*, r.application_id, r.document_type, r.visibility, r.current_verified_version_id, r.latest_version_id
    FROM document_versions v JOIN document_records r ON r.id = v.document_id WHERE v.id = $1`, [id]))[0];
  if (!v || (applicationId && v.application_id !== applicationId)) throw new NotFoundError('Document version not found');
  await visibleRecord(db, actor, v.document_id, applicationId); return v;
}
export async function checkedBytes(version: any) {
  try {
    const bytes = await documentStorage().read('objects', version.storage_key);
    if (sha256(bytes) !== version.sha256) throw new Error('Integrity mismatch');
    return bytes;
  } catch { throw new AppError(503, 'DOCUMENT_UNAVAILABLE', 'The private document is unavailable or failed its integrity check. Contact the administrator.'); }
}
export async function documentEvent(tx: Db, ctx: ActionContext, app: { id: string; institution_id: string }, id: string, action: string, reason: string, data: unknown, visibility: 'INTERNAL'|'INSTITUTION') {
  await recordAudit(tx, ctx, { entityType: 'document', entityId: id, action, reason, after: data, applicationId: app.id, institutionId: app.institution_id, visibility });
}
export async function documentsForCase(db: Db, actor: Actor, appId: string) {
  await loadVisibleApplication(db, actor, appId);
  const records = await q(db, `SELECT id, title, document_type, visibility, row_version, current_verified_version_id, latest_version_id
    FROM document_records WHERE application_id = $1 ${has(actor,'INTERNAL_NOTES_VIEW') ? '' : "AND visibility = 'INSTITUTION'"} ORDER BY created_at, id`, [appId]);
  for (const r of records) {
    r.versions = await q(db, `SELECT v.id, v.document_id, v.version_no, v.predecessor_id, v.sha256, v.media_type, v.size_bytes, v.filename,
      v.declared_metadata, v.page_estimate, v.received_at, dv.outcome AS verification_outcome, dv.reason AS verification_reason, dv.verified_at,
      m.confirmed_values, m.id AS metadata_review_id
      FROM document_versions v LEFT JOIN document_verifications dv ON dv.version_id = v.id
      LEFT JOIN LATERAL (SELECT * FROM metadata_reviews mr WHERE mr.version_id = v.id ORDER BY mr.sequence_no DESC LIMIT 1) m ON true
      WHERE v.document_id = $1 ORDER BY v.version_no`, [r.id]);
    const verified = r.versions.find((v: any) => v.id === r.current_verified_version_id);
    const pending = r.versions.find((v: any) => v.id === r.latest_version_id && !v.verification_outcome);
    const validThrough = verified?.confirmed_values?.validThrough;
    const policy = await one(db, `SELECT p.document->'calendar'->>'timezone' AS timezone FROM applications a JOIN workflow_instances w ON w.id = a.current_workflow_id
      JOIN policy_versions p ON p.id = w.policy_version_id WHERE a.id = $1`, [appId]);
    const expired = validThrough ? endOfLocalDateExclusive(validThrough, policy.timezone) <= now() : false;
    r.validity = !verified ? 'NOT_VERIFIED' : expired ? 'EXPIRED' : validThrough ? 'VALID' : 'VALIDITY_UNAVAILABLE';
    r.replacementPending = !!verified && !!pending && pending.id !== r.current_verified_version_id;
    r.verifiedValidThrough = validThrough ?? null;
    r.metadataReviews = await q(db, `SELECT m.id, m.version_id, m.confirmed_values, m.reviewed_at, m.reason FROM metadata_reviews m JOIN document_versions v ON v.id = m.version_id WHERE v.document_id = $1 ORDER BY m.sequence_no`, [r.id]);
  }
  return records;
}
export async function attachmentsForCase(db:Db,actor:Actor,appId:string) {
  return q(db, `SELECT a.id, a.target_kind, a.target_id, a.version_id, a.attached_at, v.filename, r.title, r.id AS document_id
    FROM document_attachments a JOIN document_versions v ON v.id = a.version_id JOIN document_records r ON r.id = v.document_id
    WHERE a.application_id = $1 ${has(actor,'INTERNAL_NOTES_VIEW')?'':`AND r.visibility = 'INSTITUTION'
      AND (a.target_kind <> 'VISIT_FINDING' OR EXISTS (SELECT 1 FROM visit_findings f WHERE f.id = a.target_id AND f.visibility = 'INSTITUTION'))
      AND (a.target_kind <> 'FINDING_RESPONSE' OR EXISTS (SELECT 1 FROM finding_responses fr JOIN findings f ON f.id = fr.finding_id WHERE fr.id = a.target_id AND f.visibility = 'INSTITUTION'))`}
    ORDER BY a.attached_at,a.id`,[appId]);
}
/** Reconciles crashes between local storage and DB commit. Serialised with registration, with 24h grace.
 * File lease/mtime uses operational real time; demo clock jumps must never delete a fresh upload. */
export async function reconcileDocumentStorage() {
  const storage = documentStorage(); if (!storage.inventory) return { removed: 0, inventoryAvailable: false };
  return withTx(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [UPLOAD_LOCK]);
    const at = realNow(); let removed = 0;
    for (const area of ['quarantine','objects'] as const) for (const file of await storage.inventory!(area)) {
      if (at.getTime() - file.modifiedAt.getTime() < 86400_000) continue;
      if ((await q(tx, 'SELECT 1 FROM document_versions WHERE storage_key = $1 UNION ALL SELECT 1 FROM upload_leases WHERE storage_key = $1 AND expires_at > $2', [file.key, at])).length) continue;
      await storage.remove(area, file.key); await tx.query('DELETE FROM upload_leases WHERE storage_key = $1', [file.key]); removed++;
    }
    if (removed) await recordAudit(tx, { actor: null, correlationId: 'storage-reconciliation', at: now() }, { entityType: 'storage', entityId: 'orphan-reconciliation', action: 'ORPHAN_UPLOADS_REMOVED', after: { removed }, reason: 'Unreferenced private files older than the 24-hour operational grace period' });
    return { removed, inventoryAvailable: true };
  });
}
