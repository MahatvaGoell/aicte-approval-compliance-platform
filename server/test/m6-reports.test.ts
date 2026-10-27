import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool, one } from '../src/db.js';
import { setTestNow } from '../src/lib/clock.js';
import { LocalStorageAdapter } from '../src/modules/documents/storage.js';
import { setDocumentStorage } from '../src/modules/documents/service.js';
import { Client, createAndSubmit, key, resetDatabase, satisfyChecklist, signIn, startApp, TEST_NOW } from './helpers.js';

const DAY = 86_400_000;
const NAMES = ['pending', 'overdue', 'due-soon', 'awaiting-institution', 'evc-unscheduled', 'evidence-backlog', 'obligations-overdue'];
const reason = 'Synthetic review for the report tests.';

let app: FastifyInstance;
let refs: Awaited<ReturnType<typeof resetDatabase>>;
let storageDir: string;
let pune: Client, nagpur: Client, north: Client, ro: Client, roNorth: Client, authority: Client, auditor: Client, committee: Client, admin: Client;
let casePune: string, caseNagpur: string, caseNorth: string, caseConditions: string;

const view = async (c: Client, id: string) => (await c.get(`/api/v1/applications/${id}`)).json();
async function owner(id: string) {
  const v = await view(ro, id);
  const row = await one(getPool(), 'SELECT email FROM users WHERE id = $1', [v.stages[0].assignee.id]);
  return signIn(app, row.email);
}
const report = async (c: Client, name: string, qs = '') => c.get(`/api/v1/reports/${name}${qs ? '?' + qs : ''}`);
const tile = (dash: any, key: string) => dash.tiles.find((t: any) => t.key === key);

