import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool, q } from '../src/db.js';
import { verifyChain } from '../src/modules/audit/audit.js';
import { Client, count, createAndSubmit, resetDatabase, satisfyChecklist, signIn, startApp } from './helpers.js';

let app: FastifyInstance;
let inst: Client;
let ro: Client;
let authority: Client;

beforeAll(async () => {
  await resetDatabase();
  app = await startApp();
  inst = await signIn(app, 'inst.west@demo.aicte.test');
  ro = await signIn(app, 'ro.west@demo.aicte.test');
  authority = await signIn(app, 'authority@demo.aicte.test');
});

afterAll(async () => {
  await app.close();
  await closePool();
});

/** Signs in as whoever owns the live stage of the case. */
async function owner(appId: string): Promise<Client> {
  const rows = await q(getPool(),
    `SELECT u.email FROM applications a JOIN workflow_instances w ON w.id = a.current_workflow_id
       JOIN stage_instances s ON s.id = w.current_stage_id JOIN users u ON u.id = s.assignee_user_id WHERE a.id = $1`, [appId]);
  if (!rows.length) throw new Error('no assignee');
  return signIn(app, rows[0].email);
}

const view = async (c: Client, id: string) => (await c.get(`/api/v1/applications/${id}`)).json();
const current = (v: any) => v.stages.find((s: any) => s.id === v.currentStageId);

async function decide(id: string, outcome: string) {
  const res = await authority.command(id, 'RECORD_DECISION', { outcome, reason: `Demo decision: ${outcome.toLowerCase()} after review` });
  expect(res.statusCode, res.body).toBe(200);
}

async function finishScrutiny(id: string) {
  const member = await owner(id);
  expect((await satisfyChecklist(member, id)).statusCode).toBe(200);
  expect((await member.command(id, 'RECORD_RECOMMENDATION', { recommendation: 'RECOMMEND_APPROVAL', text: 'All requirements are met on record.' })).statusCode).toBe(200);
  const done = await member.command(id, 'COMPLETE_STAGE', { note: 'Scrutiny completed' });
  expect(done.statusCode, done.body).toBe(200);
}

