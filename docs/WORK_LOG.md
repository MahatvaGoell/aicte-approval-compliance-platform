# Work log (national round, SIH26262, Team Infera)

Chat-by-chat notes. Plan: `../STEP_PLAN.md` (outer folder, not in this repo). Pehle isko padho, phir NATIONAL_ROUND_PLAN / NEXT_PROMPT sirf zarurat par.

## Project kya hai
AICTE approval workflow + compliance + alert system (PS SIH26262). Route -> Clock -> Escalate -> Watch -> Prove. **System kabhi approve/reject nahi karta**; sirf `DECISION_RECORD` wala user karta hai. Sab data synthetic, real email/service nahi. Har rule pe label `APH_CLAUSE` / `ADMIN_INSTRUCTION` / `DEMO_ASSUMPTION`. Approval outcome, compliance, lifecycle alag fields; upload != verification != closure; case apni policy version pe rehta hai.
Status: M1-M5 done. M6 B2-B6b done (204 tests); B7 closure baaki. PDF expiry, M7, demo prep baaki. M8 (AI/load) national plan me nahi.

## Folder structure
- `server/src/modules/`: applications (commands.ts, commands-m2.ts, command-kit.ts), audit, compliance (status.ts, routes.ts), deadlines (engine.ts, scheduler.ts, calendar.ts), documents, evc, identity (permissions.ts), notifications (worker.ts), ops, outbox, policy, reference, workflow
- `server/src/`: app.ts, db.ts (AppError, withTx), lib/clock.ts (now()), seed/, worker/, http/
- `server/migrations/`: 001..007 (agla naya = 008_*.sql; purane migration mat chhedo). `server/test/`: m1..m6 tests + helpers.ts. `server/scripts/`: demo:scenarios
- `web/src/`: App.tsx (sectionFor, nav), api.ts, ui.tsx, motion.tsx (Icon), styles.css, pages/ (Home, Compliance, Audit, Case*, Evc, Ops, Policy ...)
- `docs/`: BUILD_PLAN (spec), PROGRESS, NEXT_PROMPT, HANDOFF, FOUNDATIONS, NATIONAL_ROUND_PLAN

## Rules jo har step me lagte hain (AGENTS.md)
- State change + `recordAudit` ek `withTx` me; baad ka kaam `emitEvent` (outbox). Case change sirf `POST /applications/:id/commands` (COMMANDS me guard + run).
- Mutation = `Idempotency-Key` + `expectedVersion`. Capabilities `identity/permissions.ts`; scope `applicationScopeSql` / `institutionScopeSql`; out-of-scope = 404.
- Time sirf `now()` (lib/clock.ts). Errors `AppError`. Zod at API boundary. Web: TanStack Query, `Status/Loading/ErrorState/MutationError`, CSS tokens, status text + colour.
- Finish: `npm run typecheck` + `npm test` (+ `npm run build`, `git diff --check` M6 DoD me).
- Commits/docs me AI/Claude attribution nahi. Hinglish short.

## Exact requirements
**M6** (NEXT_PROMPT.md "Milestone 6 scope" 1-7; NATIONAL_ROUND_PLAN 4.4; BUILD_PLAN 14, 17, 18, 20 R01, 21):
1. Role dashboards (institution / officer / management region x stage); har number click -> same-scope filtered list.
2. Reconciled reports: common filters, summary = drill-down = CSV (R01), denominators + ageing anchor defined, last refresh / empty / failed states.
3. CSV: server-side scope, formula-injection safe, bounded size, institution ko internal notes nahi.
4. Audit viewer: actor/action/date/case filter, paging, "Verify integrity" (`POST /audit/verify`), absolute immutability claim nahi.
5. Mock integration: fixtures (valid, changed, duplicate, invalid, unknown-code, out-of-order), idempotent, raw events retained, "mock / disconnected from AICTE" label.
6. Reconciliation queue: reason + run + source ids, resolution needs reason/version/idempotency/audit; mirror fields only, kabhi decision/snapshot/policy nahi.
7. Web/demo: nav labels, run counts. Tests list: NEXT_PROMPT "Tests required".
**PDF expiry** (NATIONAL_ROUND_PLAN 4.3): pdfjs text, tesseract.js OCR fallback (offline), date rules (valid till/expiry vs issued), output `{field,value,page,excerpt,bbox,method,ambiguous}`, abstain if unsure, M5 review screen pe sirf suggestion + highlight, officer confirm ke baad hi save, `npm run evaluate:extraction` 20-30 synthetic PDFs accuracy table.
**M7** (4.5, BUILD_PLAN 21): policy impact preview (reminder 7->14, deterministic, running cases apne version pe), gap panel, rule-based priority queue (factors dikhao, "AI" nahi).
**Demo** (4.6, BUILD_PLAN 19): DEMO_SCRIPT.md (7 min), reset = `db:reset && demo:scenarios`, chaos test 20-30 kill/restart (0 duplicate, 0 missing, audit verify pass), 3 rehearsals. EVC climax = conflicted expert blocked.

