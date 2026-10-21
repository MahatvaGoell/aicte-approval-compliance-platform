import type { Db } from '../../db.js';
import { one, q } from '../../db.js';
import { now } from '../../lib/clock.js';
import type { Actor } from '../identity/permissions.js';
import { has, ROLE_LABELS, type Role } from '../identity/permissions.js';
import { routeStages } from '../policy/engine.js';
import { activePolicy } from '../policy/service.js';
import { STATE_LABELS } from '../workflow/states.js';
import { eligibleAssignees, evaluateCompletion } from '../workflow/workflow.js';
import type { CaseContext } from './commands.js';
import { loadCaseContext, permittedCommands } from './commands.js';
import { submissionProblems } from './forms.js';

const NEXT_ACTION_BY_KIND: Record<string, string> = {
  SCRUTINY: 'Complete the scrutiny checklist, record a recommendation and complete the stage',
  EVC: 'Schedule the expert visit, receive and accept the visit report, then complete the stage',
  COMMITTEE: 'Review the case and record the committee recommendation',
  DECISION: 'Review the case history and recommendations, then record the decision',
};

/** Everything the case workspace needs, filtered to what the actor may see. */
export async function caseView(db: Db, actor: Actor, appId: string) {
  const c = await loadCaseContext(db, actor, appId, false);
  const internal = has(actor, 'INTERNAL_NOTES_VIEW');
  const { app } = c;
  const institution = await one(db, 'SELECT id, name, aicte_permanent_id, address, district, state, region_id, institution_type, is_synthetic FROM institutions WHERE id = $1', [app.institution_id]);
  const proposal = await one(db, 'SELECT * FROM proposals WHERE application_id = $1 ORDER BY created_at LIMIT 1', [app.id]);
  const policyForNames = c.policy ?? (await activePolicy(db));
  const category = policyForNames.doc.categories.find((x) => x.code === proposal.category_code);
  const full = await one(db, 'SELECT * FROM applications WHERE id = $1', [app.id]);

  const stageRows = c.workflow
    ? await q(
        db,
        `SELECT si.*, u.name AS assignee_name, cu.name AS completed_by_name
           FROM stage_instances si
           LEFT JOIN users u ON u.id = si.assignee_user_id
           LEFT JOIN users cu ON cu.id = si.completed_by
          WHERE si.workflow_id = $1 ORDER BY si.entered_at, si.attempt_no`,
        [c.workflow.id],
      )
    : [];
  const checklist = stageRows.length
    ? await q(db, `SELECT * FROM checklist_items WHERE stage_instance_id = ANY($1::uuid[]) ORDER BY code`, [stageRows.map((s) => s.id)])
    : [];

  const stages = stageRows.map((s) => ({
    id: s.id,
    stageKey: s.stage_key,
    name: c.policy!.doc.stages[s.stage_key]?.name ?? s.stage_key,
    kind: s.stage_kind,
    attemptNo: s.attempt_no,
    state: s.state,
    stateLabel: STATE_LABELS[s.state],
    ownerRole: s.owner_role,
    ownerRoleLabel: ROLE_LABELS[s.owner_role as Role],
    assignee: internal && s.assignee_user_id ? { id: s.assignee_user_id, name: s.assignee_name } : null,
    enteredAt: s.entered_at,
    startedAt: s.started_at,
    completedAt: s.completed_at,
    completedBy: internal ? s.completed_by_name : null,
    outcome: s.outcome,
    ruleRef: s.rule_ref,
    checklist: checklist
      .filter((i) => i.stage_instance_id === s.id)
      .map((i) => ({
        code: i.code, requirement: i.requirement, ruleRef: i.rule_ref, provenance: i.provenance, evidenceDocType: i.evidence_doc_type,
        status: i.status, observation: internal ? i.observation : null, updatedAt: i.updated_at,
      })),
  }));

  const route = c.workflow?.route_key ? routeStages(c.policy!.doc, c.workflow.route_key) : [];
  const routeProgress = route.map((r, position) => {
    const attempts = stageRows.filter((s) => s.route_position === position);
    const latest = attempts[attempts.length - 1];
    return { position, stageKey: r.key, name: r.def.name, kind: r.def.kind, state: latest?.state ?? 'NOT_STARTED', attempts: attempts.length };
  });

  const completion = c.stage && c.stageDef ? await evaluateCompletion(db, c.stage, c.stageDef) : [];
  const recommendations = internal
    ? await q(
        db,
        `SELECT r.id, r.recommendation, r.text, r.proposed_conditions, r.created_at, r.stage_instance_id, u.name AS author_name, r.author_role
           FROM recommendations r JOIN users u ON u.id = r.author_user_id WHERE r.application_id = $1 ORDER BY r.created_at`,
        [app.id],
      )
    : [];
  const decisionRow = c.workflow
    ? (await q(db, `SELECT d.*, u.name AS authority_name FROM decisions d JOIN users u ON u.id = d.authority_user_id WHERE d.workflow_id = $1`, [c.workflow.id]))[0]
    : null;
  const decision = decisionRow
    ? {
        id: decisionRow.id, outcome: decisionRow.outcome, reason: decisionRow.reason, conditions: decisionRow.conditions,
        issuedAt: decisionRow.issued_at, authorityName: decisionRow.authority_name, ruleRef: decisionRow.rule_ref,
      }
    : null;

  const canAssign = c.stage && has(actor, 'STAGE_ASSIGN');
  const assignable = canAssign && c.stageDef ? await eligibleAssignees(db, c.stageDef, app.region_id, now()) : [];

  return {
    application: {
      id: app.id, appNo: app.app_no, lifecycleState: app.lifecycle_state, lifecycleLabel: STATE_LABELS[app.lifecycle_state],
      decisionOutcome: app.decision_outcome, complianceStatus: app.compliance_status, cycleCode: app.cycle_code, regionId: app.region_id,
      submittedAt: full.submitted_at, createdAt: full.created_at, rowVersion: app.row_version, isSynthetic: full.is_synthetic,
      snapshotSha256: full.snapshot_sha256, formSchemaVersion: full.form_schema_version,
    },
    institution,
    proposal: { categoryCode: proposal.category_code, categoryName: category?.name ?? proposal.category_code, details: proposal.details, classificationStatus: proposal.classification_status },
    form: app.lifecycle_state === 'DRAFT' ? app.draft_data : full.submitted_snapshot?.form ?? {},
    workflow: c.workflow
      ? {
          id: c.workflow.id, state: c.workflow.state, routeKey: c.workflow.route_key,
          routeName: c.workflow.route_key ? c.policy!.doc.routes[c.workflow.route_key].name : null,
          policyVersion: { id: c.policy!.id, versionNo: c.policy!.versionNo, label: c.policy!.label },
          classification: c.workflow.classification_trace,
          routeProgress,
        }
      : null,
    stages,
    currentStageId: c.stage?.id ?? null,
    completion,
    recommendations,
    decision,
    actionPanel: actionPanel(c, completion, app.lifecycle_state === 'DRAFT' ? submissionProblems(app.draft_data, proposal.category_code, proposal.details) : [], stageRows),
    permittedCommands: permittedCommands(c),
    assignableUsers: assignable.map((a) => ({ id: a.user_id, name: a.name, openStages: a.open_load })),
    canEditDraft: app.lifecycle_state === 'DRAFT' && has(actor, 'APPLICATION_CREATE'),
    canSubmit: app.lifecycle_state === 'DRAFT' && has(actor, 'APPLICATION_SUBMIT'),
  };
}

