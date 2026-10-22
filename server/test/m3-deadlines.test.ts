import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { closePool, getPool, one, q, withTx } from '../src/db.js';
import { setTestNow } from '../src/lib/clock.js';
import { extendDueDateByWorkingDays, ladderStepAt } from '../src/modules/deadlines/calendar.js';
import { scanDeadlines } from '../src/modules/deadlines/scheduler.js';
import { OutboxEmailAdapter } from '../src/modules/notifications/email.js';
import { notify } from '../src/modules/notifications/service.js';
import { deliverEmails, processOutbox } from '../src/modules/notifications/worker.js';
import { runTick, setEmailAdapter } from '../src/worker/tick.js';
import { Client, createAndSubmit, resetDatabase, satisfyChecklist, signIn, startApp, TEST_NOW } from './helpers.js';

// D02 (valid-through expiry) and D03 (leap day, month end, holidays) are covered by calendar.test.ts.

const TZ = 'Asia/Kolkata';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let app: FastifyInstance;
let inst: Client;
let ro: Client;
let authority: Client;
let admin: Client;
let outboxDir: string;
let adapter: OutboxEmailAdapter;
const demoMode = config.demoMode;

beforeAll(async () => {
  await resetDatabase();
  (config as { demoMode: boolean }).demoMode = true;
  outboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'outbox-test-'));
  adapter = new OutboxEmailAdapter({
    dir: outboxDir, from: 'Test <no-reply@demo.aicte.test>',
    transientFailureDomains: ['flaky.demo.test'], permanentFailureDomains: ['bounce.demo.test'],
  });
  setEmailAdapter(adapter);
  app = await startApp();
  inst = await signIn(app, 'inst.west@demo.aicte.test');
  ro = await signIn(app, 'ro.west@demo.aicte.test');
  authority = await signIn(app, 'authority@demo.aicte.test');
  admin = await signIn(app, 'admin@demo.aicte.test');
});

beforeEach(() => setTestNow(TEST_NOW));

afterAll(async () => {
  (config as { demoMode: boolean }).demoMode = demoMode;
  setEmailAdapter(null);
  await app.close();
  await closePool();
  await fs.rm(outboxDir, { recursive: true, force: true });
});

const view = async (c: Client, id: string) => (await c.get(`/api/v1/applications/${id}`)).json();
const stageClock = (v: any) => v.deadlines.find((d: any) => d.clockType === 'STAGE_HANDLING' && ['ACTIVE', 'PAUSED'].includes(d.state));
const stepAt = (dueDate: string, offset: number) => ladderStepAt(dueDate, offset, TZ);
const alerts = (deadlineId: string, extra = '') =>
  q(getPool(), `SELECT * FROM alert_events WHERE deadline_id = $1 ${extra} ORDER BY step_at, created_at`, [deadlineId]);

async function owner(appId: string) {
  const rows = await q(getPool(),
    `SELECT u.email FROM applications a JOIN workflow_instances w ON w.id = a.current_workflow_id
       JOIN stage_instances s ON s.id = w.current_stage_id JOIN users u ON u.id = s.assignee_user_id WHERE a.id = $1`, [appId]);
  return signIn(app, rows[0].email);
}

