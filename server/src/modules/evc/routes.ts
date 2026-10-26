import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, NotFoundError, getPool, one, q } from '../../db.js';
import { requireActor, requireCapability } from '../../http/context.js';
import { now } from '../../lib/clock.js';
import { applicationScopeSql, has, type Actor } from '../identity/permissions.js';
import { loadCaseContext } from '../applications/commands.js';
import { loadVisibleApplication } from '../applications/service.js';
import { expertSuggestions, isEvcMember, slotSchema, visitViews } from './service.js';

function requireView(actor: Actor) {
  if (!has(actor, 'EVC_VIEW') || (actor.role === 'COMMITTEE_MEMBER' && !isEvcMember(actor))) throw new AppError(403, 'MISSING_CAPABILITY', 'Your active role cannot view the EVC workspace');
}
export async function evcRoutes(app: FastifyInstance) {
  app.get('/evc/queue', async (req) => {
    const actor = requireActor(req); requireView(actor);
    const f = z.object({ region: z.string().optional(), state: z.enum(['WAITING','PROPOSED','CONFIRMED','HELD','REPORT_SUBMITTED','REPORT_ACCEPTED']).optional(), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
    const params: unknown[] = [];
    let where = applicationScopeSql(actor, params);
    if (f.region) { params.push(f.region); where += ` AND a.region_id = $${params.length}`; }
    if (f.state) { params.push(f.state); where += ` AND COALESCE(v.state,'WAITING') = $${params.length}`; }
    const base = `FROM evc_readiness r JOIN stage_instances s ON s.id = r.stage_instance_id
      JOIN workflow_instances w ON w.current_stage_id = s.id JOIN applications a ON a.id = r.application_id AND a.current_workflow_id = w.id
      JOIN institutions i ON i.id = a.institution_id LEFT JOIN evc_visits v ON v.stage_instance_id = s.id AND v.state NOT IN ('CANCELLED','RESCHEDULED')
      WHERE s.state IN ('QUEUED','ASSIGNED','IN_PROGRESS') AND ${where}`;
    const count = await one(getPool(), `SELECT count(*)::int AS n ${base}`, params);
    const rows = await q(getPool(), `SELECT a.id AS application_id, a.app_no, a.row_version, a.region_id, i.name AS institution,
      s.id AS stage_instance_id, r.ready_at, COALESCE(v.state,'WAITING') AS visit_state, v.id AS visit_id,
      (SELECT min(current_due_at) FROM deadlines d WHERE d.subject_id = s.id AND d.clock_type = 'EVC_SCHEDULING' AND d.state = 'ACTIVE') AS scheduling_due_at,
      (SELECT min(current_due_date)::text FROM deadlines d WHERE d.subject_id = s.id AND d.clock_type = 'EVC_SCHEDULING' AND d.state = 'ACTIVE') AS scheduling_due_date
      ${base} ORDER BY scheduling_due_at NULLS LAST, r.ready_at, a.id LIMIT 50 OFFSET ${(f.page - 1) * 50}`, params);
    return { rows: rows.map((r) => ({ ...r, waitingDays: Math.max(0, Math.floor((now().getTime() - r.ready_at.getTime()) / 86400_000)),
      overdue: !!r.scheduling_due_at && r.scheduling_due_at <= now() })), total: count.n, page: f.page, refreshedAt: now() };
  });
  app.get('/evc/experts', async (req) => {
    requireCapability(req, 'EVC_SCHEDULE');
    return { rows: await q(getPool(), `SELECT e.user_id, u.name, e.specialisms, e.home_region_id, e.eligible, e.directory_complete,
      e.max_visits_per_month, e.provenance,
      (SELECT json_agg(json_build_object('from', lower(a.available), 'to', upper(a.available))) FROM expert_availability a WHERE a.expert_user_id = e.user_id) AS availability
      FROM expert_profiles e JOIN users u ON u.id = e.user_id ORDER BY u.name`) };
  });
  app.get<{ Params: { id: string } }>('/evc/applications/:id/suggestions', async (req) => {
    const actor = requireCapability(req, 'EVC_SCHEDULE');
    const c = await loadCaseContext(getPool(), actor, req.params.id, false);
    if (c.stage?.stage_kind !== 'EVC' || !['ASSIGNED','IN_PROGRESS'].includes(c.stage.state)) throw new AppError(409, 'EVC_NOT_READY', 'A live EVC stage is required');
    const slot = slotSchema.extend({ ignoreVisitId: z.string().uuid().optional() }).parse(req.query);
    if (slot.ignoreVisitId && slot.ignoreVisitId !== c.evcVisit?.id) throw new NotFoundError('Visit not found');
    return { rows: await expertSuggestions(getPool(), c, slot, now(), slot.ignoreVisitId), composition: c.policy!.doc.evc,
      explanation: 'Demo ranking: case urgency + monthly workload + home-region travel proxy. Suggestions never appoint experts.' };
  });
  app.get('/evc/calendar', async (req) => {
    const actor = requireActor(req); requireView(actor);
    const f = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).parse(req.query);
    if (Date.parse(f.to) <= Date.parse(f.from) || Date.parse(f.to) - Date.parse(f.from) > 93 * 86400_000) throw new AppError(422, 'CALENDAR_RANGE', 'Choose a range of at most 93 days');
    const params: unknown[] = [f.from, f.to];
    const scope = applicationScopeSql(actor, params);
    return { rows: await q(getPool(), `SELECT v.id, v.application_id, a.app_no, v.state, v.mode, v.timezone, v.starts_at, v.ends_at,
      (SELECT json_agg(json_build_object('name', u.name, 'confirmedAt', m.confirmed_at, 'reserved', EXISTS (SELECT 1 FROM expert_reservations r WHERE r.visit_id = v.id AND r.expert_user_id = m.expert_user_id AND r.active)))
       FROM visit_members m JOIN users u ON u.id = m.expert_user_id WHERE m.visit_id = v.id) AS members
      FROM evc_visits v JOIN applications a ON a.id = v.application_id WHERE v.scheduled && tstzrange($1,$2,'[)') AND ${scope} ORDER BY v.starts_at, v.id`, params), refreshedAt: now() };
  });
  app.get<{ Params: { id: string } }>('/evc/visits/:id', async (req) => {
    const actor = requireActor(req);
    const id = z.string().uuid().parse(req.params.id);
    const v = (await q(getPool(), 'SELECT application_id FROM evc_visits WHERE id = $1', [id]))[0];
    if (!v) throw new NotFoundError('Visit not found');
    await loadVisibleApplication(getPool(), actor, v.application_id);
    const result = (await visitViews(getPool(), actor, v.application_id)).find((x) => x.id === id);
    if (!result) throw new NotFoundError('Visit not found');
    return result;
  });
}
