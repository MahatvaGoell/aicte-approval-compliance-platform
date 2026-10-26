import { z } from 'zod';
import type { Db } from '../../db.js';
import { AppError, NotFoundError, ValidationError, one, q } from '../../db.js';
import type { ActionContext } from '../audit/audit.js';
import { recordAudit } from '../audit/audit.js';
import { closeDeadlines, insertDeadline } from '../deadlines/engine.js';
import { overdueDays } from '../deadlines/calendar.js';
import type { PolicyVersion } from '../policy/service.js';
import { emitEvent } from '../outbox/outbox.js';
import type { Actor } from '../identity/permissions.js';
import { has } from '../identity/permissions.js';
import type { CaseContext } from '../applications/command-kit.js';
import { rankExperts, type ExpertCandidate } from './suggestions.js';

export const slotSchema = z.object({
  startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }),
  mode: z.enum(['PHYSICAL','ONLINE','HYBRID']), timezone: z.string().min(1).max(80),
  specialism: z.string().trim().min(1).max(100),
});
export type Slot = z.infer<typeof slotSchema>;
export function validateSlot(slot: Slot, at: Date) {
  const start = Date.parse(slot.startsAt), end = Date.parse(slot.endsAt);
  if (start < at.getTime() || end <= start || end - start > 24 * 3600_000) throw new ValidationError('Choose a future visit lasting at most 24 hours');
  try { new Intl.DateTimeFormat('en', { timeZone: slot.timezone }); } catch { throw new ValidationError('Choose a valid IANA time zone'); }
}
export function isEvcMember(actor: Actor) { return actor.role === 'COMMITTEE_MEMBER' && actor.committeeKind === 'EVC'; }

export async function readiness(tx: Db, ctx: ActionContext, app: { id: string; institution_id: string }, workflowId: string,
  policy: PolicyVersion, stage: { id: string; stage_key: string; stage_kind: string; route_position: number }) {
  if (stage.stage_kind !== 'EVC') return;
  const blocked = await q(tx, `SELECT p.id FROM stage_instances p WHERE p.workflow_id = $1 AND p.route_position < $2
    AND NOT EXISTS (SELECT 1 FROM stage_instances done WHERE done.workflow_id = p.workflow_id AND done.route_position = p.route_position AND done.state = 'COMPLETED')`, [workflowId, stage.route_position]);
  if (blocked.length) throw new AppError(409, 'EVC_NOT_READY', 'Earlier route stages are not complete');
  const rows = await q(tx, `INSERT INTO evc_readiness(stage_instance_id, application_id, ready_at) VALUES ($1,$2,$3)
    ON CONFLICT DO NOTHING RETURNING stage_instance_id`, [stage.id, app.id, ctx.at]);
  if (!rows.length) return;
  await recordAudit(tx, ctx, { entityType: 'stage', entityId: stage.id, action: 'EVC_READY', applicationId: app.id,
    institutionId: app.institution_id, policyVersionId: policy.id, after: { readyAt: ctx.at }, reason: 'Earlier route stages complete; EVC stage entered', visibility: 'INSTITUTION' });
  if (policy.doc.evc) await insertDeadline(tx, ctx, { applicationId: app.id, institutionId: app.institution_id, workflowId,
    clockType: 'EVC_SCHEDULING', subjectId: stage.id, stageKey: stage.stage_key, label: 'EVC scheduling',
    rule: policy.doc.evc.scheduling, policy, ruleRefPath: 'evc/scheduling' });
}

