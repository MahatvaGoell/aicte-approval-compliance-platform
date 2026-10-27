import {afterAll,beforeAll,expect,it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {closePool,getPool,q,withTx} from '../src/db.js';
import {advanceTestNow,now} from '../src/lib/clock.js';
import {accountability,backfillCustody,deriveCustody} from '../src/modules/custody/service.js';
import {Client,createAndSubmit,resetDatabase,signIn,startApp} from './helpers.js';
let app:FastifyInstance,inst:Client,member:Client,id:string,prior:string,original:string;
beforeAll(async()=>{await resetDatabase();app=await startApp();inst=await signIn(app,'inst.west@demo.aicte.test');id=await createAndSubmit(inst,'EXTENSION_OF_APPROVAL');const owner=(await q(getPool(),`SELECT u.email FROM stage_instances s JOIN users u ON u.id=s.assignee_user_id WHERE s.application_id=$1`,[id]))[0];member=await signIn(app,owner.email);original=(await inst.get(`/api/v1/applications/${id}`)).json().accountability.stageDueDates[0].originalDueDate;});
afterAll(async()=>{await app.close();await closePool();});
it('AC01 segments add up to total across two returns and preserve authority accounting',()=>{
 const dates=['2026-11-01','2026-11-03','2026-11-05','2026-11-08','2026-11-10','2026-11-12'];
 const holders=['OFFICE','INSTITUTION','OFFICE','INSTITUTION','AUTHORITY'] as const;
 const result=accountability(holders.map((holder,i)=>({holder,started_at:dates[i]+'T00:00:00+05:30',ended_at:dates[i+1]+'T00:00:00+05:30',opened_by_transition:holder==='INSTITUTION'?'RETURN_TO_INSTITUTION':'ENTER_STAGE'})),new Date('2026-11-20'));
 expect(result).toEqual({totalDays:11,institutionDays:4,officeDays:5,authorityDays:2,returns:2});
});
it('AC02 two API returns keep the original due date and carry current deadline under existing rules',async()=>{
 for(let round=0;round<2;round++){
  advanceTestNow(86400000);
  const finding=await member.command(id,'RAISE_FINDING',{reasonCode:'CLARIFICATION',explanation:'Please clarify the recorded lease detail.',visibility:'INSTITUTION',...(round?{earlierFindingId:prior}:{})});
  expect(finding.statusCode,finding.body).toBe(200);prior=finding.json().result.findingId;
  expect((await member.command(id,'RETURN_TO_INSTITUTION',{reason:'Lease detail needs institution clarification',responseDueNote:'Demo response period'})).statusCode).toBe(200);
  advanceTestNow(3*86400000);
  expect((await inst.command(id,'RESPOND_TO_FINDING',{findingId:prior,text:'The recorded lease detail is clarified here.'})).statusCode).toBe(200);
 }
 const a=(await inst.get(`/api/v1/applications/${id}`)).json().accountability;
 expect(a.returns).toBe(2);expect(a.stageDueDates[0].originalDueDate).toBe(original);expect(a.stageDueDates[0].currentDueDate>original).toBe(true);
 expect(a.totalDays).toBe(a.officeDays+a.institutionDays+a.authorityDays);
 expect((await q(getPool(),`SELECT id FROM custody_segments WHERE application_id=$1 AND ended_at IS NULL`,[id]))).toHaveLength(1);
});
it('AC03 new objection in re-scrutiny needs justification, saves it and audits it atomically',async()=>{
 const input={reasonCode:'OTHER',explanation:'A separately discovered concern after re-scrutiny.',visibility:'INSTITUTION'};
 const denied=await member.command(id,'RAISE_FINDING',input);expect(denied.statusCode).toBe(409);expect(denied.json().error.code).toBe('NEW_OBJECTION_NEEDS_JUSTIFICATION');
 const note='A newly supplied record exposed this additional inconsistency.';
 const saved=await member.command(id,'RAISE_FINDING',{...input,newObjectionJustification:note});expect(saved.statusCode,saved.body).toBe(200);
 const audit=(await q(getPool(),`SELECT after_state FROM audit_events WHERE entity_id=$1 AND action='FINDING_RAISED'`,[saved.json().result.findingId]))[0];expect(audit.after_state.newObjectionJustification).toBe(note);
 expect((await inst.get(`/api/v1/applications/${id}`)).json().findings.find((x:any)=>x.id===saved.json().result.findingId).newObjectionJustification).toBe(note);
});
it('AC04 institution case numbers, holding report and CSV obey existing scope',async()=>{
 const other=await signIn(app,'inst.north@demo.aicte.test');expect((await other.get(`/api/v1/applications/${id}`)).statusCode).toBe(404);
 const report=(await other.get('/api/v1/reports/returns-and-holding')).json();expect(report.rows.some((x:any)=>x.applicationId===id)).toBe(false);
 const csv=await other.get('/api/v1/reports/returns-and-holding/csv');expect(csv.statusCode).toBe(200);expect(csv.body).not.toContain(id);
});
it('AC05 backfill never invents a segment or a submission time',async()=>{
 expect(deriveCustody([])).toEqual({segments:[],incomplete:true});
 const unknown=deriveCustody([{command:'RECORD_DECISION',at:now()}]);expect(unknown.segments).toHaveLength(0);expect(unknown.incomplete).toBe(true);
 const draft=await inst.post('/api/v1/applications',{cycleCode:'2027-28',categoryCode:'EXTENSION_OF_APPROVAL'});const blank=draft.json().id;
 await getPool().query(`UPDATE applications SET submitted_at=$2,custody_history_incomplete=true WHERE id=$1`,[blank,now()]);
 await withTx(tx=>backfillCustody(tx,{actor:null,at:now(),correlationId:'test-backfill'}));
 expect(await q(getPool(),'SELECT id FROM custody_segments WHERE application_id=$1',[blank])).toHaveLength(0);
 expect((await q(getPool(),'SELECT custody_history_incomplete FROM applications WHERE id=$1',[blank]))[0].custody_history_incomplete).toBe(true);
});