## STEP_PLAN.md se alag / dhyan do
- Repo path: `SIH_FINAL/aicte-approval-compliance-platform/` (alag git repo; outer repo me wo untracked hai). Commit isi inner repo me.
- STEP_PLAN "Commit + push" likhta hai, par abhi **push nahi** (user ka order). NEXT_PROMPT "push to main authorised" bhi abhi lagu nahi.
- NEXT_PROMPT M6 bada hai (raw events, run outcomes, reconciliation resolution, idempotency by source+external id+revision, institution data hiding). STEP_PLAN B6 sirf "mock integration + tests" kehta hai: B1 me sub-tasks me todna.
- NEXT_PROMPT: "M7 priority/scoring/readiness/policy-impact M6 me mat banao" - STEP_PLAN Phase D me ye M7 me aate hain (theek).
- NEXT_PROMPT DoD me `npm run build` + `git diff --check` bhi hai; STEP_PLAN me nahi.
- NATIONAL_ROUND_PLAN 4.4 R01 test + "Verify integrity" button; STEP_PLAN B5 me button ka zikr nahi.
- Dashboards pe "invented official timeline/performance figure" nahi.

## M6 design (B1)
**Ek read-model, teen jagah same**: `reports/service.ts` me har report ek definition (FROM+WHERE+columns). Dashboard tile count, drill-down rows aur CSV teeno isi se bante hain => R01 reconcile by construction. Scope hamesha `applicationScopeSql(actor)` se; filter uske upar AND (out-of-scope region filter = khaali, leak nahi). Time `now()`. Koi migration B2-B5 me nahi; sirf B6 me `006_integration.sql`.

**Naye files**: `server/src/modules/reports/{filters,definitions,service,routes}.ts` (B2; CSV `csv.ts` B4), `modules/audit/routes.ts` extend (B5), `modules/integration/{contract,fixtures,import,reconcile,routes}.ts` + `migrations/006_integration.sql` + `server/fixtures/portal-export.json` (B6), `server/test/m6-{reports,csv,audit,integration}.test.ts`, web: `pages/Dashboard.tsx`, `Reports.tsx`, `Integration.tsx`, `Audit.tsx` update (B3-B6), `app.ts` me routes register.

**Reports (B2)**, filters: `regionId, institutionId, categoryCode, stageKey, submittedFrom, submittedTo, page, pageSize<=100`. Entity application unless likha:
| name | kaun dekhe | definition |
|---|---|---|
| `pending` | office + institution | lifecycle SUBMITTED/AWAITING_CLASSIFICATION/IN_PROCESS/AWAITING_DECISION (denominator for % nahi, sirf count) |
| `overdue` | office | pending + koi ACTIVE office clock (STAGE_HANDLING/EVC_*) `current_due_at <= now()` |
| `due-soon` | office | pending, not overdue, ACTIVE clock due within 7 din (`DEMO_ASSUMPTION`) |
| `awaiting-institution` | office + institution | live stage AWAITING_RESPONSE |
| `evc-unscheduled` | office | EVC stage ready (`evc_readiness`) aur koi live visit nahi |
| `evidence-backlog` (obligation) | office | state EVIDENCE_SUBMITTED/UNDER_VERIFICATION; `onTime` receipt se alag dikhao |
| `obligations-overdue` (obligation) | office + institution | state OPEN + ACTIVE OBLIGATION_SUBMISSION clock due <= now (same as `complianceStatus`) |
Row: `id, appNo, institution, region, stage, stageState, owner, pendingAction, dueAt, dueBasis, overdueDays, waitingReason (INSTITUTION_RESPONSE/OFFICER_REVIEW/VISIT_AVAILABILITY/EXTERNAL_INFORMATION/UNKNOWN), ageingDays`. Ageing anchor = live stage `entered_at`; case age = `submitted_at`. Institution ko owner, officer clocks, waitingReason internal detail nahi; sirf office+institution reports. Expiring-documents tile B2 me nahi (doc validity clock alag, B3 pe "unavailable" dikhega).

