import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool } from '../src/db.js';
import { diffPolicies } from '../src/modules/policy/diff.js';
import type { SeedRefs } from '../src/seed/base.js';
import { Client, createAndSubmit, resetDatabase, signIn, startApp } from './helpers.js';

let app: FastifyInstance;
let refs: SeedRefs;
let admin: Client;
let approver: Client;
let inst: Client;
let ro: Client;

beforeAll(async () => {
  refs = await resetDatabase();
  app = await startApp();
  admin = await signIn(app, 'policy.admin@demo.aicte.test');
  approver = await signIn(app, 'policy.approver@demo.aicte.test');
  inst = await signIn(app, 'inst.west@demo.aicte.test');
  ro = await signIn(app, 'ro.west@demo.aicte.test');
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('Policy change control', () => {
  let draftId: string;
  let oldCase: string;
  let doc: any;
  let rowVersion: number;

  it('separates drafting from publishing', async () => {
    expect((await approver.post('/api/v1/policy/versions', { basedOnId: refs.policyV1Id, label: 'v2 attempt by approver' })).statusCode).toBe(403);
    const created = await admin.post('/api/v1/policy/versions', { basedOnId: refs.policyV1Id, label: 'v2 — extension needs a visit (demo)' });
    expect(created.statusCode, created.body).toBe(200);
    draftId = created.json().id;
    expect(created.json().versionNo).toBe(2);
    const detail = (await admin.get(`/api/v1/policy/versions/${draftId}`)).json();
    expect(detail.status).toBe('DRAFT');
    doc = detail.document;
    rowVersion = detail.rowVersion;
  });

  it('policy roles cannot see cases', async () => {
    oldCase = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    expect((await admin.get(`/api/v1/applications/${oldCase}`)).statusCode).toBe(404);
    expect((await approver.get(`/api/v1/applications/${oldCase}`)).statusCode).toBe(404);
  });

  it('validation errors block publishing', async () => {
    const broken = structuredClone(doc);
    broken.routes.SCRUTINY_ONLY.stages = ['SCRUTINY', 'NOT_A_STAGE'];
    const saved = await admin.put(`/api/v1/policy/versions/${draftId}`, { document: broken, expectedVersion: rowVersion });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().issues.some((i: any) => i.level === 'error' && i.message.includes('NOT_A_STAGE'))).toBe(true);
    rowVersion = saved.json().rowVersion;

    const pub = await approver.post(`/api/v1/policy/versions/${draftId}/publish`, { effectiveFrom: '2026-11-01', changeNote: 'Attempt to publish a broken draft', expectedVersion: rowVersion });
    expect(pub.statusCode).toBe(422);
    expect(pub.json().error.code).toBe('POLICY_INVALID');
  });

  it('a stale draft save is rejected', async () => {
    const res = await admin.put(`/api/v1/policy/versions/${draftId}`, { document: doc, expectedVersion: rowVersion - 1 });
    expect(res.statusCode).toBe(409);
  });

  it('the administrator cannot publish; the approver can', async () => {
    const fixed = structuredClone(doc);
    fixed.classification.find((r: any) => r.id === 'extension').routeKey = 'SCRUTINY_EVC';
    const saved = await admin.put(`/api/v1/policy/versions/${draftId}`, { document: fixed, expectedVersion: rowVersion });
    expect(saved.json().issues.filter((i: any) => i.level === 'error')).toHaveLength(0);
    rowVersion = saved.json().rowVersion;

    const body = { effectiveFrom: '2026-11-01', changeNote: 'Extensions now also need an expert visit (demo change).', expectedVersion: rowVersion };
    expect((await admin.post(`/api/v1/policy/versions/${draftId}/publish`, body)).statusCode).toBe(403);
    const pub = await approver.post(`/api/v1/policy/versions/${draftId}/publish`, body);
    expect(pub.statusCode, pub.body).toBe(200);
    expect(pub.json().changes.some((c: any) => c.section === 'classification' && c.key === 'extension')).toBe(true);

    // Published versions are immutable.
    expect((await admin.put(`/api/v1/policy/versions/${draftId}`, { document: fixed, expectedVersion: rowVersion + 1 })).statusCode).toBe(409);
  });

  it('existing cases keep their pinned version; new submissions use v2', async () => {
    const old = (await ro.get(`/api/v1/applications/${oldCase}`)).json();
    expect(old.workflow.policyVersion.versionNo).toBe(1);
    expect(old.workflow.routeKey).toBe('SCRUTINY_ONLY');

    const fresh = await createAndSubmit(inst, 'EXTENSION_OF_APPROVAL');
    const v = (await ro.get(`/api/v1/applications/${fresh}`)).json();
    expect(v.workflow.policyVersion.versionNo).toBe(2);
    expect(v.workflow.routeKey).toBe('SCRUTINY_EVC');
  });

  it('lists versions, sources and a readable diff', async () => {
    const list = (await approver.get('/api/v1/policy/versions')).json();
    expect(list.map((x: any) => x.version_no)).toEqual([2, 1]);
    const diff = (await admin.get(`/api/v1/policy/diff?from=${refs.policyV1Id}&to=${draftId}`)).json();
    const change = diff.changes.find((c: any) => c.key === 'extension');
    expect(change.change).toBe('changed');
    expect(change.summary).toContain('routeKey: SCRUTINY_ONLY → SCRUTINY_EVC');
    const sources = (await admin.get('/api/v1/policy/sources')).json();
    expect(sources.map((s: any) => s.id)).toContain('DEMO-POLICY-NOTE');
    expect((await inst.get('/api/v1/policy/versions')).statusCode).toBe(403);
  });
});

describe('diffPolicies', () => {
  it('reports added, removed and changed items by section', () => {
    const a = { title: 'A', categories: [{ code: 'X', name: 'X' }], routes: { R: { name: 'R', stages: ['S', 'D'] } }, stages: { S: { name: 'S', checklist: [{ code: 'C1', requirement: 'r' }] } } };
    const b = { title: 'B', categories: [{ code: 'Y', name: 'Y' }], routes: { R: { name: 'R', stages: ['D'] } }, stages: { S: { name: 'S', checklist: [{ code: 'C1', requirement: 'r2' }] } } };
    const d = diffPolicies(a, b);
    expect(d.find((c) => c.section === 'meta')!.summary).toBe('title: A → B');
    expect(d.filter((c) => c.section === 'categories').map((c) => `${c.key}:${c.change}`)).toEqual(['X:removed', 'Y:added']);
    expect(d.find((c) => c.section === 'routes')!.summary).toBe('Route R: stages: S, D → D');
    expect(d.find((c) => c.section === 'checklist')!.key).toBe('S/C1');
  });
});
