import type { Db } from '../../db.js';
import { NotFoundError, one, q } from '../../db.js';
import { now } from '../../lib/clock.js';
import { recordAudit, type ActionContext } from '../audit/audit.js';
import type { CaseContext } from '../applications/command-kit.js';
import { assertVersion } from '../applications/service.js';
import { emitEvent } from '../outbox/outbox.js';
import { nextStepAfter, type DeadlineRow } from '../deadlines/engine.js';
import { complianceStatus } from './status.js';
export { complianceStatus } from './status.js';

export async function complianceEvent(tx: Db, c: CaseContext, ctx: ActionContext, id: string, action: string, reason: string, after: unknown) {
  await recordAudit(tx, ctx, { entityType: 'obligation', entityId: id, action, reason, after, applicationId: c.app.id,
    institutionId: c.app.institution_id, policyVersionId: c.policy!.id, ruleRef: `policy v${c.policy!.versionNo} · compliance`, visibility: 'INSTITUTION' });
  await emitEvent(tx, ctx, action, 'obligation', id, { applicationId: c.app.id, obligationId: id });
}
export async function loadObligation(tx: Db, c: CaseContext, id: string, expectedVersion: number) {
  const o = (await q(tx, 'SELECT * FROM obligations WHERE id = $1 AND application_id = $2 FOR UPDATE', [id,c.app.id]))[0];
  if (!o) throw new NotFoundError('Obligation not found'); assertVersion(o, expectedVersion); return o;
}
export async function verifierCandidates(db: Db, regionId: string, at = now()) {
  return q(db, `SELECT DISTINCT u.id, u.name FROM users u JOIN capability_grants g ON g.user_id = u.id
    WHERE u.is_active AND g.role IN ('REGIONAL_OFFICER','BUREAU_OFFICER') AND g.revoked_at IS NULL
      AND g.valid_from <= $2 AND (g.valid_to IS NULL OR g.valid_to > $2) AND (g.scope_all OR $1 = ANY(g.region_ids)) ORDER BY u.name`, [regionId,at]);
}
export async function updateCompliance(tx: Db, c: CaseContext, ctx: ActionContext) {
  const value = await complianceStatus(tx,c.app.id);
  if (value !== c.app.compliance_status) {
    await tx.query('UPDATE applications SET compliance_status = $2 WHERE id = $1',[c.app.id,value]);
    await recordAudit(tx,ctx,{entityType:'application',entityId:c.app.id,action:'COMPLIANCE_CHANGED', before:{status:c.app.compliance_status},after:{status:value},applicationId:c.app.id,institutionId:c.app.institution_id,visibility:'INSTITUTION'});
  }
}
export async function reopenSubmissionClock(tx: Db, ctx: ActionContext, obligationId: string) {
  const d = await one<DeadlineRow>(tx,"SELECT * FROM deadlines WHERE subject_id = $1 AND clock_type = 'OBLIGATION_SUBMISSION' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[obligationId]);
  const start = d.current_due_at < ctx.at ? d.current_due_at : ctx.at;
  await tx.query(`UPDATE deadlines SET state = 'ACTIVE', generation = generation + 1, generation_started_at = $2,
    next_step_at = $3, closed_at = NULL, close_reason = NULL, met_late = NULL WHERE id = $1`,[d.id,start,nextStepAfter(d,start)]);
}
export async function obligationsForCase(db: Db, applicationId: string) {
  const rows = await q(db, `SELECT o.*, u.name AS verifier_name, d.original_due_date, d.current_due_date, d.current_due_at, d.id AS deadline_id,
    d.rule_ref, d.provenance FROM obligations o JOIN users u ON u.id = o.verifier_user_id
    JOIN LATERAL (SELECT * FROM deadlines dl WHERE dl.subject_id = o.id AND dl.clock_type = 'OBLIGATION_SUBMISSION' ORDER BY created_at DESC LIMIT 1) d ON true
    WHERE o.application_id = $1 ORDER BY o.created_at,o.id`,[applicationId]);
  for (const o of rows) {
    o.overdue = o.state === 'OPEN' && o.current_due_at <= now();
    o.submissions = await q(db, `SELECT s.*, v.outcome, v.reason AS verification_reason, v.verified_at FROM evidence_submissions s
      LEFT JOIN verification_results v ON v.submission_id = s.id WHERE s.obligation_id = $1 ORDER BY s.receipt_no`,[o.id]);
    for (const s of o.submissions) s.documents = await q(db, `SELECT v.id, v.version_no, v.sha256, v.filename, r.id AS document_id, r.title
      FROM submission_documents sd JOIN document_versions v ON v.id = sd.version_id JOIN document_records r ON r.id = v.document_id WHERE sd.submission_id = $1 ORDER BY v.id`,[s.id]);
    o.verificationClock = o.current_submission_id ? (await q(db,"SELECT id, current_due_at, state FROM deadlines WHERE subject_id = $1 AND clock_type = 'VERIFICATION' ORDER BY created_at DESC LIMIT 1",[o.current_submission_id]))[0] ?? null : null;
  }
  return rows;
}
