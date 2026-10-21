import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool, q, withTx } from '../src/db.js';
import { actorFromToken } from '../src/modules/identity/auth.js';
import { executeCommand } from '../src/modules/applications/commands.js';
import { verifyChain } from '../src/modules/audit/audit.js';
import { now } from '../src/lib/clock.js';
import { Client, COMPLETE_FORM, count, createAndSubmit, key, resetDatabase, satisfyChecklist, signIn, startApp } from './helpers.js';

let app: FastifyInstance;
let inst: Client;
let scrutiny: Client;
let authority: Client;

beforeAll(async () => {
  await resetDatabase();
  app = await startApp();
  inst = await signIn(app, 'inst.west@demo.aicte.test');
  // Two scrutiny members exist in Demo West; least-loaded assignment picks by load then name.
  scrutiny = await signIn(app, 'scrutiny.west1@demo.aicte.test');
  authority = await signIn(app, 'authority@demo.aicte.test');
});

afterAll(async () => {
  await app.close();
  await closePool();
});

async function assignedScrutinyClient(appId: string): Promise<Client> {
  const ro = await signIn(app, 'ro.west@demo.aicte.test');
  const view = (await ro.get(`/api/v1/applications/${appId}`)).json();
  const scrutinyStage = view.stages.filter((s: any) => s.kind === 'SCRUTINY').at(-1);
  const email = scrutinyStage.assignee.name.includes('Joshi') ? 'scrutiny.west1@demo.aicte.test' : 'scrutiny.west2@demo.aicte.test';
  return signIn(app, email);
}

