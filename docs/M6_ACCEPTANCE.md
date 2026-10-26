# M6 acceptance and closure

Verified locally on 26 Oct 2026. M6 closes the agreed B1–B7 scope; PDF extraction, M7 and demo preparation remain separate steps. All data/rules are synthetic; no live AICTE/NSWS connection or real email was used. The system never records regulatory decisions on its own.

## Scope and evidence

| Requirement | Delivered | Automated evidence |
|---|---|---|
| Role dashboards and shared filtered lists | Institution/officer/management views; region × stage pending counts/ageing; seven report definitions; denominators and ageing anchors | `m6-reports.test.ts` — 9 tests, including R01 tile/list/pagination/elapsed-time reconciliation and on-time receipt semantics |
| Safe CSV | Same report definition/filters/scope, quoting/formula neutralisation, institution-safe columns, 5000-row rejection, export audit | `m6-csv.test.ts` — 9 tests, including R01 exported identities and empty results |
| Scoped audit viewer | Actor/action/entity/case/local-date filters, scoped totals/facets/detail, paging, global integrity result with limits | `m6-audit.test.ts` — 13 tests; earlier audit tamper/security tests remain passing |
| Mock import | Pinned mapping, immutable parsed raw/canonical source records and run counts, idempotent source identities, separate mirrors, regional cursors | `m6-integration.test.ts` — 16 tests; fresh West 2 accepted / 1 duplicate / 2 invalid / 3 reconciliation, identical new-key retry 8 duplicates |
| Human reconciliation | Scoped queue/detail, reasoned retry/correction/dismissal, item/cursor versions, immutable attempts, atomic state/audit/outbox | `m6-reconciliation.test.ts` — 18 tests, including current scope/revocation, stale/concurrent requests, rollback and local case isolation |
| Web behaviour | Role-aware nav, URL filters/paging, refresh time/30-second polling, loading/empty/error/retry/stale states, readable status labels | B3–B6b browser walkthroughs in WORK_LOG; B7 combined acceptance below |

M6 adds **65 tests** to the M5 baseline of 139; the full suite has **204 tests across 16 files**. No new behaviour test was added for B7's documentation-only change.

## B7 combined verification

`npm run typecheck`, `npm test`, `npm run build` and `git diff --check` pass. Full test output is retained locally in `var/b7-full-tests.log` (ignored).

The existing `npm run demo:scenarios` command prepared nine cases successfully. Development integration history was retained; the application database was not reset during B7. Test resets affect only the isolated `aicte_test` database. Do not rerun scenario creation on an already prepared database unless additional synthetic cases are intended.

As `ro.west`, Dashboard → management → Demo West showed **6 Applications in process**. Clicking the tile preserved `regionId=DEMO-WEST`, listed six cases and downloaded CSV successfully. Live API verification matched all six exported IDs to the report: **01001, 01002, 01003, 01005, 01007, 01008**. The institution export omitted Owner and Waiting-for columns, and the institution integration endpoint returned 403. The auditor UI reported **Global chain intact**, with **179 events** at verification time; this is a local observation, not a fixed expected production count. Browser console error output was empty.

B6b's browser-verified blocked retry → explicit correction → resolved item, older-revision dismissal and duplicate retry remained present in B7. Run totals still summed correctly and the queue retained one RESOLVED, one DISMISSED and three OPEN items. B6b tests cover original raw/run immutability and source correction history. No regulatory case fields were updated by integration.

Local evidence (ignored): `var/b7-closure-evidence.json`, `var/b7-pending-west.csv`, `var/b7-demo-scenarios.log`. Screenshots are local verification artifacts outside the repository.

## Reproduce the UI checks

1. Start PostgreSQL/API/web; use the local outbox worker. On a disposable development database only, `npm run db:reset` then `npm run demo:scenarios` prepares the nine cases. Reset clears imports/reviews too.
2. Regional officer → Dashboard → management → Demo West → Applications in process → Download CSV. Compare count and IDs under the same filters. Case ages/overdue counts follow business time.
3. Auditor → Audit log → filter a case/action/actor/date → expand an event → Verify integrity. Read the displayed global-chain limits.
4. Regional officer → Mock integration → import reason → Run mock sync. On a fresh West import expect 8 total, 2 accepted, 1 duplicate, 2 invalid, 3 reconciliation and 5 queue items.
5. Open DEMO-WEST-UNKNOWN → reason → Retry original record (still OPEN). Select an explicitly reviewed valid source code and apply with a reason (RESOLVED). Dismiss the older-revision item with a reason; repeat the original fixture (8 duplicates, closed items remain closed).

## Boundaries and next step

- Expiring-document drill-down, trends and escalation totals are unavailable, explicitly labelled. Existing document/notification screens are linked; no invented count is substituted. Separate per-user workload charts are not delivered; report owner columns and the region/stage matrix are available.
- Export limit 5000 rows; no streaming/background exports, historical dashboard snapshots or national-scale load claims.
- Audit is tamper-evident, with application/database-trigger protections; a superuser can bypass them. Independent protected checkpoints remain a production requirement.
- Mock integration is local, bounded and disconnected; no live connector, writeback or scheduled import. Human correction affects only mirrors and never case approval, compliance, lifecycle, frozen snapshots, pinned policies, obligations or deadlines.
- Document metadata is manual. No PDF extractor/OCR worker, source highlight or extraction-accuracy result exists yet.

Next: **C1, 20–30 labelled synthetic text/scanned PDFs and a reproducible generator/manifest**. Follow NEXT_PROMPT; stop after C1. Current local commits are not pushed under the standing no-push instruction.
