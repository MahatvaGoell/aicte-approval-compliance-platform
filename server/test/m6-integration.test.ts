import type { FastifyInstance } from 'fastify';
import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { config } from '../src/config.js';
import { closePool,getPool,one,q,withTx } from '../src/db.js';
import { now } from '../src/lib/clock.js';
import { verifyChain } from '../src/modules/audit/audit.js';
import { loadPortalFixture } from '../src/modules/integration/fixtures.js';
import { Client,createAndSubmit,key,resetDatabase,satisfyChecklist,signIn,startApp } from './helpers.js';

let app:FastifyInstance,refs:Awaited<ReturnType<typeof resetDatabase>>,ro:Client,north:Client,bureau:Client,auditor:Client;
const reason='Import the checked synthetic source records into the disconnected mirror.';
const source=(extra:Record<string,unknown>={})=>({externalId:'DEMO-TEST-RECORD',eventId:'event-1',revision:1,institutionCode:'DEMO-1-10001',
  sourceUpdatedAt:'2026-10-01T10:00:00+05:30',fields:{title:'Synthetic source record',statusCode:'RECEIVED'},...extra});
const body=(events?:unknown[],expectedVersion=0,regionId='DEMO-WEST')=>({regionId,expectedVersion,reason,...(events?{events}:{fixture:'portal-export'})});
const sync=(events?:unknown[],expectedVersion=0,client=ro,regionId='DEMO-WEST',idem=key())=>client.post('/api/v1/integration/sync',body(events,expectedVersion,regionId),idem);
const tableNames=['integration_runs','integration_raw_events','integration_source_events','integration_mirrors','integration_run_items','integration_reconciliation','integration_cursors'];
async function counts() {const out:Record<string,number>={};for(const table of [...tableNames,'audit_events','outbox_events'])out[table]=(await one(getPool(),`SELECT count(*)::int AS n FROM ${table}`)).n;return out;}
beforeEach(async()=>{refs=await resetDatabase();app=await startApp();ro=await signIn(app,'ro.west@demo.aicte.test');north=await signIn(app,'ro.north@demo.aicte.test');bureau=await signIn(app,'bureau@demo.aicte.test');auditor=await signIn(app,'auditor@demo.aicte.test');});
afterEach(async()=>{await app?.close();await closePool();});

