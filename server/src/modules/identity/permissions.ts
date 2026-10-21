// Permission matrix. Roles are functional; their mapping to official designations is data on the grant.
// A grant's extra_capabilities can add a capability (for example EVC_SCHEDULE) without a new role.

export const ROLES = [
  'INSTITUTION_REP',
  'REGIONAL_OFFICER',
  'BUREAU_OFFICER',
  'COMMITTEE_MEMBER',
  'COMPETENT_AUTHORITY',
  'SYSTEM_ADMIN',
  'POLICY_ADMIN',
  'POLICY_APPROVER',
  'AUDITOR',
] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  // institution side
  'APPLICATION_CREATE',
  'APPLICATION_SUBMIT',
  'FINDING_RESPOND',
  'APPEAL_FILE',
  'EVIDENCE_UPLOAD',
  // case access
  'APPLICATION_VIEW_SCOPE', // every case in the grant's institution/region scope
  'APPLICATION_VIEW_ASSIGNED', // only cases the user is or was assigned to
  'INTERNAL_NOTES_VIEW',
  // case work
  'STAGE_ASSIGN',
  'STAGE_WORK', // work on a stage the user is assigned to
  'RECOMMEND',
  'FINDING_RAISE',
  'CASE_RETURN',
  'CLASSIFY',
  'EVIDENCE_VERIFY',
  'DOCUMENT_VERIFY',
  'EVC_SCHEDULE',
  // authority
  'DECISION_RECORD',
  'DEADLINE_EXTEND',
  'CASE_REOPEN',
  'POLICY_MIGRATE',
  'CLOSE_WITH_REASON',
  // oversight
  'REPORTS_VIEW',
  'AUDIT_VIEW',
  // configuration and administration
  'POLICY_VIEW',
  'POLICY_DRAFT',
  'POLICY_PUBLISH',
  'USERS_MANAGE',
  'SETTINGS_MANAGE',
  'DEMO_CLOCK',
  'OPS_VIEW',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  INSTITUTION_REP: ['APPLICATION_CREATE', 'APPLICATION_SUBMIT', 'APPLICATION_VIEW_SCOPE', 'FINDING_RESPOND', 'APPEAL_FILE', 'EVIDENCE_UPLOAD'],
  REGIONAL_OFFICER: [
    'APPLICATION_VIEW_SCOPE', 'INTERNAL_NOTES_VIEW', 'STAGE_ASSIGN', 'STAGE_WORK', 'FINDING_RAISE', 'CASE_RETURN',
    'CLASSIFY', 'EVIDENCE_VERIFY', 'DOCUMENT_VERIFY', 'REPORTS_VIEW',
  ],
  BUREAU_OFFICER: [
    'APPLICATION_VIEW_SCOPE', 'INTERNAL_NOTES_VIEW', 'STAGE_ASSIGN', 'CLASSIFY', 'EVIDENCE_VERIFY', 'DEADLINE_EXTEND',
    'REPORTS_VIEW',
  ],
  COMMITTEE_MEMBER: ['APPLICATION_VIEW_ASSIGNED', 'INTERNAL_NOTES_VIEW', 'STAGE_WORK', 'RECOMMEND', 'FINDING_RAISE', 'CASE_RETURN'],
  COMPETENT_AUTHORITY: [
    'APPLICATION_VIEW_SCOPE', 'INTERNAL_NOTES_VIEW', 'STAGE_WORK', 'DECISION_RECORD', 'DEADLINE_EXTEND', 'CASE_REOPEN',
    'POLICY_MIGRATE', 'CLOSE_WITH_REASON', 'REPORTS_VIEW',
  ],
  SYSTEM_ADMIN: ['USERS_MANAGE', 'SETTINGS_MANAGE', 'DEMO_CLOCK', 'OPS_VIEW', 'POLICY_VIEW'],
  POLICY_ADMIN: ['POLICY_VIEW', 'POLICY_DRAFT'],
  POLICY_APPROVER: ['POLICY_VIEW', 'POLICY_PUBLISH'],
  AUDITOR: ['APPLICATION_VIEW_SCOPE', 'INTERNAL_NOTES_VIEW', 'AUDIT_VIEW', 'REPORTS_VIEW', 'POLICY_VIEW'],
};

