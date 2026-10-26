import { z } from 'zod';
import { ROLES } from '../identity/permissions.js';

// A policy version is data in this constrained schema. Only the predicates and actions listed here are
// supported; no user-supplied code is ever executed.

export const PROVENANCES = ['APH_CLAUSE', 'ADMIN_INSTRUCTION', 'DEMO_ASSUMPTION'] as const;
export const provenance = z.enum(PROVENANCES);

const ruleMeta = {
  provenance,
  sourceId: z.string().optional(),
  note: z.string().optional(),
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const predicateSchema = z.object({
  field: z.string().min(1),
  op: z.enum(['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'exists', 'isTrue', 'isFalse']),
  value: z.unknown().optional(),
});
export type Predicate = z.infer<typeof predicateSchema>;

export const STAGE_KINDS = ['SCRUTINY', 'EVC', 'COMMITTEE', 'DECISION'] as const;
export const COMPLETION_CONDITIONS = [
  'CHECKLIST_COMPLETE',
  'RECOMMENDATION_RECORDED',
  'NO_OPEN_FINDING',
  'EVC_REPORT_ACCEPTED',
] as const;
export const DECISION_OUTCOMES = ['APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'DEFERRED'] as const;

export const checklistItemSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_]+$/, 'Use upper-case letters, digits and underscores'),
  requirement: z.string().min(3),
  evidenceDocType: z.string().optional(),
  ...ruleMeta,
});

export const stageSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(STAGE_KINDS),
  ownerRole: z.enum(ROLES),
  committeeKind: z.enum(['SCRUTINY', 'EVC', 'SAC', 'SHC']).optional(),
  checklist: z.array(checklistItemSchema).default([]),
  completion: z.array(z.enum(COMPLETION_CONDITIONS)).default([]),
  allowReturn: z.boolean().default(false),
  ...ruleMeta,
});
export type StageDef = z.infer<typeof stageSchema>;

export const policyDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().min(1),
  academicYear: z.string().min(1),
  calendar: z.object({
    timezone: z.string().min(1),
    weekendDays: z.array(z.number().int().min(0).max(6)),
    holidays: z.array(z.object({ date: isoDate, name: z.string(), ...ruleMeta })).default([]),
  }),
  categories: z
    .array(z.object({ code: z.string().regex(/^[A-Z0-9_]+$/), name: z.string(), description: z.string().default(''), ...ruleMeta }))
    .min(1),
  classification: z.array(
    z.object({
      id: z.string().min(1),
      categoryCode: z.string(),
      when: z.array(predicateSchema).default([]),
      routeKey: z.string(),
      priority: z.number().int().default(0),
      ...ruleMeta,
    }),
  ),
  routes: z.record(z.string(), z.object({ name: z.string(), stages: z.array(z.string()).min(1), ...ruleMeta })),
  stages: z.record(z.string(), stageSchema),
  decision: z.object({
    outcomes: z.array(z.enum(DECISION_OUTCOMES)).min(1),
    authorityRole: z.literal('COMPETENT_AUTHORITY'),
    conditionsRequiredFor: z.array(z.enum(DECISION_OUTCOMES)).default(['APPROVED_WITH_CONDITIONS']),
    ...ruleMeta,
  }),
  // Clocks and the escalation ladder. Absent = no deadlines are tracked for cases on this version.
  evc: z.object({
    minMembers: z.number().int().min(1).max(10),
    maxMembers: z.number().int().min(1).max(10),
    mandatoryConflicts: z.array(z.enum(['OWN_INSTITUTION', 'DECLARED', 'REGION_AFFILIATION'])),
    scheduling: z.object({ amount: z.number().int().min(1).max(366), unit: z.enum(['WORKING_DAYS','CALENDAR_DAYS','CALENDAR_MONTHS']), ...ruleMeta }),
    report: z.object({ amount: z.number().int().min(1).max(366), unit: z.enum(['WORKING_DAYS','CALENDAR_DAYS','CALENDAR_MONTHS']), ...ruleMeta }),
    ...ruleMeta,
  }).optional(),
  deadlines: z
    .object({
      stages: z.record(z.string(), z.object({
        amount: z.number().int().min(0).max(366),
        unit: z.enum(['WORKING_DAYS', 'CALENDAR_DAYS', 'CALENDAR_MONTHS']),
        rollForwardToWorkingDay: z.boolean().optional(),
        // Whether returning the case to the institution stops this clock. If false it keeps running (D04).
        pauseOnReturn: z.boolean().default(false),
        ...ruleMeta,
      })).default({}),
      institutionResponse: z.object({
        amount: z.number().int().min(1).max(366),
        unit: z.enum(['WORKING_DAYS', 'CALENDAR_DAYS', 'CALENDAR_MONTHS']),
        rollForwardToWorkingDay: z.boolean().optional(),
        ...ruleMeta,
      }).optional(),
      ladder: z.array(z.object({
        id: z.string().regex(/^[A-Z0-9_]+$/),
        offsetDays: z.number().int().min(-365).max(365),
        kind: z.enum(['REMINDER', 'OVERDUE', 'ESCALATION']),
        // OWNER = whoever must act (stage assignee, or the institution for a response clock);
        // CASE_OFFICER = regional officers covering the case region; SUPERVISOR = bureau officers covering it.
        recipients: z.array(z.enum(['OWNER', 'CASE_OFFICER', 'SUPERVISOR'])).min(1),
        ...ruleMeta,
      })).default([]),
    })
    .optional(),
  // Which route an appeal against a decision follows, and within how many calendar days it may be filed.
  appeal: z
    .object({
      routeKey: z.string(),
      appealableOutcomes: z.array(z.enum(DECISION_OUTCOMES)).min(1).default(['REJECTED']),
      windowDays: z.number().int().min(1).max(365),
      ...ruleMeta,
    })
    .optional(),
});
export type PolicyDocument = z.infer<typeof policyDocumentSchema>;
/** Authoring shape: fields with defaults may be omitted. */
export type PolicyDocumentInput = z.input<typeof policyDocumentSchema>;

