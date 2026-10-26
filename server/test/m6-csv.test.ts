import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError, closePool, getPool, one, q } from '../src/db.js';
import { setTestNow } from '../src/lib/clock.js';
import { verifyChain } from '../src/modules/audit/audit.js';
import { csvCell, toCsv } from '../src/modules/reports/csv.js';
import { exportReportCsv, requireReport } from '../src/modules/reports/service.js';
import { Client, createAndSubmit, resetDatabase, signIn, startApp, TEST_NOW } from './helpers.js';

const DAY = 86_400_000;
let app: FastifyInstance;
let refs: Awaited<ReturnType<typeof resetDatabase>>;
let pune: Client, north: Client, ro: Client, roNorth: Client, auditor: Client, committee: Client, admin: Client;
let casePune: string, caseNorth: string;

/** Minimal RFC 4180 parser, enough to read back what the export wrote. */
function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && body[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  return rows;
}

/** An all-regions read-only actor shaped like the auditor's, for calling the service directly. */
function actorLike(capabilities = ['REPORTS_VIEW', 'REPORTS_EXPORT', 'APPLICATION_VIEW_SCOPE']) {
  return {
    userId: refs.users['auditor@demo.aicte.test'], name: 'Auditor', email: 'auditor@demo.aicte.test', sessionId: 's', grantId: 'g',
    role: 'AUDITOR', officialDesignation: null, institutionId: null, regionIds: [], scopeAll: true, committeeId: null, committeeKind: null,
    capabilities: new Set(capabilities),
  } as any;
}

beforeAll(async () => {
  refs = await resetDatabase();
  app = await startApp();
  pune = await signIn(app, 'inst.west@demo.aicte.test');
  north = await signIn(app, 'inst.north@demo.aicte.test');
  ro = await signIn(app, 'ro.west@demo.aicte.test');
  roNorth = await signIn(app, 'ro.north@demo.aicte.test');
  auditor = await signIn(app, 'auditor@demo.aicte.test');
  committee = await signIn(app, 'scrutiny.west1@demo.aicte.test');
  admin = await signIn(app, 'admin@demo.aicte.test');
  casePune = await createAndSubmit(pune, 'EXTENSION_OF_APPROVAL');
  caseNorth = await createAndSubmit(north, 'EXTENSION_OF_APPROVAL');
});

afterAll(async () => {
  setTestNow(TEST_NOW);
  await app?.close();
  await closePool();
});

describe('csvCell', () => {
  it('quotes every cell; embedded quotes are doubled and commas or newlines stay inside the quotes', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi", then\nleave')).toBe('"say ""hi"", then\nleave"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(7)).toBe('"7"');
    expect(csvCell(new Date('2026-11-02T04:30:00Z'))).toBe('"2026-11-02T04:30:00.000Z"');
  });

  it('neutralises spreadsheet formulas', () => {
    for (const evil of ['=SUM(A1)', '+1+1', '-2+3', '@cmd', '\tTAB', '\rCR', '=HYPERLINK("http://x","y")']) {
      expect(csvCell(evil), evil).toMatch(/^"'/);
    }
    expect(csvCell('a=b')).toBe('"a=b"');
    expect(toCsv(['H'], [['=1']])).toBe('﻿"H"\r\n"\'=1"\r\n');
  });
});