export const ROLE_LABELS: Record<Role, string> = {
  INSTITUTION_REP: 'Institution representative',
  REGIONAL_OFFICER: 'Regional officer',
  BUREAU_OFFICER: 'Bureau officer',
  COMMITTEE_MEMBER: 'Committee member',
  COMPETENT_AUTHORITY: 'Competent authority',
  SYSTEM_ADMIN: 'System administrator',
  POLICY_ADMIN: 'Policy administrator',
  POLICY_APPROVER: 'Policy approver',
  AUDITOR: 'Auditor (read-only)',
};

export interface Actor {
  userId: string;
  name: string;
  email: string;
  sessionId: string;
  grantId: string;
  role: Role;
  officialDesignation: string | null;
  capabilities: Set<Capability>;
  institutionId: string | null;
  regionIds: string[];
  scopeAll: boolean;
  committeeId: string | null;
  committeeKind: string | null;
}

export function capabilitiesFor(role: Role, extra: string[]): Set<Capability> {
  const set = new Set<Capability>(ROLE_CAPABILITIES[role]);
  for (const c of extra) if ((CAPABILITIES as readonly string[]).includes(c)) set.add(c as Capability);
  return set;
}

export function has(actor: Actor, cap: Capability) {
  return actor.capabilities.has(cap);
}

/** True if the actor's grant covers this region (institution reps are handled by institution id instead). */
export function coversRegion(actor: Actor, regionId: string) {
  return actor.scopeAll || actor.regionIds.includes(regionId);
}

/**
 * SQL condition restricting an applications row (alias `a`) to what the actor may see.
 * Pushes parameters onto `params`. Deny by default.
 */
export function applicationScopeSql(actor: Actor, params: unknown[], alias = 'a'): string {
  if (has(actor, 'APPLICATION_VIEW_SCOPE')) {
    if (actor.role === 'INSTITUTION_REP') {
      params.push(actor.institutionId);
      return `${alias}.institution_id = $${params.length}`;
    }
    if (actor.scopeAll) return 'TRUE';
    params.push(actor.regionIds);
    return `${alias}.region_id = ANY($${params.length}::text[])`;
  }
  if (has(actor, 'APPLICATION_VIEW_ASSIGNED')) {
    params.push(actor.userId);
    return `EXISTS (SELECT 1 FROM stage_assignments sa JOIN stage_instances si ON si.id = sa.stage_instance_id
             WHERE si.application_id = ${alias}.id AND sa.user_id = $${params.length})`;
  }
  return 'FALSE';
}

/** Same rule as applicationScopeSql, for institutions (alias `i`). */
export function institutionScopeSql(actor: Actor, params: unknown[], alias = 'i'): string {
  if (actor.role === 'INSTITUTION_REP') {
    params.push(actor.institutionId);
    return `${alias}.id = $${params.length}`;
  }
  if (has(actor, 'APPLICATION_VIEW_SCOPE')) {
    if (actor.scopeAll) return 'TRUE';
    params.push(actor.regionIds);
    return `${alias}.region_id = ANY($${params.length}::text[])`;
  }
  if (has(actor, 'APPLICATION_VIEW_ASSIGNED')) {
    params.push(actor.userId);
    return `EXISTS (SELECT 1 FROM applications a2 JOIN stage_instances si ON si.application_id = a2.id
             JOIN stage_assignments sa ON sa.stage_instance_id = si.id
             WHERE a2.institution_id = ${alias}.id AND sa.user_id = $${params.length})`;
  }
  return 'FALSE';
}
