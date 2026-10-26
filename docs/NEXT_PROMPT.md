# Prompt for the next session — Milestone 6

Copy everything below the line into the coding session.

---

You are continuing the **AICTE Approval & Compliance Platform** (SIH 2026, SIH26262). M1–M5 are complete. Implement **Milestone 6 only**: role dashboards, reconciled reports/CSV exports, audit viewer improvements and mock integration with reconciliation.

## Read first

1. AGENTS.md — product and engineering rules.
2. docs/BUILD_PLAN.md — §14 dashboards/screens, §17 integration, §18 audit/security, §20 R01/security tests, §21 milestone boundary.
3. docs/PROGRESS.md — M4/M5 details and limitations; docs/FOUNDATIONS.md — reusable modules.
4. Existing application list/view, permission scopes, compliance/status.ts and routes.ts, deadlines/engine.ts and scheduler.ts, notifications/worker.ts, audit routes/hash chain, web/src/pages/Home.tsx, Compliance.tsx, Audit.tsx, App.tsx and shared UI/api/session helpers.
5. server/test/helpers.ts and M1–M5 tests for scope, versions, idempotency and rollback.

## Setup

```bash
npm install
cp .env.example .env              # only if missing
npm run db:start                  # separate terminal, UTF8 PostgreSQL / 54329
npm run db:reset                  # disposable synthetic local database only
npm test                         # baseline: 139 passing
npm run dev:api                   # API 4000; separate terminal: npm run dev:web (5180)
npm run dev:worker                # separate terminal; local outbox only
npm run demo:scenarios            # nine cases, including obligation and expired lease renewal
```

## Existing M5 boundary

Private uploads/immutable versions, manual metadata/document verdicts, exact evidence receipts, condition obligations and separate submission/verification/validity clocks work. Upload ≠ document acceptance ≠ obligation fulfilment. A pending renewal leaves the old expired verified version current. Receipt timeliness is immutable. Case/application lists derive compliance status at read time. Attachments link exact versions to current finding responses/EVC reports before review. Optional pinned compliance config is absent on older published policies; never rewrite those policies. Preserve these behaviours and scope checks.

## Milestone 6 scope

Build vertical slices: numbered migration if needed → scoped read model/API → web → tests.

1. **Role dashboards**: institution next actions/applications/findings/upcoming visits/obligations/expiring documents; officer due-soon/overdue work, verification backlog, EVC and escalations; management region × stage pendency/ageing, workload, visit readiness/scheduling and renewal backlog. Reuse current state/clock definitions. Submission lateness and officer verification waiting stay separate. Show unavailable information honestly.
2. **Reconciled reports**: common validated filters and authorised query definitions for summary, drill-down and CSV. R01: totals, record identities and filters reconcile, including pagination/empty results. Show owner, pending action, due date/rule, overdue duration and waiting reason when available. Define denominators and ageing anchors. Every dashboard shows last refresh, polling interval, loading/stale/failed/empty/retry states. No invented official timelines or performance figures.
3. **CSV**: server-side capability/current scope, identical filters, safe quoting and spreadsheet-formula injection protection, bounded export size. Institutions receive no internal notes or hidden document/visit data. Recheck access independently; never trust unscoped client record IDs.
4. **Audit viewer**: reuse existing append-only hash chain/integrity endpoint; add useful actor/action/date/case filtering, paging, scoped totals and record links using shared theme. Explain integrity limits; no absolute immutability claim or audit rewriting.
5. **Mock integration**: document source contract, mapping version and field-authority matrix. Import checked-in synthetic fixtures containing valid, changed, duplicate, invalid, unknown-code and out-of-order events. Retain raw events and run outcomes. Idempotency by source system + external ID + event ID/revision; retries and older revisions never overwrite newer mirror data.
6. **Reconciliation queue**: unknown mappings and invalid/conflicting/out-of-order events retain reason, source identifiers and run; never coerce codes. Authorised resolution/retry needs reason, versions, idempotency and audit. Start read-only shadow reconciliation: update mirror fields only, never authority decisions, frozen snapshots, pinned policies or case lifecycle. Any necessary case mutation must use a permitted import command through the case command boundary.
7. **Web/demo**: role-aware nav/section labels, dashboard drill-down/report/export and integration run/reconciliation UI. Demonstrate accurate accepted/duplicate/invalid/reconciliation run counts. Clearly label the adapter mock, synthetic and disconnected from AICTE/NSWS. No scraping or real external service/email calls.

## Tests required

- R01 summary/drill-down/export reconcile under identical filters, pagination, empty results and elapsed demo time.
- Cross-institution/region, unassigned/revoked/expired grants and read-only roles cannot leak dashboard counts, audit rows, exports or integration data. Institutions cannot see internal attachments/notes/clocks.
- On-time evidence awaiting late review stays on time; a pending renewal leaves expired verified-document counts unchanged.
- CSV escaping/formula injection, invalid filters and export bounds.
- Import retry/duplicate idempotency, changed/older revisions, unknown/invalid codes, raw records/mapping versions/run totals, resolution concurrency and atomic state/audit/outbox rollback.
- Mock events cannot approve/reject, fulfil obligations, bypass capabilities or rewrite snapshots/policies.
- Existing **139 tests** pass. Fixed business clock, real local PostgreSQL, synthetic fixtures and local outbox only.

## Definition of done

- npm run typecheck, npm test, npm run build and git diff --check pass.
- Browser: dashboard → filtered drill-down → matching safe CSV; scoped audit integrity result; mock import → reconciliation → reasoned resolution/retry with accurate run counts.
- Update PROGRESS.md with actual test counts/features/limitations; update README/HANDOFF as needed.
- Replace NEXT_PROMPT.md with an M7 prompt based on BUILD_PLAN. Do not implement M7 priority/scoring/consistency/readiness/policy-impact differentiators, M8 AI or separately proposed national-level additions.
- Commit and push tested work to GitHub main as authorised. No AI-tool attribution in commits, PRs or docs.
