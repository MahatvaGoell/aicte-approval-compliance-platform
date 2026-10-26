import type { Actor } from '../identity/permissions.js';
import { has } from '../identity/permissions.js';
import type { FilterKey } from './filters.js';
import { FILTER_KEYS } from './filters.js';

export const DAY_MS = 86_400_000;
/** DEMO_ASSUMPTION: "due soon" horizon. Not an AICTE rule. */
export const DUE_SOON_DAYS = 7;
/** DEMO_ASSUMPTION: calendar used to turn submittedFrom/submittedTo dates into instants. */
export const REPORT_TZ = 'Asia/Kolkata';

export const PENDING_LIFECYCLE = ['SUBMITTED', 'AWAITING_CLASSIFICATION', 'IN_PROCESS', 'AWAITING_DECISION'];
/** Clocks officers work against. Institutions only see the clock that is theirs to meet. */
export const OFFICE_CLOCKS = ['STAGE_HANDLING', 'INSTITUTION_RESPONSE', 'EVC_SCHEDULING', 'EVC_REPORT'];
export const INSTITUTION_CLOCKS = ['INSTITUTION_RESPONSE'];

export type ReportName =
  | 'pending'
  | 'overdue'
  | 'due-soon'
  | 'awaiting-institution'
  | 'evc-unscheduled'
  | 'evidence-backlog'
  | 'obligations-overdue';

export interface ReportDef {
  name: ReportName;
  label: string;
  entity: 'application' | 'obligation';
  /** BOTH = institution representatives may read it for their own institution; OFFICE = REPORTS_VIEW holders only. */
  audience: 'OFFICE' | 'BOTH';
  denominator: string;
  ageingAnchor: string;
  supports: readonly FilterKey[];
}

const APP_FILTERS = FILTER_KEYS;
const OBLIGATION_FILTERS = FILTER_KEYS.filter((k) => k !== 'stageKey');

export const REPORTS: readonly ReportDef[] = [
  {
    name: 'pending', label: 'Applications in process', entity: 'application', audience: 'BOTH',
    denominator: 'Applications submitted and not yet decided, withdrawn or closed (lifecycle SUBMITTED, AWAITING_CLASSIFICATION, IN_PROCESS, AWAITING_DECISION). Counts, not percentages.',
    ageingAnchor: 'Days since the live stage was entered; case age counts from submission.',
    supports: APP_FILTERS,
  },
  {
    name: 'overdue', label: 'Overdue', entity: 'application', audience: 'OFFICE',
    denominator: 'Pending applications whose earliest running clock (stage handling, institution response, EVC scheduling, EVC report) is past its current due time. Paused clocks are excluded.',
    ageingAnchor: 'Overdue days run from the current due time (after any authorised extension) to now.',
    supports: APP_FILTERS,
  },
  {
    name: 'due-soon', label: `Due within ${DUE_SOON_DAYS} days`, entity: 'application', audience: 'OFFICE',
    denominator: `Pending applications whose earliest running clock falls due within ${DUE_SOON_DAYS} days (DEMO_ASSUMPTION horizon) and is not yet overdue.`,
    ageingAnchor: 'Days since the live stage was entered.',
    supports: APP_FILTERS,
  },
  {
    name: 'awaiting-institution', label: 'Waiting for the institution', entity: 'application', audience: 'BOTH',
    denominator: 'Pending applications whose live stage is returned to the institution and awaiting its response.',
    ageingAnchor: 'Days since the live stage was entered (the return).',
    supports: APP_FILTERS,
  },
  {
    name: 'evc-unscheduled', label: 'EVC visit not yet scheduled', entity: 'application', audience: 'OFFICE',
    denominator: 'Pending applications whose EVC stage is ready (readiness recorded) and has no live visit.',
    ageingAnchor: 'Days since the live stage was entered.',
    supports: APP_FILTERS,
  },
  {
    name: 'evidence-backlog', label: 'Evidence awaiting verification', entity: 'obligation', audience: 'OFFICE',
    denominator: 'Obligations with evidence submitted (EVIDENCE_SUBMITTED or UNDER_VERIFICATION). Submission timeliness is shown separately from verification waiting.',
    ageingAnchor: 'Days since the current evidence receipt was recorded.',
    supports: OBLIGATION_FILTERS,
  },
  {
    name: 'obligations-overdue', label: 'Conditions past their submission due date', entity: 'obligation', audience: 'BOTH',
    denominator: 'Open obligations whose running submission clock is past its current due time (same rule as the case compliance status).',
    ageingAnchor: 'Overdue days run from the current submission due time to now.',
    supports: OBLIGATION_FILTERS,
  },
];

export function findReport(name: string): ReportDef | undefined {
  return REPORTS.find((r) => r.name === name);
}

export const isInstitutionActor = (actor: Actor) => actor.role === 'INSTITUTION_REP';

/** Whether the active grant may read this report at all. Callers answer "no" with 404 so report names are not probed. */
export function canReadReport(actor: Actor, def: ReportDef) {
  if (isInstitutionActor(actor)) return def.audience === 'BOTH' && has(actor, 'APPLICATION_VIEW_SCOPE');
  return has(actor, 'REPORTS_VIEW');
}
