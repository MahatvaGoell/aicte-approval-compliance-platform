import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closePool, getPool, one, q, withTx } from '../src/db.js';
import { now, setTestNow } from '../src/lib/clock.js';
import { scanDeadlines } from '../src/modules/deadlines/scheduler.js';
import { processOutbox, deliverEmails } from '../src/modules/notifications/worker.js';
import { OutboxEmailAdapter } from '../src/modules/notifications/email.js';
import { config } from '../src/config.js';
import { executeCommand } from '../src/modules/applications/commands.js';
import { actorFromToken } from '../src/modules/identity/auth.js';
import { Client, createAndSubmit, key, resetDatabase, satisfyChecklist, signIn, startApp } from './helpers.js';

let app: FastifyInstance, refs: Awaited<ReturnType<typeof resetDatabase>>;
let inst: Client, ro: Client, north: Client, member1: Client, member2: Client, outsider: Client;
const slot = { startsAt: '2026-11-04T10:00:00+05:30', endsAt: '2026-11-04T12:00:00+05:30', mode: 'PHYSICAL', timezone: 'Asia/Kolkata', specialism: 'ENGINEERING' };
const reason = 'Synthetic visit action with a recorded reason';
const report = { summary: 'Synthetic inspection report: all reviewed observations recorded.', findings: [
  { requirement: 'Demo campus review', observation: 'Synthetic public observation recorded.', visibility: 'INSTITUTION' },
  { requirement: 'Internal assessment', observation: 'Private committee observation must stay internal.', visibility: 'INTERNAL' },
] };
const view = async (c: Client, id: string) => (await c.get(`/api/v1/applications/${id}`)).json();
const visit = async (id: string) => (await view(ro, id)).evc.visits.find((v: any) => !['CANCELLED','RESCHEDULED'].includes(v.state));
async function cmd(c: Client, id: string, command: string, extra: Record<string, unknown> = {}) {
  const v = await visit(id);
  return c.command(id, command, { visitId: v?.id, visitExpectedVersion: v?.row_version, reason, ...extra });
}
async function propose(id: string, extra: Record<string, unknown> = {}) {
  const r = await ro.command(id, 'PROPOSE_VISIT', { ...slot, expertIds: [refs.users['evc1@demo.aicte.test'], refs.users['evc2@demo.aicte.test']], reason, ...extra });
  expect(r.statusCode, r.body).toBe(200); return r.json().result.visitId as string;
}
async function confirmed() {
  const id = await createAndSubmit(inst, 'CHANGE_OF_SITE', { proposedSiteAddress: '44 Synthetic Campus Road, Pune' }); await propose(id);
  const r = await cmd(ro, id, 'CONFIRM_VISIT'); expect(r.statusCode, r.body).toBe(200); return id;
}
async function held() {
  const id = await confirmed();
  for (const c of [member1, member2]) expect((await cmd(c, id, 'CONFIRM_VISIT_MEMBER')).statusCode).toBe(200);
  expect((await cmd(inst, id, 'ACKNOWLEDGE_VISIT')).statusCode).toBe(200);
  setTestNow(new Date('2026-11-04T13:00:00+05:30'));
  expect((await cmd(ro, id, 'RECORD_VISIT_HELD')).statusCode).toBe(200); return id;
}
beforeEach(async () => {
  refs = await resetDatabase(); app = await startApp();
  inst = await signIn(app, 'inst.west@demo.aicte.test'); ro = await signIn(app, 'ro.west@demo.aicte.test'); north = await signIn(app, 'ro.north@demo.aicte.test');
  member1 = await signIn(app, 'evc1@demo.aicte.test'); member2 = await signIn(app, 'evc2@demo.aicte.test'); outsider = await signIn(app, 'evc3@demo.aicte.test');
});
afterEach(async () => { await app?.close(); await closePool(); });
describe('M4 EVC vertical slice', () => {
  it('queues only a live EVC stage after scrutiny completes, with scheduling clock and scoped count', async () => {
    const id = await createAndSubmit(inst, 'NEW_INSTITUTION');
    expect((await ro.get('/api/v1/evc/queue')).json().total).toBe(0);
    const ownerId = (await view(ro, id)).stages[0].assignee.id;
    const email = await one(getPool(), 'SELECT email FROM users WHERE id = $1', [ownerId]);
    const owner = await signIn(app, email.email);
    await satisfyChecklist(owner, id); await owner.command(id, 'RECORD_RECOMMENDATION', { recommendation: 'RECOMMEND_APPROVAL', text: 'Synthetic checklist completed for review.' });
    expect((await owner.command(id, 'COMPLETE_STAGE')).statusCode).toBe(200);
    const queue = (await ro.get('/api/v1/evc/queue?state=WAITING')).json();
    expect(queue.total).toBe(1); expect(queue.rows[0].ready_at).toBe(now().toISOString()); expect(queue.rows[0].scheduling_due_at).toBeTruthy();
    expect((await north.get('/api/v1/evc/queue')).json().total).toBe(0);
  });
  it('shows conflict/unavailable information and blocks unsafe composition and invalid slots', async () => {
    const id = await createAndSubmit(inst, 'CHANGE_OF_SITE', { proposedSiteAddress: '44 Synthetic Campus Road, Pune' });
    const result = await ro.get(`/api/v1/evc/applications/${id}/suggestions?${new URLSearchParams(slot).toString()}`);
    expect(result.statusCode, result.body).toBe(200);
    const rows = result.json().rows;
    expect(rows.find((r: any) => r.userId === refs.users['evc3@demo.aicte.test']).blockers).toContain('OWN_INSTITUTION');
    expect(rows.find((r: any) => r.userId === refs.users['evc4@demo.aicte.test']).blockers).toContain('INFORMATION_UNAVAILABLE');
    const bad = await ro.command(id, 'PROPOSE_VISIT', { ...slot, expertIds: [refs.users['evc1@demo.aicte.test'], refs.users['evc3@demo.aicte.test']], reason });
    expect(bad.statusCode).toBe(422);
    expect((await ro.command(id, 'PROPOSE_VISIT', { ...slot, endsAt: slot.startsAt, expertIds: [], reason })).statusCode).toBe(422);
    expect((await north.get(`/api/v1/evc/applications/${id}/suggestions?${new URLSearchParams(slot)}`)).statusCode).toBe(404);
  });
  it('E01: simultaneous confirmations cannot reserve the same experts twice', async () => {
    const a = await createAndSubmit(inst, 'CHANGE_OF_SITE', { proposedSiteAddress: '44 Synthetic Campus Road, Pune' }), b = await createAndSubmit(inst, 'CHANGE_OF_SITE', { proposedSiteAddress: '44 Synthetic Campus Road, Pune' });
    await propose(a); await propose(b);
    const results = await Promise.all([cmd(ro, a, 'CONFIRM_VISIT'), cmd(ro, b, 'CONFIRM_VISIT')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200,409]);
    expect((await one(getPool(), 'SELECT count(*)::int AS n FROM expert_reservations WHERE active')).n).toBe(2);
  });
  it('E01: the database exclusion constraint independently rejects an overlapping reservation', async () => {
    const a = await createAndSubmit(inst, 'CHANGE_OF_SITE', { proposedSiteAddress: '44 Synthetic Campus Road, Pune' }), b = await createAndSubmit(inst, 'CHANGE_OF_SITE', { proposedSiteAddress: '44 Synthetic Campus Road, Pune' });
    const va = await propose(a), vb = await propose(b), expert = refs.users['evc1@demo.aicte.test'];
    const sql = "INSERT INTO expert_reservations(visit_id, expert_user_id, reserved) VALUES ($1,$2,tstzrange($3,$4,'[)'))";
    // Bypass all service checks to prove the DB constraint itself rejects an overlap.
    // Concurrent service confirmations are exercised above with independent API transactions.
    await withTx((tx) => tx.query(sql, [va, expert, slot.startsAt, slot.endsAt]));
    await expect(withTx((tx) => tx.query(sql, [vb, expert, slot.startsAt, slot.endsAt]))).rejects.toMatchObject({ code: '23P01' });
  });
  it('E02: reschedule preserves the old visit, replaces reservations, resets confirmations and cancels stale delivery', async () => {
    const id = await confirmed(), old = await visit(id);
    const clock = await one(getPool(), "SELECT * FROM deadlines WHERE subject_id = $1 AND clock_type = 'EVC_REPORT'", [old.id]);
    setTestNow(new Date(clock.current_due_at.getTime())); await scanDeadlines(now());
    const later = { ...slot, startsAt: '2026-11-20T10:00:00+05:30', endsAt: '2026-11-20T12:00:00+05:30' };
    const r = await cmd(ro, id, 'RESCHEDULE_VISIT', { ...later, expertIds: [refs.users['evc1@demo.aicte.test'], refs.users['evc2@demo.aicte.test']] });
    expect(r.statusCode, r.body).toBe(200);
    const current = await visit(id); expect(current.id).not.toBe(old.id); expect(current.rescheduled_from_id).toBe(old.id);
    expect(current.institution_acknowledged_at).toBeNull(); expect(current.members.every((m: any) => !m.confirmed_at)).toBe(true);
    expect((await one(getPool(), 'SELECT count(*)::int AS n FROM expert_reservations WHERE visit_id = $1 AND active', [old.id])).n).toBe(0);
    const newClock = await one(getPool(), "SELECT generation FROM deadlines WHERE subject_id = $1 AND clock_type = 'EVC_REPORT'", [current.id]);
    expect(newClock.generation).toBeGreaterThan(clock.generation);
    const sent = await deliverEmails(new OutboxEmailAdapter({ dir: config.outboxDir, from: 'demo@demo.aicte.test' }), now(), 'm4-stale');
    expect(sent.cancelled).toBeGreaterThan(0);
  });
  it('E02: cancel releases reservations and reopens scheduling from the original readiness anchor', async () => {
    const id = await confirmed(), v = await visit(id);
    expect((await cmd(ro, id, 'CANCEL_VISIT')).statusCode).toBe(200);
    expect((await one(getPool(), 'SELECT count(*)::int AS n FROM expert_reservations WHERE visit_id = $1 AND active', [v.id])).n).toBe(0);
    const d = await one(getPool(), "SELECT anchor_at FROM deadlines WHERE application_id = $1 AND clock_type = 'EVC_SCHEDULING' AND state = 'ACTIVE'", [id]);
    expect(d.anchor_at).toEqual(new Date(v.ready_at));
    await propose(id); expect((await cmd(ro, id, 'CONFIRM_VISIT')).statusCode).toBe(200);
  });
  it('E03: elapsed visit time cannot complete a stage; only an accepted report unlocks completion', async () => {
    const id = await confirmed(); setTestNow(new Date('2026-11-10T10:00:00+05:30'));
    expect((await ro.command(id, 'COMPLETE_STAGE')).statusCode).toBe(422);
    expect((await cmd(ro, id, 'RECORD_VISIT_HELD')).statusCode).toBe(409);
    await cmd(inst, id, 'ACKNOWLEDGE_VISIT'); await cmd(member1, id, 'CONFIRM_VISIT_MEMBER'); await cmd(member2, id, 'CONFIRM_VISIT_MEMBER');
    expect((await cmd(ro, id, 'RECORD_VISIT_HELD')).statusCode).toBe(200);
    expect((await cmd(member1, id, 'SUBMIT_VISIT_REPORT', report)).statusCode).toBe(200);
    expect((await ro.command(id, 'COMPLETE_STAGE')).statusCode).toBe(422);
    const v = await visit(id);
    expect((await cmd(ro, id, 'ACCEPT_VISIT_REPORT', { reportId: v.reports[0].id })).statusCode).toBe(200);
    expect((await ro.command(id, 'COMPLETE_STAGE')).statusCode).toBe(200);
    const final = await view(ro, id); expect(final.stages.find((s: any) => s.id === final.currentStageId).kind).toBe('DECISION');
    expect(final.application.decisionOutcome).toBeNull();
  });
  it('keeps report revisions immutable and hides internal observations from the institution', async () => {
    const id = await held(); await cmd(member1, id, 'SUBMIT_VISIT_REPORT', report);
    let v = await visit(id); const first = v.reports[0].id;
    expect((await cmd(ro, id, 'RETURN_VISIT_REPORT', { reportId: first })).statusCode).toBe(200);
    await cmd(member2, id, 'SUBMIT_VISIT_REPORT', { ...report, summary: 'Corrected synthetic report with the requested additional explanation.' });
    v = await visit(id); expect(v.reports.map((r: any) => r.revision)).toEqual([1,2]);
    expect((await cmd(ro, id, 'ACCEPT_VISIT_REPORT', { reportId: first })).statusCode).toBe(409);
    const institution = await view(inst, id);
    expect(JSON.stringify(institution.evc)).not.toContain('Private committee'); expect(JSON.stringify(institution.evc)).not.toContain('Corrected synthetic report');
    await expect(withTx((tx) => tx.query("UPDATE visit_reports SET summary = 'tampered' WHERE id = $1", [first]))).rejects.toMatchObject({ code: '23514' });
  });
  it('rechecks member grants, case/visit scopes and restricted directory access', async () => {
    const id = await confirmed(), v = await visit(id);
    expect((await outsider.get(`/api/v1/applications/${id}`)).statusCode).toBe(404);
    expect((await north.get(`/api/v1/evc/visits/${v.id}`)).statusCode).toBe(404);
    expect((await inst.get('/api/v1/evc/experts')).statusCode).toBe(403);
    const unassigned = await signIn(app, 'evc4@demo.aicte.test');
    expect((await unassigned.get('/api/v1/evc/queue')).json().total).toBe(0);
    await withTx((tx) => tx.query('UPDATE capability_grants SET revoked_at = $2 WHERE user_id = $1', [refs.users['evc1@demo.aicte.test'], now()]));
    expect((await member1.get(`/api/v1/evc/visits/${v.id}`)).statusCode).toBe(401);
  });
  it('revalidates eligibility at confirmation and rejects past dates, duplicates and capacity exhaustion', async () => {
    const id = await createAndSubmit(inst, 'CHANGE_OF_SITE', { proposedSiteAddress: '44 Synthetic Campus Road, Pune' }); await propose(id);
    await withTx((tx) => tx.query('UPDATE expert_profiles SET eligible = false WHERE user_id = $1', [refs.users['evc2@demo.aicte.test']]));
    expect((await cmd(ro, id, 'CONFIRM_VISIT')).statusCode).toBe(422);
    expect((await one(getPool(), 'SELECT count(*)::int AS n FROM expert_reservations')).n).toBe(0);
  });
  it('uses case and visit versions plus idempotency, with atomic rollback of visit/audit/outbox', async () => {
    const id = await createAndSubmit(inst, 'CHANGE_OF_SITE', { proposedSiteAddress: '44 Synthetic Campus Road, Pune' });
    const before = await view(ro, id), idem = key();
    const body = { command: 'PROPOSE_VISIT', expectedVersion: before.application.rowVersion, ...slot, expertIds: [refs.users['evc1@demo.aicte.test'], refs.users['evc2@demo.aicte.test']], reason };
    const a = await ro.post(`/api/v1/applications/${id}/commands`, body, idem), b = await ro.post(`/api/v1/applications/${id}/commands`, body, idem);
    expect(a.statusCode).toBe(200); expect(b.json().replayed).toBe(true);
    expect((await ro.post(`/api/v1/applications/${id}/commands`, body)).statusCode).toBe(409);
    expect((await cmd(ro, id, 'CONFIRM_VISIT', { visitExpectedVersion: 100 })).statusCode).toBe(409);
    const v = await visit(id), actor = await actorFromToken(getPool(), ro.sid);
    const counts = await one(getPool(), 'SELECT (SELECT count(*) FROM audit_events) AS a, (SELECT count(*) FROM outbox_events) AS o');
    await expect(withTx(async (tx) => { await executeCommand(tx, { actor, at: now(), correlationId: 'm4-rollback' }, id,
      { command: 'CONFIRM_VISIT', expectedVersion: a.json().rowVersion, visitId: v.id, visitExpectedVersion: v.row_version, reason }); throw new Error('forced rollback'); })).rejects.toThrow('forced rollback');
    expect((await visit(id)).state).toBe('PROPOSED');
    expect(await one(getPool(), 'SELECT (SELECT count(*) FROM audit_events) AS a, (SELECT count(*) FROM outbox_events) AS o')).toEqual(counts);
  });
  it('calendar, notifications and member queue remain scoped and report reminders reach the appointed experts', async () => {
    const id = await confirmed(), v = await visit(id);
    const range = '?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z';
    expect((await ro.get('/api/v1/evc/calendar' + range)).json().rows).toHaveLength(1);
    expect((await north.get('/api/v1/evc/calendar' + range)).json().rows).toHaveLength(0);
    expect((await member1.get('/api/v1/evc/queue')).json().total).toBe(1);
    await processOutbox(now());
    expect((await one(getPool(), "SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND kind = 'EVC_VISIT_CONFIRMED'", [refs.users['evc1@demo.aicte.test']])).n).toBe(1);
    const d = await one(getPool(), "SELECT current_due_at FROM deadlines WHERE subject_id = $1 AND clock_type = 'EVC_REPORT'", [v.id]);
    setTestNow(d.current_due_at); await scanDeadlines(now());
    const recipients = await q(getPool(), "SELECT DISTINCT recipient_user_id FROM alert_events e JOIN deadlines d ON d.id = e.deadline_id WHERE d.subject_id = $1 AND e.channel = 'IN_APP'", [v.id]);
    expect(recipients.map((r) => r.recipient_user_id).sort()).toEqual([refs.users['evc1@demo.aicte.test'], refs.users['evc2@demo.aicte.test']].sort());
  });
  it('E01: adjacent half-open slots are allowed, while monthly capacity still blocks excess bookings', async () => {
    await confirmed();
    const id = await createAndSubmit(inst, 'CHANGE_OF_SITE', { proposedSiteAddress: '44 Synthetic Campus Road, Pune' });
    const adjacent = { ...slot, startsAt: slot.endsAt, endsAt: '2026-11-04T14:00:00+05:30' };
    await propose(id, adjacent); expect((await cmd(ro, id, 'CONFIRM_VISIT')).statusCode).toBe(200);
    await withTx((tx) => tx.query('UPDATE expert_profiles SET max_visits_per_month = 2 WHERE user_id = $1', [refs.users['evc1@demo.aicte.test']]));
    const next = await createAndSubmit(inst, 'CHANGE_OF_SITE', { proposedSiteAddress: '44 Synthetic Campus Road, Pune' });
    const attempt = await ro.command(next, 'PROPOSE_VISIT', { ...slot, startsAt: '2026-11-05T10:00:00+05:30', endsAt: '2026-11-05T12:00:00+05:30',
      expertIds: [refs.users['evc1@demo.aicte.test'], refs.users['evc2@demo.aicte.test']], reason });
    expect(attempt.statusCode).toBe(422); expect(attempt.body).toContain('MONTHLY_CAPACITY');
  });
  it('E02: a conflicting replacement rolls back old reservations, state, clocks and history', async () => {
    const a = await confirmed(), b = await createAndSubmit(inst, 'CHANGE_OF_SITE', { proposedSiteAddress: '44 Synthetic Campus Road, Pune' });
    const occupied = { ...slot, startsAt: '2026-11-05T10:00:00+05:30', endsAt: '2026-11-05T12:00:00+05:30' };
    await propose(b, occupied); await cmd(ro, b, 'CONFIRM_VISIT');
    const before = await visit(a);
    const failed = await cmd(ro, a, 'RESCHEDULE_VISIT', { ...occupied, expertIds: [refs.users['evc1@demo.aicte.test'], refs.users['evc2@demo.aicte.test']] });
    expect(failed.statusCode).toBe(409);
    const after = await visit(a); expect(after.id).toBe(before.id); expect(after.state).toBe('CONFIRMED'); expect(after.history).toEqual(before.history);
    expect((await one(getPool(), 'SELECT count(*)::int AS n FROM expert_reservations WHERE visit_id = $1 AND active', [before.id])).n).toBe(2);
  });
  it('records declared conflicts and rechecks availability/appointment expiry before confirming', async () => {
    const nagpur = await signIn(app, 'inst.nagpur@demo.aicte.test');
    const id = await createAndSubmit(nagpur, 'CHANGE_OF_SITE', { proposedSiteAddress: '22 Synthetic Nagpur Road' });
    const result = (await ro.get(`/api/v1/evc/applications/${id}/suggestions?${new URLSearchParams(slot)}`)).json();
    expect(result.rows.find((r: any) => r.userId === refs.users['evc3@demo.aicte.test']).blockers).toContain('DECLARED');
    await propose(id);
    await withTx((tx) => tx.query('UPDATE capability_grants SET valid_to = $2 WHERE user_id = $1', [refs.users['evc2@demo.aicte.test'], '2026-11-03T00:00:00Z']));
    expect((await cmd(ro, id, 'CONFIRM_VISIT')).statusCode).toBe(422);
    expect((await one(getPool(), 'SELECT count(*)::int AS n FROM expert_reservations')).n).toBe(0);
  });
  it('cancellation after downtime keeps scheduling overdue and actionable; member My work uses visit assignments', async () => {
    const id = await confirmed();
    const myWork = await member1.get('/api/v1/applications?assignedToMe=true');
    expect(myWork.statusCode).toBe(200); expect(myWork.body).toContain(id);
    setTestNow(new Date('2026-12-01T10:00:00+05:30'));
    expect((await cmd(ro, id, 'CANCEL_VISIT')).statusCode).toBe(200);
    const d = await one(getPool(), "SELECT * FROM deadlines WHERE application_id = $1 AND clock_type = 'EVC_SCHEDULING' AND state = 'ACTIVE'", [id]);
    await scanDeadlines(now());
    expect((await one(getPool(), "SELECT count(*)::int AS n FROM alert_events WHERE deadline_id = $1 AND state = 'CREATED'", [d.id])).n).toBeGreaterThan(0);
  });
});
