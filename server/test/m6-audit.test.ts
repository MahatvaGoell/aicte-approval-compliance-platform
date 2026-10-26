import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool, one, q, withTx } from '../src/db.js';
import { now, setTestNow } from '../src/lib/clock.js';
import { recordAudit } from '../src/modules/audit/audit.js';
import { actorFromToken } from '../src/modules/identity/auth.js';
import { Client, createAndSubmit, resetDatabase, signIn, startApp, TEST_NOW } from './helpers.js';

let app:FastifyInstance, refs:Awaited<ReturnType<typeof resetDatabase>>;
let auditor:Client, regional:Client, institution:Client, north:Client, ro:Client;
let westId:string,northId:string,westNo:string,northNo:string;
let publicEvent:number,privateEvent:number,northEvent:number,exportEvent:number;
const dateEvents:number[]=[];
const list=async(c=auditor,query='')=>c.get(`/api/v1/audit${query?'?'+query:''}`);
async function event(client:Client,applicationId:string,action:string,visibility:'INSTITUTION'|'INTERNAL',at=TEST_NOW) {
  setTestNow(at);
  const actor=await actorFromToken(getPool(),client.sid);
  return withTx(tx=>recordAudit(tx,{actor,at:now(),correlationId:'b5-synthetic-event'},
    {entityType:'synthetic_audit_fixture',entityId:applicationId,applicationId,action,visibility,
      before:{phase:'before'},after:{phase:'after',marker:action},reason:'Synthetic B5 audit verification event'}));
}
beforeAll(async()=>{
  refs=await resetDatabase();app=await startApp();
  auditor=await signIn(app,'auditor@demo.aicte.test');regional=await signIn(app,'bureau@demo.aicte.test');
  institution=await signIn(app,'inst.west@demo.aicte.test');north=await signIn(app,'inst.north@demo.aicte.test');ro=await signIn(app,'ro.west@demo.aicte.test');
  westId=await createAndSubmit(institution,'EXTENSION_OF_APPROVAL');northId=await createAndSubmit(north,'EXTENSION_OF_APPROVAL');
  westNo=(await one(getPool(),'SELECT app_no FROM applications WHERE id=$1',[westId])).app_no;
  northNo=(await one(getPool(),'SELECT app_no FROM applications WHERE id=$1',[northId])).app_no;
  // Test active grants without adding synthetic accounts or changing the product's seed permissions.
  await withTx(async tx=>{
    await tx.query("UPDATE capability_grants SET scope_all=false,region_ids=ARRAY['DEMO-WEST'] WHERE user_id=$1 AND role='AUDITOR'",[refs.users['bureau@demo.aicte.test']]);
    await tx.query("UPDATE capability_grants SET extra_capabilities=ARRAY['AUDIT_VIEW'] WHERE user_id=$1 AND role='INSTITUTION_REP'",[refs.users['inst.west@demo.aicte.test']]);
  });
  const me=(await regional.get('/api/v1/me')).json();
  expect((await regional.post('/api/v1/auth/switch-role',{grantId:me.grants.find((g:any)=>g.role==='AUDITOR').id})).statusCode).toBe(200);
  publicEvent=await event(institution,westId,'B5_WEST_PUBLIC','INSTITUTION');
  privateEvent=await event(ro,westId,'B5_WEST_PRIVATE','INTERNAL');
  northEvent=await event(north,northId,'B5_NORTH_ONLY','INTERNAL');
  for(const at of ['2026-10-31T18:29:59.999Z','2026-10-31T18:30:00.000Z','2026-11-01T18:29:59.999Z','2026-11-01T18:30:00.000Z']) dateEvents.push(await event(institution,westId,'B5_DATE_BOUNDARY','INSTITUTION',new Date(at)));
  setTestNow(TEST_NOW);
  const exported=await ro.get('/api/v1/reports/pending/csv');expect(exported.statusCode,exported.body).toBe(200);
  exportEvent=(await one(getPool(),"SELECT id FROM audit_events WHERE action='REPORT_EXPORTED' ORDER BY id DESC LIMIT 1")).id;
});
afterAll(async()=>{setTestNow(TEST_NOW);await app?.close();await closePool();});