describe('Deadlines on stages', () => {
  it('a stage clock is set from the pinned policy with an explanation', async () => {
    const id = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    const v = await view(ro, id);
    const d = stageClock(v);
    // Monday 2 Nov 2026 + 10 working days, counting from the next day → Monday 16 Nov.
    expect(d.originalDueDate).toBe('2026-11-16');
    expect(d.explanation).toContain('10 working days');
    expect(d.provenance).toBe('DEMO_ASSUMPTION');
    expect(v.actionPanel.due.dueDate).toBe('2026-11-16');
    // The institution sees the clock too (alerts are internal).
    const iv = await view(inst, id);
    expect(stageClock(iv).currentDueDate).toBe('2026-11-16');
    expect(stageClock(iv).alerts).toEqual([]);
  });

  it('D01 a reminder fires once its local-time threshold is crossed, within the scan tolerance', async () => {
    const id = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    const d = stageClock(await view(ro, id));
    const at = stepAt(d.currentDueDate, -7);
    expect(at.toISOString()).toBe('2026-11-08T18:30:00.000Z'); // start of 9 Nov in India

    setTestNow(new Date(at.getTime() - MIN));
    await runTick();
    expect(await alerts(d.id)).toHaveLength(0);

    setTestNow(new Date(at.getTime() + 30_000));
    const r = await runTick();
    const created = await alerts(d.id, `AND state = 'CREATED' AND channel = 'IN_APP'`);
    expect(created).toHaveLength(1);
    expect(created[0].step_id).toBe('REMIND_7');
    expect(r.delivery.accepted).toBeGreaterThanOrEqual(1);
    const member = await owner(id);
    const list = (await member.get('/api/v1/notifications?filter=deadlines')).json();
    expect(list.items.some((n: any) => n.applicationId === id && n.title.startsWith('Reminder') && n.email.state === 'ACCEPTED')).toBe(true);
    // The email links to the case and carries no attachment.
    const files = await adapter.list();
    const raw = await adapter.read(files.find((f) => f.includes('n-'))!);
    expect(raw).toContain('/applications/');
  });

  it('D06 after downtime only the current step is sent; earlier ones are recorded as missed', async () => {
    const id = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    const d = stageClock(await view(ro, id));
    setTestNow(new Date(stepAt(d.currentDueDate, 3).getTime() + HOUR));
    await scanDeadlines(new Date(stepAt(d.currentDueDate, 3).getTime() + HOUR));
    const created = await alerts(d.id, `AND state = 'CREATED' AND channel = 'IN_APP'`);
    expect(created.map((a) => a.step_id)).toEqual(['ESCALATE_SUPERVISOR']);
    const missed = await alerts(d.id, `AND state = 'MISSED'`);
    expect(missed.map((a) => a.step_id)).toEqual(['REMIND_7', 'REMIND_1', 'OVERDUE', 'ESCALATE_OFFICER']);
    const bureau = await signIn(app, 'bureau@demo.aicte.test');
    const n = (await bureau.get('/api/v1/notifications?filter=escalations')).json();
    expect(n.items.filter((x: any) => x.applicationId === id)).toHaveLength(1);
    expect((await q(getPool(), `SELECT 1 FROM audit_events WHERE entity_id = $1 AND action = 'ESCALATION_RAISED'`, [d.id])).length).toBe(1);
    // Escalation only notifies: the case is unchanged.
    expect((await view(ro, id)).application.lifecycleState).toBe('IN_PROCESS');
  });

  it('N01 two schedulers scanning at once produce one alert per recipient', async () => {
    const id = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    const d = stageClock(await view(ro, id));
    const at = new Date(stepAt(d.currentDueDate, -7).getTime() + MIN);
    await Promise.all([scanDeadlines(at), scanDeadlines(at), scanDeadlines(at)]);
    expect(await alerts(d.id, `AND channel = 'IN_APP'`)).toHaveLength(1);
    expect(await alerts(d.id, `AND channel = 'EMAIL'`)).toHaveLength(1);
  });

  it('closing the stage closes its clock as met', async () => {
    const id = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    const member = await owner(id);
    await satisfyChecklist(member, id);
    await member.command(id, 'RECORD_RECOMMENDATION', { recommendation: 'RECOMMEND_APPROVAL', text: 'All requirements are met on record.' });
    expect((await member.command(id, 'COMPLETE_STAGE', {})).statusCode).toBe(200);
    const v = await view(ro, id);
    const scrutiny = v.deadlines.find((x: any) => x.stageKey === 'SCRUTINY');
    expect(scrutiny.state).toBe('MET');
    expect(scrutiny.metLate).toBe(false);
    expect(stageClock(v).stageKey).toBe('DECISION');
  });
});