**Endpoints** (sab `/api/v1`): `GET /reports` (actor ke liye catalogue), `GET /reports/:name` -> `{name, filters, total, page, pageSize, rows, definition:{denominator, ageingAnchor}, refreshedAt}`; `GET /dashboards/:view` (`institution` = role INSTITUTION_REP, `officer` = STAGE_WORK/STAGE_ASSIGN/EVC_REVIEW, `management` = REPORTS_VIEW; galat view 403) -> `{tiles:[{key,label,count,report,filters}], matrix (management: region x stage pendency + avg ageing), refreshedAt, pollSeconds:30}`. Anjaan/unauthorised report naam = 404. Bad filter = 422. B4: `GET /reports/:name?format=csv` + capability `REPORTS_EXPORT` (officers, auditor, institution safe columns), max 5000 rows, `=+-@\t\r` prefix pe `'`. B5: `GET /audit` me `from/to/actor/action/applicationId/page` + scoped `total`; institution ko sirf `visibility=INSTITUTION`; `POST /audit/verify` same. B6: `POST /integration/sync`, `GET /integration/runs`, `GET /integration/reconciliation`, `POST /integration/reconciliation/:id/resolve` (capabilities `INTEGRATION_VIEW`, `INTEGRATION_RESOLVE`; reason + expectedVersion + Idempotency-Key + audit + outbox ek tx me).

**Tests**: B2 `m6-reports.test.ts` R01 (tile = total = pages ka sum, empty result, demo time aage badhne pe overdue badle), scope (dusra region/institution 0 rows, institution `overdue` = 404, committee member management = 403, 401), bad filter 422, on-time evidence late review pe `obligations-overdue` me nahi. B4 CSV escape/formula/bound/institution columns. B5 audit scope + filters. B6 duplicate/retry/older revision/unknown code/run totals/resolution concurrency/rollback/mock approve-reject nahi kar sakta.

**STEP_PLAN me sudhaar (suggest, file nahi badli)**: B5 me "Verify integrity" button + date/actor/action filter jodo. B6 bada hai: do chats karo (6a: contract + fixtures + migration + import + run counts, 6b: reconciliation queue + resolve + web). B7 me `npm run build` + `git diff --check` jodo. B2/B3/B4 ke "Common rules" same.

## Log
- B6b done: migration `007_integration_reconciliation.sql`, scoped queue/detail APIs aur reason/version/idempotency wale RETRY / CORRECT_AND_RETRY / DISMISS; immutable attempt history, pinned mapping, mirror-only changes, original raw/run counts preserved.
  Web `/integration`: synthetic sync, run history, queue filters/paging, raw + current mirror, reviewed corrections/dismissal/history; auditor read-only. Browser: blocked retry -> explicit correction -> resolved; older revision dismissed; reimport = 8 duplicates, closed items stay closed; stale-cursor 409 retains entered fields; no unexpected console errors.
  Baseline **186/186**, 18 new `m6-reconciliation.test.ts` tests, final **204/204**; typecheck/build/diff checks pass. Concurrency/stale cursors, scope/revocation, atomic rollback and local case/decision isolation covered; logs `var/b6b-*-tests.log` (ignored).
  Contract/PROGRESS/LIMITATIONS updated. B6b par rukna; one local commit, **push nahi**. Next = B7 M6 closure; PDF expiry/M7 abhi start nahi.