describe('M6 CSV export', () => {
  it('R01: export rows equal the report rows for the same filters, after time moves and for empty results', async () => {
    const cases: Array<[string, string]> = [
      ['pending', ''], ['overdue', ''], ['pending', 'regionId=DEMO-WEST'], ['pending', 'categoryCode=NO_SUCH'], ['due-soon', ''], ['evidence-backlog', ''],
    ];
    for (const offsetDays of [0, 60]) {
      setTestNow(new Date(TEST_NOW.getTime() + offsetDays * DAY));
      for (const [name, qs] of cases) {
        const json = (await ro.get(`/api/v1/reports/${name}?pageSize=100${qs ? '&' + qs : ''}`)).json();
        const res = await ro.get(`/api/v1/reports/${name}/csv${qs ? '?' + qs : ''}`);
        expect(res.statusCode, `${name} ${qs}`).toBe(200);
        const [header, ...rows] = parseCsv(res.body);
        expect(header[0]).toBe('Application number');
        expect(rows.length, `${name} ${qs} at +${offsetDays}d`).toBe(json.total);
        expect(rows.map((r) => r[0]).sort()).toEqual(json.rows.map((r: any) => r.appNo).sort());
      }
    }
    setTestNow(TEST_NOW);
  });

  it('sends a download with safe headers and records the export in the audit trail', async () => {
    const before = await one(getPool(), "SELECT count(*)::int AS n FROM audit_events WHERE action = 'REPORT_EXPORTED'");
    const res = await ro.get('/api/v1/reports/pending/csv?regionId=DEMO-WEST');
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="pending-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    const rows = await q(getPool(), "SELECT actor_role, entity_id, after_state FROM audit_events WHERE action = 'REPORT_EXPORTED' ORDER BY id DESC LIMIT 1");
    expect(rows[0]).toMatchObject({ actor_role: 'REGIONAL_OFFICER', entity_id: 'pending' });
    expect(rows[0].after_state).toMatchObject({ report: 'pending', filters: { regionId: 'DEMO-WEST' }, rowCount: 1 });
    const after = await one(getPool(), "SELECT count(*)::int AS n FROM audit_events WHERE action = 'REPORT_EXPORTED'");
    expect(after.n).toBe(before.n + 1);
    expect((await verifyChain(getPool())).ok).toBe(true);
  });

  it('spreadsheet formulas in stored text come out neutralised', async () => {
    const original = await one(getPool(), 'SELECT name FROM institutions WHERE id = $1', [refs.institutions.pune]);
    const evil = '=HYPERLINK("http://evil.test","Open"),x';
    await q(getPool(), 'UPDATE institutions SET name = $2 WHERE id = $1', [refs.institutions.pune, evil]);
    try {
      const res = await ro.get('/api/v1/reports/pending/csv?regionId=DEMO-WEST');
      const cells = parseCsv(res.body).flat();
      expect(cells.some((c) => c.startsWith('='))).toBe(false);
      expect(cells).toContain(`'${evil}`);
    } finally {
      await q(getPool(), 'UPDATE institutions SET name = $2 WHERE id = $1', [refs.institutions.pune, original.name]);
    }
  });

  it('scope: other regions and institutions never appear, and filters cannot widen access', async () => {
    const appNo = async (id: string) => (await one(getPool(), 'SELECT app_no FROM applications WHERE id = $1', [id])).app_no;
    const west = parseCsv((await ro.get('/api/v1/reports/pending/csv')).body).slice(1).map((r) => r[0]);
    const northOnly = parseCsv((await roNorth.get('/api/v1/reports/pending/csv')).body).slice(1).map((r) => r[0]);
    expect(west).toEqual([await appNo(casePune)]);
    expect(northOnly).toEqual([await appNo(caseNorth)]);
    const probe = parseCsv((await roNorth.get(`/api/v1/reports/pending/csv?regionId=DEMO-WEST&institutionId=${refs.institutions.pune}`)).body);
    expect(probe).toHaveLength(1); // header only
    expect(parseCsv((await auditor.get('/api/v1/reports/pending/csv')).body).slice(1)).toHaveLength(2);
  });

  it('institutions get only their own rows, without owner or waiting-reason columns, and only institution-safe reports', async () => {
    const res = await pune.get('/api/v1/reports/pending/csv');
    expect(res.statusCode).toBe(200);
    const [header, ...rows] = parseCsv(res.body);
    expect(header).not.toContain('Owner');
    expect(header).not.toContain('Waiting for');
    expect(rows).toHaveLength(1);
    expect(res.body).not.toMatch(/Dr\. |scrutiny\./);
    for (const name of ['overdue', 'due-soon', 'evc-unscheduled', 'evidence-backlog']) {
      expect((await pune.get(`/api/v1/reports/${name}/csv`)).statusCode, name).toBe(404);
    }
  });

  it('refuses callers without access: 401, 404 for unknown or unavailable reports, 403 without the export capability', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/reports/pending/csv' })).statusCode).toBe(401);
    expect((await ro.get('/api/v1/reports/nope/csv')).statusCode).toBe(404);
    expect((await committee.get('/api/v1/reports/pending/csv')).statusCode).toBe(404);
    expect((await admin.get('/api/v1/reports/pending/csv')).statusCode).toBe(404);
    const noExport = actorLike(['REPORTS_VIEW', 'APPLICATION_VIEW_SCOPE']);
    await expect(exportReportCsv(getPool(), noExport, requireReport(noExport, 'pending'), {})).rejects.toMatchObject({ status: 403 });
  });

  it('rejects invalid filters and enforces the row bound instead of truncating', async () => {
    for (const bad of ['submittedFrom=2026-13-40', 'institutionId=abc', 'submittedFrom=2026-11-10&submittedTo=2026-11-01']) {
      expect((await ro.get(`/api/v1/reports/pending/csv?${bad}`)).statusCode, bad).toBe(422);
    }
    expect((await ro.get('/api/v1/reports/evidence-backlog/csv?stageKey=SCRUTINY')).statusCode).toBe(422);
    const actor = actorLike();
    const def = requireReport(actor, 'pending');
    const tooMany = exportReportCsv(getPool(), actor, def, {}, 1);
    await expect(tooMany).rejects.toBeInstanceOf(AppError);
    await expect(tooMany).rejects.toMatchObject({ status: 422, code: 'EXPORT_TOO_LARGE' });
    expect((await exportReportCsv(getPool(), actor, def, {}, 2)).rowCount).toBe(2);
  });
});