describe('M1 complete journey: Only Scrutiny route', () => {
  let appId: string;

  it('creates a draft, reports missing items, and submits once complete', async () => {
    const created = await inst.post('/api/v1/applications', {
      cycleCode: '2027-28', categoryCode: 'EXTENSION_OF_APPROVAL', details: {}, draftData: { remarks: 'draft' },
    });
    expect(created.statusCode).toBe(200);
    appId = created.json().id;

    const early = await inst.post(`/api/v1/applications/${appId}/submit`, { expectedVersion: 1 });
    expect(early.statusCode).toBe(422);
    expect(early.json().error.details.map((d: any) => d.field)).toEqual(
      expect.arrayContaining(['campusAddress', 'landAreaAcres', 'programmes', 'declarationAccepted']),
    );

    const saved = await inst.put(`/api/v1/applications/${appId}/draft`, { expectedVersion: 1, draftData: COMPLETE_FORM });
    expect(saved.statusCode).toBe(200);
    const submitted = await inst.post(`/api/v1/applications/${appId}/submit`, { expectedVersion: saved.json().rowVersion });
    expect(submitted.statusCode).toBe(200);
  });

  it('selects the configured route and explains which rule chose it', async () => {
    const view = (await inst.get(`/api/v1/applications/${appId}`)).json();
    expect(view.application.lifecycleState).toBe('IN_PROCESS');
    expect(view.workflow.routeKey).toBe('SCRUTINY_ONLY');
    expect(view.workflow.classification.matchedRuleId).toBe('extension');
    expect(view.workflow.classification.ruleRef).toBe('policy v1 · classification/extension');
    expect(view.workflow.policyVersion.versionNo).toBe(1);
    expect(view.workflow.routeProgress.map((r: any) => r.stageKey)).toEqual(['SCRUTINY', 'DECISION']);
    expect(view.application.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses stage completion until the configured conditions are met, without partial changes (W03)', async () => {
    const member = await assignedScrutinyClient(appId);
    const before = (await member.get(`/api/v1/applications/${appId}`)).json();
    const res = await member.command(appId, 'COMPLETE_STAGE');
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('COMPLETION_CONDITIONS_NOT_MET');
    const conditions = res.json().error.details.map((d: any) => d.condition);
    expect(conditions).toEqual(expect.arrayContaining(['CHECKLIST_COMPLETE', 'RECOMMENDATION_RECORDED']));
    const after = (await member.get(`/api/v1/applications/${appId}`)).json();
    expect(after.application.rowVersion).toBe(before.application.rowVersion);
    expect(after.currentStageId).toBe(before.currentStageId);
  });

  it('completes scrutiny through authorised actions and moves to the decision stage', async () => {
    const member = await assignedScrutinyClient(appId);
    expect((await satisfyChecklist(member, appId)).statusCode).toBe(200);
    const rec = await member.command(appId, 'RECORD_RECOMMENDATION', {
      recommendation: 'RECOMMEND_APPROVAL', text: 'All checklist items verified against submitted records.',
    });
    expect(rec.statusCode).toBe(200);
    const done = await member.command(appId, 'COMPLETE_STAGE', { note: 'Scrutiny complete' });
    expect(done.statusCode).toBe(200);
    expect(done.json().result.nextStageKey).toBe('DECISION');

    const view = (await authority.get(`/api/v1/applications/${appId}`)).json();
    expect(view.application.lifecycleState).toBe('AWAITING_DECISION');
    expect(view.actionPanel.requiresHumanDecision).toBe(true);
    expect(view.permittedCommands.find((p: any) => p.command === 'RECORD_DECISION').allowed).toBe(true);
  });

  it('a recommendation does not decide the case; only the competent authority records the decision (W06)', async () => {
    const member = await assignedScrutinyClient(appId);
    const blocked = await member.command(appId, 'RECORD_DECISION', { outcome: 'APPROVED', reason: 'Trying to decide as a member' });
    expect(blocked.statusCode).toBe(403);

    const noConditions = await authority.command(appId, 'RECORD_DECISION', { outcome: 'APPROVED_WITH_CONDITIONS', reason: 'Approve subject to conditions', conditions: [] });
    expect(noConditions.statusCode).toBe(422);

    const decided = await authority.command(appId, 'RECORD_DECISION', {
      outcome: 'APPROVED_WITH_CONDITIONS',
      reason: 'Approved on the basis of scrutiny findings, subject to lease renewal.',
      conditions: [{ text: 'Submit a renewed registered lease deed for the campus land', dueInDays: 90 }],
    });
    expect(decided.statusCode).toBe(200);
    const view = (await inst.get(`/api/v1/applications/${appId}`)).json();
    expect(view.application.lifecycleState).toBe('DECISION_RECORDED');
    expect(view.application.decisionOutcome).toBe('APPROVED_WITH_CONDITIONS');
    // Approval and compliance are separate dimensions.
    expect(view.application.complianceStatus).toBe('OPEN');
    expect(view.decision.conditions).toHaveLength(1);
  });

  it('keeps the submitted snapshot frozen (W05)', async () => {
    const view = (await inst.get(`/api/v1/applications/${appId}`)).json();
    const res = await inst.put(`/api/v1/applications/${appId}/draft`, { expectedVersion: view.application.rowVersion, draftData: { remarks: 'edit after submit' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.code).toBe('SNAPSHOT_FROZEN');
  });

  it('hides internal notes from the institution view', async () => {
    const instView = (await inst.get(`/api/v1/applications/${appId}`)).json();
    expect(instView.recommendations).toEqual([]);
    expect(instView.stages[0].checklist.every((i: any) => i.observation === null)).toBe(true);
    expect(instView.stages[0].assignee).toBeNull();
    const timeline = (await inst.get(`/api/v1/applications/${appId}/timeline`)).json();
    expect(timeline.some((e: any) => e.action === 'RECOMMENDATION_RECORDED')).toBe(false);
    expect(timeline.some((e: any) => e.action === 'DECISION_RECORDED')).toBe(true);
  });

  it('records an audit event for every transition and the hash chain verifies', async () => {
    const transitions = await count('SELECT count(*) AS n FROM transitions WHERE application_id = $1', [appId]);
    expect(transitions).toBeGreaterThanOrEqual(4);
    const kinds = await q(getPool(), 'SELECT DISTINCT action FROM audit_events WHERE application_id = $1', [appId]);
    const actions = kinds.map((k) => k.action);
    for (const a of ['DRAFT_CREATED', 'SUBMITTED', 'ROUTE_SELECTED', 'STAGE_ENTERED', 'CHECKLIST_RECORDED', 'RECOMMENDATION_RECORDED', 'STAGE_COMPLETED', 'DECISION_RECORDED']) {
      expect(actions).toContain(a);
    }
    const outbox = await count(`SELECT count(*) AS n FROM outbox_events WHERE payload->>'applicationId' = $1`, [appId]);
    expect(outbox).toBeGreaterThanOrEqual(3);
    expect((await verifyChain(getPool())).ok).toBe(true);
  });
});

describe('Routing', () => {
  it('chooses a conditional route from proposal details', async () => {
    const small = await createAndSubmit(inst, 'INCREASE_IN_INTAKE', { intakeIncreasePercent: 20 });
    const large = await createAndSubmit(inst, 'INCREASE_IN_INTAKE', { intakeIncreasePercent: 60 });
    const vs = (await inst.get(`/api/v1/applications/${small}`)).json();
    const vl = (await inst.get(`/api/v1/applications/${large}`)).json();
    expect(vs.workflow.routeKey).toBe('SCRUTINY_ONLY');
    expect(vl.workflow.routeKey).toBe('SCRUTINY_EVC');
    expect(vl.workflow.classification.matchedRuleId).toBe('intake-large');
  });

  it('does not guess a route when no rule matches (W02)', async () => {
    const id = await createAndSubmit(inst, 'OTHER_REQUEST');
    const view = (await inst.get(`/api/v1/applications/${id}`)).json();
    expect(view.application.lifecycleState).toBe('AWAITING_CLASSIFICATION');
    expect(view.workflow.classification.status).toBe('NO_MATCH');
    expect(view.stages).toHaveLength(0);
    expect(view.actionPanel.requiresHumanDecision).toBe(true);
  });
});

describe('Concurrency and duplicates', () => {
  it('replays a duplicate command with the same key and performs it once (C01)', async () => {
    const id = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    const member = await assignedScrutinyClient(id);
    const view = (await member.get(`/api/v1/applications/${id}`)).json();
    const current = view.stages.find((s: any) => s.id === view.currentStageId);
    const body = {
      command: 'SAVE_CHECKLIST', expectedVersion: view.application.rowVersion,
      items: current.checklist.map((i: any) => ({ code: i.code, status: 'SATISFIED' })),
    };
    const k = key();
    const first = await member.post(`/api/v1/applications/${id}/commands`, body, k);
    const second = await member.post(`/api/v1/applications/${id}/commands`, body, k);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
    expect(second.json().rowVersion).toBe(first.json().rowVersion);
    const audits = await count(`SELECT count(*) AS n FROM audit_events WHERE application_id = $1 AND action = 'CHECKLIST_RECORDED'`, [id]);
    expect(audits).toBe(1);

    // C02: the same key with a different body is rejected.
    const reused = await member.post(`/api/v1/applications/${id}/commands`, { ...body, items: [{ code: current.checklist[0].code, status: 'PENDING' }] }, k);
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.details.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('rejects a stale version (C03)', async () => {
    const id = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    const member = await assignedScrutinyClient(id);
    const res = await member.post(`/api/v1/applications/${id}/commands`, {
      command: 'RECORD_RECOMMENDATION', expectedVersion: 1, recommendation: 'RECOMMEND_APPROVAL', text: 'Stale attempt from an old screen',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.code).toBe('STALE_VERSION');
  });

  it('lets exactly one of two simultaneous commands on the same version succeed (C03)', async () => {
    const id = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    const member = await assignedScrutinyClient(id);
    const version = (await member.get(`/api/v1/applications/${id}`)).json().application.rowVersion;
    const body = (text: string) => ({ command: 'RECORD_RECOMMENDATION', expectedVersion: version, recommendation: 'RECOMMEND_APPROVAL', text });
    const [a, b] = await Promise.all([
      member.post(`/api/v1/applications/${id}/commands`, body('First reviewer recommendation text')),
      member.post(`/api/v1/applications/${id}/commands`, body('Second reviewer recommendation text')),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(await count('SELECT count(*) AS n FROM recommendations WHERE application_id = $1', [id])).toBe(1);
  });

  it('rolls back stage changes, audit and outbox together when a transaction fails (C04)', async () => {
    const id = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    const member = await assignedScrutinyClient(id);
    await satisfyChecklist(member, id);
    await member.command(id, 'RECORD_RECOMMENDATION', { recommendation: 'RECOMMEND_APPROVAL', text: 'Ready for completion of scrutiny' });
    const before = {
      audit: await count('SELECT count(*) AS n FROM audit_events'),
      outbox: await count('SELECT count(*) AS n FROM outbox_events'),
      stages: await count('SELECT count(*) AS n FROM stage_instances WHERE application_id = $1', [id]),
    };
    const view = (await member.get(`/api/v1/applications/${id}`)).json();
    const actor = await actorFromToken(getPool(), member.sid);
    await expect(
      withTx(async (tx) => {
        await executeCommand(tx, { actor, correlationId: 'test-rollback', at: now() }, id, { command: 'COMPLETE_STAGE', expectedVersion: view.application.rowVersion });
        throw new Error('simulated failure after the stage change');
      }),
    ).rejects.toThrow('simulated failure');
    expect(await count('SELECT count(*) AS n FROM audit_events')).toBe(before.audit);
    expect(await count('SELECT count(*) AS n FROM outbox_events')).toBe(before.outbox);
    expect(await count('SELECT count(*) AS n FROM stage_instances WHERE application_id = $1', [id])).toBe(before.stages);
    const after = (await member.get(`/api/v1/applications/${id}`)).json();
    expect(after.application.rowVersion).toBe(view.application.rowVersion);
  });
});