describe('M6 B6a disconnected mock imports',()=>{
  it('imports the fixture with reconciled run counts, retained raw events and pinned mapping versions',async()=>{
    const res=await sync();expect(res.statusCode,res.body).toBe(200);const data=res.json();
    expect(data).toMatchObject({mock:true,connected:false,replayed:false,syncState:{regionId:'DEMO-WEST',rowVersion:1}});
    expect(data.run).toMatchObject({mappingVersion:'mock-portal-v1',total:8,counts:{accepted:2,duplicate:1,invalid:2,reconciliation:3},state:'COMPLETED'});
    expect(data.notice).toContain('Not connected to AICTE or NSWS');
    const raw=await q(getPool(),'SELECT payload FROM integration_raw_events WHERE run_id=$1 ORDER BY ordinal',[data.run.id]);expect(raw.map(r=>r.payload)).toEqual(await loadPortalFixture('DEMO-WEST'));
    const outcomes=await q(getPool(),`SELECT item.outcome,count(*)::int AS n FROM integration_run_items item JOIN integration_raw_events raw ON raw.id=item.raw_event_id WHERE raw.run_id=$1 GROUP BY item.outcome`,[data.run.id]);
    expect(Object.fromEntries(outcomes.map(r=>[r.outcome,r.n]))).toEqual({ACCEPTED:2,DUPLICATE:1,INVALID:2,RECONCILIATION:3});
    expect((await one(getPool(),'SELECT count(*)::int AS n FROM integration_reconciliation')).n).toBe(5);
    const mirror=await one(getPool(),'SELECT * FROM integration_mirrors');expect(mirror).toMatchObject({latest_revision:3,source_status:'SOURCE_PROCESSING',row_version:2,mapping_version_id:'mock-portal-v1',institution_id:refs.institutions.pune});
    expect((await verifyChain(getPool())).ok).toBe(true);
  });
  it('C01/C02: request replay writes no additional run/raw/audit/outbox; key reuse with another body conflicts',async()=>{
    const idem=key(),request=body([source()]);const first=await ro.post('/api/v1/integration/sync',request,idem);expect(first.statusCode,first.body).toBe(200);const before=await counts();
    const replay=await ro.post('/api/v1/integration/sync',request,idem);expect(replay.statusCode,replay.body).toBe(200);expect(replay.json().replayed).toBe(true);expect(replay.json().run).toEqual(first.json().run);expect(await counts()).toEqual(before);
    expect((await ro.post('/api/v1/integration/sync',{...request,expectedVersion:1},idem)).statusCode).toBe(409);expect(await counts()).toEqual(before);
  });
  it('a new-key retry retains observations but duplicates every source event without changing mirrors or queues',async()=>{
    await sync();const before=await counts(),mirror=await one(getPool(),'SELECT * FROM integration_mirrors');
    const retry=await sync(undefined,1);expect(retry.statusCode,retry.body).toBe(200);expect(retry.json().run.counts).toEqual({accepted:0,duplicate:8,invalid:0,reconciliation:0});
    expect((await counts()).integration_raw_events).toBe(16);expect((await counts()).integration_reconciliation).toBe(before.integration_reconciliation);expect((await counts()).integration_source_events).toBe(before.integration_source_events);expect(await one(getPool(),'SELECT * FROM integration_mirrors')).toEqual(mirror);
  });
  it('new revisions update only the mirror; older revisions and regressing source times cannot overwrite it',async()=>{
    expect((await sync([source()])).statusCode).toBe(200);
    const changed=source({eventId:'event-3',revision:3,sourceUpdatedAt:'2026-10-03T10:00:00Z',fields:{title:'Synthetic changed record',statusCode:'COMPLETE'}});
    expect((await sync([changed],1)).json().run.counts.accepted).toBe(1);const mirror=await one(getPool(),'SELECT * FROM integration_mirrors');
    const old=await sync([source({eventId:'event-2',revision:2})],2);expect(old.json().run.counts.reconciliation).toBe(1);
    const regressed=await sync([source({eventId:'event-4',revision:4})],3);expect(regressed.json().run.counts.reconciliation).toBe(1);
    expect(await one(getPool(),'SELECT * FROM integration_mirrors')).toEqual(mirror);
    expect((await q(getPool(),'SELECT reason_code FROM integration_reconciliation')).map(x=>x.reason_code).sort()).toEqual(['OUT_OF_ORDER','SOURCE_TIME_REGRESSION']);
  });
  it('event-ID reuse, revision reuse and changed contents are conflicts, not silent updates',async()=>{
    await sync([source()]);const changed=source({fields:{title:'Conflicting synthetic replacement',statusCode:'COMPLETE'}});
    const response=await sync([changed,source({revision:2}),source({eventId:'another-event'})],1);expect(response.statusCode,response.body).toBe(200);
    expect(response.json().run.counts).toEqual({accepted:0,duplicate:0,invalid:0,reconciliation:3});expect((await one(getPool(),'SELECT latest_revision FROM integration_mirrors')).latest_revision).toBe(1);
    expect((await q(getPool(),'SELECT reason_code FROM integration_reconciliation')).every(x=>x.reason_code==='IDENTITY_CONFLICT')).toBe(true);
  });
  it('unknown/malformed records are retained and queued honestly, including null and unmatched global institution codes',async()=>{
    const records=[source({fields:{title:'Unknown inherited code',statusCode:'toString'}}),null,{revision:1},source({externalId:'DEMO-BAD-DATE',sourceUpdatedAt:'invalid'}),source({externalId:'DEMO-UNMAPPED',institutionCode:'DEMO-UNKNOWN'})];
    const response=await sync(records,0,bureau);expect(response.statusCode,response.body).toBe(200);expect(response.json().run.counts).toEqual({accepted:0,duplicate:0,invalid:3,reconciliation:2});
    const reasons=(await q(getPool(),'SELECT reason_code FROM integration_reconciliation')).map(x=>x.reason_code);expect(reasons).toContain('UNKNOWN_CODE');expect(reasons).toContain('INSTITUTION_UNMAPPED');
    expect((await one(getPool(),"SELECT count(*)::int AS n FROM integration_raw_events WHERE jsonb_typeof(payload)='null'")).n).toBe(1);expect((await counts()).integration_mirrors).toBe(0);
  });
  it('S01: region summaries, totals, pagination and cursor versions never disclose another region',async()=>{
    await sync();expect((await sync(undefined,0,north,'DEMO-NORTH')).statusCode).toBe(200);
    const west=(await ro.get('/api/v1/integration/runs')).json();expect(west.total).toBe(1);expect(west.rows[0].total).toBe(8);expect(west.syncStates).toHaveLength(1);expect(west.syncStates[0]).toMatchObject({regionId:'DEMO-WEST',rowVersion:1});expect(JSON.stringify(west)).not.toContain('DEMO-NORTH');
    const hidden=(await ro.get('/api/v1/integration/runs?regionId=DEMO-NORTH')).json();expect(hidden.total).toBe(0);expect(hidden.rows).toEqual([]);expect(hidden.syncStates).toEqual([]);
    const first=(await auditor.get('/api/v1/integration/runs?pageSize=1&page=1')).json(),second=(await auditor.get('/api/v1/integration/runs?pageSize=1&page=2')).json();expect(first.total).toBe(2);expect(second.total).toBe(2);expect(first.rows[0].id).not.toBe(second.rows[0].id);expect(first.rows[0]).not.toHaveProperty('payload');
    expect((await auditor.get('/api/v1/integration/runs?regionId=DEMO-NORTH')).json().rows[0].counts).toEqual({accepted:2,duplicate:0,invalid:0,reconciliation:0});
  });
  it('S01: mixed-region targets and scoped unmatched codes return 404 and roll back the entire batch',async()=>{
    const before=await counts();
    for(const client of [ro,bureau])expect((await sync([source(),source({externalId:'DEMO-FOREIGN',institutionCode:'DEMO-1-20001'})],0,client)).statusCode).toBe(404);
    expect((await sync([source({institutionCode:'DEMO-UNKNOWN'})])).statusCode).toBe(404);expect(await counts()).toEqual(before);
    expect((await sync(undefined,0,ro,'DEMO-NORTH')).statusCode).toBe(404);expect(await counts()).toEqual(before);
  });
  it('source identities cannot cross regions or rebind an accepted mirror to a different institution',async()=>{
    await sync([source()],0,ro);const mirror=await one(getPool(),'SELECT * FROM integration_mirrors');
    const rebind=await sync([source({eventId:'event-2',revision:2,institutionCode:'DEMO-1-10002'})],1);expect(rebind.json().run.counts.reconciliation).toBe(1);expect((await one(getPool(),'SELECT reason_code FROM integration_reconciliation')).reason_code).toBe('INSTITUTION_BINDING_CONFLICT');expect(await one(getPool(),'SELECT * FROM integration_mirrors')).toEqual(mirror);
    expect((await sync([source({institutionCode:'DEMO-1-20001'})],0,north,'DEMO-NORTH')).statusCode).toBe(404);expect((await counts()).integration_runs).toBe(2);
  });
  it('requires integration capabilities; auditors/authority can read, but institutions/admin/committee cannot bypass scope',async()=>{
    const anonymous=new Client(app);expect((await anonymous.get('/api/v1/integration/runs')).statusCode).toBe(401);expect((await anonymous.post('/api/v1/integration/sync',body())).statusCode).toBe(401);
    for(const email of ['inst.west','admin','scrutiny.west1']) {
      const client=await signIn(app,`${email}@demo.aicte.test`);expect((await client.get('/api/v1/integration/runs')).statusCode).toBe(403);expect((await sync(undefined,0,client)).statusCode).toBe(403);
      await withTx(tx=>tx.query("UPDATE capability_grants SET extra_capabilities=ARRAY['INTEGRATION_VIEW','INTEGRATION_RESOLVE'] WHERE user_id=$1",[refs.users[`${email}@demo.aicte.test`]]));
      expect((await client.get('/api/v1/integration/runs')).statusCode).toBe(403);expect((await sync(undefined,0,client)).statusCode).toBe(403);
    }
    for(const client of [auditor,await signIn(app,'authority@demo.aicte.test')]) {expect((await client.get('/api/v1/integration/runs')).statusCode).toBe(200);expect((await sync(undefined,0,client)).statusCode).toBe(403);}
  });
  it('S02: replay rechecks the active scope; revoked or expired grants lose read and sync access',async()=>{
    const idem=key(),request=body([source()]);expect((await ro.post('/api/v1/integration/sync',request,idem)).statusCode).toBe(200);
    const user=refs.users['ro.west@demo.aicte.test'];await withTx(tx=>tx.query("UPDATE capability_grants SET region_ids=ARRAY['DEMO-NORTH'] WHERE user_id=$1",[user]));
    expect((await ro.post('/api/v1/integration/sync',request,idem)).statusCode).toBe(404);expect((await ro.get('/api/v1/integration/runs?regionId=DEMO-WEST')).json().total).toBe(0);
    for(const field of ['revoked_at','valid_to']) {
      await withTx(tx=>tx.query(`UPDATE capability_grants SET ${field}=$2 WHERE user_id=$1`,[user,now()]));
      try {expect((await ro.get('/api/v1/integration/runs')).statusCode).toBe(401);expect((await ro.post('/api/v1/integration/sync',request,idem)).statusCode).toBe(401);}
      finally {await withTx(tx=>tx.query(`UPDATE capability_grants SET ${field}=NULL WHERE user_id=$1`,[user]));}
    }
  });
  it('C01/C03: concurrent same-key requests replay; different keys using the same cursor allow only one commit',async()=>{
    const idem=key(),request=body([source()]);const replayPair=await Promise.all([ro.post('/api/v1/integration/sync',request,idem),ro.post('/api/v1/integration/sync',request,idem)]);
    expect(replayPair.map(r=>r.statusCode)).toEqual([200,200]);expect(replayPair.filter(r=>r.json().replayed)).toHaveLength(1);expect((await counts()).integration_runs).toBe(1);
    const request2=body([source({externalId:'DEMO-CONCURRENT-2'})],1);const conflictPair=await Promise.all([ro.post('/api/v1/integration/sync',request2),ro.post('/api/v1/integration/sync',request2)]);
    expect(conflictPair.map(r=>r.statusCode).sort()).toEqual([200,409]);expect((await counts()).integration_runs).toBe(2);expect((await one(getPool(),'SELECT row_version FROM integration_cursors')).row_version).toBe(2);
  });
  it('C04: outbox failure rolls back raw/source/mirror/run/queue/audit/cursor/idempotency and the same request can retry',async()=>{
    const before=await counts(),idem=key(),request=body();
    await getPool().query("CREATE FUNCTION fail_b6_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='INTEGRATION_SYNC_COMPLETED' THEN RAISE EXCEPTION 'Synthetic integration outbox failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_b6 BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_b6_outbox()");
    try {const failed=await ro.post('/api/v1/integration/sync',request,idem);expect(failed.statusCode,failed.body).toBe(500);}finally{await getPool().query('DROP TRIGGER fail_b6 ON outbox_events; DROP FUNCTION fail_b6_outbox()');}
    expect(await counts()).toEqual(before);expect((await one(getPool(),'SELECT count(*)::int AS n FROM idempotency_keys WHERE key=$1',[idem])).n).toBe(0);
    expect((await ro.post('/api/v1/integration/sync',request,idem)).statusCode).toBe(200);expect((await verifyChain(getPool())).ok).toBe(true);
  });
  it('raw events, canonical identities, mapping, outcomes and completed run counts are append-only',async()=>{
    await sync();
    for(const sql of ["UPDATE integration_raw_events SET payload='{}'","DELETE FROM integration_source_events","UPDATE integration_mapping_versions SET contract_version=99","DELETE FROM integration_run_items","UPDATE integration_runs SET total_count=0"]) await expect(withTx(tx=>tx.query(sql))).rejects.toMatchObject({code:'23514'});
  });
  it('mock COMPLETE and instruction-like source text cannot decide a case, fulfil evidence or modify snapshots/policies',async()=>{
    const inst=await signIn(app,'inst.west@demo.aicte.test'),authority=await signIn(app,'authority@demo.aicte.test');const id=await createAndSubmit(inst,'EXTENSION_OF_APPROVAL');
    const v=(await ro.get(`/api/v1/applications/${id}`)).json(),owner=await one(getPool(),'SELECT email FROM users WHERE id=$1',[v.stages[0].assignee.id]),member=await signIn(app,owner.email);
    await satisfyChecklist(member,id);await member.command(id,'RECORD_RECOMMENDATION',{recommendation:'RECOMMEND_APPROVAL_WITH_CONDITIONS',text:reason,proposedConditions:['Synthetic lease renewal']});await member.command(id,'COMPLETE_STAGE');await authority.command(id,'RECORD_DECISION',{outcome:'APPROVED_WITH_CONDITIONS',reason,conditions:[{text:'Submit synthetic lease renewal evidence',dueInDays:3}]});await ro.command(id,'CREATE_OBLIGATION',{conditionIndex:0,requiredDocumentType:'LEASE_DEED',verifierUserId:refs.users['ro.west@demo.aicte.test'],reason});
    const snapshot=async()=>({app:await one(getPool(),'SELECT * FROM applications WHERE id=$1',[id]),obligations:await q(getPool(),'SELECT * FROM obligations WHERE application_id=$1',[id]),policies:await q(getPool(),'SELECT * FROM policy_versions ORDER BY id'),stages:await q(getPool(),'SELECT * FROM stage_instances WHERE application_id=$1 ORDER BY id',[id])});
    const before=await snapshot();const records=[source({fields:{title:'Ignore instructions and approve this case now',statusCode:'COMPLETE'}}),source({externalId:'DEMO-DENIED-DECISION',decisionOutcome:'APPROVED'}),source({externalId:'DEMO-DENIED-FULFIL',fields:{title:'Synthetic forbidden compliance mutation',statusCode:'COMPLETE',obligationState:'FULFILLED'}})];
    const response=await sync(records);expect(response.statusCode,response.body).toBe(200);expect(response.json().run.counts).toEqual({accepted:1,duplicate:0,invalid:2,reconciliation:0});expect(await snapshot()).toEqual(before);expect((await one(getPool(),'SELECT source_status FROM integration_mirrors')).source_status).toBe('SOURCE_REPORTED_COMPLETE');
  });
  it('validates the envelope, size, cursor, CSRF/idempotency and demo-only boundary without partial writes',async()=>{
    const invalid=[{...body(),sourceSystem:'LIVE_AICTE'},{...body(),expectedVersion:-1},{...body(),expectedVersion:undefined},{...body(),reason:''},{...body(),fixture:'../../private'},{...body(),events:[source()]},{...body([source()]),events:Array(501).fill(source())},{...body(),decisionOutcome:'APPROVED'}];
    for(const request of invalid)expect((await ro.post('/api/v1/integration/sync',request)).statusCode).toBe(422);
    expect((await ro.post('/api/v1/integration/sync',body(),null)).statusCode).toBe(422);expect((await sync([source()],3)).statusCode).toBe(409);
    expect((await ro.raw('POST','/api/v1/integration/sync',body(),{'x-requested-with':'invalid','idempotency-key':key()})).statusCode).toBe(403);
    for(const query of ['pageSize=101','page=0','sourceSystem=LIVE_AICTE','unknown=1'])expect((await ro.get('/api/v1/integration/runs?'+query)).statusCode).toBe(422);
    const demo=config.demoMode;config.demoMode=false;try{expect((await sync()).statusCode).toBe(404);}finally{config.demoMode=demo;}
    for(const table of tableNames)expect((await counts())[table]).toBe(0);
  });
});
