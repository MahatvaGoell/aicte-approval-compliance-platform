import type { Db } from '../../db.js';
import { AppError, maybe, one } from '../../db.js';
import { now } from '../../lib/clock.js';
import type { PolicyDocument } from './schema.js';
import { policyDocumentSchema } from './schema.js';

export interface PolicyVersion {
  id: string;
  versionNo: number;
  label: string;
  status: string;
  effectiveFrom: Date | null;
  doc: PolicyDocument;
}

// Published versions never change, so parsed documents can be cached by id.
const cache = new Map<string, PolicyVersion>();

function toVersion(row: any): PolicyVersion {
  return {
    id: row.id,
    versionNo: row.version_no,
    label: row.label,
    status: row.status,
    effectiveFrom: row.effective_from,
    doc: policyDocumentSchema.parse(row.document),
  };
}

export async function getPolicyVersion(db: Db, id: string): Promise<PolicyVersion> {
  const hit = cache.get(id);
  if (hit) return hit;
  const row = await one(db, 'SELECT * FROM policy_versions WHERE id = $1', [id]);
  const v = toVersion(row);
  if (row.status !== 'DRAFT') cache.set(id, v);
  return v;
}

/** The latest published version whose effective date has been reached (business time). */
export async function activePolicy(db: Db, policyKey = 'approval-process'): Promise<PolicyVersion> {
  const row = await maybe(
    db,
    `SELECT * FROM policy_versions
      WHERE policy_key = $1 AND status = 'PUBLISHED' AND effective_from <= $2
      ORDER BY effective_from DESC, version_no DESC LIMIT 1`,
    [policyKey, now()],
  );
  if (!row) throw new AppError(503, 'NO_ACTIVE_POLICY', 'No published policy is in effect');
  return toVersion(row);
}

export function clearPolicyCache() {
  cache.clear();
}
