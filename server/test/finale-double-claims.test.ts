import {afterAll,beforeAll,expect,it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {closePool,getPool,q,withTx} from '../src/db.js';
import {now} from '../src/lib/clock.js';
import {findDoubleClaims,physicalIdentity,type Claim,type DoubleClaimRule} from '../src/modules/claims/engine.js';
import {recheckClaims} from '../src/modules/claims/service.js';
import {processOutbox} from '../src/modules/notifications/worker.js';
import {validatePolicy} from '../src/modules/policy/schema.js';
import {policyV1} from '../src/seed/policy-v1.js';
import {Client,COMPLETE_FORM,resetDatabase,signIn,startApp} from './helpers.js';
const rule:DoubleClaimRule={exclusiveKinds:['FACULTY','LAB','BUILDING'],sameInstitutionDifferentProgramme:true,overlapRule:'INCLUSIVE_DATES',provenance:'DEMO_ASSUMPTION'};
const claim=(patch:Partial<Claim>={}):Claim=>({id:'a',kind:'FACULTY',identityKey:'FAC-DEMO-0001',institutionId:'inst-a',applicationId:'app-a',programmeCode:'CS',periodFrom:'2026-10-01',periodTo:'2027-09-30',...patch});
it('DC01 same exact faculty ID and overlapping periods produce one deterministic pair',()=>{
 const claims=[claim(),claim({id:'b',institutionId:'inst-b',applicationId:'app-b'})];
 expect(findDoubleClaims(claims,rule)).toHaveLength(1);expect(findDoubleClaims([...claims].reverse(),rule)).toEqual(findDoubleClaims(claims,rule));
 expect(findDoubleClaims([claim(),claim({id:'c',institutionId:'other',periodFrom:'2027-09-30'})],rule)).toHaveLength(1);
});
it('DC02 same display name with different synthetic registration IDs never matches',()=>{
 expect(findDoubleClaims([claim(),claim({id:'b',identityKey:'FAC-DEMO-0002',institutionId:'inst-b'})],rule)).toEqual([]);
});
it('DC03 disjoint periods and excluded kinds do not flag; lab/building identities share the engine',()=>{
 expect(findDoubleClaims([claim(),claim({id:'b',institutionId:'other',periodFrom:'2027-10-01',periodTo:null})],rule)).toEqual([]);
 expect(findDoubleClaims([claim(),claim({id:'b',institutionId:'other'})],{...rule,exclusiveKinds:['LAB']})).toEqual([]);
 for(const kind of ['LAB','BUILDING'] as const){
  const identityKey=physicalIdentity('demo-plot-12','12 Synthetic Campus Road');expect(identityKey).toBe(physicalIdentity(' DEMO PLOT 12 ','12 synthetic campus road'));
  expect(findDoubleClaims([claim({kind,identityKey}),claim({id:'b',kind,identityKey,programmeCode:'ME'})],rule)).toHaveLength(1);
  expect(findDoubleClaims([claim({kind,identityKey}),claim({id:'b',kind,identityKey,programmeCode:'ME'})],{...rule,sameInstitutionDifferentProgramme:false})).toHaveLength(0);
 }
});
let api:FastifyInstance,west:Client,north:Client,ro:Client,bureau:Client,first:string,second:string,flagId:string;
async function submit(c:Client,resources:Record<string,unknown>){
 const draft=await c.post('/api/v1/applications',{cycleCode:'2027-28',categoryCode:'EXTENSION_OF_APPROVAL',draftData:{...COMPLETE_FORM,...resources}});expect(draft.statusCode,draft.body).toBe(200);
 const id=draft.json().id;const sent=await c.post(`/api/v1/applications/${id}/submit`,{expectedVersion:draft.json().rowVersion});expect(sent.statusCode,sent.body).toBe(200);return id as string;
}
beforeAll(async()=>{
 await resetDatabase();api=await startApp();west=await signIn(api,'inst.west@demo.aicte.test');north=await signIn(api,'inst.north@demo.aicte.test');ro=await signIn(api,'ro.west@demo.aicte.test');bureau=await signIn(api,'bureau@demo.aicte.test');
 const faculty=[{registrationId:'FAC-DEMO-0001',name:'Synthetic Teacher Alpha',programmeCode:'CS',periodFrom:'2026-10-01',periodTo:'2027-09-30'}];first=await submit(west,{faculty});second=await submit(north,{faculty});flagId=(await west.get(`/api/v1/applications/${first}`)).json().doubleClaims[0].id;
});
afterAll(async()=>{await api.close();await closePool();});
it('DC04 institution and out-of-scope officer never receive the other case; all-scope officer can see it',async()=>{
 const own=(await west.get(`/api/v1/applications/${first}`)).json(),other=(await north.get(`/api/v1/applications/${second}`)).json();
 expect(own.doubleClaims).toHaveLength(1);expect(own.doubleClaims[0].otherClaims).toEqual([]);expect(JSON.stringify(own.doubleClaims)).not.toContain(second);
 const regional=(await ro.get(`/api/v1/applications/${first}`)).json();expect(regional.doubleClaims[0].outsideScope).toBe(true);expect(regional.doubleClaims[0].otherClaims).toEqual([]);
 expect(JSON.stringify(regional.doubleClaims)).not.toContain(other.application.appNo);
 const full=(await bureau.get(`/api/v1/applications/${first}`)).json();expect(full.doubleClaims[0].otherClaims[0].appNo).toBe(other.application.appNo);
 expect((await ro.get(`/api/v1/applications/${second}`)).statusCode).toBe(404);
 const csv=await ro.get('/api/v1/reports/double-claims/csv');expect(csv.statusCode).toBe(200);expect(csv.body).not.toContain(other.application.appNo);expect(csv.body).toContain('outside your scope');
});
it('DC05 review needs officer capability and a note; audit and institution-note visibility stay scoped',async()=>{
 expect((await ro.command(first,'REVIEW_DOUBLE_CLAIM',{flagId,outcome:'EXPLAINED',note:'short'})).statusCode).toBe(422);
 expect((await west.command(first,'REVIEW_DOUBLE_CLAIM',{flagId,outcome:'EXPLAINED',note:'An institution cannot review this flag.'})).statusCode).toBe(403);
 const note='The officer checked the stored synthetic timetable and recorded an explanation.';
 const reviewed=await ro.command(first,'REVIEW_DOUBLE_CLAIM',{flagId,expectedFlagVersion:1,outcome:'EXPLAINED',note,visibleToInstitution:true});expect(reviewed.statusCode,reviewed.body).toBe(200);
 expect((await west.get(`/api/v1/applications/${first}`)).json().doubleClaims[0].note).toBe(note);
 expect((await north.get(`/api/v1/applications/${second}`)).json().doubleClaims[0].note).toBeNull();
 const northOfficer=await signIn(api,'ro.north@demo.aicte.test');expect((await northOfficer.get(`/api/v1/applications/${second}`)).json().doubleClaims[0].note).toBeNull();
 expect((await northOfficer.command(second,'REVIEW_DOUBLE_CLAIM',{flagId,expectedFlagVersion:1,outcome:'CONFIRMED',note:'A stale shared flag review must be refused.'})).statusCode).toBe(409);
 expect((await q(getPool(),`SELECT after_state FROM audit_events WHERE action='DOUBLE_CLAIM_REVIEWED' AND application_id=$1`,[first]))[0].after_state.note).toBe(note);
});
it('DC06 flags and reviews do not change lifecycle, decision or compliance; worker emits scoped notifications once',async()=>{
 const before=(await west.get(`/api/v1/applications/${first}`)).json().application;
 expect(await recheckClaims(now())).toBe(0);expect(await recheckClaims(now())).toBe(0);
 await processOutbox(now());await processOutbox(now());
 const messages=await q(getPool(),`SELECT DISTINCT application_id FROM notifications WHERE kind='DOUBLE_CLAIM_DETECTED'`);expect(messages.map(m=>m.application_id).sort()).toEqual([first,second].sort());
 const after=(await west.get(`/api/v1/applications/${first}`)).json().application;
 for(const k of ['lifecycleState','decisionOutcome','complianceStatus'])expect(after[k]).toBe(before[k]);
 expect((await q(getPool(),'SELECT id FROM claim_flags'))).toHaveLength(1);
 const report=(await bureau.get('/api/v1/reports/double-claims')).json();expect(report.total).toBe(2);
 const dashboard=(await bureau.get('/api/v1/dashboards/management')).json();expect(dashboard.tiles.find((t:any)=>t.key==='double-claims').count).toBe(report.total);
});
it('DC03 policy versions without a detector remain valid, and unknown provenance is refused',()=>{
 expect(validatePolicy({...policyV1,doubleClaim:undefined}).issues.filter(i=>i.level==='error')).toHaveLength(0);
 expect(validatePolicy({...policyV1,doubleClaim:{...rule,provenance:'APH_CLAUSE'}}).doc).toBeNull();
});
it('DC06 a same-name different-ID application stays unflagged; same-case lab programme overlap is flagged',async()=>{
 const honest=await submit(west,{faculty:[{registrationId:'FAC-DEMO-0999',name:'Synthetic Teacher Alpha',periodFrom:'2026-10-01'}]});expect((await west.get(`/api/v1/applications/${honest}`)).json().doubleClaims).toEqual([]);
 const labs=await submit(west,{labs:[{identifier:'DEMO-LAB-1',address:'12 Synthetic Lab Road',programmeCode:'CS',periodFrom:'2026-10-01'},{identifier:'demo lab 1',address:'12 synthetic lab road',programmeCode:'ME',periodFrom:'2026-10-01'}]});
 const v=(await west.get(`/api/v1/applications/${labs}`)).json();expect(v.doubleClaims).toHaveLength(2);expect(new Set(v.doubleClaims.map((f:any)=>f.id)).size).toBe(1);expect(v.doubleClaims[0].sameCase).toBe(true);
});
