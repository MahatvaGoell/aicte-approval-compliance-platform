import type { Db } from '../../db.js';
import { AppError, NotFoundError, one, q } from '../../db.js';
import { now } from '../../lib/clock.js';
import type { Actor } from '../identity/permissions.js';
import { applicationScopeSql, has } from '../identity/permissions.js';
import type { ReportDef, ReportName } from './definitions.js';
import {
  DAY_MS, DUE_SOON_DAYS, INSTITUTION_CLOCKS, OFFICE_CLOCKS, PENDING_LIFECYCLE, REPORT_TZ, REPORTS, canReadReport, findReport,
  isInstitutionActor,
} from './definitions.js';
import type { FilterKey, ReportFilters } from './filters.js';
import { FILTER_KEYS } from './filters.js';

const POLL_SECONDS = 30;

/**
 * One query definition per report. The dashboard tile count, the drill-down rows and (later) the CSV all come
 * from here with the same actor scope and filters, which is what keeps them reconciled.
 */
function buildQuery(actor: Actor, def: ReportDef, f: ReportFilters, at: Date) {
  const params: unknown[] = [];
  const where: string[] = [applicationScopeSql(actor, params)];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };

  for (const key of FILTER_KEYS) {
    if (f[key] !== undefined && !def.supports.includes(key)) {
      throw new AppError(422, 'FILTER_NOT_SUPPORTED', `The ${def.name} report does not support the ${key} filter`, [{ field: key, message: 'Not supported by this report' }]);
    }
  }
  if (f.regionId) where.push(`a.region_id = ${p(f.regionId)}`);
  if (f.institutionId) where.push(`a.institution_id = ${p(f.institutionId)}`);
  if (f.categoryCode) where.push(`pr.category_code = ${p(f.categoryCode)}`);
  if (f.submittedFrom) where.push(`a.submitted_at >= (${p(f.submittedFrom)}::date)::timestamp AT TIME ZONE '${REPORT_TZ}'`);
  if (f.submittedTo) where.push(`a.submitted_at < ((${p(f.submittedTo)}::date + 1)::timestamp AT TIME ZONE '${REPORT_TZ}')`);

  // Parameters are pushed only when a clause uses them (an unused bind parameter is a PostgreSQL error).
  let nowParam: string | null = null;
  const nowP = () => (nowParam ??= p(at));

  const common = `FROM applications a
    JOIN institutions i ON i.id = a.institution_id
    JOIN LATERAL (SELECT category_code FROM proposals x WHERE x.application_id = a.id ORDER BY x.created_at LIMIT 1) pr ON true`;

  if (def.entity === 'application') {
    if (f.stageKey) where.push(f.stageKey === 'NONE' ? 'si.id IS NULL' : `si.stage_key = ${p(f.stageKey)}`);
    where.push(`a.lifecycle_state = ANY(${p(PENDING_LIFECYCLE)}::text[])`);
    const extra: Partial<Record<ReportName, () => string>> = {
      overdue: () => `dl.current_due_at <= ${nowP()}`,
      'due-soon': () => `dl.current_due_at > ${nowP()} AND dl.current_due_at <= ${p(new Date(at.getTime() + DUE_SOON_DAYS * DAY_MS))}`,
      'awaiting-institution': () => `si.state = 'AWAITING_RESPONSE'`,
      'evc-unscheduled': () => `si.stage_kind = 'EVC' AND si.state IN ('QUEUED','ASSIGNED','IN_PROGRESS') AND vs.state IS NULL
        AND EXISTS (SELECT 1 FROM evc_readiness r WHERE r.stage_instance_id = si.id)`,
    };
    const clause = extra[def.name]?.();
    if (clause) where.push(clause);
    const clocks = p(isInstitutionActor(actor) ? INSTITUTION_CLOCKS : OFFICE_CLOCKS);
    const from = `${common}
      LEFT JOIN workflow_instances w ON w.id = a.current_workflow_id
      LEFT JOIN stage_instances si ON si.id = w.current_stage_id
      LEFT JOIN users u ON u.id = si.assignee_user_id
      LEFT JOIN LATERAL (SELECT ev.state FROM evc_visits ev WHERE ev.stage_instance_id = si.id AND ev.state NOT IN ('CANCELLED','RESCHEDULED') LIMIT 1) vs ON true
      LEFT JOIN LATERAL (SELECT d.current_due_at, d.label, d.rule_ref, d.provenance FROM deadlines d
          WHERE d.application_id = a.id AND d.state = 'ACTIVE' AND d.clock_type = ANY(${clocks}::text[])
          ORDER BY d.current_due_at, d.id LIMIT 1) dl ON true
      WHERE ${where.join(' AND ')}`;
    return {
      params, from,
      select: `a.id, a.app_no, a.region_id, a.lifecycle_state, a.submitted_at, i.name AS institution, pr.category_code,
        w.state AS workflow_state, si.stage_key, si.stage_kind, si.state AS stage_state, si.owner_role, si.entered_at AS stage_entered_at,
        u.name AS assignee_name, vs.state AS visit_state, dl.current_due_at AS due_at, dl.label AS due_label, dl.rule_ref AS due_rule, dl.provenance AS due_provenance`,
      order: 'dl.current_due_at ASC NULLS LAST, a.app_no, a.id',
    };
  }

  const states = def.name === 'evidence-backlog' ? ['EVIDENCE_SUBMITTED', 'UNDER_VERIFICATION'] : ['OPEN'];
  where.push(`o.state = ANY(${p(states)}::text[])`);
  if (def.name === 'obligations-overdue') where.push(`ds.current_due_at <= ${nowP()}`);
  const from = `${common}
    JOIN obligations o ON o.application_id = a.id
    JOIN users vu ON vu.id = o.verifier_user_id
    LEFT JOIN evidence_submissions s ON s.id = o.current_submission_id
    LEFT JOIN LATERAL (SELECT d.current_due_at, d.label, d.rule_ref, d.provenance FROM deadlines d
        WHERE d.subject_id = o.id AND d.clock_type = 'OBLIGATION_SUBMISSION' AND d.state = 'ACTIVE' ORDER BY d.current_due_at, d.id LIMIT 1) ds ON true
    LEFT JOIN LATERAL (SELECT d.current_due_at, d.label, d.rule_ref, d.provenance FROM deadlines d
        WHERE d.subject_id = s.id AND d.clock_type = 'VERIFICATION' AND d.state = 'ACTIVE' ORDER BY d.current_due_at, d.id LIMIT 1) dv ON true
    WHERE ${where.join(' AND ')}`;
  const backlog = def.name === 'evidence-backlog';
  return {
    params, from,
    select: `o.id, a.id AS application_id, a.app_no, a.region_id, i.name AS institution, o.condition_text, o.state AS obligation_state,
      o.created_at AS obligation_created_at, vu.name AS verifier_name, s.received_at, s.on_time,
      ${backlog ? 'dv' : 'ds'}.current_due_at AS due_at, ${backlog ? 'dv' : 'ds'}.label AS due_label,
      ${backlog ? 'dv' : 'ds'}.rule_ref AS due_rule, ${backlog ? 'dv' : 'ds'}.provenance AS due_provenance`,
    order: `${backlog ? 'dv' : 'ds'}.current_due_at ASC NULLS LAST, o.created_at, o.id`,
  };
}

