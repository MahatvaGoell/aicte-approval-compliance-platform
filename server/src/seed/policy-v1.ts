import type { PolicyDocumentInput } from '../modules/policy/schema.js';

// DEMONSTRATION POLICY. Every rule here is a DEMO_ASSUMPTION unless it names a reviewed source.
// The category-to-route mapping illustrates the route combinations named in SIH26262; it is NOT the
// official mapping. Verify against the Approval Process Handbook 2024-27 (Table 2.3) and applicable
// amendments before marking any rule APH_CLAUSE.

const demo = { provenance: 'DEMO_ASSUMPTION' as const, sourceId: 'DEMO-POLICY-NOTE' };

export const policyV1: PolicyDocumentInput = {
  schemaVersion: 1,
  title: 'Demonstration approval process policy',
  academicYear: '2027-28',
  calendar: {
    timezone: 'Asia/Kolkata',
    weekendDays: [0, 6],
    holidays: [
      { date: '2026-11-08', name: 'Diwali (demo calendar entry)', ...demo },
      { date: '2026-12-25', name: 'Christmas (demo calendar entry)', ...demo },
      { date: '2027-01-26', name: 'Republic Day (demo calendar entry)', ...demo },
    ],
  },
  categories: [
    { code: 'NEW_INSTITUTION', name: 'New institution', description: 'Approval for a new technical institution', ...demo },
    { code: 'EXTENSION_OF_APPROVAL', name: 'Extension of approval', description: 'Continuing approval for an existing institution', ...demo },
    { code: 'INCREASE_IN_INTAKE', name: 'Increase in intake', description: 'Additional seats in an approved programme', ...demo },
    { code: 'CHANGE_OF_SITE', name: 'Change of site', description: 'Relocation of the institution campus', ...demo },
    { code: 'OTHER_REQUEST', name: 'Other request', description: 'Requests without a configured route; classified manually', ...demo },
  ],
  classification: [
    { id: 'new-institution', categoryCode: 'NEW_INSTITUTION', when: [], routeKey: 'SCRUTINY_EVC', priority: 0, ...demo },
    { id: 'extension', categoryCode: 'EXTENSION_OF_APPROVAL', when: [], routeKey: 'SCRUTINY_ONLY', priority: 0, ...demo },
    { id: 'intake-standard', categoryCode: 'INCREASE_IN_INTAKE', when: [], routeKey: 'SCRUTINY_ONLY', priority: 0, ...demo },
    {
      id: 'intake-large',
      categoryCode: 'INCREASE_IN_INTAKE',
      when: [{ field: 'intakeIncreasePercent', op: 'gt', value: 50 }],
      routeKey: 'SCRUTINY_EVC',
      priority: 10,
      ...demo,
      note: 'Illustrates a conditional route: large increases also need a visit (demo threshold).',
    },
    { id: 'change-of-site', categoryCode: 'CHANGE_OF_SITE', when: [], routeKey: 'ONLY_EVC', priority: 0, ...demo },
  ],
  routes: {
    SCRUTINY_ONLY: { name: 'Only Scrutiny', stages: ['SCRUTINY', 'DECISION'], ...demo },
    SCRUTINY_EVC: { name: 'Scrutiny + EVC', stages: ['SCRUTINY', 'EVC', 'DECISION'], ...demo },
    ONLY_EVC: { name: 'Only EVC', stages: ['EVC', 'DECISION'], ...demo },
    EVC_SAC: { name: 'EVC + SAC', stages: ['EVC', 'SAC_REVIEW', 'DECISION'], ...demo },
    EVC_SHC: { name: 'EVC + SHC', stages: ['EVC', 'SHC_HEARING', 'DECISION'], ...demo },
    APPEAL_SAC: { name: 'Appeal: SAC review', stages: ['SAC_REVIEW', 'DECISION'], ...demo, note: 'Used only for appeals against a decision.' },
  },
  stages: {
    SCRUTINY: {
      name: 'Scrutiny',
      kind: 'SCRUTINY',
      ownerRole: 'COMMITTEE_MEMBER',
      committeeKind: 'SCRUTINY',
      allowReturn: true,
      completion: ['CHECKLIST_COMPLETE', 'NO_OPEN_FINDING', 'RECOMMENDATION_RECORDED'],
      checklist: [
        { code: 'LAND_DOCUMENTS', requirement: 'Land ownership or registered lease documents are on record and cover the campus', evidenceDocType: 'LEASE_DEED', ...demo },
        { code: 'BUILDING_PLAN', requirement: 'Approved building plan and completion certificate are on record', evidenceDocType: 'BUILDING_PLAN', ...demo },
        { code: 'FACULTY_DETAILS', requirement: 'Faculty details are complete for the programmes applied for', ...demo },
        { code: 'AFFIDAVIT', requirement: 'Affidavit/undertaking from the institution is uploaded and signed', evidenceDocType: 'AFFIDAVIT', ...demo },
      ],
      ...demo,
    },
    EVC: {
      name: 'Expert Visit Committee',
      kind: 'EVC',
      ownerRole: 'REGIONAL_OFFICER',
      allowReturn: true,
      completion: ['EVC_REPORT_ACCEPTED', 'NO_OPEN_FINDING'],
      checklist: [],
      ...demo,
    },
    SAC_REVIEW: {
      name: 'Standing Appellate Committee review',
      kind: 'COMMITTEE',
      ownerRole: 'COMMITTEE_MEMBER',
      committeeKind: 'SAC',
      completion: ['RECOMMENDATION_RECORDED'],
      checklist: [],
      ...demo,
    },
    SHC_HEARING: {
      name: 'Standing Hearing Committee hearing',
      kind: 'COMMITTEE',
      ownerRole: 'COMMITTEE_MEMBER',
      committeeKind: 'SHC',
      completion: ['RECOMMENDATION_RECORDED'],
      checklist: [],
      ...demo,
    },
    DECISION: {
      name: 'Decision by competent authority',
      kind: 'DECISION',
      ownerRole: 'COMPETENT_AUTHORITY',
      completion: [],
      checklist: [],
      ...demo,
    },
  },
  decision: {
    outcomes: ['APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'DEFERRED'],
    authorityRole: 'COMPETENT_AUTHORITY',
    conditionsRequiredFor: ['APPROVED_WITH_CONDITIONS'],
    ...demo,
  },
  // Demo timings. They illustrate the mechanism and are NOT AICTE service levels.
  deadlines: {
    stages: {
      SCRUTINY: { amount: 10, unit: 'WORKING_DAYS', pauseOnReturn: true, ...demo },
      EVC: { amount: 30, unit: 'CALENDAR_DAYS', rollForwardToWorkingDay: true, pauseOnReturn: false, ...demo },
      SAC_REVIEW: { amount: 15, unit: 'WORKING_DAYS', ...demo },
      SHC_HEARING: { amount: 15, unit: 'WORKING_DAYS', ...demo },
      DECISION: { amount: 7, unit: 'WORKING_DAYS', ...demo },
    },
    institutionResponse: { amount: 15, unit: 'CALENDAR_DAYS', rollForwardToWorkingDay: true, ...demo },
    ladder: [
      { id: 'REMIND_30', offsetDays: -30, kind: 'REMINDER', recipients: ['OWNER'], ...demo },
      { id: 'REMIND_7', offsetDays: -7, kind: 'REMINDER', recipients: ['OWNER'], ...demo },
      { id: 'REMIND_1', offsetDays: -1, kind: 'REMINDER', recipients: ['OWNER'], ...demo },
      { id: 'OVERDUE', offsetDays: 0, kind: 'OVERDUE', recipients: ['OWNER'], ...demo },
      { id: 'ESCALATE_OFFICER', offsetDays: 1, kind: 'ESCALATION', recipients: ['CASE_OFFICER'], ...demo },
      { id: 'ESCALATE_SUPERVISOR', offsetDays: 3, kind: 'ESCALATION', recipients: ['SUPERVISOR'], ...demo },
    ],
  },
  evc: {
    minMembers: 2, maxMembers: 3, mandatoryConflicts: ['OWN_INSTITUTION','DECLARED'],
    scheduling: { amount: 7, unit: 'WORKING_DAYS', ...demo },
    report: { amount: 3, unit: 'WORKING_DAYS', ...demo },
    ...demo, note: 'Demonstration composition, conflicts and timings; not official requirements.',
  },
  appeal: { routeKey: 'APPEAL_SAC', appealableOutcomes: ['REJECTED'], windowDays: 30, ...demo, note: 'Demo appeal window, not an AICTE timeline.' },
};