describe('W04 return → response → re-scrutiny attempt', () => {
  let id: string;
  let member: Client;
  let returnedFinding: string;
  let internalFinding: string;
  let snapshotHash: string;

  it('raises findings and returns the case', async () => {
    id = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    snapshotHash = (await view(inst, id)).application.snapshotSha256;
    member = await owner(id);
    const items = current(await view(member, id)).checklist.map((i: any) =>
      i.code === 'LAND_DOCUMENTS' ? { code: i.code, status: 'DEFICIENT', observation: 'Lease deed expired in 2025' } : { code: i.code, status: 'SATISFIED' });
    expect((await member.command(id, 'SAVE_CHECKLIST', { items })).statusCode).toBe(200);

    // Returning needs an institution-visible finding first.
    const early = await member.command(id, 'RETURN_TO_INSTITUTION', { reason: 'Documents missing for land', responseDueNote: 'Demo: 15 days' });
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('NO_FINDING_TO_RETURN');

    const f1 = await member.command(id, 'RAISE_FINDING', {
      checklistCode: 'LAND_DOCUMENTS', reasonCode: 'MISSING_DOCUMENT', explanation: 'Upload a registered lease deed valid for the cycle.',
      requestedEvidence: 'Registered lease deed', visibility: 'INSTITUTION', requestsAmendment: true,
    });
    expect(f1.statusCode, f1.body).toBe(200);
    returnedFinding = f1.json().result.findingId;
    const f2 = await member.command(id, 'RAISE_FINDING', { reasonCode: 'CLARIFICATION', explanation: 'Check land records with the state portal (internal).', visibility: 'INTERNAL' });
    internalFinding = f2.json().result.findingId;

    const ret = await member.command(id, 'RETURN_TO_INSTITUTION', { reason: 'Land documents are not on record', responseDueNote: 'Demo: respond within 15 days' });
    expect(ret.statusCode, ret.body).toBe(200);
    const v = await view(ro, id);
    expect(current(v).state).toBe('AWAITING_RESPONSE');
    expect(v.actionPanel.responsible.role).toBe('Institution representative');
    // The internal finding was not sent.
    expect(v.findings.find((f: any) => f.id === internalFinding).state).toBe('OPEN');
    expect(v.findings.find((f: any) => f.id === returnedFinding).state).toBe('RESPONSE_PENDING');
  });

  it('hides internal findings from the institution', async () => {
    const v = await view(inst, id);
    expect(v.findings.map((f: any) => f.id)).toEqual([returnedFinding]);
  });

  it('another institution cannot respond (404)', async () => {
    const other = await signIn(app, 'inst.north@demo.aicte.test');
    const res = await other.post(`/api/v1/applications/${id}/commands`, { command: 'RESPOND_TO_FINDING', expectedVersion: 1, findingId: returnedFinding, text: 'Not my case at all, really.' });
    expect(res.statusCode).toBe(404);
  });

  it('W05 an amendment is a linked record and the snapshot is unchanged', async () => {
    const res = await inst.command(id, 'REQUEST_AMENDMENT', {
      findingId: returnedFinding, changes: { campusAddress: '14 Demo Road, Hinjawadi, Pune (corrected)' }, note: 'Corrected campus address as per the new lease deed.',
    });
    expect(res.statusCode, res.body).toBe(200);
    const v = await view(inst, id);
    expect(v.application.snapshotSha256).toBe(snapshotHash);
    expect(v.form.campusAddress).toBe('12 Demo Road, Hinjawadi, Pune');
    expect(v.amendments).toHaveLength(1);
    expect(v.amendments[0].changes.campusAddress.to).toContain('corrected');
  });

  it('answering every returned finding closes the attempt and opens attempt 2 for the same owner', async () => {
    const ownerEmail = (await q(getPool(), `SELECT u.email FROM stage_instances s JOIN users u ON u.id = s.assignee_user_id WHERE s.application_id = $1`, [id]))[0].email;
    const res = await inst.command(id, 'RESPOND_TO_FINDING', { findingId: returnedFinding, text: 'A registered lease deed valid to 2030 is now on record.' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().result.reopened).toBe(true);
    const v = await view(ro, id);
    const attempts = v.stages.filter((s: any) => s.stageKey === 'SCRUTINY');
    expect(attempts.map((s: any) => s.attemptNo)).toEqual([1, 2]);
    expect(attempts[0].state).toBe('COMPLETED');
    expect(attempts[0].outcome).toBe('RETURNED');
    // The first attempt's checklist is preserved as recorded.
    expect(attempts[0].checklist.find((i: any) => i.code === 'LAND_DOCUMENTS').status).toBe('DEFICIENT');
    // The new attempt carries results over; the deficient item is pending again with the earlier observation.
    const land = attempts[1].checklist.find((i: any) => i.code === 'LAND_DOCUMENTS');
    expect(land.status).toBe('PENDING');
    expect(land.observation).toContain('Previous attempt');
    expect(attempts[1].checklist.find((i: any) => i.code === 'AFFIDAVIT').status).toBe('SATISFIED');
    expect(attempts[1].assignee.name).toBe((await q(getPool(), 'SELECT name FROM users WHERE email = $1', [ownerEmail]))[0].name);
    expect(v.findings.find((f: any) => f.id === returnedFinding).state).toBe('RESPONSE_SUBMITTED');
  });

  it('cannot complete until findings are reviewed, then completes', async () => {
    member = await owner(id);
    await satisfyChecklist(member, id);
    await member.command(id, 'RECORD_RECOMMENDATION', { recommendation: 'RECOMMEND_REJECTION', text: 'Land title remains doubtful after the response.' });
    const blocked = await member.command(id, 'COMPLETE_STAGE', {});
    expect(blocked.statusCode).toBe(422);
    expect(JSON.stringify(blocked.json().error.details)).toContain('finding');
    expect((await member.command(id, 'REJECT_FINDING_RESPONSE', { findingId: returnedFinding, note: 'Lease deed is not registered.' })).statusCode).toBe(200);
    expect((await member.command(id, 'RESOLVE_FINDING', { findingId: internalFinding, note: 'Checked on the state portal.' })).statusCode).toBe(200);
    const done = await member.command(id, 'COMPLETE_STAGE', {});
    expect(done.statusCode, done.body).toBe(200);
    expect(current(await view(ro, id)).stageKey).toBe('DECISION');
  });

  it('W07 an appeal creates a linked workflow and never changes the original decision', async () => {
    await decide(id, 'REJECTED');
    const original = (await q(getPool(), 'SELECT * FROM decisions WHERE application_id = $1', [id]))[0];
    const res = await inst.command(id, 'FILE_APPEAL', { grounds: 'The lease deed was registered on time; the registration receipt is attached.' });
    expect(res.statusCode, res.body).toBe(200);
    const v = await view(inst, id);
    expect(v.workflow.kind).toBe('APPEAL');
    expect(v.workflow.routeKey).toBe('APPEAL_SAC');
    expect(v.workflows).toHaveLength(2);
    expect(v.workflows[1].appealOfDecisionId).toBe(original.id);
    expect(v.workflows[0].decision.outcome).toBe('REJECTED');
    expect(current(await view(ro, id)).stageKey).toBe('SAC_REVIEW');

    // Second appeal of the same decision is refused.
    const again = await inst.command(id, 'FILE_APPEAL', { grounds: 'Trying to appeal a second time with the same grounds.' });
    expect(again.statusCode).toBe(409);

    // SAC is a committee stage owned by a SAC member; it may not return the case (allowReturn: false).
    const sac = await owner(id);
    expect((await sac.get('/api/v1/me')).json().user.email).toBe('sac1@demo.aicte.test');
    await sac.command(id, 'RAISE_FINDING', { reasonCode: 'CLARIFICATION', explanation: 'Please confirm the registration date.', visibility: 'INSTITUTION' });
    const ret = await sac.command(id, 'RETURN_TO_INSTITUTION', { reason: 'Need the date of registration', responseDueNote: 'Demo: 7 days' });
    expect(ret.statusCode).toBe(409);
    expect(ret.json().error.code).toBe('RETURN_NOT_ALLOWED');
    const fid = (await view(sac, id)).findings.find((f: any) => f.state === 'OPEN').id;
    await sac.command(id, 'RESOLVE_FINDING', { findingId: fid, note: 'Date confirmed from the receipt on record.' });
    await sac.command(id, 'RECORD_RECOMMENDATION', { recommendation: 'RECOMMEND_APPROVAL', text: 'Registration was timely; allow the appeal.' });
    expect((await sac.command(id, 'COMPLETE_STAGE', {})).statusCode).toBe(200);
    await decide(id, 'APPROVED');

    const decisions = await q(getPool(), 'SELECT id, outcome, reason FROM decisions WHERE application_id = $1 ORDER BY issued_at, id', [id]);
    expect(decisions).toHaveLength(2);
    const still = decisions.find((d) => d.id === original.id)!;
    expect(still.outcome).toBe('REJECTED');
    expect(still.reason).toBe(original.reason);
    const after = await view(inst, id);
    expect(after.application.decisionOutcome).toBe('APPROVED');
    // An appeal decision cannot itself be appealed here.
    expect(after.permittedCommands.find((p: any) => p.command === 'FILE_APPEAL').allowed).toBe(false);
  });
});

describe('W01 route fixtures', () => {
  it('Only Scrutiny reaches the decision', async () => {
    const id = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    expect((await view(ro, id)).workflow.routeKey).toBe('SCRUTINY_ONLY');
    await finishScrutiny(id);
    expect(current(await view(ro, id)).stageKey).toBe('DECISION');
  });

  it('Scrutiny + EVC stops at the EVC stage until a visit report is accepted (M4)', async () => {
    const id = await createAndSubmit(inst, 'NEW_INSTITUTION');
    expect((await view(ro, id)).workflow.routeKey).toBe('SCRUTINY_EVC');
    await finishScrutiny(id);
    const v = await view(ro, id);
    expect(current(v).stageKey).toBe('EVC');
    expect(v.actionPanel.blockers.join(' ')).toContain('EVC visit report');
  });

  it('a large intake increase takes the conditional EVC route', async () => {
    const id = await createAndSubmit(inst, 'INCREASE_IN_INTAKE', { intakeIncreasePercent: 60 });
    const v = await view(ro, id);
    expect(v.workflow.routeKey).toBe('SCRUTINY_EVC');
    expect(v.workflow.classification.matchedRuleId).toBe('intake-large');
  });

  it('Only EVC starts at the EVC stage owned by the regional officer', async () => {
    const id = await createAndSubmit(inst, 'CHANGE_OF_SITE', { proposedSiteAddress: 'Plot 9, Demo Industrial Area, Pune' });
    const v = await view(ro, id);
    expect(v.workflow.routeKey).toBe('ONLY_EVC');
    expect(current(v).stageKey).toBe('EVC');
    expect(current(v).ownerRole).toBe('REGIONAL_OFFICER');
    const blocked = await ro.command(id, 'COMPLETE_STAGE', {});
    expect(blocked.statusCode).toBe(422);
  });

  for (const routeKey of ['EVC_SAC', 'EVC_SHC']) {
    it(`${routeKey} is reachable by manual classification and stops at EVC`, async () => {
      const id = await createAndSubmit(inst, 'OTHER_REQUEST');
      const res = await ro.command(id, 'CLASSIFY', { routeKey, reason: 'Request concerns a matter the committee must review.' });
      expect(res.statusCode, res.body).toBe(200);
      const v = await view(ro, id);
      expect(v.workflow.routeKey).toBe(routeKey);
      expect(current(v).stageKey).toBe('EVC');
      expect(v.workflow.routeProgress.map((s: any) => s.stageKey)).toEqual(['EVC', routeKey === 'EVC_SAC' ? 'SAC_REVIEW' : 'SHC_HEARING', 'DECISION']);
    });
  }
});

describe('W02 manual classification', () => {
  it('a no-match case waits; only an in-scope officer can classify it with a reason', async () => {
    const id = await createAndSubmit(inst, 'OTHER_REQUEST');
    let v = await view(ro, id);
    expect(v.application.lifecycleState).toBe('AWAITING_CLASSIFICATION');
    expect(v.availableRoutes.length).toBeGreaterThanOrEqual(5);

    const roNorth = await signIn(app, 'ro.north@demo.aicte.test');
    expect((await roNorth.post(`/api/v1/applications/${id}/commands`, { command: 'CLASSIFY', expectedVersion: 1, routeKey: 'SCRUTINY_ONLY', reason: 'Out of region attempt' })).statusCode).toBe(404);
    expect((await inst.command(id, 'CLASSIFY', { routeKey: 'SCRUTINY_ONLY', reason: 'Institution choosing its own route' })).statusCode).toBe(403);
    expect((await ro.command(id, 'CLASSIFY', { routeKey: 'NO_SUCH_ROUTE', reason: 'Testing an unknown route key' })).statusCode).toBe(422);
    expect((await ro.command(id, 'CLASSIFY', { routeKey: 'SCRUTINY_ONLY', reason: 'short' })).statusCode).toBe(422);

    const ok = await ro.command(id, 'CLASSIFY', { routeKey: 'SCRUTINY_ONLY', reason: 'Minor request; scrutiny alone is sufficient.' });
    expect(ok.statusCode, ok.body).toBe(200);
    v = await view(ro, id);
    expect(v.application.lifecycleState).toBe('IN_PROCESS');
    expect(current(v).stageKey).toBe('SCRUTINY');
    expect(v.workflow.classification.manual.reason).toContain('Minor request');
    expect(await count(`SELECT count(*) AS n FROM audit_events WHERE application_id = $1 AND action = 'ROUTE_SELECTED_MANUALLY'`, [id])).toBe(1);
    // Classifying again is refused.
    expect((await ro.command(id, 'CLASSIFY', { routeKey: 'ONLY_EVC', reason: 'Change of mind after starting' })).statusCode).toBe(409);
  });
});

describe('audit chain after M2 commands', () => {
  it('stays intact', async () => {
    const r = await verifyChain(getPool());
    expect(r.ok).toBe(true);
  });
});
