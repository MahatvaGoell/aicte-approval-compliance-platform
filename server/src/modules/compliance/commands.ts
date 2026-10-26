import { z } from 'zod';
import { AppError, NotFoundError, ValidationError, one, q } from '../../db.js';
import { has, coversRegion } from '../identity/permissions.js';
import { deny, type CaseContext, type CommandDef } from '../applications/command-kit.js';
import { closeDeadlines, insertDeadline } from '../deadlines/engine.js';
import { endOfLocalDateExclusive } from '../deadlines/calendar.js';
import { getPolicyVersion } from '../policy/service.js';
import { dateOnly, reasonSchema } from '../documents/schema.js';
import { checkedBytes, visibleVersion } from '../documents/service.js';
import { complianceEvent, loadObligation, reopenSubmissionClock, updateCompliance, verifierCandidates } from './service.js';

const target = z.object({ obligationId: z.string().uuid(), obligationExpectedVersion: z.number().int().positive(), reason: reasonSchema });
function guard(c: CaseContext, name: string) {
  if (!c.policy?.doc.compliance) return deny(409,'COMPLIANCE_UNCONFIGURED','The pinned policy has no compliance configuration');
  if (name === 'SUBMIT_EVIDENCE') {
    if (c.actor.role !== 'INSTITUTION_REP' || c.actor.institutionId !== c.app.institution_id || !has(c.actor,'EVIDENCE_UPLOAD')) return deny(403,'MISSING_CAPABILITY','Only the case institution submits obligation evidence');
  } else if (name === 'CLOSE_OBLIGATION') {
    if (!has(c.actor,'CLOSE_WITH_REASON') || !coversRegion(c.actor,c.app.region_id)) return deny(403,'MISSING_CAPABILITY','An authorised closure grant is required');
  } else if (!has(c.actor,'EVIDENCE_VERIFY') || !coversRegion(c.actor,c.app.region_id)) return deny(403,'MISSING_CAPABILITY','A scoped evidence-verification grant is required');
  if (name === 'CREATE_OBLIGATION' && (!c.decision || !['APPROVED','APPROVED_WITH_CONDITIONS'].includes(c.decision.outcome))) return deny(409,'NO_APPROVED_DECISION','Record an authorised approval with conditions first');
  if (['BEGIN_VERIFICATION','VERIFY_EVIDENCE'].includes(name) && !c.obligations.some(o=>o.verifier_user_id===c.actor.userId)) return deny(403,'NOT_VERIFIER','Only an assigned verifier can review an obligation');
  if (name === 'VERIFY_EVIDENCE' && !c.obligations.some(o=>o.verifier_user_id===c.actor.userId && o.state==='UNDER_VERIFICATION')) return deny(409,'NO_ACTIONABLE_OBLIGATION','Start reviewing an assigned submission first');
  if (name !== 'CREATE_OBLIGATION' && !c.obligations.some((o) => name === 'SUBMIT_EVIDENCE' ? o.state === 'OPEN' : name === 'BEGIN_VERIFICATION' ? o.state === 'EVIDENCE_SUBMITTED' : ['OPEN','EVIDENCE_SUBMITTED','UNDER_VERIFICATION'].includes(o.state))) return deny(409,'NO_ACTIONABLE_OBLIGATION','No obligation is ready for this action');
  return null;
}
function def(name: string,label: string,input: z.ZodTypeAny,run: CommandDef<any>['run']): CommandDef<any> { return {name,label,input,guard:(c)=>guard(c,name),run}; }
export const COMPLIANCE_COMMANDS = [
  def('CREATE_OBLIGATION','Track an approval condition',z.object({ conditionIndex:z.number().int().min(0), requiredDocumentType:z.string(), verifierUserId:z.string().uuid(), dueDate:dateOnly.optional(), reason:reasonSchema }),async(tx,c,ctx,input)=>{
    const decision = await one(tx,'SELECT * FROM decisions WHERE id = $1 AND application_id = $2',[c.decision!.id,c.app.id]);
    const condition = decision.conditions[input.conditionIndex]; if (!condition) throw new NotFoundError('Decision condition not found');
    if (!c.policy!.doc.compliance!.documentTypes.some((t)=>t.code === input.requiredDocumentType)) throw new ValidationError('Choose a configured required document type');
    if (!(await verifierCandidates(tx,c.app.region_id,ctx.at)).some((u)=>u.id===input.verifierUserId)) throw new ValidationError('Choose a currently eligible regional verifier');
    if (!condition.dueInDays && !input.dueDate) throw new ValidationError('An explicit due date and recorded basis are required for this condition');
    if (condition.dueInDays && input.dueDate) throw new ValidationError('This recorded condition already specifies its duration; use an authorised extension after creation');
    const policy = await getPolicyVersion(tx,decision.policy_version_id);
    const o = await one(tx,`INSERT INTO obligations(application_id,decision_id,condition_index,condition_text,required_document_type,policy_version_id,verifier_user_id,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[c.app.id,decision.id,input.conditionIndex,condition.text,input.requiredDocumentType,policy.id,input.verifierUserId,ctx.at]);
    await insertDeadline(tx,ctx,{ applicationId:c.app.id,institutionId:c.app.institution_id,workflowId:decision.workflow_id,clockType:'OBLIGATION_SUBMISSION',subjectId:o.id,stageKey:'COMPLIANCE',label:'Approval condition evidence',anchorAt:decision.issued_at,
      rule:{amount:condition.dueInDays ?? 0,unit:'CALENDAR_DAYS',provenance:policy.doc.compliance!.provenance},policy,ruleRefPath:`decision/${decision.id}/conditions/${input.conditionIndex}`,dueDate:input.dueDate });
    await complianceEvent(tx,c,ctx,o.id,'OBLIGATION_CREATED',input.reason,{decisionId:decision.id,conditionIndex:input.conditionIndex}); await updateCompliance(tx,c,ctx); return {obligationId:o.id};
  }),
  def('SUBMIT_EVIDENCE','Submit exact document versions as evidence',target.extend({versionIds:z.array(z.string().uuid()).min(1).max(10)}),async(tx,c,ctx,input)=>{
    const o = await loadObligation(tx,c,input.obligationId,input.obligationExpectedVersion);
    if (o.state !== 'OPEN') throw new AppError(409,'OBLIGATION_NOT_OPEN','This obligation is not accepting a submission');
    if (new Set(input.versionIds).size !== input.versionIds.length) throw new ValidationError('Choose distinct document versions');
    const versions = []; for (const id of input.versionIds) versions.push(await visibleVersion(tx,c.actor,id,c.app.id));
    if (!versions.some((v)=>v.document_type===o.required_document_type) || versions.some((v)=>v.visibility!=='INSTITUTION')) throw new ValidationError('Include the required institution-visible document type');
    const d = await one(tx,"SELECT * FROM deadlines WHERE subject_id = $1 AND clock_type = 'OBLIGATION_SUBMISSION' AND state = 'ACTIVE' FOR UPDATE",[o.id]);
    const s = await one(tx,`INSERT INTO evidence_submissions(obligation_id,application_id,submitted_by,received_at,effective_due_at,on_time,deadline_generation,reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[o.id,c.app.id,c.actor.userId,ctx.at,d.current_due_at,ctx.at<d.current_due_at,d.generation,input.reason]);
    for (const id of input.versionIds) await tx.query('INSERT INTO submission_documents(submission_id,version_id,application_id) VALUES ($1,$2,$3)',[s.id,id,c.app.id]);
    await closeDeadlines(tx,ctx,o.id,'MET','Evidence received; officer verification is a separate clock','OBLIGATION_SUBMISSION');
    await insertDeadline(tx,ctx,{applicationId:c.app.id,institutionId:c.app.institution_id,workflowId:c.workflow!.id,clockType:'VERIFICATION',subjectId:s.id,stageKey:'COMPLIANCE',label:'Evidence verification waiting',rule:c.policy!.doc.compliance!.verification,policy:c.policy!,ruleRefPath:'compliance/verification'});
    await tx.query("UPDATE obligations SET state = 'EVIDENCE_SUBMITTED', current_submission_id = $2, row_version = row_version + 1 WHERE id = $1",[o.id,s.id]);
    await complianceEvent(tx,c,ctx,o.id,'EVIDENCE_SUBMITTED',input.reason,{submissionId:s.id,onTime:ctx.at<d.current_due_at,versionIds:input.versionIds}); await updateCompliance(tx,c,ctx); return {submissionId:s.id,onTime:ctx.at<d.current_due_at};
  }),
  def('BEGIN_VERIFICATION','Start reviewing the current evidence',target,async(tx,c,ctx,input)=>{
    const o = await loadObligation(tx,c,input.obligationId,input.obligationExpectedVersion);
    if (o.verifier_user_id !== c.actor.userId) throw new AppError(403,'NOT_VERIFIER','Only the assigned verifier can review this obligation');
    if (o.state !== 'EVIDENCE_SUBMITTED') throw new AppError(409,'NOT_SUBMITTED','Evidence is not waiting for review');
    await tx.query("UPDATE obligations SET state = 'UNDER_VERIFICATION', row_version = row_version + 1 WHERE id = $1",[o.id]);
    await complianceEvent(tx,c,ctx,o.id,'EVIDENCE_REVIEW_STARTED',input.reason,{submissionId:o.current_submission_id}); return {obligationId:o.id};
  }),
  def('VERIFY_EVIDENCE','Record an evidence verification result',target.extend({submissionId:z.string().uuid(),outcome:z.enum(['ACCEPT','REJECT'])}),async(tx,c,ctx,input)=>{
    const o = await loadObligation(tx,c,input.obligationId,input.obligationExpectedVersion);
    if (o.verifier_user_id !== c.actor.userId) throw new AppError(403,'NOT_VERIFIER','Only the assigned verifier can record this result');
    if (o.state !== 'UNDER_VERIFICATION' || o.current_submission_id !== input.submissionId) throw new AppError(409,'EVIDENCE_NOT_CURRENT','Start verification of the current submission first');
    const s = await one(tx,'SELECT * FROM evidence_submissions WHERE id = $1 AND obligation_id = $2',[input.submissionId,o.id]);
    if (input.outcome === 'ACCEPT') {
      const docs = await q(tx,`SELECT v.id, v.storage_key, v.sha256, dv.outcome, r.current_verified_version_id, r.document_type, mr.confirmed_values FROM submission_documents sd
        JOIN document_versions v ON v.id = sd.version_id JOIN document_records r ON r.id = v.document_id
        LEFT JOIN document_verifications dv ON dv.version_id = v.id LEFT JOIN metadata_reviews mr ON mr.id = dv.metadata_review_id WHERE sd.submission_id = $1`,[s.id]);
      if (docs.some((v)=>v.outcome!=='ACCEPT' || v.current_verified_version_id!==v.id || (v.confirmed_values?.validThrough && endOfLocalDateExclusive(v.confirmed_values.validThrough,c.policy!.doc.calendar.timezone)<=ctx.at))) throw new ValidationError('Verify the submitted document versions first; expired or superseded evidence cannot fulfil this obligation');
      for (const doc of docs) await checkedBytes(doc);
    }
    await tx.query('INSERT INTO verification_results(submission_id,outcome,reason,verified_by,verified_at) VALUES ($1,$2,$3,$4,$5)',[s.id,input.outcome,input.reason,c.actor.userId,ctx.at]);
    await closeDeadlines(tx,ctx,s.id,'MET','An authorised evidence verification result was recorded','VERIFICATION');
    await tx.query('UPDATE obligations SET state = $2, row_version = row_version + 1, closed_at = $3, closed_reason = $4 WHERE id = $1',[o.id,input.outcome==='ACCEPT'?'FULFILLED':'OPEN',input.outcome==='ACCEPT'?ctx.at:null,input.outcome==='ACCEPT'?input.reason:null]);
    if (input.outcome==='REJECT') await reopenSubmissionClock(tx,ctx,o.id);
    await complianceEvent(tx,c,ctx,o.id,input.outcome==='ACCEPT'?'OBLIGATION_FULFILLED':'EVIDENCE_REJECTED',input.reason,{submissionId:s.id,originalOnTime:s.on_time}); await updateCompliance(tx,c,ctx); return {obligationId:o.id};
  }),
  def('CLOSE_OBLIGATION','Close an obligation with authorised reason',target,async(tx,c,ctx,input)=>{
    const o = await loadObligation(tx,c,input.obligationId,input.obligationExpectedVersion);
    if (['FULFILLED','CLOSED_WITH_AUTHORISED_REASON'].includes(o.state)) throw new AppError(409,'OBLIGATION_CLOSED','This obligation is already closed');
    await closeDeadlines(tx,ctx,o.id,'CANCELLED',input.reason,'OBLIGATION_SUBMISSION');
    if(o.current_submission_id) await closeDeadlines(tx,ctx,o.current_submission_id,'CANCELLED',input.reason,'VERIFICATION');
    await tx.query("UPDATE obligations SET state = 'CLOSED_WITH_AUTHORISED_REASON', closed_at = $2, closed_reason = $3, row_version = row_version + 1 WHERE id = $1",[o.id,ctx.at,input.reason]);
    await complianceEvent(tx,c,ctx,o.id,'OBLIGATION_CLOSED_WITH_REASON',input.reason,{}); await updateCompliance(tx,c,ctx); return {obligationId:o.id};
  }),
];
