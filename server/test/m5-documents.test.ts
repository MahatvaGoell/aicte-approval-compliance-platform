import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { beforeEach,afterEach,describe,it,expect } from 'vitest';
import { closePool,getPool,one,q,withTx } from '../src/db.js';
import { now,realNow,setTestNow } from '../src/lib/clock.js';
import { LocalStorageAdapter,type StorageAdapter } from '../src/modules/documents/storage.js';
import { reconcileDocumentStorage,setDocumentStorage } from '../src/modules/documents/service.js';
import { scanDeadlines } from '../src/modules/deadlines/scheduler.js';
import { config } from '../src/config.js';
import { Client,createAndSubmit,resetDatabase,satisfyChecklist,signIn,startApp,key } from './helpers.js';

let app:FastifyInstance,refs:Awaited<ReturnType<typeof resetDatabase>>,inst:Client,ro:Client,north:Client,authority:Client,id:string,dir:string,storage:LocalStorageAdapter;
const reason='Synthetic evidence reviewed against the recorded condition.';
const pdf=(text='Synthetic lease')=>Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n% ${text}\ntrailer << >>\n%%EOF\n`);
const view=async(c=ro,appId=id)=>(await c.get(`/api/v1/applications/${appId}`)).json();
function multipart(metadata:unknown,bytes=pdf(),filename='lease.pdf') {
 const boundary='m5-'+crypto.randomUUID(); return {headers:{'content-type':`multipart/form-data; boundary=${boundary}`},body:Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)] )};
}
async function upload(extra:Record<string,unknown>={},bytes=pdf(),client=inst,appId=id) {
 const v=await view(client,appId),payload=multipart({expectedVersion:v.application.rowVersion,title:'Synthetic lease deed',documentType:'LEASE_DEED',visibility:'INSTITUTION',...extra},bytes);
 return client.raw('POST',`/api/v1/applications/${appId}/documents/uploads`,payload.body,{...payload.headers,'idempotency-key':key()});
}
async function uploaded(extra:Record<string,unknown>={}) {const r=await upload(extra);expect(r.statusCode,r.body).toBe(200);return r.json();}
async function verify(versionId:string,validThrough='2027-12-31') {
 const m=await ro.command(id,'REVIEW_DOCUMENT_METADATA',{versionId,values:{institutionName:'Synthetic institution',validThrough,page:1,excerpt:'Synthetic valid-through field'},reason});
 expect(m.statusCode,m.body).toBe(200);
 const r=await ro.command(id,'VERIFY_DOCUMENT',{versionId,outcome:'ACCEPT',metadataReviewId:m.json().result.metadataReviewId,reason}); expect(r.statusCode,r.body).toBe(200);
}
async function obligation(index=0) {
 const r=await ro.command(id,'CREATE_OBLIGATION',{conditionIndex:index,requiredDocumentType:'LEASE_DEED',verifierUserId:refs.users['ro.west@demo.aicte.test'],reason});expect(r.statusCode,r.body).toBe(200);return r.json().result.obligationId as string;
}
async function oc(command:string,oid:string,extra:Record<string,unknown>={},client=ro) {
 const v=await view(client);const o=v.obligations.find((x:any)=>x.id===oid);
 return client.command(id,command,{obligationId:oid,obligationExpectedVersion:o.row_version,reason,...extra});
}
async function submit(oid:string,versionId:string) {const r=await oc('SUBMIT_EVIDENCE',oid,{versionIds:[versionId]},inst);expect(r.statusCode,r.body).toBe(200);return r.json().result.submissionId;}
beforeEach(async()=>{
 refs=await resetDatabase();dir=await fs.mkdtemp(path.join(os.tmpdir(),'aicte-m5-'));storage=new LocalStorageAdapter(dir);setDocumentStorage(storage);
 app=await startApp();inst=await signIn(app,'inst.west@demo.aicte.test');ro=await signIn(app,'ro.west@demo.aicte.test');north=await signIn(app,'ro.north@demo.aicte.test');authority=await signIn(app,'authority@demo.aicte.test');
 id=await createAndSubmit(inst,'EXTENSION_OF_APPROVAL');
 const owner=(await view()).stages[0].assignee.id;const email=await one(getPool(),'SELECT email FROM users WHERE id = $1',[owner]);const member=await signIn(app,email.email);
 await satisfyChecklist(member,id);await member.command(id,'RECORD_RECOMMENDATION',{recommendation:'RECOMMEND_APPROVAL_WITH_CONDITIONS',text:reason,proposedConditions:['Synthetic lease renewal condition']});await member.command(id,'COMPLETE_STAGE');
 const decision=await authority.command(id,'RECORD_DECISION',{outcome:'APPROVED_WITH_CONDITIONS',reason,conditions:[{text:'Submit a renewed synthetic lease deed',dueInDays:3},{text:'Provide separate synthetic supporting evidence',dueInDays:5}]});expect(decision.statusCode,decision.body).toBe(200);
});
afterEach(async()=>{setDocumentStorage(null);await app?.close();await closePool();if(dir&&path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'aicte-m5-'))await fs.rm(dir,{recursive:true,force:true});});
describe('M5 document and evidence vertical slice',()=>{
 it('S03: multipart upload registers immutable private bytes; safe authorised download matches SHA-256',async()=>{
  const u=await uploaded();const v=await view(inst);expect(v.documents).toHaveLength(1);expect(v.documents[0].replacementPending).toBe(false);expect(JSON.stringify(v.documents)).not.toContain('storage_key');
  const download=await inst.get(`/api/v1/documents/versions/${u.versionId}/download`);expect(download.statusCode).toBe(200);expect(download.rawPayload).toEqual(pdf());expect(download.headers['content-disposition']).toContain('attachment');
  await expect(withTx(tx=>tx.query("UPDATE document_versions SET sha256 = repeat('0',64) WHERE id = $1",[u.versionId]))).rejects.toMatchObject({code:'23514'});
 });
 it('O01: on-time receipt remains on time after late officer verification; approval/lifecycle remain independent',async()=>{
  const oid=await obligation(),u=await uploaded(),sid=await submit(oid,u.versionId);
  setTestNow(new Date('2026-11-12T10:00:00+05:30'));
  let v=await view();expect(v.obligations[0].submissions[0].on_time).toBe(true);expect(v.obligations[0].overdue).toBe(false);expect(v.obligations[0].verificationClock.current_due_at).toBeTruthy();
  await verify(u.versionId);expect((await oc('BEGIN_VERIFICATION',oid)).statusCode).toBe(200);expect((await oc('VERIFY_EVIDENCE',oid,{submissionId:sid,outcome:'ACCEPT'})).statusCode).toBe(200);
  v=await view();expect(v.obligations[0].state).toBe('FULFILLED');expect(v.obligations[0].submissions[0].on_time).toBe(true);expect(v.application.decisionOutcome).toBe('APPROVED_WITH_CONDITIONS');expect(v.application.lifecycleState).toBe('DECISION_RECORDED');expect(v.application.complianceStatus).toBe('OPEN');
 });
 it('O02/D02: expired verified lease stays current until renewal is explicitly accepted',async()=>{
  const old=await uploaded();await verify(old.versionId,'2026-11-01');let v=await view();expect(v.documents[0].validity).toBe('EXPIRED');
  const doc=v.documents[0];const renewal=await uploaded({documentId:doc.id,documentExpectedVersion:doc.row_version});v=await view();expect(v.documents[0].replacementPending).toBe(true);expect(v.documents[0].current_verified_version_id).toBe(old.versionId);expect(v.documents[0].validity).toBe('EXPIRED');
  await verify(renewal.versionId);v=await view();expect(v.documents[0].current_verified_version_id).toBe(renewal.versionId);expect(v.documents[0].validity).toBe('VALID');expect(v.documents[0].versions[0].confirmed_values.validThrough).toBe('2026-11-01');
  const d=await one(getPool(),"SELECT current_due_at FROM deadlines WHERE subject_id = $1 AND clock_type = 'DOCUMENT_VALIDITY'",[old.versionId]);expect(d.current_due_at.toISOString()).toBe('2026-11-01T18:30:00.000Z');
 });
 it('O03: rejection preserves receipt, reopens the original clock and only selected obligations fulfil',async()=>{
  const a=await obligation(),b=await obligation(1),u=await uploaded();const sid=await submit(a,u.versionId);await oc('BEGIN_VERIFICATION',a);
  expect((await oc('VERIFY_EVIDENCE',a,{submissionId:sid,outcome:'REJECT'})).statusCode).toBe(200);
  let v=await view();expect(v.obligations.find((o:any)=>o.id===a).submissions[0].on_time).toBe(true);expect(v.obligations.find((o:any)=>o.id===a).state).toBe('OPEN');
  await verify(u.versionId);const sid2=await submit(a,u.versionId);await oc('BEGIN_VERIFICATION',a);await oc('VERIFY_EVIDENCE',a,{submissionId:sid2,outcome:'ACCEPT'});
  v=await view();expect(v.obligations.find((o:any)=>o.id===a).state).toBe('FULFILLED');expect(v.obligations.find((o:any)=>o.id===b).state).toBe('OPEN');expect(v.obligations.find((o:any)=>o.id===a).submissions).toHaveLength(2);
 });
 it('does not fulfil from upload, metadata or document verification; unverified/expired evidence is refused',async()=>{
  const oid=await obligation(),u=await uploaded();let v=await view();expect(v.obligations[0].state).toBe('OPEN');
  const sid=await submit(oid,u.versionId);await oc('BEGIN_VERIFICATION',oid);expect((await oc('VERIFY_EVIDENCE',oid,{submissionId:sid,outcome:'ACCEPT'})).statusCode).toBe(422);
  await verify(u.versionId,'2026-11-01');expect((await oc('VERIFY_EVIDENCE',oid,{submissionId:sid,outcome:'ACCEPT'})).statusCode).toBe(422);v=await view();expect(v.obligations[0].state).toBe('UNDER_VERIFICATION');
 });
 it('S01/S02: files, lists/counts and internal clock data obey active scopes and revoked grants',async()=>{
  const u=await uploaded();expect((await north.get(`/api/v1/documents/versions/${u.versionId}/download`)).statusCode).toBe(404);expect((await north.get('/api/v1/documents')).json().total).toBe(0);
  const other=await signIn(app,'inst.north@demo.aicte.test');expect((await other.get(`/api/v1/documents/versions/${u.versionId}/download`)).statusCode).toBe(404);
  const privateUpload=await upload({visibility:'INTERNAL',documentType:'OTHER_EVIDENCE'},pdf(),ro);expect(privateUpload.statusCode).toBe(200);
  const privateId=privateUpload.json().versionId;expect((await inst.get(`/api/v1/documents/versions/${privateId}/download`)).statusCode).toBe(404);
  expect((await inst.get('/api/v1/documents')).json().total).toBe(1);
  await withTx(tx=>tx.query('UPDATE capability_grants SET revoked_at = $2 WHERE user_id = $1',[refs.users['inst.west@demo.aicte.test'],now()]));
  expect((await inst.get(`/api/v1/documents/versions/${u.versionId}/download`)).statusCode).toBe(401);
 });
 it('S03: rejects disguised, empty, encrypted, damaged and oversized content without orphan records',async()=>{
  for(const bytes of [Buffer.from('MZ executable'),Buffer.alloc(0),Buffer.from('%PDF-1.4 /Encrypt 2 0 R %%EOF'),Buffer.from('%PDF-1.4 damaged')])expect((await upload({},bytes)).statusCode).toBe(422);
  const oldLimit=config.maxUploadBytes;config.maxUploadBytes=30;try{expect((await upload({},pdf())).statusCode).toBe(413);}finally{config.maxUploadBytes=oldLimit;}
  expect((await one(getPool(),'SELECT count(*)::int AS n FROM document_versions')).n).toBe(0);expect(await storage.inventory('objects')).toHaveLength(0);expect(await storage.inventory('quarantine')).toHaveLength(0);
 });
 it('idempotent upload replay writes one file and version, while stale or changed requests are rejected',async()=>{
  const v=await view(inst),metadata={expectedVersion:v.application.rowVersion,title:'Synthetic lease deed',documentType:'LEASE_DEED'},p=multipart(metadata),idem=key();
  const send=(k=idem)=>inst.raw('POST',`/api/v1/applications/${id}/documents/uploads`,p.body,{...p.headers,'idempotency-key':k});
  expect((await send()).statusCode).toBe(200);expect((await send()).json().replayed).toBe(true);expect((await send(key())).statusCode).toBe(409);expect(await storage.inventory('objects')).toHaveLength(1);
 });
 it('rejects invalid dates, stale metadata selection and changes after verification',async()=>{
  const u=await uploaded();expect((await ro.command(id,'REVIEW_DOCUMENT_METADATA',{versionId:u.versionId,values:{validThrough:'2026-02-31'},reason})).statusCode).toBe(422);
  const m=await ro.command(id,'REVIEW_DOCUMENT_METADATA',{versionId:u.versionId,values:{validThrough:'2027-01-01'},reason});
  await ro.command(id,'REVIEW_DOCUMENT_METADATA',{versionId:u.versionId,values:{validThrough:'2027-12-31'},reason});
  expect((await ro.command(id,'VERIFY_DOCUMENT',{versionId:u.versionId,outcome:'ACCEPT',metadataReviewId:m.json().result.metadataReviewId,reason})).statusCode).toBe(422);
  await verify(u.versionId);expect((await ro.command(id,'REVIEW_DOCUMENT_METADATA',{versionId:u.versionId,values:{validThrough:'2028-12-31'},reason})).statusCode).toBe(409);
 });
 it('only the assigned verifier reviews; authorised reasoned closure does not change approval',async()=>{
  const oid=await obligation(),u=await uploaded(),sid=await submit(oid,u.versionId);const bureau=await signIn(app,'bureau@demo.aicte.test');
  expect((await oc('BEGIN_VERIFICATION',oid,{},bureau)).statusCode).toBe(403);expect((await oc('CLOSE_OBLIGATION',oid,{},inst)).statusCode).toBe(403);
  expect((await oc('CLOSE_OBLIGATION',oid,{},authority)).statusCode).toBe(200);const v=await view();expect(v.obligations[0].state).toBe('CLOSED_WITH_AUTHORISED_REASON');expect(v.application.decisionOutcome).toBe('APPROVED_WITH_CONDITIONS');
  await expect(withTx(tx=>tx.query('DELETE FROM evidence_submissions WHERE id = $1',[sid]))).rejects.toMatchObject({code:'23514'});
 });
 it('storage failures and DB rollback remove promoted bytes; old orphan sweep preserves referenced/fresh files',async()=>{
  const failing:StorageAdapter={name:'failing-local',put:storage.put.bind(storage),read:storage.read.bind(storage),remove:storage.remove.bind(storage),exists:storage.exists.bind(storage),move:async(...args)=>{await storage.move(...args);throw new Error('simulated publication failure');}};
  setDocumentStorage(failing);expect((await upload()).statusCode).toBe(500);setDocumentStorage(storage);expect(await storage.inventory('objects')).toHaveLength(0);
  const u=await uploaded();const referenced=await one(getPool(),'SELECT storage_key FROM document_versions WHERE id = $1',[u.versionId]);
  const orphan=await storage.put('objects',pdf('orphan'));const fresh=await storage.put('quarantine',pdf('fresh'));
  const old=new Date(realNow().getTime()-2*86400_000);
  for(const k of [orphan,referenced.storage_key])await fs.utimes(path.join(dir,'objects',k.slice(0,2),k),old,old);
  setTestNow(new Date('2030-01-01T00:00:00Z'));expect((await reconcileDocumentStorage()).removed).toBe(1);expect(await storage.exists('objects',referenced.storage_key)).toBe(true);expect(await storage.exists('quarantine',fresh)).toBe(true);
 });
 it('missing/corrupted bytes never download or verify as valid evidence',async()=>{
  const u=await uploaded(),oid=await obligation();await verify(u.versionId);const sid=await submit(oid,u.versionId);await oc('BEGIN_VERIFICATION',oid);
  const v=await one(getPool(),'SELECT * FROM document_versions WHERE id = $1',[u.versionId]);
  await fs.writeFile(path.join(dir,'objects',v.storage_key.slice(0,2),v.storage_key),Buffer.from('tampered'));
  expect((await inst.get(`/api/v1/documents/versions/${u.versionId}/download`)).statusCode).toBe(503);
  expect((await oc('VERIFY_EVIDENCE',oid,{submissionId:sid,outcome:'ACCEPT'})).statusCode).toBe(503);expect((await view()).obligations[0].state).toBe('UNDER_VERIFICATION');
 });
 it('a database failure after promotion rolls back registration, audit, outbox and cleans private bytes',async()=>{
  const before=await view(); const counts=await one(getPool(),'SELECT (SELECT count(*) FROM audit_events) AS a,(SELECT count(*) FROM outbox_events) AS o');
  await getPool().query("CREATE FUNCTION fail_m5_upload() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced registration failure'; END $$; CREATE TRIGGER fail_upload BEFORE INSERT ON document_versions FOR EACH ROW EXECUTE FUNCTION fail_m5_upload()");
  try {expect((await upload()).statusCode).toBe(500);} finally {await getPool().query('DROP TRIGGER fail_upload ON document_versions; DROP FUNCTION fail_m5_upload()');}
  expect((await view()).application.rowVersion).toBe(before.application.rowVersion);
  expect(await one(getPool(),'SELECT (SELECT count(*) FROM audit_events) AS a,(SELECT count(*) FROM outbox_events) AS o')).toEqual(counts);
  expect((await one(getPool(),'SELECT count(*)::int AS n FROM document_records')).n).toBe(0);expect(await storage.inventory('objects')).toHaveLength(0);
 });
 it('D05: an extended obligation retains original due, generations and exact receipt basis',async()=>{
  const oid=await obligation();const original=await one(getPool(),"SELECT * FROM deadlines WHERE subject_id=$1 AND clock_type='OBLIGATION_SUBMISSION'",[oid]);
  expect((await authority.command(id,'EXTEND_DEADLINE',{deadlineId:original.id,newDueDate:'2026-11-30',reason})).statusCode).toBe(200);
  const d=await one(getPool(),'SELECT * FROM deadlines WHERE id=$1',[original.id]);expect(d.original_due_at).toEqual(original.original_due_at);expect(d.generation).toBe(original.generation+1);
  setTestNow(new Date('2026-11-12T10:00:00+05:30'));expect((await view()).application.complianceStatus).toBe('OPEN');
  const u=await uploaded(),sid=await submit(oid,u.versionId);const receipt=await one(getPool(),'SELECT * FROM evidence_submissions WHERE id=$1',[sid]);expect(receipt.on_time).toBe(true);expect(receipt.effective_due_at).toEqual(d.current_due_at);expect(receipt.deadline_generation).toBe(d.generation);
 });
 it('scope and exact version links reject another case, including an otherwise visible same-institution case',async()=>{
  const oid=await obligation();const other=await createAndSubmit(inst,'EXTENSION_OF_APPROVAL');const u=await upload({},pdf(),inst,other);expect(u.statusCode,u.body).toBe(200);
  expect((await oc('SUBMIT_EVIDENCE',oid,{versionIds:[u.json().versionId]},inst)).statusCode).toBe(404);
  expect((await ro.command(id,'REVIEW_DOCUMENT_METADATA',{versionId:u.json().versionId,values:{},reason})).statusCode).toBe(404);
  const outsider=await signIn(app,'evc3@demo.aicte.test');expect((await outsider.get(`/api/v1/documents/versions/${u.json().versionId}/download`)).statusCode).toBe(404);
  expect((await outsider.get('/api/v1/documents')).json().total).toBe(0);
 });
 it('internal document validity clocks, audit content and counts stay hidden from institutions',async()=>{
  const u=await upload({visibility:'INTERNAL',documentType:'OTHER_EVIDENCE'},pdf(),ro);expect(u.statusCode,u.body).toBe(200);const versionId=u.json().versionId;
  const bureau=await signIn(app,'bureau@demo.aicte.test');const m=await bureau.command(id,'REVIEW_DOCUMENT_METADATA',{versionId,values:{validThrough:'2026-11-01'},reason});expect(m.statusCode,m.body).toBe(200);
  expect((await bureau.command(id,'VERIFY_DOCUMENT',{versionId,outcome:'ACCEPT',metadataReviewId:m.json().result.metadataReviewId,reason})).statusCode).toBe(200);
  await scanDeadlines(now()); const visible=await view(inst);expect(visible.documents).toHaveLength(0);expect(visible.deadlines.some((d:any)=>d.clockType==='DOCUMENT_VALIDITY')).toBe(false);
  const recipients=await q(getPool(),"SELECT recipient_user_id FROM alert_events e JOIN deadlines d ON d.id=e.deadline_id WHERE d.subject_id=$1",[versionId]);expect(recipients.some(x=>x.recipient_user_id===refs.users['inst.west@demo.aicte.test'])).toBe(false);
 });
 it('concurrent metadata commands reject one stale version and obligation commands require a reason',async()=>{
  const u=await uploaded(),v=await view();const payload={command:'REVIEW_DOCUMENT_METADATA',expectedVersion:v.application.rowVersion,versionId:u.versionId,values:{validThrough:'2027-12-31'},reason};
  const results=await Promise.all([ro.post(`/api/v1/applications/${id}/commands`,payload),ro.post(`/api/v1/applications/${id}/commands`,payload)]);expect(results.map(x=>x.statusCode).sort()).toEqual([200,409]);
  const oid=await obligation();expect((await oc('CLOSE_OBLIGATION',oid,{reason:''},authority)).statusCode).toBe(422);
  const old=(await view()).obligations[0].row_version;await submit(oid,u.versionId);expect((await ro.command(id,'BEGIN_VERIFICATION',{obligationId:oid,obligationExpectedVersion:old,reason})).statusCode).toBe(409);
 });
 it('M2 response attachments preserve exact immutable versions and freeze after finding review',async()=>{
  const caseId=await createAndSubmit(inst,'EXTENSION_OF_APPROVAL');const v=await view(ro,caseId);const owner=await one(getPool(),'SELECT email FROM users WHERE id=$1',[v.stages[0].assignee.id]);const member=await signIn(app,owner.email);
  const finding=await member.command(caseId,'RAISE_FINDING',{checklistCode:'LAND_DOCUMENTS',reasonCode:'MISSING_DOCUMENT',visibility:'INSTITUTION',requestsAmendment:false,explanation:reason,requestedEvidence:'Synthetic lease deed'});expect(finding.statusCode,finding.body).toBe(200);
  const findingId=finding.json().result.findingId;await member.command(caseId,'RETURN_TO_INSTITUTION',{reason,responseDueNote:'Synthetic deadline supplied by demo policy'});
  const response=await inst.command(caseId,'RESPOND_TO_FINDING',{findingId,text:reason});expect(response.statusCode,response.body).toBe(200);
  const u=await upload({},pdf(),inst,caseId);expect(u.statusCode,u.body).toBe(200);
  const attach={versionId:u.json().versionId,targetKind:'FINDING_RESPONSE',targetId:response.json().result.responseId,reason};
  expect((await inst.command(caseId,'ATTACH_DOCUMENT',attach)).statusCode).toBe(200);expect((await view(inst,caseId)).attachments[0].version_id).toBe(u.json().versionId);
  expect((await member.command(caseId,'RESOLVE_FINDING',{findingId,note:reason})).statusCode).toBe(200);expect((await inst.command(caseId,'ATTACH_DOCUMENT',attach)).statusCode).toBe(409);
  await expect(withTx(tx=>tx.query('DELETE FROM document_attachments WHERE version_id=$1',[u.json().versionId]))).rejects.toMatchObject({code:'23514'});
 });
 it('case and application list derive elapsed overdue status; closing every recorded condition is explicit',async()=>{
  const a=await obligation(),b=await obligation(1);setTestNow(new Date('2026-11-12T10:00:00+05:30'));
  expect((await view()).application.complianceStatus).toBe('OVERDUE');expect((await inst.get('/api/v1/applications')).json().rows.find((x:any)=>x.id===id).compliance_status).toBe('OVERDUE');
  expect((await oc('CLOSE_OBLIGATION',a,{},authority)).statusCode).toBe(200);expect((await view()).application.complianceStatus).toBe('OVERDUE');
  expect((await oc('CLOSE_OBLIGATION',b,{},authority)).statusCode).toBe(200);expect((await view()).application.complianceStatus).toBe('ALL_FULFILLED');
 });
 it('EVC report and finding attachments use exact versions, hide internal targets and freeze accepted revisions',async()=>{
  const caseId=await createAndSubmit(inst,'CHANGE_OF_SITE',{proposedSiteAddress:'44 Synthetic Campus Road, Pune'});
  const members=await Promise.all(['evc1','evc2'].map(x=>signIn(app,`${x}@demo.aicte.test`)));
  const proposal=await ro.command(caseId,'PROPOSE_VISIT',{startsAt:'2026-11-04T10:00:00+05:30',endsAt:'2026-11-04T12:00:00+05:30',mode:'PHYSICAL',timezone:'Asia/Kolkata',specialism:'ENGINEERING',expertIds:[refs.users['evc1@demo.aicte.test'],refs.users['evc2@demo.aicte.test']],reason});expect(proposal.statusCode,proposal.body).toBe(200);
  const vc=async(client:Client,command:string,extra:Record<string,unknown>={})=>{const visit=(await view(ro,caseId)).evc.visits[0];return client.command(caseId,command,{visitId:visit.id,visitExpectedVersion:visit.row_version,reason,...extra});};
  await vc(ro,'CONFIRM_VISIT');await vc(inst,'ACKNOWLEDGE_VISIT');for(const member of members)await vc(member,'CONFIRM_VISIT_MEMBER');
  setTestNow(new Date('2026-11-04T13:00:00+05:30'));await vc(ro,'RECORD_VISIT_HELD');
  const report=await vc(members[0],'SUBMIT_VISIT_REPORT',{summary:reason,findings:[{requirement:'Synthetic private observation',observation:reason,visibility:'INTERNAL'}]});expect(report.statusCode,report.body).toBe(200);
  const u=await upload({documentType:'OTHER_EVIDENCE'},pdf(),members[0],caseId);expect(u.statusCode,u.body).toBe(200);
  const rp=(await view(ro,caseId)).evc.visits[0].reports[0];const base={versionId:u.json().versionId,reason};
  expect((await members[0].command(caseId,'ATTACH_DOCUMENT',{...base,targetKind:'VISIT_REPORT',targetId:rp.id})).statusCode).toBe(200);
  expect((await members[0].command(caseId,'ATTACH_DOCUMENT',{...base,targetKind:'VISIT_FINDING',targetId:rp.findings[0].id})).statusCode).toBe(200);
  expect((await view(inst,caseId)).attachments).toHaveLength(1);expect((await view(ro,caseId)).attachments).toHaveLength(2);
  await vc(ro,'ACCEPT_VISIT_REPORT',{reportId:rp.id});expect((await members[0].command(caseId,'ATTACH_DOCUMENT',{...base,targetKind:'VISIT_REPORT',targetId:rp.id})).statusCode).toBe(409);
 });
});