function multipart(metadata: unknown, bytes: Buffer) {
  const boundary = 'm6-' + crypto.randomUUID();
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="lease.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

beforeAll(async () => {
  refs = await resetDatabase();
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aicte-m6-'));
  setDocumentStorage(new LocalStorageAdapter(storageDir));
  app = await startApp();
  pune = await signIn(app, 'inst.west@demo.aicte.test');
  nagpur = await signIn(app, 'inst.nagpur@demo.aicte.test');
  north = await signIn(app, 'inst.north@demo.aicte.test');
  ro = await signIn(app, 'ro.west@demo.aicte.test');
  roNorth = await signIn(app, 'ro.north@demo.aicte.test');
  authority = await signIn(app, 'authority@demo.aicte.test');
  auditor = await signIn(app, 'auditor@demo.aicte.test');
  committee = await signIn(app, 'scrutiny.west1@demo.aicte.test');
  admin = await signIn(app, 'admin@demo.aicte.test');

  casePune = await createAndSubmit(pune, 'EXTENSION_OF_APPROVAL');
  caseNorth = await createAndSubmit(north, 'EXTENSION_OF_APPROVAL');
  // Nagpur: returned to the institution with a finding.
  caseNagpur = await createAndSubmit(nagpur, 'EXTENSION_OF_APPROVAL');
  const m = await owner(caseNagpur);
  const raised = await m.command(caseNagpur, 'RAISE_FINDING', { checklistCode: 'LAND_DOCUMENTS', reasonCode: 'MISSING_DOCUMENT', explanation: 'Upload a registered lease deed.', requestedEvidence: 'Lease deed', visibility: 'INSTITUTION' });
  expect(raised.statusCode, raised.body).toBe(200);
  const ret = await m.command(caseNagpur, 'RETURN_TO_INSTITUTION', { reason: 'Land documents are not on record', responseDueNote: 'Demo: respond within 15 days' });
  expect(ret.statusCode, ret.body).toBe(200);

  // Pune, second case: approved with two conditions → two obligations.
  caseConditions = await createAndSubmit(pune, 'EXTENSION_OF_APPROVAL');
  const mc = await owner(caseConditions);
  await satisfyChecklist(mc, caseConditions);
  await mc.command(caseConditions, 'RECORD_RECOMMENDATION', { recommendation: 'RECOMMEND_APPROVAL_WITH_CONDITIONS', text: reason, proposedConditions: ['Synthetic lease renewal'] });
  await mc.command(caseConditions, 'COMPLETE_STAGE');
  const decision = await authority.command(caseConditions, 'RECORD_DECISION', {
    outcome: 'APPROVED_WITH_CONDITIONS', reason,
    conditions: [{ text: 'Submit a renewed synthetic lease deed', dueInDays: 3 }, { text: 'Provide synthetic supporting evidence', dueInDays: 5 }],
  });
  expect(decision.statusCode, decision.body).toBe(200);
});

afterAll(async () => {
  setTestNow(TEST_NOW);
  setDocumentStorage(null);
  await app?.close();
  await closePool();
  await fs.rm(storageDir, { recursive: true, force: true });
});

describe('M6 reports and dashboards (server)', () => {
  it('R01: tile count, report total and paged rows reconcile for every report, before and after demo time moves', async () => {
    for (const offsetDays of [0, 60]) {
      setTestNow(new Date(TEST_NOW.getTime() + offsetDays * DAY));
      const dash = (await ro.get('/api/v1/dashboards/management')).json();
      const seen: Record<string, string[]> = {};
      for (const name of NAMES) {
        const t = tile(dash, name);
        expect(t, `${name} tile at +${offsetDays}d`).toBeTruthy();
        const first = (await report(ro, name, 'pageSize=1&page=1')).json();
        expect(first.total).toBe(t.count);
        const ids: string[] = [];
        for (let page = 1; page <= Math.max(1, first.total); page++) {
          const r = (await report(ro, name, `pageSize=1&page=${page}`)).json();
          expect(r.total).toBe(t.count);
          ids.push(...r.rows.map((x: any) => x.id));
        }
        // Past the last page is empty but keeps the same total.
        const beyond = (await report(ro, name, `pageSize=1&page=${first.total + 1}`)).json();
        expect(beyond.rows).toEqual([]);
        expect(beyond.total).toBe(t.count);
        expect(ids.length).toBe(t.count);
        expect(new Set(ids).size).toBe(ids.length);
        // A single large page lists the same identities as page-by-page.
        const whole = (await report(ro, name, 'pageSize=100')).json();
        expect(whole.rows.map((x: any) => x.id).sort()).toEqual([...ids].sort());
        seen[name] = ids;
      }
      // Subset invariant: the application sub-reports are slices of "pending".
      for (const sub of ['overdue', 'due-soon', 'awaiting-institution', 'evc-unscheduled']) {
        for (const id of seen[sub]) expect(seen.pending).toContain(id);
      }
      // The matrix cells add up to the pending tile and each cell drills into the same number.
      expect(dash.matrix.reduce((n: number, c: any) => n + c.pending, 0)).toBe(tile(dash, 'pending').count);
      for (const cell of dash.matrix) {
        const qs = new URLSearchParams({ regionId: cell.filters.regionId, stageKey: cell.filters.stageKey }).toString();
        expect((await report(ro, 'pending', qs)).json().total).toBe(cell.pending);
      }
    }
    setTestNow(TEST_NOW);
  });

  it('elapsed demo time moves cases into overdue; the same filter gives the same rows in the tile and the report', async () => {
    setTestNow(TEST_NOW);
    expect((await report(ro, 'overdue')).json().total).toBe(0);
    setTestNow(new Date(TEST_NOW.getTime() + 60 * DAY));
    const overdue = (await report(ro, 'overdue', 'regionId=DEMO-WEST')).json();
    expect(overdue.total).toBeGreaterThan(0);
    const row = overdue.rows[0];
    expect(row.overdue).toBe(true);
    expect(row.overdueDays).toBeGreaterThan(0);
    expect(row.dueBasis).toContain('DEMO_ASSUMPTION');
    expect(['INSTITUTION_RESPONSE', 'OFFICER_REVIEW', 'VISIT_AVAILABILITY', 'EXTERNAL_INFORMATION', 'UNKNOWN']).toContain(row.waitingReason);
    const dash = (await ro.get('/api/v1/dashboards/officer?regionId=DEMO-WEST')).json();
    expect(tile(dash, 'overdue').count).toBe(overdue.total);
    expect(tile(dash, 'overdue').filters).toEqual({ regionId: 'DEMO-WEST' });
    setTestNow(TEST_NOW);
  });

  it('filters narrow results; an empty result is a normal 200 with total 0', async () => {
    const west = (await report(ro, 'pending', 'regionId=DEMO-WEST')).json();
    expect(west.total).toBeGreaterThan(0);
    const none = await report(ro, 'pending', 'categoryCode=NO_SUCH_CATEGORY');
    expect(none.statusCode).toBe(200);
    expect(none.json()).toMatchObject({ total: 0, rows: [] });
    const future = (await report(ro, 'pending', 'submittedFrom=2030-01-01')).json();
    expect(future.total).toBe(0);
    const tileEmpty = tile((await ro.get('/api/v1/dashboards/management?submittedFrom=2030-01-01')).json(), 'pending');
    expect(tileEmpty.count).toBe(0);
  });

  it('awaiting-institution lists the returned case with the institution as the waiting reason', async () => {
    const r = (await report(ro, 'awaiting-institution')).json();
    expect(r.rows.map((x: any) => x.applicationId)).toEqual([caseNagpur]);
    expect(r.rows[0]).toMatchObject({ waitingReason: 'INSTITUTION_RESPONSE', pendingAction: 'Institution to respond to the findings' });
  });

  it('scope: regions, institutions and filters cannot widen what a grant sees', async () => {
    const west = (await report(ro, 'pending')).json();
    const northRows = (await report(roNorth, 'pending')).json();
    expect(west.rows.map((x: any) => x.applicationId)).not.toContain(caseNorth);
    expect(northRows.rows.map((x: any) => x.applicationId)).toEqual([caseNorth]);
    // Asking for another region's data through a filter returns nothing, not an error that confirms it exists.
    const probe = await report(roNorth, 'pending', 'regionId=DEMO-WEST');
    expect(probe.statusCode).toBe(200);
    expect(probe.json().total).toBe(0);
    const instProbe = await report(roNorth, 'pending', `institutionId=${refs.institutions.pune}`);
    expect(instProbe.json().total).toBe(0);
    // Dashboard counts follow the same scope.
    expect(tile((await roNorth.get('/api/v1/dashboards/management')).json(), 'pending').count).toBe(1);
    // Auditor (read-only, all regions) sees everything and cannot act.
    const all = (await report(auditor, 'pending')).json();
    expect(all.rows.map((x: any) => x.applicationId)).toEqual(expect.arrayContaining([casePune, caseNorth, caseNagpur]));
  });

  it('institutions see only their own cases, no owner or internal clocks, and no office-only reports', async () => {
    const own = (await report(pune, 'pending')).json();
    expect(own.rows.map((x: any) => x.applicationId)).toEqual([casePune]);
    expect(own.rows[0].owner).toBeNull();
    expect(own.rows[0].waitingReason).toBeNull();
    expect(own.rows[0].dueAt).toBeNull(); // the stage-handling clock is an internal officer clock
    expect(JSON.stringify(own)).not.toMatch(/assignee|Dr\. /);
    for (const name of ['overdue', 'due-soon', 'evc-unscheduled', 'evidence-backlog']) {
      expect((await report(pune, name)).statusCode, name).toBe(404);
    }
    expect((await pune.get('/api/v1/reports')).json().reports.map((r: any) => r.name)).toEqual(['double-claims', 'returns-and-holding', 'pending', 'awaiting-institution', 'obligations-overdue']);
    expect((await report(pune, 'pending', `institutionId=${refs.institutions.nagpur}`)).json().total).toBe(0);
    const nagpurOwn = (await report(nagpur, 'awaiting-institution')).json();
    expect(nagpurOwn.rows).toHaveLength(1);
    expect(nagpurOwn.rows[0].dueAt).not.toBeNull(); // the institution's own response clock is shown
    expect((await pune.get('/api/v1/dashboards/management')).statusCode).toBe(403);
    expect((await pune.get('/api/v1/dashboards/officer')).statusCode).toBe(403);
    const dash = (await pune.get('/api/v1/dashboards/institution')).json();
    expect(dash.tiles.map((t: any) => t.key)).toEqual(['pending', 'awaiting-institution', 'obligations-overdue']);
    expect(tile(dash, 'pending').count).toBe(1);
    expect(dash.unavailable.map((u: any) => u.key)).toContain('documents-expiring');
  });

  it('roles without the capability are refused; unknown names are 404; unauthenticated is 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/reports/pending' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/dashboards/management' })).statusCode).toBe(401);
    expect((await committee.get('/api/v1/dashboards/management')).statusCode).toBe(403);
    expect((await committee.get('/api/v1/reports/pending')).statusCode).toBe(404);
    expect((await committee.get('/api/v1/reports')).json().reports).toEqual([]);
    expect((await admin.get('/api/v1/reports/pending')).statusCode).toBe(404);
    expect((await auditor.get('/api/v1/dashboards/officer')).statusCode).toBe(403);
    expect((await auditor.get('/api/v1/dashboards/management')).statusCode).toBe(200);
    expect((await ro.get('/api/v1/reports/not-a-report')).statusCode).toBe(404);
    expect((await ro.get('/api/v1/dashboards/nope')).statusCode).toBe(404);
  });

  it('invalid filters are rejected with a clear error', async () => {
    for (const bad of ['submittedFrom=2026-13-40', 'submittedFrom=yesterday', 'pageSize=1000', 'pageSize=0', 'page=0', 'institutionId=abc', 'submittedFrom=2026-11-10&submittedTo=2026-11-01']) {
      const res = await report(ro, 'pending', bad);
      expect(res.statusCode, bad).toBe(422);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
    const unsupported = await report(ro, 'evidence-backlog', 'stageKey=SCRUTINY');
    expect(unsupported.statusCode).toBe(422);
    expect(unsupported.json().error.code).toBe('FILTER_NOT_SUPPORTED');
    expect((await ro.get('/api/v1/dashboards/management?submittedFrom=nope')).statusCode).toBe(422);
  });

  it('on-time evidence awaiting late review stays on time and is not counted as an overdue condition', async () => {
    const v0 = await view(ro, caseConditions);
    const verifier = refs.users['ro.west@demo.aicte.test'];
    const created: string[] = [];
    for (const index of [0, 1]) {
      const r = await ro.command(caseConditions, 'CREATE_OBLIGATION', { conditionIndex: index, requiredDocumentType: 'LEASE_DEED', verifierUserId: verifier, reason });
      expect(r.statusCode, r.body).toBe(200);
      created.push(r.json().result.obligationId);
    }
    expect(v0.application.decisionOutcome).toBe('APPROVED_WITH_CONDITIONS');

    // Day 1: the institution uploads and submits evidence for the first obligation (due in 3 days).
    setTestNow(new Date(TEST_NOW.getTime() + 1 * DAY));
    const pv = await view(pune, caseConditions);
    const bytes = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n% Synthetic lease\ntrailer << >>\n%%EOF\n');
    const mp = multipart({ expectedVersion: pv.application.rowVersion, title: 'Synthetic lease deed', documentType: 'LEASE_DEED', visibility: 'INSTITUTION' }, bytes);
    const up = await pune.raw('POST', `/api/v1/applications/${caseConditions}/documents/uploads`, mp.body, { ...mp.headers, 'idempotency-key': key() });
    expect(up.statusCode, up.body).toBe(200);
    const pv2 = await view(pune, caseConditions);
    const first = pv2.obligations.find((o: any) => o.id === created[0]);
    const submit = await pune.command(caseConditions, 'SUBMIT_EVIDENCE', { obligationId: created[0], obligationExpectedVersion: first.row_version, versionIds: [up.json().versionId], reason });
    expect(submit.statusCode, submit.body).toBe(200);

    // Day 12: both submission due dates have passed and nobody has verified yet.
    setTestNow(new Date(TEST_NOW.getTime() + 12 * DAY));
    const backlog = (await report(ro, 'evidence-backlog')).json();
    expect(backlog.rows.map((x: any) => x.id)).toEqual([created[0]]);
    expect(backlog.rows[0]).toMatchObject({ submissionOnTime: true, waitingReason: 'OFFICER_REVIEW', obligationState: 'EVIDENCE_SUBMITTED' });
    const overdue = (await report(ro, 'obligations-overdue')).json();
    expect(overdue.rows.map((x: any) => x.id)).toEqual([created[1]]);
    expect(overdue.rows[0].overdueDays).toBeGreaterThanOrEqual(6);
    expect(tile((await ro.get('/api/v1/dashboards/officer')).json(), 'obligations-overdue').count).toBe(1);
    expect(tile((await ro.get('/api/v1/dashboards/officer')).json(), 'evidence-backlog').count).toBe(1);

    // The institution sees its overdue condition but not the internal verification backlog.
    expect((await report(pune, 'obligations-overdue')).json().rows.map((x: any) => x.id)).toEqual([created[1]]);
    expect((await report(pune, 'evidence-backlog')).statusCode).toBe(404);
    expect((await report(pune, 'obligations-overdue')).json().rows[0].owner).toBeNull();
    // Other institutions never see these obligations.
    expect((await report(nagpur, 'obligations-overdue')).json().total).toBe(0);
    // Receipt timeliness is untouched by the passing of time.
    const receipt = await one(getPool(), 'SELECT on_time FROM evidence_submissions WHERE obligation_id = $1', [created[0]]);
    expect(receipt.on_time).toBe(true);
    setTestNow(TEST_NOW);
  });
});