const floorDays = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));

/** Plain-language next step; describes who must act, never what the outcome should be. */
function pendingAction(r: any): string {
  if (r.stage_state === 'AWAITING_RESPONSE') return 'Institution to respond to the findings';
  if (r.workflow_state === 'AWAITING_CLASSIFICATION' || r.lifecycle_state === 'AWAITING_CLASSIFICATION') return 'Officer to classify the application';
  if (r.stage_kind === 'EVC') {
    if (!r.visit_state) return 'Schedule the expert visit';
    return { PROPOSED: 'Confirm the proposed visit', CONFIRMED: 'Hold the visit', HELD: 'Expert to submit the visit report', REPORT_SUBMITTED: 'Review the visit report' }[r.visit_state as string] ?? 'Follow the visit';
  }
  if (r.stage_state === 'QUEUED') return 'Assign a reviewer';
  if (r.stage_kind === 'DECISION' || r.lifecycle_state === 'AWAITING_DECISION') return 'Competent authority to record the decision';
  if (r.stage_state) return 'Complete the stage review';
  return 'Awaiting next step';
}

/** Categorised waiting reason (BUILD_PLAN §14). External information cannot be derived yet and is reported as UNKNOWN, not guessed. */
function waitingReason(r: any): string {
  if (r.stage_state === 'AWAITING_RESPONSE') return 'INSTITUTION_RESPONSE';
  if (r.workflow_state === 'AWAITING_CLASSIFICATION' || r.lifecycle_state === 'AWAITING_CLASSIFICATION') return 'OFFICER_REVIEW';
  if (r.stage_kind === 'EVC') return !r.visit_state || ['PROPOSED', 'CONFIRMED'].includes(r.visit_state) ? 'VISIT_AVAILABILITY' : 'OFFICER_REVIEW';
  if (r.stage_state || r.lifecycle_state === 'AWAITING_DECISION') return 'OFFICER_REVIEW';
  return 'UNKNOWN';
}

