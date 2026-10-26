import { z } from 'zod';
import { AppError, NotFoundError, ValidationError, one, q } from '../../db.js';
import { deny, type CaseContext, type CommandDef } from '../applications/command-kit.js';
import { coversRegion, has } from '../identity/permissions.js';
import { closeDeadlines, insertDeadline } from '../deadlines/engine.js';
import { emitEvent } from '../outbox/outbox.js';
import { metadataSchema, reasonSchema } from './schema.js';
import { checkedBytes, documentEvent, visibleVersion } from './service.js';

function guard(c: CaseContext, name: string) {
  if (!c.policy?.doc.compliance) return deny(409,'DOCUMENTS_UNCONFIGURED','The pinned policy has no document configuration');
  if (name === 'ATTACH_DOCUMENT') {
    if(!has(c.actor,'EVIDENCE_UPLOAD')) return deny(403,'MISSING_CAPABILITY','Your grant cannot attach evidence');
    const ready=c.actor.role==='INSTITUTION_REP' ? c.findings.some(f=>f.state==='RESPONSE_SUBMITTED'&&f.visibility==='INSTITUTION') : c.evcMember&&c.evcVisit?.state==='REPORT_SUBMITTED';
    return ready?null:deny(409,'NO_ATTACHMENT_TARGET','A submitted institution response or assigned visit report awaiting review is required');
  }
  return has(c.actor,'DOCUMENT_VERIFY') && coversRegion(c.actor,c.app.region_id) ? null : deny(403,'MISSING_CAPABILITY','A scoped document-review grant is required');
}
function def(name:string,label:string,input:z.ZodTypeAny,run:CommandDef<any>['run']):CommandDef<any> {return {name,label,input,guard:(c)=>guard(c,name),run};}
const target = z.object({versionId:z.string().uuid(),reason:reasonSchema});
export const DOCUMENT_COMMANDS = [
  def('REVIEW_DOCUMENT_METADATA','Confirm metadata for an exact document version',target.extend({values:metadataSchema}),async(tx,c,ctx,input)=>{
    const v=await visibleVersion(tx,c.actor,input.versionId,c.app.id);
    if ((await q(tx,'SELECT 1 FROM document_verifications WHERE version_id = $1',[v.id])).length) throw new AppError(409,'VERSION_REVIEWED','Verified/rejected metadata is frozen with its verification result');
    if (input.values.page && v.page_estimate && input.values.page>v.page_estimate) throw new ValidationError('The cited page exceeds the PDF page estimate');
    const m=await one(tx,'INSERT INTO metadata_reviews(version_id,confirmed_values,reviewed_by,reviewed_at,reason) VALUES ($1,$2,$3,$4,$5) RETURNING id',[v.id,JSON.stringify(input.values),c.actor.userId,ctx.at,input.reason]);
    await documentEvent(tx,ctx,c.app,v.document_id,'DOCUMENT_METADATA_CONFIRMED',input.reason,{versionId:v.id,metadataReviewId:m.id,values:input.values},v.visibility);
    await emitEvent(tx,ctx,'DOCUMENT_METADATA_CONFIRMED','document',v.document_id,{applicationId:c.app.id,versionId:v.id}); return {metadataReviewId:m.id};
  }),
  def('VERIFY_DOCUMENT','Accept or reject an exact document version',target.extend({outcome:z.enum(['ACCEPT','REJECT']),metadataReviewId:z.string().uuid().optional()}),async(tx,c,ctx,input)=>{
    const v=await visibleVersion(tx,c.actor,input.versionId,c.app.id);
    if (v.uploaded_by===c.actor.userId) throw new AppError(403,'SELF_VERIFICATION','Another authorised reviewer must verify your upload');
    if ((await q(tx,'SELECT 1 FROM document_verifications WHERE version_id = $1',[v.id])).length) throw new AppError(409,'VERSION_REVIEWED','This version already has an immutable verification result');
    let m:any=null;
    if(input.outcome==='ACCEPT') {
      if(v.latest_version_id!==v.id) throw new AppError(409,'VERSION_SUPERSEDED','Review the latest uploaded version');
      m=(await q(tx,'SELECT * FROM metadata_reviews WHERE version_id = $1 ORDER BY sequence_no DESC LIMIT 1',[v.id]))[0];
      if(!m || m.id!==input.metadataReviewId) throw new ValidationError('Confirm and select the latest metadata review first');
      const type=c.policy!.doc.compliance!.documentTypes.find(t=>t.code===v.document_type);
      if(type?.validityRequired && !m.confirmed_values.validThrough) throw new ValidationError('The pinned rule requires a reviewer-confirmed valid-through date');
      await checkedBytes(v);
    }
    await tx.query('INSERT INTO document_verifications(version_id,metadata_review_id,outcome,reason,verified_by,verified_at) VALUES ($1,$2,$3,$4,$5,$6)',[v.id,m?.id??null,input.outcome,input.reason,c.actor.userId,ctx.at]);
    if(input.outcome==='ACCEPT') {
      if(v.current_verified_version_id) await closeDeadlines(tx,ctx,v.current_verified_version_id,'CANCELLED','A replacement document version was verified','DOCUMENT_VALIDITY');
      await tx.query('UPDATE document_records SET current_verified_version_id = $2, row_version = row_version + 1 WHERE id = $1',[v.document_id,v.id]);
      if(m.confirmed_values.validThrough) await insertDeadline(tx,ctx,{applicationId:c.app.id,institutionId:c.app.institution_id,workflowId:c.workflow!.id,clockType:'DOCUMENT_VALIDITY',subjectId:v.id,stageKey:'DOCUMENTS',label:'Verified document validity',
        rule:{amount:0,unit:'CALENDAR_DAYS',provenance:c.policy!.doc.compliance!.provenance},policy:c.policy!,ruleRefPath:`compliance/documentTypes/${v.document_type}`,dueDate:m.confirmed_values.validThrough,visibility:v.visibility});
    }
    await documentEvent(tx,ctx,c.app,v.document_id,input.outcome==='ACCEPT'?'DOCUMENT_VERIFIED':'DOCUMENT_REJECTED',input.reason,{versionId:v.id,metadataReviewId:m?.id??null},v.visibility);
    await emitEvent(tx,ctx,'DOCUMENT_REVIEWED','document',v.document_id,{applicationId:c.app.id,versionId:v.id,visibility:v.visibility}); return {versionId:v.id};
  }),
  def('ATTACH_DOCUMENT','Link a document version to a submitted response or report',target.extend({targetKind:z.enum(['FINDING_RESPONSE','VISIT_REPORT','VISIT_FINDING']),targetId:z.string().uuid()}),async(tx,c,ctx,input)=>{
    const v=await visibleVersion(tx,c.actor,input.versionId,c.app.id);
    let allowed=false, targetVisibility:'INTERNAL'|'INSTITUTION'=v.visibility;
    if(input.targetKind==='FINDING_RESPONSE') {
      const r=(await q(tx,`SELECT r.id, f.state, f.visibility FROM finding_responses r JOIN findings f ON f.id = r.finding_id WHERE r.id = $1 AND f.application_id = $2`,[input.targetId,c.app.id]))[0];
      if(!r || (r.visibility==='INTERNAL'&&!has(c.actor,'INTERNAL_NOTES_VIEW'))) throw new NotFoundError('Attachment target not found');
      const latest=await one(tx,'SELECT id FROM finding_responses WHERE finding_id = (SELECT finding_id FROM finding_responses WHERE id = $1) ORDER BY receipt_sequence DESC LIMIT 1',[r.id]);
      allowed=r.state==='RESPONSE_SUBMITTED' && c.actor.role==='INSTITUTION_REP' && latest.id===r.id;
      if(r.visibility==='INTERNAL') targetVisibility='INTERNAL';
    } else {
      const r=(await q(tx,`SELECT rp.id, ev.state, rp.revision,
        (SELECT max(revision) FROM visit_reports vr WHERE vr.visit_id = ev.id) AS latest_revision,
        ${input.targetKind==='VISIT_FINDING'?"(SELECT visibility FROM visit_findings WHERE id = $1)":"'INSTITUTION'"} AS visibility FROM visit_reports rp JOIN evc_visits ev ON ev.id = rp.visit_id
        WHERE ${input.targetKind==='VISIT_REPORT'?'rp.id = $1':'rp.id = (SELECT report_id FROM visit_findings WHERE id = $1)'} AND ev.application_id = $2
        AND EXISTS (SELECT 1 FROM visit_members vm WHERE vm.visit_id = ev.id AND vm.expert_user_id = $3 AND vm.committee_id = $4)`,[input.targetId,c.app.id,c.actor.userId,c.actor.committeeId]))[0];
      if(!r) throw new NotFoundError('Attachment target not found'); allowed=r.state==='REPORT_SUBMITTED' && c.actor.committeeKind==='EVC' && r.revision===r.latest_revision;
      if(r.visibility==='INTERNAL') targetVisibility='INTERNAL';
    }
    if(!allowed) throw new AppError(409,'ATTACHMENT_FROZEN','Attachments must be recorded by the responding institution or assigned expert before the response/report is reviewed');
    const a=await one(tx,'INSERT INTO document_attachments(application_id,version_id,target_kind,target_id,attached_by,attached_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',[c.app.id,v.id,input.targetKind,input.targetId,c.actor.userId,ctx.at]);
    await documentEvent(tx,ctx,c.app,v.document_id,'DOCUMENT_ATTACHED',input.reason,{attachmentId:a.id,targetKind:input.targetKind,targetId:input.targetId,versionId:v.id},targetVisibility);
    await emitEvent(tx,ctx,'DOCUMENT_ATTACHED','document',v.document_id,{applicationId:c.app.id}); return {attachmentId:a.id};
  }),
];