- A2 done: ye file bani. Koi code change nahi.
- B1 done: M6 design upar. Code nahi.
- B2 done (server only): `server/src/modules/reports/{filters,definitions,service,routes}.ts`, registered in `app.ts`; `GET /reports`, `GET /reports/:name`, `GET /dashboards/:view`. Test `server/test/m6-reports.test.ts` (9, R01 included). Baaki: web (B3), CSV (B4), audit (B5), integration (B6). `stageKey=NONE` = no live stage. Expiring-documents / escalations / trends tiles "unavailable" dikhte hain, count nahi.
- B3 done (web only): `web/src/pages/Dashboard.tsx` (`/dashboard`, officer/management tabs, tiles, region x stage matrix, unavailable list), `web/src/pages/Reports.tsx` (`/reports`, `/reports/:name`, filters in URL, paging, definitions), nav + `sectionFor` (11, 12) in `App.tsx`. Browser checked: officer, management, institution; tile -> same filtered report. Polling 30 s, stale/failed banner with retry. Baaki: CSV button (B4), audit (B5), integration (B6).
- B4 done: `GET /reports/:name/csv` (same filters/scope as the JSON report, `reports/csv.ts` + `exportReportCsv` in service). New capability `REPORTS_EXPORT` (institution rep, regional, bureau, authority, auditor). Max 5000 rows, bigger = 422 `EXPORT_TOO_LARGE` (no truncation). Formula-injection prefix `'`, all cells quoted, BOM + CRLF. Institutions: no Owner/Waiting columns. Each export audited as `REPORT_EXPORTED`. Web: "Download CSV" button on `/reports/:name` (`download()` in api.ts). Tests `server/test/m6-csv.test.ts` (9). Total 157 tests pass. Note: ek baar full `npm test` fail hua (output save nahi kiya), baad ke 2 run pass; flaky ho sakta hai, dhyan rakho.
- B5 done: `audit/service.ts`, `audit/routes.ts`, exported `reports/filters.ts` isoDate; paged/scoped list, action/actor/entity facets, exact-case/local-date filters aur on-demand detail. Regional grants ko application-less events nahi milte; internal visibility har read par checked.
  Integrity result me `verifiedAt`/limits; scoped viewers ko global `checked`/`firstBrokenId` nahi. `web/src/pages/Audit.tsx`: URL filters, paging, detail expansion, retry/empty/stale states; async facets ke baad actor selection retain hota hai.
  `server/test/m6-audit.test.ts`: 13 tests; baseline **157/157**, final **170/170**, typecheck/build/diff checks pass. Full test logs `var/b5-baseline-tests.log` aur `var/b5-full-tests.log` (local/ignored); purana full-test failure reproduce nahi hua.
  Browser: combined filters + local dates, reload/actor restore, disjoint pages, empty result, case link, detail aur integrity verified; console errors empty. Baaki: **B6a**, phir B6b/B7. B5 par rukna; push nahi kiya.
- B6a done: `006_integration.sql`, `modules/integration/{access,contract,fixtures,import,routes}.ts`, fixed synthetic `server/fixtures/portal-export.json`; scoped sync/runs APIs, canonical IDs + immutable raw receipts, mirror-only updates, regional cursor versions aur retained reconciliation items.
  `docs/INTEGRATION_CONTRACT.md` me source schema, mapping v1, field-authority matrix, limits aur API examples. Fresh West counts: 2 accepted / 1 duplicate / 2 invalid / 3 reconciliation; new-key retry = 8 duplicates, mirror/queue unchanged.
  `m6-integration.test.ts`: 16 tests. Baseline **170/170**, final **186/186**, typecheck/build/diff checks pass; logs `var/b6a-*-tests.log` (ignored). Idempotency/concurrency, ordering/conflicts, scope/revocation, immutable history, atomic rollback aur local decision/obligation isolation covered.
  Live local API import/replay/retry verified. Server-only step: RO login ke baad `/api/v1/integration/runs` se counts dekh sakte ho; Integration UI aur reasoned/versioned queue resolve/retry **B6b** me. B6a par rukna; push nahi kiya.

