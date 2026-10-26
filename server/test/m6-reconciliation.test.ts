import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { config } from '../src/config.js';
import { closePool,getPool,one,q,withTx } from '../src/db.js';
import { now } from '../src/lib/clock.js';
import { verifyChain } from '../src/modules/audit/audit.js';
import { Client,createAndSubmit,key,resetDatabase,satisfyChecklist,signIn,startApp,TEST_NOW } from './helpers.js';

let app:FastifyInstance,refs:Awaited<ReturnType<typeof resetDatabase>>,ro:Client,north:Client,bureau:Client,auditor:Client,runId:string;
const reason='Reviewed the exact synthetic source record against the pinned mock mapping.';
const sample=(extra:Record<string,unknown>={})=>({externalId:'DEMO-REVIEW-TEST',eventId:'review-1',revision:1,institutionCode:'DEMO-1-10001',sourceUpdatedAt:'2026-10-01T10:00:00+05:30',fields:{title:'Synthetic review record',statusCode:'RECEIVED'},...extra});
async function sync(events?:unknown[],client=ro,regionId='DEMO-WEST') {
  const data=(await client.get('/api/v1/integration/runs?regionId='+regionId)).json();
  const r=await client.post('/api/v1/integration/sync',{regionId,expectedVersion:data.syncStates[0].rowVersion,reason,...(events?{events}:{fixture:'portal-export'})});
  expect(r.statusCode,r.body).toBe(200);return r.json();
}
const queue=async(client=ro,query='')=>(await client.get('/api/v1/integration/reconciliation'+(query?'?'+query:''))).json();
const detail=async(id:string,client=ro)=>(await client.get('/api/v1/integration/reconciliation/'+id)).json();
async function find(reasonCode:string) {return (await queue()).rows.find((r:any)=>r.reasonCode===reasonCode).id as string;}
async function request(id:string,action='RETRY',extra:Record<string,unknown>={}) {const d=await detail(id);return {action,expectedVersion:d.item.rowVersion,expectedCursorVersion:d.item.cursorVersion,reason,...extra};}
async function resolve(id:string,action='RETRY',extra:Record<string,unknown>={},client=ro,idem=key()) {return client.post(`/api/v1/integration/reconciliation/${id}/resolve`,await request(id,action,extra),idem);}
const tables=['integration_runs','integration_raw_events','integration_source_events','integration_mirrors','integration_run_items','integration_reconciliation','integration_resolution_attempts','integration_cursors','audit_events','outbox_events','idempotency_keys'];
async function snapshot() {const out:Record<string,unknown>={};for(const table of tables)out[table]=await q(getPool(),`SELECT * FROM ${table} ORDER BY 1`);return out;}
beforeEach(async()=>{refs=await resetDatabase();app=await startApp();ro=await signIn(app,'ro.west@demo.aicte.test');north=await signIn(app,'ro.north@demo.aicte.test');bureau=await signIn(app,'bureau@demo.aicte.test');auditor=await signIn(app,'auditor@demo.aicte.test');runId=(await sync()).run.id;});
afterEach(async()=>{await app?.close();await closePool();});