describe('D04 returns pause only clocks that allow it', () => {
  it('scrutiny pauses on return and resumes with the lost working days added', async () => {
    const id = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    const member = await owner(id);
    const original = stageClock(await view(ro, id));
    await member.command(id, 'RAISE_FINDING', { reasonCode: 'MISSING_DOCUMENT', explanation: 'Upload the registered lease deed.', visibility: 'INSTITUTION' });
    await member.command(id, 'RETURN_TO_INSTITUTION', { reason: 'Lease deed is missing', responseDueNote: 'Policy institution response clock' });
    let v = await view(ro, id);
    const paused = v.deadlines.find((x: any) => x.id === original.id);
    expect(paused.state).toBe('PAUSED');
    const response = v.deadlines.find((x: any) => x.clockType === 'INSTITUTION_RESPONSE');
    expect(response.state).toBe('ACTIVE');
    expect(v.actionPanel.due.deadlineId).toBe(response.id);

    // The institution answers three days later (Monday → Thursday: 2, 3 and 4 Nov are lost working days).
    setTestNow(new Date(TEST_NOW.getTime() + 3 * DAY));
    const fid = (await view(inst, id)).findings[0].id;
    expect((await inst.command(id, 'RESPOND_TO_FINDING', { findingId: fid, text: 'The registered lease deed is now on record.' })).statusCode).toBe(200);
    v = await view(ro, id);
    const resumed = v.deadlines.find((x: any) => x.id === original.id);
    expect(resumed.state).toBe('ACTIVE');
    expect(resumed.generation).toBe(2);
    expect(resumed.pauses[0].daysLost).toBe(3);
    expect(resumed.originalDueDate).toBe(original.originalDueDate);
    expect(resumed.currentDueDate).toBe(extendDueDateByWorkingDays(original.currentDueDate, 3, { timezone: TZ, weekendDays: [0, 6], holidays: [] }));
    expect(v.deadlines.find((x: any) => x.id === response.id).state).toBe('MET');
    // The clock now belongs to the new attempt.
    const row = await one(getPool(), 'SELECT subject_id FROM deadlines WHERE id = $1', [original.id]);
    expect(row.subject_id).toBe(v.currentStageId);
  });

  it('the EVC clock keeps running when the case is returned', async () => {
    const id = await createAndSubmit(inst, 'CHANGE_OF_SITE', { proposedSiteAddress: 'Plot 9, Demo Industrial Area, Pune' });
    const clock = stageClock(await view(ro, id));
    expect(clock.stageKey).toBe('EVC');
    await ro.command(id, 'RAISE_FINDING', { reasonCode: 'CLARIFICATION', explanation: 'Confirm the survey number of the new site.', visibility: 'INSTITUTION' });
    expect((await ro.command(id, 'RETURN_TO_INSTITUTION', { reason: 'Site details unclear', responseDueNote: 'Policy institution response clock' })).statusCode).toBe(200);
    const after = (await view(ro, id)).deadlines.find((x: any) => x.id === clock.id);
    expect(after.state).toBe('ACTIVE');
    expect(after.currentDueDate).toBe(clock.currentDueDate);
    expect((await q(getPool(), `SELECT 1 FROM audit_events WHERE entity_id = $1 AND action = 'DEADLINE_CONTINUES'`, [clock.id])).length).toBe(1);
  });
});

