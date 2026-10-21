import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { closePool, getPool } from '../src/db.js';
import { resetLoginRateLimit } from '../src/modules/identity/routes.js';
import { Client, createAndSubmit, resetDatabase, signIn, startApp } from './helpers.js';
import type { SeedRefs } from '../src/seed/base.js';

let app: FastifyInstance;
let refs: SeedRefs;
let puneAppId: string;

beforeAll(async () => {
  refs = await resetDatabase();
  app = await startApp();
  const inst = await signIn(app, 'inst.west@demo.aicte.test');
  puneAppId = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('Authentication', () => {
  it('rejects a wrong password without revealing whether the account exists', async () => {
    const c = new Client(app);
    const wrong = await c.login('inst.west@demo.aicte.test', 'not-the-password');
    const missing = await c.login('nobody@demo.aicte.test', 'whatever');
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(missing.json().error.message);
  });

  it('locks an account after repeated failures', async () => {
    const c = new Client(app);
    for (let i = 0; i < 5; i++) await c.login('inst.south@demo.aicte.test', 'bad-password');
    const res = await c.login('inst.south@demo.aicte.test');
    expect(res.statusCode).toBe(423);
  });

  it('requires a session for protected endpoints', async () => {
    const res = await new Client(app).get('/api/v1/applications');
    expect(res.statusCode).toBe(401);
  });

  it('rejects mutating requests without the CSRF header', async () => {
    const c = await signIn(app, 'inst.west@demo.aicte.test');
    const res = await app.inject({ method: 'POST', url: '/api/v1/applications', headers: { cookie: `sid=${c.sid}` }, payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_CHECK_FAILED');
  });

  it('sets an httpOnly, SameSite=Strict session cookie', async () => {
    const res = await new Client(app).login('inst.west@demo.aicte.test');
    const cookie = String([res.headers['set-cookie']].flat()[0]);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('demo one-click sign-in works only for listed accounts and only in demo mode', async () => {
    resetLoginRateLimit();
    const demo = config.demoMode;
    try {
      (config as { demoMode: boolean }).demoMode = true;
      const c = new Client(app);
      const ok = await c.raw('POST', '/api/v1/auth/demo-login', { email: 'ro.west@demo.aicte.test' });
      expect(ok.statusCode).toBe(200);
      c.sid = String([ok.headers['set-cookie']].flat()[0]).split(';')[0].slice(4);
      expect((await c.get('/api/v1/me')).json().user.email).toBe('ro.west@demo.aicte.test');
      // inst.south exists but is not in the demo list.
      const unlisted = await new Client(app).raw('POST', '/api/v1/auth/demo-login', { email: 'inst.south@demo.aicte.test' });
      expect(unlisted.statusCode).toBe(404);

      (config as { demoMode: boolean }).demoMode = false;
      const off = await new Client(app).raw('POST', '/api/v1/auth/demo-login', { email: 'ro.west@demo.aicte.test' });
      expect(off.statusCode).toBe(404);
    } finally {
      (config as { demoMode: boolean }).demoMode = demo;
    }
  });
});

describe('Data isolation (S01)', () => {
  const urls = (id: string) => [`/api/v1/applications/${id}`, `/api/v1/applications/${id}/timeline`];

  it('another institution cannot see, list or act on the case', async () => {
    const other = await signIn(app, 'inst.north@demo.aicte.test');
    for (const u of urls(puneAppId)) expect((await other.get(u)).statusCode).toBe(404);
    const list = (await other.get('/api/v1/applications?pageSize=100')).json();
    expect(list.rows.some((r: any) => r.id === puneAppId)).toBe(false);
    const cmd = await other.post(`/api/v1/applications/${puneAppId}/commands`, { command: 'COMPLETE_STAGE', expectedVersion: 1 });
    expect(cmd.statusCode).toBe(404);
    const draft = await other.put(`/api/v1/applications/${puneAppId}/draft`, { expectedVersion: 1, draftData: {} });
    expect(draft.statusCode).toBe(404);
    const inst = await other.get(`/api/v1/institutions/${refs.institutions.pune}`);
    expect(inst.statusCode).toBe(404);
  });

  it('an officer of another region cannot see the case', async () => {
    const ro = await signIn(app, 'ro.north@demo.aicte.test');
    for (const u of urls(puneAppId)) expect((await ro.get(u)).statusCode).toBe(404);
  });

  it('an unassigned committee member cannot see the case', async () => {
    const member = await signIn(app, 'scrutiny.north1@demo.aicte.test');
    for (const u of urls(puneAppId)) expect((await member.get(u)).statusCode).toBe(404);
  });

  it('administrative and policy roles have no case access or decision power', async () => {
    for (const email of ['admin@demo.aicte.test', 'policy.approver@demo.aicte.test', 'policy.admin@demo.aicte.test']) {
      const c = await signIn(app, email);
      expect((await c.get(`/api/v1/applications/${puneAppId}`)).statusCode).toBe(404);
      const cmd = await c.post(`/api/v1/applications/${puneAppId}/commands`, { command: 'RECORD_DECISION', expectedVersion: 1, outcome: 'APPROVED', reason: 'Not allowed' });
      expect(cmd.statusCode).toBe(404);
    }
  });

  it('the institution can see its own case but cannot perform officer commands', async () => {
    const inst = await signIn(app, 'inst.west@demo.aicte.test');
    const view = (await inst.get(`/api/v1/applications/${puneAppId}`)).json();
    expect(view.permittedCommands.every((p: any) => !p.allowed)).toBe(true);
    const res = await inst.command(puneAppId, 'COMPLETE_STAGE');
    expect(res.statusCode).toBe(403);
  });

  it('an auditor can read but not act', async () => {
    const auditor = await signIn(app, 'auditor@demo.aicte.test');
    expect((await auditor.get(`/api/v1/applications/${puneAppId}`)).statusCode).toBe(200);
    const res = await auditor.command(puneAppId, 'COMPLETE_STAGE');
    expect(res.statusCode).toBe(403);
    expect((await auditor.post('/api/v1/audit/verify', {})).json().ok).toBe(true);
  });

  it('rejects malformed ids as not found rather than erroring', async () => {
    const inst = await signIn(app, 'inst.west@demo.aicte.test');
    expect((await inst.get('/api/v1/applications/not-a-uuid')).statusCode).toBe(404);
  });
});

describe('Grant revocation (S02)', () => {
  it('a revoked grant stops authorising the existing session', async () => {
    const c = await signIn(app, 'inst.nagpur@demo.aicte.test');
    expect((await c.get('/api/v1/me')).statusCode).toBe(200);
    await getPool().query(`UPDATE capability_grants SET revoked_at = now(), revoke_reason = 'test' WHERE user_id = $1`, [refs.users['inst.nagpur@demo.aicte.test']]);
    expect((await c.get('/api/v1/me')).statusCode).toBe(401);
  });

  it('a user with two grants can switch the active role', async () => {
    const c = await signIn(app, 'bureau@demo.aicte.test');
    const me = (await c.get('/api/v1/me')).json();
    expect(me.grants).toHaveLength(2);
    const auditorGrant = me.grants.find((g: any) => g.role === 'AUDITOR');
    expect((await c.post('/api/v1/auth/switch-role', { grantId: auditorGrant.id }, null)).statusCode).toBe(200);
    expect((await c.get('/api/v1/me')).json().activeGrant.role).toBe('AUDITOR');
  });
});

describe('Audit protection', () => {
  it('blocks updates and deletes of audit rows for the application connection', async () => {
    await expect(getPool().query(`UPDATE audit_events SET reason = 'tampered' WHERE id = 1`)).rejects.toThrow(/append-only/);
    await expect(getPool().query('DELETE FROM audit_events WHERE id = 1')).rejects.toThrow(/append-only/);
  });

  it('detects tampering that bypasses the trigger', async () => {
    const auditor = await signIn(app, 'auditor@demo.aicte.test');
    const client = await getPool().connect();
    try {
      await client.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update');
      await client.query(`UPDATE audit_events SET reason = 'tampered by a superuser' WHERE id = 2`);
      await client.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update');
    } finally {
      client.release();
    }
    const res = (await auditor.post('/api/v1/audit/verify', {})).json();
    expect(res.ok).toBe(false);
    expect(res.firstBrokenId).toBe(2);
  });
});
