import {afterAll,beforeAll,expect,it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {closePool,getPool,q} from '../src/db.js';
import {Client,createAndSubmit,resetDatabase,satisfyChecklist,signIn,startApp} from './helpers.js';
let app:FastifyInstance,inst:Client,authority:Client,id:string,letter:any;
async function approved(outcome:string,conditions:any[]=[]){
 const caseId=await createAndSubmit(inst,'EXTENSION_OF_APPROVAL');
 const owner=(await q(getPool(),`SELECT u.email FROM stage_instances s JOIN users u ON u.id=s.assignee_user_id WHERE s.application_id=$1`,[caseId]))[0];const member=await signIn(app,owner.email);
 expect((await satisfyChecklist(member,caseId)).statusCode).toBe(200);
 expect((await member.command(caseId,'RECORD_RECOMMENDATION',{recommendation:'RECOMMEND_APPROVAL',text:'The synthetic records have been reviewed.'})).statusCode).toBe(200);
 expect((await member.command(caseId,'COMPLETE_STAGE')).statusCode).toBe(200);
 const decision=await authority.command(caseId,'RECORD_DECISION',{outcome,reason:'Recorded by the competent demo authority after review.',conditions});expect(decision.statusCode,decision.body).toBe(200);return caseId;
}
beforeAll(async()=>{await resetDatabase();app=await startApp();inst=await signIn(app,'inst.west@demo.aicte.test');authority=await signIn(app,'authority@demo.aicte.test');id=await approved('APPROVED_WITH_CONDITIONS',[{text:'Provide renewed lease evidence.'},{text:'Provide the synthetic lab register.'}]);letter=(await inst.get(`/api/v1/applications/${id}`)).json().approvalLetters[0];});
afterAll(async()=>{await app?.close();await closePool();});
it('Q01 signed token verifies without a session and QR is generated offline from stored fields',async()=>{
 const res=await app.inject({method:'GET',url:'/api/v1/public/verify/'+letter.token});expect(res.statusCode,res.body).toBe(200);const v=res.json();expect(v.signatureValid).toBe(true);expect(v.issuedBySystem).toBe(true);expect(v.signedAtIssue.intake).toBe(120);expect(v.signedAtIssue.conditions).toBe(2);expect(v.currentRecord.openConditionsCount).toBe(2);expect(v.signedAtIssue).not.toHaveProperty('validity_end');expect(letter.qrDataUrl).toMatch(/^data:image\/png;base64,/);expect(letter.verifyUrl).toContain('/verify/'+letter.token);
 expect((await q(getPool(),`SELECT id FROM audit_events WHERE entity_id=$1 AND action='APPROVAL_LETTER_ISSUED'`,[letter.id]))).toHaveLength(1);
});
it('Q02 changing the signed intake field fails verification and returns no untrusted signed fields',async()=>{
 const [encoded,signature]=letter.token.split('.'),payload=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));payload.intake++;
 const token=Buffer.from(JSON.stringify(payload)).toString('base64url')+'.'+signature;
 const result=(await app.inject({method:'GET',url:'/api/v1/public/verify/'+token})).json();expect(result.signatureValid).toBe(false);expect(result.message).toBe('This letter was not issued by this system');expect(result.signedAtIssue).toBeNull();
});
it('Q03 authority revocation is audited and current status changes while signed issue fields stay immutable',async()=>{
 expect((await inst.command(id,'REVOKE_LETTER',{letterId:letter.id,reason:'Institution cannot revoke.'})).statusCode).toBe(403);
 expect((await authority.command(id,'REVOKE_LETTER',{letterId:letter.id,reason:''})).statusCode).toBe(422);
 const result=await authority.command(id,'REVOKE_LETTER',{letterId:letter.id,reason:'Synthetic demo revocation after authority review.'});expect(result.statusCode,result.body).toBe(200);
 const current=(await app.inject({method:'GET',url:'/api/v1/public/verify/'+letter.token})).json();expect(current.signatureValid).toBe(true);expect(current.currentRecord.revoked).toBe(true);expect(current.signedAtIssue).toEqual(letter.payload);
 expect((await q(getPool(),`SELECT id FROM audit_events WHERE action='APPROVAL_LETTER_REVOKED' AND entity_id=$1`,[letter.id]))).toHaveLength(1);
 await expect(getPool().query(`UPDATE approval_letters SET payload='{}' WHERE id=$1`,[letter.id])).rejects.toThrow('immutable');
});
it('Q04 public verification exposes only signed institutional fields and current counts, never personal or other-case data',async()=>{
 const result=(await app.inject({method:'GET',url:'/api/v1/public/verify/'+letter.token,headers:{cookie:'sid=invalid'}})).json();
 expect(JSON.stringify(result)).not.toMatch(/email|authority_user|actor_user|submittedBy|review_note|revoke_reason|privateKey|application_id/);
 expect(result.signedAtIssue.app_no).toBe(letter.payload.app_no);expect(result.currentRecord).not.toHaveProperty('revokeReason');
 const invalid=(await app.inject({method:'GET',url:'/api/v1/public/verify/not-a-signed-token'})).json();expect(invalid.signedAtIssue).toBeNull();
});
it('Q05 rejected and deferred decisions never issue a letter',async()=>{
 for(const outcome of ['REJECTED','DEFERRED']){const caseId=await approved(outcome);expect((await inst.get(`/api/v1/applications/${caseId}`)).json().approvalLetters).toEqual([]);expect(await q(getPool(),'SELECT id FROM approval_letters WHERE application_id=$1',[caseId])).toHaveLength(0);}
});

it('Q04 public verification is rate limited and invalid tokens disclose no current record',async()=>{
 let limited=false;
 for(let i=0;i<65;i++){const res=await app.inject({method:'GET',url:'/api/v1/public/verify/invalid-rate-token'});if(res.statusCode===429){limited=true;break;}expect(res.json().currentRecord).toBeNull();}
 expect(limited).toBe(true);
});