function mapRow(def: ReportDef, r: any, actor: Actor, at: Date) {
  const office = !isInstitutionActor(actor);
  const dueAt: Date | null = r.due_at ?? null;
  const overdue = !!dueAt && dueAt.getTime() <= at.getTime();
  const common = {
    appNo: r.app_no, institution: r.institution, regionId: r.region_id,
    dueAt, dueBasis: r.due_label ? `${r.due_label} (${r.due_rule}; ${r.due_provenance})` : null,
    overdue, overdueDays: overdue ? floorDays(dueAt!, at) : 0,
  };
  if (def.entity === 'application') {
    return {
      ...common, id: r.id, applicationId: r.id, categoryCode: r.category_code, lifecycleState: r.lifecycle_state,
      stageKey: r.stage_key, stageState: r.stage_state,
      owner: office ? (r.assignee_name ?? r.owner_role ?? null) : null,
      pendingAction: pendingAction(r),
      waitingReason: office ? waitingReason(r) : null,
      ageingDays: r.stage_entered_at ? floorDays(r.stage_entered_at, at) : null,
      caseAgeDays: r.submitted_at ? floorDays(r.submitted_at, at) : null,
    };
  }
  const backlog = def.name === 'evidence-backlog';
  return {
    ...common, id: r.id, applicationId: r.application_id, condition: r.condition_text, obligationState: r.obligation_state,
    stageKey: null, stageState: null,
    owner: office ? r.verifier_name : null,
    pendingAction: backlog ? 'Verifier to review the submitted evidence' : 'Institution to submit evidence',
    waitingReason: office ? (backlog ? 'OFFICER_REVIEW' : 'INSTITUTION_RESPONSE') : null,
    // Timeliness of the submission is fixed when the receipt is recorded; it never changes while verification waits.
    submissionOnTime: r.on_time ?? null, receivedAt: r.received_at ?? null,
    ageingDays: floorDays(backlog && r.received_at ? r.received_at : r.obligation_created_at, at),
    caseAgeDays: null,
  };
}

export function reportCatalogue(actor: Actor) {
  return REPORTS.filter((d) => canReadReport(actor, d)).map((d) => ({
    name: d.name, label: d.label, entity: d.entity, filters: d.supports, denominator: d.denominator, ageingAnchor: d.ageingAnchor,
  }));
}

export function requireReport(actor: Actor, name: string): ReportDef {
  const def = findReport(name);
  if (!def || !canReadReport(actor, def)) throw new NotFoundError('Report not found');
  return def;
}

export async function countReport(db: Db, actor: Actor, def: ReportDef, f: ReportFilters, at: Date) {
  const b = buildQuery(actor, def, f, at);
  const n = await one<{ n: number }>(db, `SELECT count(*)::int AS n ${b.from}`, b.params);
  return n.n;
}

