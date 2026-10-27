import { z } from 'zod';
import type { Db } from '../../db.js';
import { NotFoundError, one, q, withTx } from '../../db.js';
import { now } from '../../lib/clock.js';
import type { Actor } from '../identity/permissions.js';
import { applicationScopeSql, has } from '../identity/permissions.js';
import { endOfLocalDateExclusive, startOfLocalDay } from '../deadlines/calendar.js';
import { isoDate } from '../reports/filters.js';

export const AUDIT_TIMEZONE = 'Asia/Kolkata';
export const INTEGRITY_LIMITS = 'This log is tamper-evident, not impossible to alter. Local recomputation cannot detect an administrator who rewrites every later hash. Signed witness checkpoints are checked separately. The demo witness runs on the same machine; production requires a witness operated by a separate organisation with protected keys and append-only storage. Events after the latest checkpoint are not yet witnessed.';
export const auditQuery = z.object({
  applicationId: z.string().uuid().optional(),
  appNo: z.string().trim().min(1).max(80).optional(),
  action: z.string().trim().min(1).max(80).optional(),
  entityType: z.string().trim().min(1).max(80).optional(),
  actorUserId: z.string().uuid().optional(),
  from: isoDate.optional(), to: isoDate.optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict().refine(f => !f.from || !f.to || f.from <= f.to, {message:'From date must not be after to date',path:['from']});
export type AuditQuery = z.infer<typeof auditQuery>;

/** Global events belong only to all-scope viewers; regional/assigned viewers need a visible case. */
function scopeQuery(actor: Actor) {
  const params: unknown[] = [];
  const where = [actor.scopeAll ? 'TRUE' : `EXISTS (SELECT 1 FROM applications a WHERE a.id = e.application_id AND ${applicationScopeSql(actor,params)})`];
  if (!has(actor,'INTERNAL_NOTES_VIEW')) where.push("e.visibility = 'INSTITUTION'");
  return {params,where};
}
const FROM = `FROM audit_events e LEFT JOIN users u ON u.id = e.actor_user_id LEFT JOIN applications ca ON ca.id = e.application_id`;
const SUMMARY = `e.id, e.at, e.recorded_at, e.actor_user_id, e.actor_role, u.name AS actor_name,
  e.entity_type, e.entity_id, e.action, e.reason, e.rule_ref, e.application_id, ca.app_no, e.correlation_id, e.visibility`;

/** One snapshot keeps counts, pages and scoped facets consistent while audit appends continue. */
export async function listAudit(actor: Actor, f: AuditQuery) {
  return withTx(async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const scope = scopeQuery(actor);
    const params = [...scope.params], where = [...scope.where];
    const add = (sql: string, value: unknown) => {params.push(value);where.push(sql.replace('?',`$${params.length}`));};
    if (f.applicationId) add('e.application_id = ?',f.applicationId);
    if (f.appNo) add('ca.app_no = ?',f.appNo);
    if (f.action) add('e.action = ?',f.action);
    if (f.entityType) add('e.entity_type = ?',f.entityType);
    if (f.actorUserId) add('e.actor_user_id = ?',f.actorUserId);
    if (f.from) add('e.at >= ?',startOfLocalDay(f.from,AUDIT_TIMEZONE));
    if (f.to) add('e.at < ?',endOfLocalDateExclusive(f.to,AUDIT_TIMEZONE));
    const filtered = `${FROM} WHERE ${where.join(' AND ')}`;
    const total = await one<{n:number}>(tx,`SELECT count(*)::int AS n ${filtered}`,params);
    const rows = await q(tx,`SELECT ${SUMMARY} ${filtered} ORDER BY e.id DESC LIMIT ${f.pageSize} OFFSET ${(f.page-1)*f.pageSize}`,params);
    // Facets are the visible audit domain, independent of the selected filters. Never a user directory.
    const visible = `${FROM} WHERE ${scope.where.join(' AND ')}`;
    const actions = await q<{action:string}>(tx,`SELECT DISTINCT e.action ${visible} ORDER BY e.action`,scope.params);
    const actors = await q<{id:string;name:string}>(tx,`SELECT DISTINCT e.actor_user_id AS id,u.name ${visible} AND e.actor_user_id IS NOT NULL ORDER BY u.name,e.actor_user_id`,scope.params);
    const entities = await q<{entity_type:string}>(tx,`SELECT DISTINCT e.entity_type ${visible} ORDER BY e.entity_type`,scope.params);
    return {total:total.n,page:f.page,pageSize:f.pageSize,rows,refreshedAt:now(),timezone:AUDIT_TIMEZONE,
      facets:{actions:actions.map(x=>x.action),actors,entityTypes:entities.map(x=>x.entity_type)}};
  });
}

export async function auditDetail(db: Db, actor: Actor, id: number) {
  const {params,where} = scopeQuery(actor);params.push(id);where.push(`e.id = $${params.length}`);
  const rows = await q(db,`SELECT ${SUMMARY}, e.before_state, e.after_state, e.policy_version_id,
    e.document_ids, e.actor_grant_id, e.institution_id, e.hash, e.prev_hash ${FROM} WHERE ${where.join(' AND ')}`,params);
  if (!rows.length) throw new NotFoundError('Audit event not found');
  return rows[0];
}
