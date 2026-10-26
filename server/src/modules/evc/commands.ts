import { z } from 'zod';
import { AppError, one, q } from '../../db.js';
import { assertVersion } from '../applications/service.js';
import { deny, type CaseContext, type CommandDef } from '../applications/command-kit.js';
import { coversRegion, has } from '../identity/permissions.js';
import { closeDeadlines, insertDeadline } from '../deadlines/engine.js';
import { addVisit, isEvcMember, loadVisit, reserveVisit, slotSchema, visitEvent } from './service.js';
import { now } from '../../lib/clock.js';

const reason = z.string().trim().min(10).max(2000);
const visitInput = z.object({ visitId: z.string().uuid(), visitExpectedVersion: z.number().int().positive(), reason });
const proposalInput = slotSchema.extend({ expertIds: z.array(z.string().uuid()).min(1).max(10), reason });
const scheduleCommands = ['PROPOSE_VISIT','CONFIRM_VISIT','RESCHEDULE_VISIT','CANCEL_VISIT','RECORD_VISIT_HELD'];
function guard(c: CaseContext, command: string) {
  if (!c.stage || c.stage.stage_kind !== 'EVC' || !['ASSIGNED','IN_PROGRESS'].includes(c.stage.state)) return deny(409, 'EVC_NOT_LIVE', 'A live, ready EVC stage is required');
  if (!c.policy?.doc.evc) return deny(409, 'EVC_POLICY_UNCONFIGURED', 'The pinned policy has no EVC configuration');
  if (scheduleCommands.includes(command) && (!has(c.actor, 'EVC_SCHEDULE') || !coversRegion(c.actor, c.app.region_id))) return deny(403, 'MISSING_CAPABILITY', 'A scheduler grant covering this region is required');
  if (['ACCEPT_VISIT_REPORT','RETURN_VISIT_REPORT'].includes(command) && (!has(c.actor, 'EVC_REVIEW') || !coversRegion(c.actor, c.app.region_id))) return deny(403, 'MISSING_CAPABILITY', 'An EVC report reviewer covering this region is required');
  if (['SUBMIT_VISIT_REPORT','CONFIRM_VISIT_MEMBER'].includes(command) && (!isEvcMember(c.actor) || !c.evcMember)) return deny(403, 'NOT_VISIT_MEMBER', 'An active EVC member assigned to this visit is required');
  if (command === 'ACKNOWLEDGE_VISIT' && (c.actor.role !== 'INSTITUTION_REP' || c.actor.institutionId !== c.app.institution_id)) return deny(403, 'NOT_INSTITUTION', 'Only the case institution can acknowledge the visit');
  if (command === 'ACKNOWLEDGE_VISIT' && c.evcVisit?.institution_acknowledged_at) return deny(409, 'ALREADY_ACKNOWLEDGED', 'This visit is already acknowledged');
  if (command === 'CONFIRM_VISIT_MEMBER' && c.evcMemberConfirmed) return deny(409, 'MEMBER_ALREADY_CONFIRMED', 'Your participation is already confirmed');
  if (command === 'RECORD_VISIT_HELD' && c.evcVisit && (c.evcVisit.ends_at > now() || !c.evcVisit.institution_acknowledged_at || c.evcVisit.pending_members > 0)) return deny(409, 'VISIT_NOT_READY_TO_RECORD', 'Visit must have ended, with institution acknowledgement and all member confirmations');
  const state = c.evcVisit?.state;
  const allowed: Record<string, string[]> = {
    PROPOSE_VISIT: [], CONFIRM_VISIT: ['PROPOSED'], RESCHEDULE_VISIT: ['PROPOSED','CONFIRMED'], CANCEL_VISIT: ['PROPOSED','CONFIRMED'],
    RECORD_VISIT_HELD: ['CONFIRMED'], SUBMIT_VISIT_REPORT: ['HELD'], ACCEPT_VISIT_REPORT: ['REPORT_SUBMITTED'], RETURN_VISIT_REPORT: ['REPORT_SUBMITTED'],
    ACKNOWLEDGE_VISIT: ['CONFIRMED'], CONFIRM_VISIT_MEMBER: ['CONFIRMED'],
  };
  if (command === 'PROPOSE_VISIT' ? !!state : !state || !allowed[command].includes(state)) return deny(409, 'VISIT_STATE', command === 'PROPOSE_VISIT' ? 'An active visit already exists' : 'The current visit is not ready for this action');
  return null;
}
function def(name: string, label: string, input: z.ZodTypeAny, run: CommandDef<any>['run']): CommandDef<any> {
  return { name, label, input, guard: (c) => guard(c, name), run };
}
async function checked(tx: Parameters<typeof loadVisit>[0], c: CaseContext, input: any) {
  const v = await loadVisit(tx, c, input.visitId); assertVersion(v, input.visitExpectedVersion);
  if (v.id !== c.evcVisit?.id) throw new AppError(409, 'VISIT_SUPERSEDED', 'Refresh the current visit before acting');
  return v;
}