describe('M6 B5 scoped audit viewer',()=>{
  it('S01: requires AUDIT_VIEW on list, detail and integrity routes; anonymous callers receive 401',async()=>{
    const anonymous=new Client(app);
    for(const path of ['/api/v1/audit',`/api/v1/audit/${publicEvent}`]) expect((await anonymous.get(path)).statusCode).toBe(401);
    expect((await anonymous.post('/api/v1/audit/verify', {})).statusCode).toBe(401);
    for(const email of ['ro.west','inst.north','admin','scrutiny.west1']) {
      const client=await signIn(app,`${email}@demo.aicte.test`);
      expect((await client.get('/api/v1/audit')).statusCode).toBe(403);
      expect((await client.get(`/api/v1/audit/${publicEvent}`)).statusCode).toBe(403);
      expect((await client.post('/api/v1/audit/verify', {})).statusCode).toBe(403);
    }
  });
  it('S01: all-region and regional totals match SQL; regional events/facets exclude other regions and global events',async()=>{
    const all=(await list(auditor,'pageSize=100')).json(),scoped=(await list(regional,'pageSize=100')).json();
    expect(all.total).toBe((await one(getPool(),'SELECT count(*)::int AS n FROM audit_events')).n);
    const expected=await q(getPool(),"SELECT e.id FROM audit_events e JOIN applications a ON a.id=e.application_id WHERE a.region_id='DEMO-WEST' ORDER BY e.id DESC");
    expect(scoped.total).toBe(expected.length);expect(scoped.rows.map((e:any)=>e.id)).toEqual(expected.map(e=>e.id));
    expect(scoped.rows.every((e:any)=>e.application_id===westId)).toBe(true);
    expect(scoped.facets.actions).toContain('B5_WEST_PRIVATE');expect(scoped.facets.actions).not.toContain('B5_NORTH_ONLY');expect(scoped.facets.actions).not.toContain('REPORT_EXPORTED');
    expect(scoped.facets.actors.map((a:any)=>a.id)).not.toContain(refs.users['inst.north@demo.aicte.test']);
    expect(all.facets.actions).toContain('B5_NORTH_ONLY');expect(all.facets.actions).toContain('REPORT_EXPORTED');
    expect(scoped.refreshedAt).toBe(TEST_NOW.toISOString());expect(scoped.timezone).toBe('Asia/Kolkata');
  });
  it('S01: no INTERNAL_NOTES_VIEW means institution-visible events only, including details and facets',async()=>{
    const result=(await list(institution,'pageSize=100')).json();
    const expected=await q(getPool(),"SELECT id FROM audit_events WHERE application_id=$1 AND visibility='INSTITUTION' ORDER BY id DESC",[westId]);
    expect(result.total).toBe(expected.length);expect(result.rows.map((e:any)=>e.id)).toEqual(expected.map(e=>e.id));
    expect(result.facets.actions).toContain('B5_WEST_PUBLIC');expect(result.facets.actions).not.toContain('B5_WEST_PRIVATE');
    expect((await institution.get(`/api/v1/audit/${privateEvent}`)).statusCode).toBe(404);
    expect((await institution.get(`/api/v1/audit/${publicEvent}`)).statusCode).toBe(200);
  });
  it('filters by exact case UUID and case number without bypassing region scope',async()=>{
    for(const query of [`applicationId=${westId}`,`appNo=${westNo}`]) {
      const result=(await list(auditor,query)).json();expect(result.total).toBeGreaterThan(0);expect(result.rows.every((e:any)=>e.application_id===westId)).toBe(true);
    }
    for(const query of [`applicationId=${northId}`,`appNo=${northNo}`,`applicationId=${westId}&appNo=${northNo}`]) {
      const result=(await list(regional,query)).json();expect(result.total).toBe(0);expect(result.rows).toEqual([]);
    }
  });
  it('filters by action, entity type and actor, including combined filters and exact parameterised strings',async()=>{
    const queries=[
      ['action=B5_WEST_PUBLIC',(e:any)=>e.action==='B5_WEST_PUBLIC'],
      ['entityType=synthetic_audit_fixture',(e:any)=>e.entity_type==='synthetic_audit_fixture'],
      [`actorUserId=${refs.users['inst.west@demo.aicte.test']}`,(e:any)=>e.actor_user_id===refs.users['inst.west@demo.aicte.test']],
      [`applicationId=${westId}&action=B5_WEST_PRIVATE&entityType=synthetic_audit_fixture&actorUserId=${refs.users['ro.west@demo.aicte.test']}`,(e:any)=>e.id===privateEvent],
    ] as const;
    for(const[query,predicate]of queries) {const result=(await list(auditor,query)).json();expect(result.total).toBeGreaterThan(0);expect(result.rows.every(predicate)).toBe(true);}
    expect((await list(auditor,'action='+encodeURIComponent("B5_WEST_PUBLIC' OR TRUE --"))).json().total).toBe(0);
  });
  it('D02: from/to include the entire Asia/Kolkata day with exclusive next-midnight upper bound',async()=>{
    const query='action=B5_DATE_BOUNDARY';
    expect((await list(auditor,query+'&from=2026-11-01&to=2026-11-01')).json().rows.map((e:any)=>e.id)).toEqual([dateEvents[2],dateEvents[1]]);
    expect((await list(auditor,query+'&from=2026-11-01')).json().total).toBe(3);
    expect((await list(auditor,query+'&to=2026-11-01')).json().total).toBe(3);
  });
  it('paged totals reconcile with SQL and pages are disjoint in stable audit-ID order',async()=>{
    const first=(await list(regional,'pageSize=3&page=1')).json(),second=(await list(regional,'pageSize=3&page=2')).json();
    const expected=await q(getPool(),"SELECT e.id FROM audit_events e JOIN applications a ON a.id=e.application_id WHERE a.region_id='DEMO-WEST' ORDER BY e.id DESC");
    expect(first.total).toBe(expected.length);expect(second.total).toBe(first.total);expect(first.pageSize).toBe(3);expect(second.page).toBe(2);
    expect([...first.rows,...second.rows].map((e:any)=>e.id)).toEqual(expected.slice(0,6).map(e=>e.id));
    expect(first.rows.some((e:any)=>second.rows.some((s:any)=>s.id===e.id))).toBe(false);
    const past=(await list(regional,'pageSize=3&page=10000')).json();expect(past.rows).toEqual([]);expect(past.total).toBe(first.total);
  });
  it('list omits before/after; authorised detail includes them and outside scope returns 404',async()=>{
    const result=(await list(auditor,'action=B5_WEST_PUBLIC')).json();expect(result.rows[0]).not.toHaveProperty('before_state');expect(result.rows[0]).not.toHaveProperty('after_state');
    const detail=await regional.get(`/api/v1/audit/${publicEvent}`);expect(detail.statusCode,detail.body).toBe(200);expect(detail.json().before_state).toEqual({phase:'before'});expect(detail.json().after_state.marker).toBe('B5_WEST_PUBLIC');
    expect(detail.json()).toHaveProperty('hash');expect(detail.json().app_no).toBe(westNo);
    expect((await regional.get(`/api/v1/audit/${northEvent}`)).statusCode).toBe(404);expect((await regional.get('/api/v1/audit/9007199254740991')).statusCode).toBe(404);
    expect((await auditor.get(`/api/v1/audit/${northEvent}`)).statusCode).toBe(200);
  });
  it('application-less REPORT_EXPORTED is visible only in the all-region audit grant',async()=>{
    expect((await list(auditor,'action=REPORT_EXPORTED')).json().total).toBe(1);
    expect((await list(regional,'action=REPORT_EXPORTED')).json().total).toBe(0);
    expect((await regional.get(`/api/v1/audit/${exportEvent}`)).statusCode).toBe(404);
    expect((await auditor.get(`/api/v1/audit/${exportEvent}`)).json().application_id).toBeNull();
  });
  it('invalid filters and detail IDs return 422 with the standard error envelope',async()=>{
    for(const query of ['page=0','page=1.5','pageSize=101','pageSize=0','from=2026-02-31','to=not-a-date','from=2026-11-03&to=2026-11-01','actorUserId=nope','applicationId=nope','action=','entityType=','unknown=1']) {
      const response=await list(auditor,query);expect(response.statusCode,query+response.body).toBe(422);expect(response.json().error).toMatchObject({code:'VALIDATION_FAILED',correlationId:expect.any(String)});
    }
    for(const id of ['0','-1','abc','1.2','9007199254740992'])expect((await auditor.get(`/api/v1/audit/${id}`)).statusCode).toBe(422);
  });
  it('integrity response keeps full all-region diagnostics and redacts global counts/IDs for scoped viewers',async()=>{
    const all=(await auditor.post('/api/v1/audit/verify', {})).json();expect(all.ok).toBe(true);expect(all.checked).toBe((await one(getPool(),'SELECT count(*)::int AS n FROM audit_events')).n);expect(all.firstBrokenId).toBeNull();expect(all.verifiedAt).toBe(TEST_NOW.toISOString());expect(all.limits).toContain('not impossible to alter');
    for(const client of [regional,institution]) {const scoped=(await client.post('/api/v1/audit/verify', {})).json();expect(scoped.ok).toBe(true);expect(scoped.problem).toBeNull();expect(scoped).not.toHaveProperty('checked');expect(scoped).not.toHaveProperty('firstBrokenId');expect(scoped.verifiedAt).toBe(all.verifiedAt);expect(scoped.limits).toBe(all.limits);}
  });
  it('tamper detection is preserved without revealing the broken event ID to a regional auditor',async()=>{
    const original=(await one(getPool(),'SELECT reason FROM audit_events WHERE id=$1',[northEvent])).reason;
    await withTx(async tx=>{await tx.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update');await tx.query("UPDATE audit_events SET reason='Synthetic test tampering' WHERE id=$1",[northEvent]);await tx.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update');});
    try {
      const all=(await auditor.post('/api/v1/audit/verify', {})).json(),scoped=(await regional.post('/api/v1/audit/verify', {})).json();
      expect(all.ok).toBe(false);expect(all.firstBrokenId).toBe(northEvent);expect(scoped.ok).toBe(false);expect(scoped.problem).toBe('stored content does not match its hash');expect(scoped).not.toHaveProperty('checked');expect(scoped).not.toHaveProperty('firstBrokenId');
    } finally {await withTx(async tx=>{await tx.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update');await tx.query('UPDATE audit_events SET reason=$2 WHERE id=$1',[northEvent,original]);await tx.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update');});}
  });
  it('S02: current grant revocation or expiry removes list, detail and verification access',async()=>{
    const userId=refs.users['bureau@demo.aicte.test'];
    for(const update of ['revoked_at','valid_to']) {
      await withTx(tx=>tx.query(`UPDATE capability_grants SET ${update}=$2 WHERE user_id=$1 AND role='AUDITOR'`,[userId,now()]));
      try {expect((await list(regional)).statusCode).toBe(401);expect((await regional.get(`/api/v1/audit/${publicEvent}`)).statusCode).toBe(401);expect((await regional.post('/api/v1/audit/verify', {})).statusCode).toBe(401);}
      finally {await withTx(tx=>tx.query(`UPDATE capability_grants SET ${update}=NULL WHERE user_id=$1 AND role='AUDITOR'`,[userId]));}
    }
  });
});