export async function expertSuggestions(db: Db, c: CaseContext, slot: Slot, at: Date, ignoreVisitId?: string) {
  validateSlot(slot, at);
  const rule = c.policy?.doc.evc;
  if (!rule) throw new AppError(409, 'EVC_POLICY_UNCONFIGURED', 'The pinned policy has no EVC scheduling configuration');
  const rows = await q(db, `SELECT e.*, u.name,
    EXISTS (SELECT 1 FROM capability_grants g JOIN committees cm ON cm.id = g.committee_id WHERE g.user_id = e.user_id
      AND g.role = 'COMMITTEE_MEMBER' AND cm.kind = 'EVC' AND u.is_active AND g.revoked_at IS NULL
      AND g.valid_from <= $3 AND (g.valid_to IS NULL OR g.valid_to >= $4)) AS active_appointment,
    EXISTS (SELECT 1 FROM declared_conflicts x WHERE x.expert_user_id = e.user_id AND x.institution_id = $1) AS declared_conflict,
    EXISTS (SELECT 1 FROM expert_availability a WHERE a.expert_user_id = e.user_id AND a.available @> tstzrange($3,$4,'[)')) AS available,
    EXISTS (SELECT 1 FROM expert_reservations r WHERE r.expert_user_id = e.user_id AND r.active AND r.visit_id <> COALESCE($5::uuid,'00000000-0000-0000-0000-000000000000')
      AND r.reserved && tstzrange($3,$4,'[)')) AS overlapping,
    (SELECT count(*)::int FROM expert_reservations r JOIN evc_visits v ON v.id = r.visit_id WHERE r.expert_user_id = e.user_id AND r.active
      AND v.id <> COALESCE($5::uuid,'00000000-0000-0000-0000-000000000000')
      AND date_trunc('month', timezone($6, v.starts_at)) = date_trunc('month', timezone($6, $3::timestamptz))) AS monthly_visits
    FROM expert_profiles e JOIN users u ON u.id = e.user_id WHERE $2::text IS NOT NULL ORDER BY u.name`,
    [c.app.institution_id, c.app.region_id, slot.startsAt, slot.endsAt, ignoreVisitId ?? null, c.policy!.doc.calendar.timezone]);
  const due = (await q(db, "SELECT current_due_at FROM deadlines WHERE subject_id = $1 AND clock_type = 'EVC_SCHEDULING' AND state = 'ACTIVE'", [c.stage!.id]))[0];
  return rankExperts(rows.map((r): ExpertCandidate => ({ userId: r.user_id, name: r.name, specialisms: r.specialisms,
    homeRegion: r.home_region_id, ownInstitution: r.own_institution_id, affiliatedRegions: r.affiliated_region_ids,
    eligible: r.eligible, directoryComplete: r.directory_complete, activeAppointment: r.active_appointment,
    available: r.available, overlapping: r.overlapping, declaredConflict: r.declared_conflict,
    monthlyVisits: r.monthly_visits, maxVisits: r.max_visits_per_month })), {
    institutionId: c.app.institution_id, regionId: c.app.region_id, specialism: slot.specialism, mode: slot.mode,
    mandatoryConflicts: rule.mandatoryConflicts, overdueDays: due ? overdueDays(due.current_due_at, at) : 0,
  });
}

export async function checkComposition(db: Db, c: CaseContext, slot: Slot, ids: string[], at: Date, ignore?: string) {
  const rule = c.policy!.doc.evc!;
  if (new Set(ids).size !== ids.length || ids.length < rule.minMembers || ids.length > rule.maxMembers) throw new ValidationError(`Choose ${rule.minMembers}–${rule.maxMembers} distinct eligible experts (demo policy)`);
  const candidates = await expertSuggestions(db, c, slot, at, ignore);
  if (ids.some((id) => candidates.find((e) => e.userId === id)?.overlapping)) throw new AppError(409, 'EXPERT_RESERVATION_CONFLICT', 'An expert is reserved for an overlapping visit. Refresh suggestions.');
  const blocked = ids.map((id) => candidates.find((e) => e.userId === id)).filter((e) => !e?.selectable);
  if (blocked.length) throw new ValidationError('Selected experts are unavailable, conflicted or have incomplete directory information', blocked.map((e) => ({ field: 'expertIds', message: e ? `${e.name}: ${e.blockers.join(', ')}` : 'Unknown expert' })));
}

export async function visitEvent(tx: Db, c: CaseContext, ctx: ActionContext, visitId: string, action: string, reason: string, data: unknown = {}) {
  await tx.query('INSERT INTO visit_events(visit_id, action, actor_user_id, reason, data, at) VALUES ($1,$2,$3,$4,$5,$6)', [visitId, action, ctx.actor!.userId, reason, JSON.stringify(data), ctx.at]);
  await recordAudit(tx, ctx, { entityType: 'evc_visit', entityId: visitId, action, reason, after: data, applicationId: c.app.id,
    institutionId: c.app.institution_id, policyVersionId: c.policy!.id, ruleRef: `policy-v${c.policy!.versionNo}/evc`, visibility: 'INTERNAL' });
  await emitEvent(tx, ctx, action, 'evc_visit', visitId, { applicationId: c.app.id, visitId });
}

export async function addVisit(tx: Db, c: CaseContext, ctx: ActionContext, slot: Slot, ids: string[], reason: string, previous?: string) {
  await checkComposition(tx, c, slot, ids, ctx.at, previous);
  const ready = await one(tx, 'SELECT ready_at FROM evc_readiness WHERE stage_instance_id = $1', [c.stage!.id]);
  const v = await one(tx, `INSERT INTO evc_visits(application_id, stage_instance_id, ready_at, mode, timezone, starts_at, ends_at,
    state, specialism, created_by, created_at, rescheduled_from_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'PROPOSED',$8,$9,$10,$11) RETURNING *`,
    [c.app.id, c.stage!.id, ready.ready_at, slot.mode, slot.timezone, slot.startsAt, slot.endsAt, slot.specialism, ctx.actor!.userId, ctx.at, previous ?? null]);
  for (const id of [...ids].sort()) {
    const grant = await one(tx, `SELECT g.committee_id FROM capability_grants g JOIN committees cm ON cm.id = g.committee_id
      WHERE g.user_id = $1 AND g.role = 'COMMITTEE_MEMBER' AND cm.kind = 'EVC' AND g.revoked_at IS NULL
      AND g.valid_from <= $2 AND (g.valid_to IS NULL OR g.valid_to >= $3) ORDER BY g.id LIMIT 1`, [id, slot.startsAt, slot.endsAt]);
    await tx.query('INSERT INTO visit_members(visit_id, expert_user_id, committee_id) VALUES ($1,$2,$3)', [v.id, id, grant.committee_id]);
  }
  await visitEvent(tx, c, ctx, v.id, 'EVC_VISIT_PROPOSED', reason, { ...slot, expertIds: ids, rescheduledFromId: previous ?? null });
  return v;
}