export const EVC_COMMANDS = [
  def('PROPOSE_VISIT', 'Propose an expert visit', proposalInput, async (tx, c, ctx, input) => {
    const v = await addVisit(tx, c, ctx, input, input.expertIds, input.reason);
    return { visitId: v.id };
  }),
  def('CONFIRM_VISIT', 'Confirm visit and reserve experts', visitInput, async (tx, c, ctx, input) => {
    const v = await checked(tx, c, input); await reserveVisit(tx, c, ctx, v, input.reason); return { visitId: v.id };
  }),
  def('RESCHEDULE_VISIT', 'Reschedule the visit with history', proposalInput.merge(visitInput), async (tx, c, ctx, input) => {
    const old = await checked(tx, c, input);
    const priorMembers = await q(tx, 'SELECT expert_user_id FROM visit_members WHERE visit_id = $1', [old.id]);
    await tx.query('SELECT user_id FROM expert_profiles WHERE user_id = ANY($1::uuid[]) ORDER BY user_id FOR UPDATE', [[...new Set([...input.expertIds, ...priorMembers.map((m) => m.expert_user_id)])]]);
    await tx.query('UPDATE expert_reservations SET active = false WHERE visit_id = $1', [old.id]);
    await tx.query("UPDATE evc_visits SET state = 'RESCHEDULED', row_version = row_version + 1 WHERE id = $1", [old.id]);
    await closeDeadlines(tx, ctx, old.id, 'CANCELLED', input.reason, 'EVC_REPORT');
    await tx.query("UPDATE deadlines SET generation = generation + 1 WHERE subject_id = $1 AND clock_type = 'EVC_REPORT'", [old.id]);
    const v = await addVisit(tx, c, ctx, input, input.expertIds, input.reason, old.id);
    if (old.state === 'CONFIRMED') {
      await reserveVisit(tx, c, ctx, v, input.reason);
      await tx.query("UPDATE deadlines SET generation = COALESCE((SELECT max(generation) FROM deadlines WHERE subject_id = $2),1) WHERE subject_id = $1 AND clock_type = 'EVC_REPORT'", [v.id, old.id]);
    }
    await visitEvent(tx, c, ctx, old.id, 'EVC_VISIT_RESCHEDULED', input.reason, { replacementVisitId: v.id });
    return { visitId: v.id, previousVisitId: old.id };
  }),
  def('CANCEL_VISIT', 'Cancel the visit and release reservations', visitInput, async (tx, c, ctx, input) => {
    const v = await checked(tx, c, input);
    await tx.query("UPDATE evc_visits SET state = 'CANCELLED', row_version = row_version + 1 WHERE id = $1", [v.id]);
    await tx.query('UPDATE expert_reservations SET active = false WHERE visit_id = $1', [v.id]);
    await closeDeadlines(tx, ctx, v.id, 'CANCELLED', input.reason, 'EVC_REPORT');
    await tx.query("UPDATE deadlines SET generation = generation + 1 WHERE subject_id = $1 AND clock_type = 'EVC_REPORT'", [v.id]);
    if (v.state === 'CONFIRMED') await insertDeadline(tx, ctx, { applicationId: c.app.id, institutionId: c.app.institution_id,
      workflowId: c.workflow!.id, clockType: 'EVC_SCHEDULING', subjectId: c.stage!.id, stageKey: c.stage!.stage_key,
      anchorAt: v.ready_at, label: 'EVC replacement scheduling', rule: c.policy!.doc.evc!.scheduling, policy: c.policy!, ruleRefPath: 'evc/scheduling' });
    await visitEvent(tx, c, ctx, v.id, 'EVC_VISIT_CANCELLED', input.reason); return { visitId: v.id };
  }),
  def('ACKNOWLEDGE_VISIT', 'Acknowledge the confirmed visit', visitInput, async (tx, c, ctx, input) => {
    const v = await checked(tx, c, input);
    if (v.institution_acknowledged_at) throw new AppError(409, 'ALREADY_ACKNOWLEDGED', 'This visit is already acknowledged');
    await tx.query('UPDATE evc_visits SET institution_acknowledged_at = $2, institution_acknowledged_by = $3, row_version = row_version + 1 WHERE id = $1', [v.id, ctx.at, c.actor.userId]);
    await visitEvent(tx, c, ctx, v.id, 'EVC_INSTITUTION_ACKNOWLEDGED', input.reason); return { visitId: v.id };
  }),
  def('CONFIRM_VISIT_MEMBER', 'Confirm your participation in the visit', visitInput, async (tx, c, ctx, input) => {
    const v = await checked(tx, c, input);
    const updated = await q(tx, 'UPDATE visit_members SET confirmed_at = $3 WHERE visit_id = $1 AND expert_user_id = $2 AND committee_id = $4 AND confirmed_at IS NULL RETURNING expert_user_id', [v.id, c.actor.userId, ctx.at, c.actor.committeeId]);
    if (!updated.length) throw new AppError(409, 'MEMBER_ALREADY_CONFIRMED', 'Your participation is already confirmed');
    await tx.query('UPDATE evc_visits SET row_version = row_version + 1 WHERE id = $1', [v.id]);
    await visitEvent(tx, c, ctx, v.id, 'EVC_MEMBER_CONFIRMED', input.reason); return { visitId: v.id };
  }),
  def('RECORD_VISIT_HELD', 'Record that the visit was held', visitInput, async (tx, c, ctx, input) => {
    const v = await checked(tx, c, input);
    if (ctx.at < v.ends_at) throw new AppError(422, 'VISIT_NOT_ENDED', 'The confirmed visit has not ended');
    const pending = await q(tx, 'SELECT expert_user_id FROM visit_members WHERE visit_id = $1 AND confirmed_at IS NULL', [v.id]);
    if (!v.institution_acknowledged_at || pending.length) throw new AppError(422, 'VISIT_CONFIRMATIONS_PENDING', 'Institution acknowledgement and every member confirmation are required');
    await tx.query("UPDATE evc_visits SET state = 'HELD', held_at = $2, row_version = row_version + 1 WHERE id = $1", [v.id, ctx.at]);
    await visitEvent(tx, c, ctx, v.id, 'EVC_VISIT_HELD', input.reason); return { visitId: v.id };
  }),
  def('SUBMIT_VISIT_REPORT', 'Submit the visit report', visitInput.extend({ summary: z.string().trim().min(20).max(10000),
    findings: z.array(z.object({ requirement: z.string().trim().min(3).max(500), observation: z.string().trim().min(5).max(4000), visibility: z.enum(['INTERNAL','INSTITUTION']) })).min(1).max(100) }), async (tx, c, ctx, input) => {
    const v = await checked(tx, c, input);
    const report = await one(tx, `INSERT INTO visit_reports(visit_id, revision, summary, submitted_by, submitted_at)
      SELECT $1, COALESCE(max(revision),0)+1, $2, $3, $4 FROM visit_reports WHERE visit_id = $1 RETURNING id, revision`, [v.id, input.summary, c.actor.userId, ctx.at]);
    for (const f of input.findings) await tx.query('INSERT INTO visit_findings(report_id, requirement, observation, visibility) VALUES ($1,$2,$3,$4)', [report.id, f.requirement, f.observation, f.visibility]);
    await tx.query("UPDATE evc_visits SET state = 'REPORT_SUBMITTED', row_version = row_version + 1 WHERE id = $1", [v.id]);
    await visitEvent(tx, c, ctx, v.id, 'EVC_REPORT_SUBMITTED', input.reason, { reportId: report.id, revision: report.revision });
    return { visitId: v.id, reportId: report.id };
  }),
  ...(['ACCEPT_VISIT_REPORT','RETURN_VISIT_REPORT'] as const).map((command) => def(command,
    command === 'ACCEPT_VISIT_REPORT' ? 'Accept the visit report' : 'Return the report for correction', visitInput.extend({ reportId: z.string().uuid() }), async (tx, c, ctx, input) => {
      const v = await checked(tx, c, input);
      const latest = await one(tx, 'SELECT id FROM visit_reports WHERE visit_id = $1 ORDER BY revision DESC LIMIT 1', [v.id]);
      if (latest.id !== input.reportId) throw new AppError(409, 'REPORT_SUPERSEDED', 'Review the latest report revision');
      await tx.query('UPDATE evc_visits SET state = $2, row_version = row_version + 1 WHERE id = $1', [v.id, command === 'ACCEPT_VISIT_REPORT' ? 'REPORT_ACCEPTED' : 'HELD']);
      if (command === 'ACCEPT_VISIT_REPORT') await closeDeadlines(tx, ctx, v.id, 'MET', input.reason, 'EVC_REPORT');
      await visitEvent(tx, c, ctx, v.id, command === 'ACCEPT_VISIT_REPORT' ? 'EVC_REPORT_ACCEPTED' : 'EVC_REPORT_RETURNED', input.reason, { reportId: latest.id });
      return { visitId: v.id, reportId: latest.id };
    })),
];
