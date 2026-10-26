# Work log (national round, SIH26262, Team Infera)

Chat-by-chat notes. Plan: `../STEP_PLAN.md` (outer folder, not in this repo). Pehle isko padho, phir NATIONAL_ROUND_PLAN / NEXT_PROMPT sirf zarurat par.

## Project kya hai
AICTE approval workflow + compliance + alert system (PS SIH26262). Route -> Clock -> Escalate -> Watch -> Prove. **System kabhi approve/reject nahi karta**; sirf `DECISION_RECORD` wala user karta hai. Sab data synthetic, real email/service nahi. Har rule pe label `APH_CLAUSE` / `ADMIN_INSTRUCTION` / `DEMO_ASSUMPTION`. Approval outcome, compliance, lifecycle alag fields; upload != verification != closure; case apni policy version pe rehta hai.
Status: M1-M5 done (139 tests). M6, PDF expiry, M7, demo prep baaki. M8 (AI/load) national plan me nahi.

## Folder structure
- `server/src/modules/`: applications (commands.ts, commands-m2.ts, command-kit.ts), audit, compliance (status.ts, routes.ts), deadlines (engine.ts, scheduler.ts, calendar.ts), documents, evc, identity (permissions.ts), notifications (worker.ts), ops, outbox, policy, reference, workflow
- `server/src/`: app.ts, db.ts (AppError, withTx), lib/clock.ts (now()), seed/, worker/, http/
- `server/migrations/`: 001..005 (naya = 006_*.sql; 001 mat chhedo). `server/test/`: m1..m5 tests + helpers.ts. `server/scripts/`: demo:scenarios
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

## Log
- A2 done: ye file bani. Koi code change nahi.