export async function reserveVisit(tx: Db, c: CaseContext, ctx: ActionContext, v: any, reason: string) {
  const members = await q(tx, 'SELECT expert_user_id FROM visit_members WHERE visit_id = $1 ORDER BY expert_user_id', [v.id]);
  // Lock every expert in a stable order. This also serialises monthly capacity checks across different cases.
  await tx.query('SELECT user_id FROM expert_profiles WHERE user_id = ANY($1::uuid[]) ORDER BY user_id FOR UPDATE', [members.map((m) => m.expert_user_id)]);
  const slot = { startsAt: v.starts_at.toISOString(), endsAt: v.ends_at.toISOString(), mode: v.mode, timezone: v.timezone, specialism: v.specialism };
  await checkComposition(tx, c, slot, members.map((m) => m.expert_user_id), ctx.at, v.id);
  for (const m of members) await tx.query("INSERT INTO expert_reservations(visit_id, expert_user_id, reserved) VALUES ($1,$2,tstzrange($3,$4,'[)'))", [v.id, m.expert_user_id, v.starts_at, v.ends_at]);
  await tx.query("UPDATE evc_visits SET state = 'CONFIRMED', row_version = row_version + 1 WHERE id = $1", [v.id]);
  await closeDeadlines(tx, ctx, c.stage!.id, 'MET', 'Visit confirmed; scheduling complete', 'EVC_SCHEDULING');
  await insertDeadline(tx, ctx, { applicationId: c.app.id, institutionId: c.app.institution_id, workflowId: c.workflow!.id,
    clockType: 'EVC_REPORT', subjectId: v.id, stageKey: c.stage!.stage_key, label: 'EVC visit report', anchorAt: v.ends_at,
    rule: c.policy!.doc.evc!.report, policy: c.policy!, ruleRefPath: 'evc/report' });
  await visitEvent(tx, c, ctx, v.id, 'EVC_VISIT_CONFIRMED', reason, { startsAt: v.starts_at, endsAt: v.ends_at });
}

export async function visitViews(db: Db, actor: Actor, applicationId: string) {
  const internal = has(actor, 'INTERNAL_NOTES_VIEW');
  const params: unknown[] = [applicationId];
  const memberFilter = isEvcMember(actor) ? (params.push(actor.userId, actor.committeeId), 'AND EXISTS (SELECT 1 FROM visit_members m WHERE m.visit_id = v.id AND m.expert_user_id = $2 AND m.committee_id = $3)') : '';
  const visits = await q(db, `SELECT v.* FROM evc_visits v WHERE v.application_id = $1 ${memberFilter} ORDER BY v.created_at, v.id`, params);
  for (const v of visits) {
    v.members = await q(db, `SELECT m.expert_user_id AS id, u.name, m.confirmed_at FROM visit_members m JOIN users u ON u.id = m.expert_user_id WHERE m.visit_id = $1 ORDER BY u.name`, [v.id]);
    v.reports = await q(db, 'SELECT id, revision, submitted_at' + (internal ? ', summary, submitted_by' : '') + ' FROM visit_reports WHERE visit_id = $1 ORDER BY revision', [v.id]);
    for (const r of v.reports) r.findings = await q(db, `SELECT id, requirement, observation, visibility FROM visit_findings WHERE report_id = $1 ${internal ? '' : "AND visibility = 'INSTITUTION'"} ORDER BY id`, [r.id]);
    v.history = internal ? await q(db, 'SELECT action, reason, data, at FROM visit_events WHERE visit_id = $1 ORDER BY id', [v.id]) : [];
  }
  return visits;
}

export async function loadVisit(tx: Db, c: CaseContext, id: string) {
  const v = (await q(tx, 'SELECT * FROM evc_visits WHERE id = $1 AND application_id = $2 AND stage_instance_id = $3 FOR UPDATE', [id, c.app.id, c.stage!.id]))[0];
  if (!v) throw new NotFoundError('Visit not found');
  return v;
}