describe('M6 B6b scoped reconciliation',()=>{
  it('lists scoped paged items with source IDs/run/mapping; detail includes exact raw evidence and pinned choices',async()=>{
    const result=await queue();expect(result.total).toBe(5);expect(result.refreshedAt).toBe(TEST_NOW.toISOString());expect(result.rows.every((r:any)=>r.runId===runId&&r.mappingVersion==='mock-portal-v1')).toBe(true);expect(result.rows[0]).not.toHaveProperty('payload');
    const a=await queue(ro,'pageSize=2&page=1'),b=await queue(ro,'pageSize=2&page=2');expect(a.total).toBe(5);expect(b.total).toBe(5);expect(a.rows.some((x:any)=>b.rows.some((y:any)=>x.id===y.id))).toBe(false);
    expect((await queue(ro,'runId='+runId)).total).toBe(5);expect((await queue(ro,'reasonCode=UNKNOWN_CODE')).total).toBe(1);expect((await queue(ro,'state=RESOLVED')).total).toBe(0);
    const d=await detail(await find('UNKNOWN_CODE'));expect(d.item).toMatchObject({externalId:'DEMO-WEST-UNKNOWN',eventId:'west-unknown-1',revision:1,rowVersion:1,cursorVersion:1,canResolve:true,canCorrect:true});
    expect(d.raw.payload.fields.statusCode).toBe('UNRECOGNISED_CODE');expect(d.raw.sha256).toMatch(/^[a-f0-9]{64}$/);expect(d.statusCodes.map((x:any)=>x.code).sort()).toEqual(['COMPLETE','PROCESSING','RECEIVED']);expect(d.currentMirror).toBeNull();expect(d.attempts).toEqual([]);
    expect(d.institutionOptions.every((x:any)=>x.code.startsWith('DEMO-1-1'))).toBe(true);
  });
  it('an unsuccessful original retry records history, keeps OPEN and never changes raw/run counts or the mirror',async()=>{
    const id=await find('UNKNOWN_CODE'),before=await detail(id),mirror=await q(getPool(),'SELECT * FROM integration_mirrors');
    const response=await resolve(id);expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({item:{state:'OPEN',rowVersion:2},attempt:{outcome:'STILL_BLOCKED',reasonCode:'UNKNOWN_CODE'},syncState:{rowVersion:2}});
    const after=await detail(id);expect(after.raw).toEqual(before.raw);expect(after.runCounts).toEqual(before.runCounts);expect(after.item.reasonCode).toBe('UNKNOWN_CODE');expect(after.attempts).toHaveLength(1);expect(after.attempts[0]).toMatchObject({action:'RETRY',outcome:'STILL_BLOCKED',reason,recordedAt:TEST_NOW.toISOString()});expect(await q(getPool(),'SELECT * FROM integration_mirrors')).toEqual(mirror);
  });
  it('human correction resolves only the mirror and retains original unknown code, mapping and import outcome',async()=>{
    const id=await find('UNKNOWN_CODE'),before=await detail(id);const response=await resolve(id,'CORRECT_AND_RETRY',{corrections:{statusCode:'RECEIVED'}});expect(response.statusCode,response.body).toBe(200);expect(response.json().attempt.outcome).toBe('APPLIED');
    const after=await detail(id);expect(after.item.state).toBe('RESOLVED');expect(after.raw).toEqual(before.raw);expect(after.runCounts).toEqual(before.runCounts);expect(after.currentMirror).toMatchObject({sourceStatus:'SOURCE_RECEIVED',revision:1,latestResolutionId:response.json().attempt.id});expect(after.attempts[0].corrections).toEqual({statusCode:'RECEIVED'});expect(after.attempts[0].evaluatedRecord.fields.statusCode).toBe('RECEIVED');
    expect((await one(getPool(),"SELECT document FROM integration_mapping_versions WHERE id='mock-portal-v1'")).document.statusCodes).not.toHaveProperty('UNRECOGNISED_CODE');expect((await verifyChain(getPool())).ok).toBe(true);
  });
  it('reviewed missing title can be corrected; a later duplicate import does not reopen or rewrite the resolved item',async()=>{
    const id=(await q(getPool(),"SELECT queue.id FROM integration_reconciliation queue JOIN integration_raw_events raw ON raw.id=queue.raw_event_id WHERE raw.payload->>'externalId'='DEMO-WEST-INVALID'"))[0].id;
    expect((await resolve(id,'CORRECT_AND_RETRY',{corrections:{title:'Confirmed synthetic Nagpur source title'}})).json().attempt.outcome).toBe('APPLIED');
    const before=await detail(id),retry=await sync();expect(retry.run.counts.duplicate).toBe(8);const after=await detail(id);expect(after.item.state).toBe('RESOLVED');expect(after.raw.payload.fields.title).toBe('');expect(after.currentMirror).toEqual(before.currentMirror);expect(after.attempts).toEqual(before.attempts);
  });
  it('older revisions, identity conflicts and missing identities stay blocked; reviewed fields cannot bypass those guards',async()=>{
    const old=await find('OUT_OF_ORDER'),conflict=await find('IDENTITY_CONFLICT');
    expect((await resolve(old,'CORRECT_AND_RETRY',{corrections:{statusCode:'COMPLETE'}})).json().attempt.reasonCode).toBe('OUT_OF_ORDER');expect((await resolve(conflict)).json().attempt.reasonCode).toBe('IDENTITY_CONFLICT');
    await sync([null]);const missing=await find('INVALID_IDENTITY');expect((await detail(missing)).item.canCorrect).toBe(false);expect((await resolve(missing)).json().attempt.reasonCode).toBe('INVALID_IDENTITY');
    expect((await one(getPool(),"SELECT latest_revision FROM integration_mirrors WHERE external_id='DEMO-WEST-LEASE'")).latest_revision).toBe(3);
  });
  it('dismissal requires a reason and closes only the queue item, retaining source and mirror history',async()=>{
    const id=await find('OUT_OF_ORDER'),before=await detail(id),mirrors=await q(getPool(),'SELECT * FROM integration_mirrors');
    const result=await resolve(id,'DISMISS');expect(result.statusCode,result.body).toBe(200);const d=await detail(id);expect(d.item).toMatchObject({state:'DISMISSED',resolutionReason:reason,rowVersion:2});expect(d.raw).toEqual(before.raw);expect(d.runCounts).toEqual(before.runCounts);expect(await q(getPool(),'SELECT * FROM integration_mirrors')).toEqual(mirrors);expect((await queue(ro,'state=DISMISSED')).total).toBe(1);
    expect((await resolve(id,'DISMISS')).statusCode).toBe(409);
  });
  it('C01/C02: a closed-item replay is identical with no duplicate history/audit/outbox; changed key bodies conflict',async()=>{
    const id=await find('UNKNOWN_CODE'),payload=await request(id,'CORRECT_AND_RETRY',{corrections:{statusCode:'RECEIVED'}}),idem=key(),url=`/api/v1/integration/reconciliation/${id}/resolve`;
    const first=await ro.post(url,payload,idem);expect(first.statusCode,first.body).toBe(200);const before=await snapshot();
    const replay=await ro.post(url,payload,idem);expect(replay.statusCode,replay.body).toBe(200);expect(replay.json().replayed).toBe(true);expect(replay.json().attempt).toEqual(first.json().attempt);expect(await snapshot()).toEqual(before);
    expect((await ro.post(url,{...payload,reason:'A different synthetic reason supplied for this key.'},idem)).statusCode).toBe(409);expect(await snapshot()).toEqual(before);
  });
  it('C03: stale item/cursor versions reject without partial changes after another import',async()=>{
    const id=await find('UNKNOWN_CODE'),payload=await request(id);let before=await snapshot();
    expect((await ro.post(`/api/v1/integration/reconciliation/${id}/resolve`,{...payload,expectedVersion:99})).statusCode).toBe(409);expect(await snapshot()).toEqual(before);
    await sync([sample()]);before=await snapshot();expect((await ro.post(`/api/v1/integration/reconciliation/${id}/resolve`,payload)).statusCode).toBe(409);expect(await snapshot()).toEqual(before);expect((await detail(id)).item.rowVersion).toBe(1);
  });
  it('C01/C03: concurrent same-key reviews replay; distinct reviewers/keys allow one committed version',async()=>{
    const id=await find('UNKNOWN_CODE'),url=`/api/v1/integration/reconciliation/${id}/resolve`,payload=await request(id,'CORRECT_AND_RETRY',{corrections:{statusCode:'RECEIVED'}}),idem=key();
    const pair=await Promise.all([ro.post(url,payload,idem),ro.post(url,payload,idem)]);expect(pair.map(x=>x.statusCode)).toEqual([200,200]);expect(pair.filter(x=>x.json().replayed)).toHaveLength(1);
    const old=await find('OUT_OF_ORDER'),request2=await request(old,'DISMISS');const concurrent=await Promise.all([ro.post(`/api/v1/integration/reconciliation/${old}/resolve`,request2),bureau.post(`/api/v1/integration/reconciliation/${old}/resolve`,request2)]);
    expect(concurrent.map(x=>x.statusCode).sort()).toEqual([200,409]);expect((await one(getPool(),'SELECT count(*)::int AS n FROM integration_resolution_attempts')).n).toBe(2);
  });
  it('an import racing a review shares the cursor/source lock and one stale request loses',async()=>{
    const id=await find('UNKNOWN_CODE'),payload=await request(id,'CORRECT_AND_RETRY',{corrections:{statusCode:'RECEIVED'}});
    const responses=await Promise.all([ro.post(`/api/v1/integration/reconciliation/${id}/resolve`,payload),ro.post('/api/v1/integration/sync',{regionId:'DEMO-WEST',expectedVersion:1,reason,events:[sample()]})]);
    expect(responses.map(x=>x.statusCode).sort()).toEqual([200,409]);expect((await one(getPool(),"SELECT row_version FROM integration_cursors WHERE region_id='DEMO-WEST'")).row_version).toBe(2);
  });
  it('C04: failure after mirror/history/audit changes rolls back everything and the same key can retry',async()=>{
    const id=await find('UNKNOWN_CODE'),payload=await request(id,'CORRECT_AND_RETRY',{corrections:{statusCode:'RECEIVED'}}),idem=key(),before=await snapshot();
    await getPool().query("CREATE FUNCTION fail_b6_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='INTEGRATION_RECONCILIATION_RECORDED' THEN RAISE EXCEPTION 'Synthetic review rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_review BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_b6_review()");
    try{expect((await ro.post(`/api/v1/integration/reconciliation/${id}/resolve`,payload,idem)).statusCode).toBe(500);}finally{await getPool().query('DROP TRIGGER fail_review ON outbox_events; DROP FUNCTION fail_b6_review()');}
    expect(await snapshot()).toEqual(before);expect((await ro.post(`/api/v1/integration/reconciliation/${id}/resolve`,payload,idem)).statusCode).toBe(200);expect((await verifyChain(getPool())).ok).toBe(true);
  });
  it('S01: list totals, detail/raw/history/options and mutations remain inside current region scope',async()=>{
    const id=await find('UNKNOWN_CODE');await sync([sample({externalId:'DEMO-NORTH-REVIEW',institutionCode:'DEMO-1-20001',fields:{title:'Synthetic North unknown code',statusCode:'UNKNOWN'}})],north,'DEMO-NORTH');
    expect((await queue()).total).toBe(5);expect((await queue(north)).total).toBe(1);expect((await queue(auditor,'state=ALL')).total).toBe(6);expect((await queue(ro,'regionId=DEMO-NORTH')).total).toBe(0);
    expect((await north.get('/api/v1/integration/reconciliation/'+id)).statusCode).toBe(404);expect((await resolve(id,'DISMISS',{},north)).statusCode).toBe(404);
    expect((await ro.get('/api/v1/integration/reconciliation/'+crypto.randomUUID())).statusCode).toBe(404);
    const outside=(await queue(north)).rows[0];expect((await queue(ro,'runId='+outside.runId)).total).toBe(0);
  });
  it('S01: anonymous and unauthorised roles cannot read; auditor/authority views are read-only',async()=>{
    const id=await find('UNKNOWN_CODE'),anonymous=new Client(app),url='/api/v1/integration/reconciliation';
    expect((await anonymous.get(url)).statusCode).toBe(401);expect((await anonymous.get(url+'/'+id)).statusCode).toBe(401);expect((await anonymous.post(url+'/'+id+'/resolve',await request(id))).statusCode).toBe(401);
    for(const name of ['inst.west','admin','scrutiny.west1']) {const client=await signIn(app,name+'@demo.aicte.test');expect((await client.get(url)).statusCode).toBe(403);expect((await client.get(url+'/'+id)).statusCode).toBe(403);expect((await resolve(id,'DISMISS',{},client)).statusCode).toBe(403);}
    for(const client of [auditor,await signIn(app,'authority@demo.aicte.test')]) {expect((await detail(id,client)).item.canResolve).toBe(false);expect((await resolve(id,'DISMISS',{},client)).statusCode).toBe(403);}
  });
  it('S02: grant changes block even cached replays; revoked/expired grants lose queue access',async()=>{
    const id=await find('UNKNOWN_CODE'),payload=await request(id,'DISMISS'),idem=key(),url=`/api/v1/integration/reconciliation/${id}/resolve`;await ro.post(url,payload,idem);
    const user=refs.users['ro.west@demo.aicte.test'];await withTx(tx=>tx.query("UPDATE capability_grants SET region_ids=ARRAY['DEMO-NORTH'] WHERE user_id=$1",[user]));
    expect((await ro.get('/api/v1/integration/reconciliation/'+id)).statusCode).toBe(404);expect((await ro.post(url,payload,idem)).statusCode).toBe(404);
    for(const field of ['revoked_at','valid_to']) {await withTx(tx=>tx.query(`UPDATE capability_grants SET ${field}=$2 WHERE user_id=$1`,[user,now()]));try{expect((await ro.get('/api/v1/integration/reconciliation')).statusCode).toBe(401);expect((await ro.post(url,payload,idem)).statusCode).toBe(401);}finally{await withTx(tx=>tx.query(`UPDATE capability_grants SET ${field}=NULL WHERE user_id=$1`,[user]));}}
  });
  it('a later valid source revision supersedes the reviewed mirror pointer but preserves every review attempt',async()=>{
    const id=await find('UNKNOWN_CODE');await resolve(id,'CORRECT_AND_RETRY',{corrections:{statusCode:'RECEIVED'}});const before=await detail(id);expect(before.currentMirror.latestResolutionId).toBeTruthy();
    await sync([sample({externalId:'DEMO-WEST-UNKNOWN',eventId:'unknown-revision-2',revision:2,institutionCode:'DEMO-1-10002',sourceUpdatedAt:'2026-10-02T10:00:00+05:30',fields:{title:'Synthetic source revision after review',statusCode:'COMPLETE'}})]);
    const after=await detail(id);expect(after.currentMirror).toMatchObject({sourceStatus:'SOURCE_REPORTED_COMPLETE',revision:2,latestResolutionId:null});expect(after.attempts).toEqual(before.attempts);expect(after.raw).toEqual(before.raw);expect(after.item.state).toBe('RESOLVED');
  });
  it('unmatched institution review accepts only a visible same-region binding, and attempts cannot be rewritten',async()=>{
    await sync([sample({externalId:'DEMO-UNMAPPED-REVIEW',institutionCode:'DEMO-UNKNOWN'})],bureau);const id=await find('INSTITUTION_UNMAPPED');
    expect((await resolve(id)).json().attempt.reasonCode).toBe('INSTITUTION_UNMAPPED');const before=await snapshot();
    expect((await resolve(id,'CORRECT_AND_RETRY',{corrections:{institutionCode:'DEMO-1-20001'}})).statusCode).toBe(404);expect(await snapshot()).toEqual(before);
    const applied=await resolve(id,'CORRECT_AND_RETRY',{corrections:{institutionCode:'DEMO-1-10001'}});expect(applied.statusCode,applied.body).toBe(200);expect(applied.json().attempt.outcome).toBe('APPLIED');expect((await detail(id)).raw.payload.institutionCode).toBe('DEMO-UNKNOWN');
    await expect(withTx(tx=>tx.query('DELETE FROM integration_resolution_attempts'))).rejects.toMatchObject({code:'23514'});
    await expect(withTx(tx=>tx.query("UPDATE integration_resolution_attempts SET reason='changed history'"))).rejects.toMatchObject({code:'23514'});
  });
  it('strict request validation, reason/CSRF/idempotency and demo-only checks reject invalid reviews atomically',async()=>{
    const id=await find('UNKNOWN_CODE'),payload=await request(id),url=`/api/v1/integration/reconciliation/${id}/resolve`,before=await snapshot();
    for(const input of [{...payload,reason:''},{...payload,expectedVersion:0},{...payload,expectedCursorVersion:undefined},{...payload,action:'APPROVE'},{...payload,action:'CORRECT_AND_RETRY',corrections:{}},{...payload,action:'CORRECT_AND_RETRY',corrections:{decisionOutcome:'APPROVED'}},{...payload,action:'CORRECT_AND_RETRY',corrections:{externalId:'changed'}},{...payload,action:'CORRECT_AND_RETRY',corrections:{sourceUpdatedAt:'bad-date'}},{...payload,corrections:{statusCode:'RECEIVED'}}]) expect((await ro.post(url,input)).statusCode).toBe(422);
    expect((await ro.post(url,payload,null)).statusCode).toBe(422);expect((await ro.raw('POST',url,payload,{'x-requested-with':'wrong','idempotency-key':key()})).statusCode).toBe(403);
    for(const query of ['page=0','pageSize=101','runId=bad','state=APPROVED','unknown=1'])expect((await ro.get('/api/v1/integration/reconciliation?'+query)).statusCode).toBe(422);expect((await ro.get('/api/v1/integration/reconciliation/not-a-uuid')).statusCode).toBe(422);
    const demo=config.demoMode;config.demoMode=false;try{expect((await ro.post(url,payload)).statusCode).toBe(404);}finally{config.demoMode=demo;}expect(await snapshot()).toEqual(before);
  });
  it('review cannot strip forbidden source authority fields or alter any local case/decision/obligation/policy/deadline',async()=>{
    const inst=await signIn(app,'inst.west@demo.aicte.test'),authority=await signIn(app,'authority@demo.aicte.test'),caseId=await createAndSubmit(inst,'EXTENSION_OF_APPROVAL');
    const v=(await ro.get('/api/v1/applications/'+caseId)).json(),owner=await one(getPool(),'SELECT email FROM users WHERE id=$1',[v.stages[0].assignee.id]),member=await signIn(app,owner.email);await satisfyChecklist(member,caseId);await member.command(caseId,'RECORD_RECOMMENDATION',{recommendation:'RECOMMEND_APPROVAL_WITH_CONDITIONS',text:reason,proposedConditions:['Synthetic compliance condition']});await member.command(caseId,'COMPLETE_STAGE');await authority.command(caseId,'RECORD_DECISION',{outcome:'APPROVED_WITH_CONDITIONS',reason,conditions:[{text:'Synthetic evidence condition',dueInDays:3}]});await ro.command(caseId,'CREATE_OBLIGATION',{conditionIndex:0,requiredDocumentType:'LEASE_DEED',verifierUserId:refs.users['ro.west@demo.aicte.test'],reason});
    const local=async()=>({app:await q(getPool(),'SELECT * FROM applications'),decisions:await q(getPool(),'SELECT * FROM decisions'),obligations:await q(getPool(),'SELECT * FROM obligations'),policy:await q(getPool(),'SELECT * FROM policy_versions'),deadlines:await q(getPool(),'SELECT * FROM deadlines'),documents:await q(getPool(),'SELECT * FROM document_records')});const before=await local();
    const forbidden=(await q(getPool(),"SELECT queue.id FROM integration_reconciliation queue JOIN integration_raw_events raw ON raw.id=queue.raw_event_id WHERE raw.payload->>'externalId'='DEMO-WEST-FORBIDDEN'"))[0].id;
    const blocked=await resolve(forbidden,'CORRECT_AND_RETRY',{corrections:{title:'Reviewed synthetic title',statusCode:'COMPLETE'}});expect(blocked.json().attempt).toMatchObject({outcome:'STILL_BLOCKED',reasonCode:'INVALID_RECORD'});
    expect((await resolve(await find('UNKNOWN_CODE'),'CORRECT_AND_RETRY',{corrections:{statusCode:'COMPLETE'}})).json().attempt.outcome).toBe('APPLIED');await resolve(forbidden,'DISMISS');expect(await local()).toEqual(before);
  });
});