describe('D05 extension', () => {
  it('keeps the original date, starts a new generation and cancels stale pending reminders', async () => {
    const id = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    const d = stageClock(await view(ro, id));
    const at = new Date(stepAt(d.currentDueDate, -7).getTime() + MIN);
    await scanDeadlines(at); // reminder email written but not yet sent
    const pending = await one(getPool(),
      `SELECT dl.* FROM deliveries dl JOIN alert_events e ON e.id = dl.alert_event_id WHERE e.deadline_id = $1`, [d.id]);
    expect(pending.state).toBe('PENDING');

    setTestNow(at);
    const member = await owner(id);
    expect((await member.command(id, 'EXTEND_DEADLINE', { deadlineId: d.id, newDueDate: '2026-11-30', reason: 'Committee meeting postponed' })).statusCode).toBe(403);
    expect((await authority.command(id, 'EXTEND_DEADLINE', { deadlineId: d.id, newDueDate: '2026-11-10', reason: 'Earlier date is not allowed' })).statusCode).toBe(422);
    const res = await authority.command(id, 'EXTEND_DEADLINE', { deadlineId: d.id, newDueDate: '2026-11-30', reason: 'Committee meeting postponed by the bureau' });
    expect(res.statusCode, res.body).toBe(200);

    const after = (await view(ro, id)).deadlines.find((x: any) => x.id === d.id);
    expect(after.originalDueDate).toBe('2026-11-16');
    expect(after.currentDueDate).toBe('2026-11-30');
    expect(after.generation).toBe(2);
    expect(after.adjustments).toHaveLength(1);
    expect(after.adjustments[0].kind).toBe('EXTENSION');

    await deliverEmails(adapter, at, 'test-worker');
    const stale = await one(getPool(), 'SELECT state FROM deliveries WHERE id = $1', [pending.id]);
    expect(stale.state).toBe('CANCELLED');
  });
});

describe('Email delivery', () => {
  let userId: string | null = null;
  async function newDelivery(email: string) {
    userId ??= (await one(getPool(), 'SELECT id FROM users WHERE email = $1', ['inst.south@demo.aicte.test'])).id;
    const user = { id: userId! };
    await getPool().query('UPDATE users SET email = $2 WHERE id = $1', [user.id, email]);
    const at = TEST_NOW;
    const nid = await withTx((tx) => notify(tx, at, { userId: user.id, kind: 'TEST', title: 'Test message', body: 'Synthetic test body', email: true }));
    return one(getPool(), 'SELECT * FROM deliveries WHERE notification_id = $1', [nid]);
  }

  it('N02 a claim whose worker died is recovered after the lease expires', async () => {
    const d = await newDelivery('n02@demo.aicte.test');
    await getPool().query(`UPDATE deliveries SET state = 'SENDING', attempts = 1, lease_until = $2, locked_by = 'dead-worker' WHERE id = $1`, [d.id, new Date(TEST_NOW.getTime() - MIN)]);
    const r = await deliverEmails(adapter, TEST_NOW, 'worker-2');
    expect(r.claimed).toBeGreaterThanOrEqual(1);
    expect((await one(getPool(), 'SELECT state, attempts FROM deliveries WHERE id = $1', [d.id])).state).toBe('ACCEPTED');
  });

  it('N03 a worker that died after sending does not produce a second message', async () => {
    const d = await newDelivery('n03@demo.aicte.test');
    await deliverEmails(adapter, TEST_NOW, 'worker-1');
    // The acknowledgement was lost: the row still looks in flight with an expired lease.
    await getPool().query(`UPDATE deliveries SET state = 'SENDING', lease_until = $2, locked_by = 'worker-1' WHERE id = $1`, [d.id, new Date(TEST_NOW.getTime() - MIN)]);
    await deliverEmails(adapter, new Date(TEST_NOW.getTime() + MIN), 'worker-2');
    const row = await one(getPool(), 'SELECT state, duplicate_suppressed FROM deliveries WHERE id = $1', [d.id]);
    expect(row.state).toBe('ACCEPTED');
    expect(row.duplicate_suppressed).toBe(true);
    expect((await adapter.list(500)).filter((f) => f.startsWith(d.message_id))).toHaveLength(1);
  });

  it('N04 a permanent bounce is visible and not retried; a temporary failure is retried with backoff', async () => {
    const bounce = await newDelivery('nobody@bounce.demo.test');
    await deliverEmails(adapter, TEST_NOW, 'worker-1');
    expect((await one(getPool(), 'SELECT state, attempts FROM deliveries WHERE id = $1', [bounce.id])).state).toBe('BOUNCED');
    const health = (await admin.get('/api/v1/ops/health')).json();
    expect(health.deliveries.failed).toBeGreaterThanOrEqual(1);
    expect((await admin.post(`/api/v1/ops/deliveries/${bounce.id}/retry`, {})).statusCode).toBe(409);

    const flaky = await newDelivery('someone@flaky.demo.test');
    let at = TEST_NOW;
    const states: string[] = [];
    for (let i = 0; i < 3; i++) {
      await deliverEmails(adapter, at, 'worker-1');
      const row = await one(getPool(), 'SELECT state, next_attempt_at FROM deliveries WHERE id = $1', [flaky.id]);
      states.push(row.state);
      at = new Date(new Date(row.next_attempt_at).getTime() + MIN);
    }
    expect(states).toEqual(['RETRYING', 'RETRYING', 'ACCEPTED']);
    expect((await q(getPool(), 'SELECT outcome FROM delivery_attempts WHERE delivery_id = $1 ORDER BY id', [flaky.id])).map((x) => x.outcome))
      .toEqual(['FAILED_RETRY', 'FAILED_RETRY', 'ACCEPTED']);
  });
});