export interface ValidationIssue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

/** Structural (zod) plus semantic validation. A policy with any error cannot be published. */
export function validatePolicy(raw: unknown): { doc: PolicyDocument | null; issues: ValidationIssue[] } {
  const parsed = policyDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      doc: null,
      issues: parsed.error.issues.map((i) => ({ level: 'error', path: i.path.join('.'), message: i.message })),
    };
  }
  const doc = parsed.data;
  const issues: ValidationIssue[] = [];
  const err = (path: string, message: string) => issues.push({ level: 'error', path, message });
  const warn = (path: string, message: string) => issues.push({ level: 'warning', path, message });

  const categoryCodes = new Set(doc.categories.map((c) => c.code));
  if (doc.evc && doc.evc.minMembers > doc.evc.maxMembers) err('evc.maxMembers', 'Maximum members must cover the minimum composition');
  if (categoryCodes.size !== doc.categories.length) err('categories', 'Category codes must be unique');

  const usedStages = new Set<string>();
  for (const [routeKey, route] of Object.entries(doc.routes)) {
    const seen = new Set<string>();
    route.stages.forEach((stageKey, i) => {
      const path = `routes.${routeKey}.stages.${i}`;
      const stage = doc.stages[stageKey];
      if (!stage) return err(path, `Stage "${stageKey}" is not defined`);
      if (seen.has(stageKey)) err(path, `Stage "${stageKey}" appears twice; loops are not supported in a route`);
      seen.add(stageKey);
      usedStages.add(stageKey);
      const isLast = i === route.stages.length - 1;
      if (stage.kind === 'DECISION' && !isLast) err(path, 'A decision stage must be the last stage of a route');
      if (isLast && stage.kind !== 'DECISION') {
        err(path, 'Every route must end in a decision stage; completing a processing stage never means approval');
      }
    });
  }

  for (const [key, stage] of Object.entries(doc.stages)) {
    const path = `stages.${key}`;
    if (!usedStages.has(key)) warn(path, 'Stage is not used by any route (unreachable)');
    if (stage.ownerRole === 'COMMITTEE_MEMBER' && !stage.committeeKind) err(path, 'Committee stages need committeeKind');
    if (stage.kind === 'DECISION' && stage.ownerRole !== doc.decision.authorityRole) {
      err(path, 'Decision stages must be owned by the decision authority role');
    }
    if (stage.kind === 'EVC' && !stage.completion.includes('EVC_REPORT_ACCEPTED')) {
      err(path, 'An EVC stage must require an accepted visit report before completion');
    }
    const codes = stage.checklist.map((c) => c.code);
    if (new Set(codes).size !== codes.length) err(`${path}.checklist`, 'Checklist codes must be unique within a stage');
    if (stage.completion.includes('CHECKLIST_COMPLETE') && stage.checklist.length === 0) {
      err(path, 'CHECKLIST_COMPLETE needs at least one checklist item');
    }
  }

  doc.classification.forEach((rule, i) => {
    const path = `classification.${i}`;
    if (!categoryCodes.has(rule.categoryCode)) err(path, `Unknown category "${rule.categoryCode}"`);
    if (!doc.routes[rule.routeKey]) err(path, `Unknown route "${rule.routeKey}"`);
  });
  if (doc.deadlines) {
    for (const key of Object.keys(doc.deadlines.stages)) {
      if (!doc.stages[key]) err(`deadlines.stages.${key}`, `Unknown stage "${key}"`);
    }
    const stepIds = doc.deadlines.ladder.map((l) => l.id);
    if (new Set(stepIds).size !== stepIds.length) err('deadlines.ladder', 'Ladder step ids must be unique');
    doc.deadlines.ladder.forEach((l, i) => {
      if (l.kind === 'REMINDER' && l.offsetDays >= 0) err(`deadlines.ladder.${i}`, 'A reminder must come before the due date (negative offset)');
      if (l.kind !== 'REMINDER' && l.offsetDays < 0) err(`deadlines.ladder.${i}`, 'Overdue and escalation steps come on or after the due date');
    });
  }
  if (doc.appeal && !doc.routes[doc.appeal.routeKey]) err('appeal.routeKey', `Unknown route "${doc.appeal.routeKey}"`);
  const ids = doc.classification.map((r) => r.id);
  if (new Set(ids).size !== ids.length) err('classification', 'Classification rule ids must be unique');

  // Two rules for the same category at the same priority with identical conditions can never be told apart.
  const signatures = new Map<string, string>();
  doc.classification.forEach((rule) => {
    const sig = `${rule.categoryCode}|${rule.priority}|${JSON.stringify(rule.when)}`;
    const other = signatures.get(sig);
    if (other && other !== rule.routeKey) {
      err(`classification.${rule.id}`, 'Ambiguous: another rule with the same category, priority and conditions picks a different route');
    }
    signatures.set(sig, rule.routeKey);
  });
  for (const code of categoryCodes) {
    if (!doc.classification.some((r) => r.categoryCode === code)) {
      warn(`categories.${code}`, 'No classification rule: applications in this category will wait for manual classification');
    }
  }
  return { doc, issues };
}