export async function runReport(db: Db, actor: Actor, def: ReportDef, f: ReportFilters, page: number, pageSize: number) {
  const at = now();
  const b = buildQuery(actor, def, f, at);
  const total = await one<{ n: number }>(db, `SELECT count(*)::int AS n ${b.from}`, b.params);
  const rows = await q(db, `SELECT ${b.select} ${b.from} ORDER BY ${b.order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, b.params);
  return {
    name: def.name, label: def.label, entity: def.entity, filters: f, total: total.n, page, pageSize,
    rows: rows.map((r) => mapRow(def, r, actor, at)),
    definition: { denominator: def.denominator, ageingAnchor: def.ageingAnchor },
    refreshedAt: at,
  };
}

// ---------------------------------------------------------------- dashboards

export type DashboardView = 'institution' | 'officer' | 'management';

const TILES: Record<DashboardView, ReportName[]> = {
  institution: ['pending', 'awaiting-institution', 'obligations-overdue'],
  officer: ['overdue', 'due-soon', 'awaiting-institution', 'evidence-backlog', 'evc-unscheduled', 'obligations-overdue'],
  management: ['pending', 'overdue', 'due-soon', 'awaiting-institution', 'evc-unscheduled', 'evidence-backlog', 'obligations-overdue'],
};

const UNAVAILABLE: Record<DashboardView, Array<{ key: string; label: string; reason: string }>> = {
  institution: [{ key: 'documents-expiring', label: 'Expiring documents', reason: 'Document validity is not yet a drill-down report; open the Documents page.' }],
  officer: [{ key: 'escalations', label: 'Escalations', reason: 'Escalations are notifications only; see the Notifications page. No count is derived here.' }],
  management: [
    { key: 'trends', label: 'Trends', reason: 'No historical snapshots are kept yet, so no trend is shown.' },
    { key: 'escalations', label: 'Unresolved escalations', reason: 'Escalations are notifications only; see the Notifications page. No count is derived here.' },
  ],
};

export function assertDashboardAccess(actor: Actor, view: string): DashboardView {
  if (view !== 'institution' && view !== 'officer' && view !== 'management') throw new NotFoundError('Dashboard not found');
  const isInst = isInstitutionActor(actor);
  const ok =
    view === 'institution' ? isInst && has(actor, 'APPLICATION_VIEW_SCOPE')
    : view === 'officer' ? !isInst && has(actor, 'REPORTS_VIEW') && (has(actor, 'STAGE_ASSIGN') || has(actor, 'STAGE_WORK') || has(actor, 'EVC_REVIEW'))
    : view === 'management' ? !isInst && has(actor, 'REPORTS_VIEW')
    : false;
  if (!ok) throw new AppError(403, 'FORBIDDEN', 'Your active role does not have this dashboard');
  return view;
}

export async function dashboard(db: Db, actor: Actor, view: DashboardView, f: ReportFilters) {
  const at = now();
  const tiles = [];
  for (const name of TILES[view]) {
    const def = findReport(name)!;
    if (!canReadReport(actor, def)) continue;
    // Tiles for reports that do not support an applied filter are skipped, not silently widened.
    if (FILTER_KEYS.some((k: FilterKey) => f[k] !== undefined && !def.supports.includes(k))) continue;
    tiles.push({ key: name, label: def.label, count: await countReport(db, actor, def, f, at), report: name, filters: f });
  }
  const out: Record<string, unknown> = {
    view, tiles, unavailable: UNAVAILABLE[view], refreshedAt: at, pollSeconds: POLL_SECONDS,
    note: 'Counts use the same definitions as the reports they link to. Business time is the platform clock.',
  };
  if (view === 'management') out.matrix = await pendencyMatrix(db, actor, f, at);
  return out;
}

/** Region × live stage pendency and ageing. Every cell links to the `pending` report with the same filters plus region and stage. */
async function pendencyMatrix(db: Db, actor: Actor, f: ReportFilters, at: Date) {
  const def = findReport('pending')!;
  const b = buildQuery(actor, def, f, at);
  const atP = `$${b.params.length + 1}`;
  const rows = await q(db, `SELECT a.region_id, si.stage_key, count(*)::int AS pending,
      round(avg(extract(epoch FROM (${atP}::timestamptz - si.entered_at)) / 86400))::int AS avg_ageing_days,
      max(floor(extract(epoch FROM (${atP}::timestamptz - si.entered_at)) / 86400))::int AS max_ageing_days
    ${b.from}
    GROUP BY a.region_id, si.stage_key ORDER BY a.region_id, si.stage_key NULLS LAST`, [...b.params, at]);
  const names = new Map((await q(db, 'SELECT id, name FROM regions')).map((r) => [r.id, r.name]));
  return rows.map((r) => ({
    regionId: r.region_id, regionName: names.get(r.region_id) ?? r.region_id, stageKey: r.stage_key, pending: r.pending,
    avgAgeingDays: r.avg_ageing_days, maxAgeingDays: r.max_ageing_days,
    report: 'pending', filters: { ...f, regionId: r.region_id, stageKey: r.stage_key ?? 'NONE' },
  }));
}