function actionPanel(c: CaseContext, completion: Array<{ condition: string; met: boolean; detail: string }>, draftProblems: Array<{ field: string; message: string }>, stageRows: any[]) {
  const { app, stage, stageDef } = c;
  if (app.lifecycle_state === 'DRAFT') {
    return {
      nextAction: 'Complete the application and submit it',
      responsible: { role: 'Institution representative', person: null },
      waitingSince: null,
      blockers: draftProblems.map((p) => p.message),
      ruleRef: 'demo-form-v1 submission requirements',
      reasonPending: draftProblems.length ? `${draftProblems.length} required item(s) missing` : 'Ready to submit',
      requiresHumanDecision: false,
    };
  }
  if (app.lifecycle_state === 'AWAITING_CLASSIFICATION') {
    return {
      nextAction: 'Classify the application to choose its route',
      responsible: { role: 'Regional or bureau officer', person: null },
      waitingSince: app.current_workflow_id ? null : null,
      blockers: [c.workflow?.classification_trace.explanation ?? 'No matching classification rule'],
      ruleRef: `policy v${c.policy?.versionNo} · classification`,
      reasonPending: 'No configured rule selected a route; the system does not guess',
      requiresHumanDecision: true,
    };
  }
  if (stage && stageDef && ['QUEUED', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_RESPONSE'].includes(stage.state)) {
    const row = stageRows.find((s) => s.id === stage.id);
    if (stage.state === 'QUEUED') {
      return {
        nextAction: `Assign the ${stageDef.name} stage`,
        responsible: { role: 'Regional or bureau officer', person: null },
        waitingSince: stage.entered_at,
        blockers: [`No eligible ${ROLE_LABELS[stage.owner_role as Role].toLowerCase()} was available for automatic assignment`],
        ruleRef: stage.rule_ref,
        reasonPending: 'Waiting for assignment',
        requiresHumanDecision: false,
      };
    }
    const unmet = completion.filter((x) => !x.met);
    return {
      nextAction: NEXT_ACTION_BY_KIND[stageDef.kind],
      responsible: { role: ROLE_LABELS[stage.owner_role as Role], person: has(c.actor, 'INTERNAL_NOTES_VIEW') ? row?.assignee_name ?? null : null },
      waitingSince: stage.entered_at,
      blockers: unmet.map((u) => u.detail),
      ruleRef: stage.rule_ref,
      reasonPending: unmet.length ? `${unmet.length} completion condition(s) not yet met` : 'All completion conditions are met; the owner can complete the stage',
      requiresHumanDecision: stageDef.kind === 'DECISION',
    };
  }
  return {
    nextAction: app.lifecycle_state === 'DECISION_RECORDED' ? 'No further processing action. Any conditions are tracked as compliance obligations.' : 'No action pending',
    responsible: null,
    waitingSince: null,
    blockers: [],
    ruleRef: null,
    reasonPending: null,
    requiresHumanDecision: false,
  };
}

export async function caseTimeline(db: Db, actor: Actor, appId: string) {
  await loadCaseContext(db, actor, appId, false); // scope check
  const internal = has(actor, 'INTERNAL_NOTES_VIEW');
  const rows = await q(
    db,
    `SELECT e.id, e.at, e.action, e.entity_type, e.entity_id, e.reason, e.rule_ref, e.actor_role, e.visibility,
            e.before_state, e.after_state, e.correlation_id, u.name AS actor_name
       FROM audit_events e LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.application_id = $1 ${internal ? '' : `AND e.visibility = 'INSTITUTION'`}
      ORDER BY e.id`,
    [appId],
  );
  return rows.map((r) => ({
    id: r.id, at: r.at, action: r.action, entityType: r.entity_type, reason: r.reason, ruleRef: r.rule_ref,
    actorRole: r.actor_role, actorName: internal || r.actor_role === 'INSTITUTION_REP' ? r.actor_name : null,
    before: internal ? r.before_state : null, after: internal ? r.after_state : null, correlationId: internal ? r.correlation_id : null,
  }));
}
