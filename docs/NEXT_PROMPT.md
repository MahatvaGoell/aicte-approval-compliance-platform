# Prompt for the next agent session — Milestone 4

Copy everything below the line into the coding agent.

---

You are continuing the **AICTE Approval & Compliance Platform** (SIH 2026, problem statement SIH26262) in this repository. Milestones 1–3 are complete. Your job is **Milestone 4** only: the Expert Visit Committee (EVC) readiness queue, expert directory, conflicts, suggestions, confirmed reservations, rescheduling and visit reports.

## Read first

1. `AGENTS.md` — product rules and code conventions. Follow them exactly.
2. `docs/BUILD_PLAN.md` — especially §7 data model (EVC tables), §10 deadlines, §12 EVC, §15 API, §20 tests E01–E03, §21 milestones.
3. `docs/PROGRESS.md` — what exists and known gaps.
4. `docs/FOUNDATIONS.md` — the deadline calendar is already used by `server/src/modules/deadlines/engine.ts`; reuse both.
5. Skim `server/src/modules/applications/commands.ts`, `command-kit.ts`, `commands-m2.ts`, `server/src/modules/workflow/workflow.ts`, `server/src/modules/deadlines/engine.ts` and `scheduler.ts`, `server/test/helpers.ts`, `server/test/m3-deadlines.test.ts`, `web/src/pages/Case.tsx`, `CaseM2.tsx`, `CaseM3.tsx`. Match their style.

## Setup

```bash
npm install
cp .env.example .env              # if .env does not exist
npm run db:start                  # separate terminal (or: docker compose up -d db)
npm run db:reset
npm test                          # must show 99 passing before you start
npm run dev:api                   # then, in another terminal: npm run demo:scenarios
```

## Current EVC behaviour

Routes `SCRUTINY_EVC`, `ONLY_EVC`, `EVC_SAC` and `EVC_SHC` reach the `EVC` stage (owner role `REGIONAL_OFFICER`, `allowReturn: true`, completion `EVC_REPORT_ACCEPTED` + `NO_OPEN_FINDING`) and stop there: `evaluateCompletion` checks `evc_visits` through a `to_regclass` fallback because the table does not exist yet. Seeded experts: `evc1`–`evc4@demo.aicte.test` (committee `EVC-POOL`); `ro.*` officers hold the extra capability `EVC_SCHEDULE`.

## Milestone 4 scope

Build each item as a working vertical slice (migration → service/command → API → web → tests).

1. **Schema** (new migration `004_evc.sql`): `expert_profiles` (user, specialisms, home region, eligibility flags, max visits per month), `expert_availability` (tstzrange), `declared_conflicts` (expert, institution, reason), `evc_visits` (application, stage instance, `ready_at`, mode PHYSICAL/ONLINE/HYBRID, time zone, scheduled tstzrange, state `PROPOSED → CONFIRMED → HELD → REPORT_SUBMITTED → REPORT_ACCEPTED`, plus `CANCELLED`/`RESCHEDULED` with history), `expert_reservations` (visit, expert, tstzrange, active flag) with a **database exclusion constraint** (`btree_gist`, no overlapping active reservation per expert), `visit_events` (history), `visit_findings`. Seed synthetic profiles, availability and one declared conflict.
2. **Readiness queue**: a case enters the EVC queue only when its EVC stage is live and earlier stages are complete; record `ready_at` and measure scheduling delay from it. Queue API scoped by region with filters.
3. **Conflict checks**: own institution, declared conflict, same-region affiliation (configurable which are mandatory; label demo). Missing directory data shows **information unavailable**, never "no conflict".
4. **Suggestions**: eligible experts filtered by specialism, availability and no overlap; ranked by deadline urgency, expert workload and travel practicality, with each factor shown. Pure function with unit tests.
5. **Commands** (through `POST /applications/:id/commands`, capability `EVC_SCHEDULE` and region scope): `PROPOSE_VISIT`, `CONFIRM_VISIT` (reserves every member in one transaction; the exclusion constraint rejects a competing confirmation → 409 with a clear message), `RESCHEDULE_VISIT` (replaces reservations, keeps history and reason, regenerates alerts), `CANCEL_VISIT`, `RECORD_VISIT_HELD`, `SUBMIT_VISIT_REPORT` (EVC member assigned to the visit), `ACCEPT_VISIT_REPORT` / `RETURN_VISIT_REPORT` (regional officer). Replace the `to_regclass` fallback with a direct query. Institution acknowledgement and member confirmation tracked.
6. **Clocks**: add clock types for EVC scheduling due (from `ready_at`) and visit report due (from the visit end) to `deadlines`, with demo rules in the policy and the existing scheduler/ladder. Rescheduling bumps the generation so old reminders go stale.
7. **Web**: EVC queue page (`/evc`) with ready-since and urgency, suggestion panel with factor chips and "information unavailable" warnings, week/month calendar of visits and reservations, visit detail on the case page (mode, members and confirmations, timeline, report submit/accept), expert directory table. Add the route to `sectionFor()` and the nav with an `Icon`.
8. **Demo scenarios**: extend `server/scripts/demo-scenarios.ts` with a case waiting in the EVC queue and one with a confirmed visit.

## Tests required (Vitest, `server/test/m4-*.test.ts`)

- **E01** two confirmations reserving the same expert at overlapping times concurrently → the database rejects the second.
- **E02** reschedule or cancel → reservations replaced with history, alerts of the old generation not sent.
- **E03** visit time passes without a report → stage not completable; after report accepted → completes.
- Conflict detection (own institution, declared conflict, information unavailable); suggestion ranking with factors; queue scoping by region (404 out of scope); EVC member sees only visits they are on.
- All existing tests still pass.

## Definition of done

- `npm run typecheck` and `npm test` pass.
- Update `docs/PROGRESS.md` (mark M4 done, list what was built, tests added, known gaps) and replace `docs/NEXT_PROMPT.md` with a prompt for **Milestone 5** in the same style, based on BUILD_PLAN §11, §12 and §21 and on `docs/FOUNDATIONS.md` (upload checks and storage).
- Do not invent official AICTE rules or timelines; label everything demo.
- Commit with a clear message. Do not add AI-tool attribution lines to commits.
