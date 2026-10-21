import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { closePool, getPool, q, withTx } from '../src/db.js';
import { setTestNow } from '../src/lib/clock.js';
import { dropAll, migrate } from '../src/migrate.js';
import { resetLoginRateLimit } from '../src/modules/identity/routes.js';
import { clearPolicyCache } from '../src/modules/policy/service.js';
import { DEMO_PASSWORD, seedBase, type SeedRefs } from '../src/seed/base.js';

export const TEST_NOW = new Date('2026-11-02T10:00:00+05:30');

/** Fresh schema + synthetic seed in the test database, with a fixed business clock. */
export async function resetDatabase(): Promise<SeedRefs> {
  await closePool();
  clearPolicyCache();
  await dropAll(config.testDatabaseUrl);
  await migrate(config.testDatabaseUrl, () => undefined);
  setTestNow(TEST_NOW);
  return withTx((tx) => seedBase(tx));
}

export async function startApp(): Promise<FastifyInstance> {
  resetLoginRateLimit();
  const app = await buildApp();
  await app.ready();
  return app;
}

export function key() {
  return 'test-' + crypto.randomUUID();
}

export class Client {
  sid = '';
  constructor(private app: FastifyInstance) {}

  async login(email: string, password = DEMO_PASSWORD) {
    const res = await this.raw('POST', '/api/v1/auth/login', { email, password });
    const cookie = [res.headers['set-cookie']].flat().find((c) => typeof c === 'string' && c.startsWith('sid='));
    if (cookie) this.sid = String(cookie).split(';')[0].slice(4);
    return res;
  }

  raw(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    return this.app.inject({
      method: method as any,
      url,
      payload: body as any,
      headers: { 'x-requested-with': 'aicte-web', ...(this.sid ? { cookie: `sid=${this.sid}` } : {}), ...headers },
    });
  }

  async get(url: string) {
    return this.raw('GET', url);
  }

  async post(url: string, body: unknown, idempotencyKey: string | null = key()) {
    return this.raw('POST', url, body, idempotencyKey ? { 'idempotency-key': idempotencyKey } : {});
  }

  async put(url: string, body: unknown) {
    return this.raw('PUT', url, body);
  }

  async command(appId: string, command: string, payload: Record<string, unknown> = {}, idem = key()) {
    const view = await this.get(`/api/v1/applications/${appId}`);
    const version = view.json().application.rowVersion;
    return this.post(`/api/v1/applications/${appId}/commands`, { command, expectedVersion: version, ...payload }, idem);
  }
}

export async function signIn(app: FastifyInstance, email: string) {
  // Tests sign in many times from one address; the per-IP limiter is not what these tests exercise.
  resetLoginRateLimit();
  const c = new Client(app);
  const res = await c.login(email);
  if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.body}`);
  return c;
}

export const COMPLETE_FORM = {
  campusAddress: '12 Demo Road, Hinjawadi, Pune',
  landAreaAcres: 12.5,
  programmes: [{ name: 'B.Tech Computer Engineering', level: 'UG', intake: 120 }],
  declarationAccepted: true,
};

/** Creates and submits an application as the given institution user; returns its id. */
export async function createAndSubmit(inst: Client, categoryCode: string, details: Record<string, unknown> = {}) {
  const created = await inst.post('/api/v1/applications', { cycleCode: '2027-28', categoryCode, details, draftData: COMPLETE_FORM });
  if (created.statusCode !== 200) throw new Error('create failed: ' + created.body);
  const { id, rowVersion } = created.json();
  const submitted = await inst.post(`/api/v1/applications/${id}/submit`, { expectedVersion: rowVersion });
  if (submitted.statusCode !== 200) throw new Error('submit failed: ' + submitted.body);
  return id as string;
}

export async function satisfyChecklist(member: Client, appId: string) {
  const view = (await member.get(`/api/v1/applications/${appId}`)).json();
  const current = view.stages.find((s: any) => s.id === view.currentStageId);
  return member.command(appId, 'SAVE_CHECKLIST', {
    items: current.checklist.map((i: any) => ({ code: i.code, status: 'SATISFIED' })),
  });
}

export async function count(sql: string, params: unknown[] = []) {
  const rows = await q(getPool(), sql, params);
  return Number(rows[0].n);
}