describe('Notifications', () => {
  it('outbox events become notifications; read and acknowledge do not change the case', async () => {
    const id = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    const member = await owner(id);
    await member.command(id, 'RAISE_FINDING', { reasonCode: 'CLARIFICATION', explanation: 'Clarify the faculty count for 2027-28.', visibility: 'INSTITUTION' });
    await member.command(id, 'RETURN_TO_INSTITUTION', { reason: 'Faculty count unclear', responseDueNote: 'Policy institution response clock' });
    await processOutbox(TEST_NOW);
    const list = (await inst.get('/api/v1/notifications?filter=unread')).json();
    const n = list.items.find((x: any) => x.applicationId === id && x.kind === 'CASE_RETURNED');
    expect(n).toBeTruthy();
    expect(list.unreadCount).toBeGreaterThanOrEqual(1);
    // Processing again does not duplicate.
    await getPool().query(`UPDATE outbox_events SET state = 'PENDING' WHERE event_type = 'CASE_RETURNED'`);
    await processOutbox(TEST_NOW);
    const again = (await inst.get('/api/v1/notifications')).json();
    expect(again.items.filter((x: any) => x.applicationId === id && x.kind === 'CASE_RETURNED')).toHaveLength(1);

    expect((await inst.post(`/api/v1/notifications/${n.id}/acknowledge`, {})).statusCode).toBe(200);
    const after = (await inst.get('/api/v1/notifications')).json().items.find((x: any) => x.id === n.id);
    expect(after.readAt).toBeTruthy();
    expect(after.acknowledgedAt).toBeTruthy();
    expect((await view(inst, id)).stages.find((s: any) => s.state === 'AWAITING_RESPONSE')).toBeTruthy();
    // Someone else's notification is not found.
    expect((await ro.post(`/api/v1/notifications/${n.id}/read`, {})).statusCode).toBe(404);
  });
});

describe('Demo clock and operations', () => {
  it('only the administrator moves the demo clock, and it is audited', async () => {
    expect((await ro.post('/api/v1/ops/clock', { action: 'advance', days: 1 })).statusCode).toBe(403);
    const res = await admin.post('/api/v1/ops/clock', { action: 'advance', days: 2 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().offsetDays).toBe(2);
    expect((await q(getPool(), `SELECT 1 FROM audit_events WHERE action = 'DEMO_CLOCK_CHANGED'`)).length).toBe(1);
    expect((await admin.post('/api/v1/ops/clock', { action: 'reset' })).json().offsetMs).toBe(0);
    expect((await ro.get('/api/v1/ops/health')).statusCode).toBe(403);
  });

  it('a manual tick runs the background work in demo mode only', async () => {
    expect((await admin.post('/api/v1/ops/tick', {})).statusCode).toBe(200);
    (config as { demoMode: boolean }).demoMode = false;
    expect((await admin.post('/api/v1/ops/tick', {})).statusCode).toBe(404);
    (config as { demoMode: boolean }).demoMode = true;
  });
});
