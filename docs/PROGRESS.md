# Progress

Last updated: 26 Oct 2026 · Specification: [BUILD_PLAN.md](BUILD_PLAN.md) · Agent rules: [../AGENTS.md](../AGENTS.md)

| Milestone | Status |
|---|---|
| M1 — Auth, scopes, records, one complete workflow | **Done** (web screens checked in the browser) |
| M2 — Returns, re-scrutiny, all routes, classification, appeals, policy versioning | **Done** |
| M3 — Deadlines, worker, notifications, escalation, demo clock | **Done** |
| M4 — EVC queue, scheduling, conflicts, reports | **Done** — EVC queue → accepted report → next stage, browser verified |
| M5 — Documents, obligations, verification, lease renewal | **Next** — prompt in [NEXT_PROMPT.md](NEXT_PROMPT.md) |
| M6 — Dashboards, reports, audit viewer, mock integration | Not started |
| M7 — Differentiators (action/gap panel, priority queue, consistency, readiness, preview) | Not started |
| M8 — Optional AI, load/recovery tests, docs, evaluation, rehearsal | Not started |

## M4 — what was built

Baseline: installed dependencies in an isolated checkout of GitHub main, reset the disposable development database and confirmed **99/99 tests** before implementation. Original local M3 work was left untouched.

- Migration `004_evc.sql`: expert profiles, availability ranges, declared conflicts, durable readiness, visits, appointed members, active reservations, report revisions, separate observations and visit events. PostgreSQL `btree_gist` exclusion constraint prohibits overlapping active reservations; one live visit per stage. Reports/observations/events are append-only.
- Readiness is recorded on EVC stage entry after preceding route positions complete; migration backfills existing eligible stages. Queue, total counts, calendar and visit detail are scoped to the active grant. Experts can access only visits assigned under their current EVC committee grant; assignments also populate My work.
- Pinned optional `evc` policy config specifies demo composition, mandatory/advisory conflicts and scheduling/report durations. Fresh synthetic seed includes two selectable experts, an own-institution/declared conflict, an incomplete directory and availability. Published policies are never rewritten; old versions without EVC configuration remain explicitly unconfigured. Capacity uses visit-start month in the pinned policy timezone.
- Deterministic suggestions expose eligibility, specialism, availability, conflicts, overlap, monthly capacity and workload/travel/urgency factors. Incomplete directory means information unavailable; travel uses a home-region proxy, not actual distance. Confirmation revalidates all factors and locks experts in stable order before reserving the entire team atomically.
- Case commands: `PROPOSE_VISIT`, `CONFIRM_VISIT`, `RESCHEDULE_VISIT`, `CANCEL_VISIT`, `ACKNOWLEDGE_VISIT`, `CONFIRM_VISIT_MEMBER`, `RECORD_VISIT_HELD`, `SUBMIT_VISIT_REPORT`, `ACCEPT_VISIT_REPORT`, `RETURN_VISIT_REPORT`. They use existing case versions/idempotency plus visit versions, audit and outbox in one transaction. Booking conflicts return 409. Cancel a planned visit before returning its case; report correction is a separate review action.
- Rescheduling retains the replaced visit and reservations, creates a linked replacement, resets acknowledgements and regenerates report alerts. Failed replacements roll back entirely. Cancellation releases reservations and reopens scheduling from original readiness, including overdue catch-up. A visit must have ended and have institution/member confirmations before it can be recorded held. Time passing never completes it.
- Report revisions keep internal summaries and individually scoped observations. Only assigned EVC members submit; regional report reviewers accept or return the latest revision with a reason. Only an accepted report satisfies the direct EVC completion query. Regulatory approval remains a separate authority decision.
- EVC scheduling/report clocks reuse the calendar, engine, scheduler and escalation ladder. Report reminders resolve appointed experts. Visit events become generic scoped notifications with local email intents; report contents are never copied into email.
- Web: Expert visits nav, filtered/paged readiness queue, week/month reservation view, expert directory, explanation-based team selection, proposal/reschedule forms, confirmations, report editor/revision review and visit history on the case. Action panel selects the relevant EVC clock. Added one-click demo expert accounts and two EVC demo scenarios.
- Tests: `m4-evc.test.ts` (16) and `m4-suggestions.test.ts` (4): E01–E03, concurrent API bookings, independent DB constraint, adjacent slots, capacity, reschedule rollback, stale deliveries, prerequisite queue, conflicts/missing info, expired grants, versions/idempotency, transaction rollback, report confidentiality/revisions and overdue cancellation. Total **119 tests**; final results recorded in the completion report.
- Browser verified: proposal → confirmation → institution acknowledgement → both experts confirm → demo clock advance → held visit → expert report → regional acceptance → explicit stage completion to decision. No approval was automatically recorded.
- Final verification: `npm run typecheck`, `npm test` (**119/119**), `npm run build` and `git diff --check` passed. Browser rescheduling also confirmed a new reserved slot, reset confirmations and a preserved historical visit. Browser console error log was empty during the walkthrough.

M4 limits: expert directory/availability/conflicts are seeded read-only records (no directory administration UI); travel is a region proxy; visit reports are structured text. File attachments and evidence-version links belong to M5. No real portal integration, offline inspection workspace, external email delivery or M5 implementation was added.

## M1 — what exists

### Backend (`server/`)

- **Schema** `migrations/001_init.sql`: regions, institutions, contacts, cycles, users, committees, `capability_grants` (role + institution/region/committee scope + validity dates + extra capabilities), sessions, `policy_sources`, `policy_versions`, applications (frozen `submitted_snapshot` + SHA-256), proposals, `workflow_instances`, `stage_instances` (attempts; DB-enforced one live stage per workflow), stage assignments, transitions, checklist items, recommendations, decisions, `outbox_events`, idempotency keys, system settings, `audit_events` (hash chain; update/delete/truncate blocked by trigger).
- **Identity** (`modules/identity`): scrypt passwords, opaque session token in an httpOnly SameSite=Strict cookie (stored hashed), lockout after 5 failures, per-IP login rate limit (in memory), CSRF via required `x-requested-with: aicte-web` header, role switching, grant validity re-checked on every request. Permission matrix in `permissions.ts`; out-of-scope records return 404.
- **Policy** (`modules/policy`): Zod schema + semantic validation (routes must end in a decision stage, no repeated stages, unknown references, ambiguous classification rules, unreachable stages). Pure `classify()` with a full trace; no match or a tie → `AWAITING_CLASSIFICATION`. Demo policy v1 in `seed/policy-v1.ts`, all rules `DEMO_ASSUMPTION`: categories NEW_INSTITUTION, EXTENSION_OF_APPROVAL, INCREASE_IN_INTAKE (>50% → adds EVC), CHANGE_OF_SITE, OTHER_REQUEST (no rule); routes SCRUTINY_ONLY, SCRUTINY_EVC, ONLY_EVC, EVC_SAC, EVC_SHC.
- **Workflow** (`modules/workflow`): explicit transition tables for application lifecycle and stage states; stage entry with checklist creation and least-loaded auto-assignment; completion conditions evaluated per stage.
- **Applications** (`modules/applications`): create draft, edit draft (blocked after submit: `SNAPSHOT_FROZEN`), submit (validation list → freeze snapshot → classify → first stage), withdraw draft, scoped list with filters and paging, case view (action panel, route progress, classification explanation, stages, completion conditions, permitted commands with reasons, internal-only data hidden from institutions), timeline.
- **Commands** (`POST /api/v1/applications/:id/commands`): `ASSIGN_STAGE`, `SAVE_CHECKLIST`, `RECORD_RECOMMENDATION`, `COMPLETE_STAGE`, `RECORD_DECISION`. Lock → version check → guard → validate → run, with idempotency, transitions, audit and outbox in one transaction.
- **Audit**: `GET /api/v1/audit`, `POST /api/v1/audit/verify` (recomputes the chain).
- **Seed** (`seed/base.ts`): 3 synthetic regions, 6 institutions, committees (scrutiny per region, EVC pool, SAC, SHC), 23 demo users, policy sources, published policy v1.

### Tests (`server/test/`, M1 part)

Full Only-Scrutiny journey; completion blocked without partial change (W03); route explanation; conditional route; no-match classification (W02); frozen snapshot (W05); recommendation does not decide (W06); institution view hides internal notes; audit coverage + chain verify; idempotent replay and key reuse (C01, C02); stale version and simultaneous commands (C03); full rollback on failure (C04); login errors, lockout, session required, CSRF, cookie flags; cross-institution, cross-region, unassigned member, admin/policy roles, auditor read-only (S01); revoked grant (S02); role switch; audit trigger and tamper detection.

### Web (`web/`, port 5180)

Login (demo account picker), shell with role-aware navigation, role switcher and demo banner; home ("My work" / institution's applications); application list with filters and paging; new/edit draft form with field errors; case page (action panel, route progress with rule explanation, checklist, recommendation, completion conditions, assignment, decision form, permitted actions with reasons, recommendations, submission summary, stage history, history timeline); audit log with integrity check. Loading, empty, error, unauthorised and retry states.

## M3 — what exists

### Backend

- **Migration** `003_deadlines_notifications.sql`: `deadlines` (clock type, anchor, rule, calendar, original and current due date, explanation, state ACTIVE/PAUSED/MET/CANCELLED, **generation**, `next_step_at`, ladder copied from the policy), `deadline_pause_segments`, `deadline_adjustments`, `alert_events` (unique on deadline + generation + step + recipient + channel, `NULLS NOT DISTINCT`; states CREATED/MISSED/UNRESOLVED), `notifications`, `deliveries` (email intent with lease, attempts, backoff, provider ref, duplicate flag), `delivery_attempts`, `worker_heartbeats`.
- **Policy** `deadlines` config: per-stage clocks (`pauseOnReturn`), the institution response clock, and the escalation ladder (reminders 30/7/1 days before, overdue at expiry, case officer +1 day, bureau +3 days). All demo values, labelled `DEMO_ASSUMPTION`.
- **Engine** (`modules/deadlines/engine.ts`, built on the tested `calendar.ts`): a stage clock opens on stage entry and closes as met or met late when the stage completes or a decision is recorded. A return pauses the clock only if the rule allows it; otherwise the audit records that it keeps running (D04). A returned attempt's clock carries over to the new attempt and resumes with the lost days added (new generation). The institution response clock opens on return and closes when every finding is answered. `EXTEND_DEADLINE` (`DEADLINE_EXTEND`) keeps the original date and starts a new generation (D05).
- **Scheduler** (`scheduler.ts`): picks deadlines whose next step is due with `FOR UPDATE SKIP LOCKED`, sends the latest reached step to recipients resolved from grants (owner, case officers or bureau covering the region, institution users for a response clock), records earlier reached steps as MISSED (D06) and unresolved recipients. Overdue and escalation steps write audit events; escalation only notifies. `reconcileDeadlines` repairs missing next steps.
- **Worker** (`modules/notifications/worker.ts`, `src/worker/tick.ts`, `src/worker/main.ts` — `npm run dev:worker`): outbox events → notifications (assignment, queued stage, classification needed, case returned, decision recorded, appeal filed), email delivery with a 60 s lease (N02), cancel of stale reminders whose clock closed or changed generation, retry with backoff, permanent bounce (N04), duplicate suppression by stable message id (N03), heartbeat, periodic reconciliation.
- **APIs**: `/notifications` (list with filters, unread count, read, acknowledge, read-all); `/ops/health`, `/ops/deliveries` (+ retry of DEAD ones), `/ops/clock` (DEMO_CLOCK, demo mode, audited), `/ops/tick` (run one pass now, demo mode), `/ops/outbox` preview. Case view adds `deadlines` and `actionPanel.due`.

### Web

Bell with unread count in the top bar (30 s polling) and a notifications page (filters, read, acknowledge, email delivery state shown separately); operations page (health tiles, demo clock +1/+7/+30 days and reset, run scheduler now, deliveries with attempt errors and retry, local email outbox preview); case page deadlines card (current vs original due, rule, calculation text, pauses, extensions, alert history including missed steps) with an extension form; the action panel shows the running clock.

### Tests added (14, `m3-deadlines.test.ts`)

Stage clock from the pinned policy; D01 reminder fires at the local-time threshold and not before; D06 downtime sends only the current step and records missed ones; N01 three concurrent scans create one alert; clock closes as met; D04 scrutiny pauses and resumes with 3 working days added while the EVC clock keeps running; D05 extension keeps the original date, new generation, stale queued reminder cancelled, unauthorised and earlier dates refused; N02 expired lease reclaimed; N03 resend after lost acknowledgement is a suppressed duplicate; N04 bounce visible in ops health and not retryable, transient failure retried with backoff then accepted; outbox → notifications without duplicates, acknowledge does not change the case; demo clock permissions and audit; manual tick only in demo mode. D02/D03 are covered by `calendar.test.ts`.

## M2 — what exists

### Backend

- **Migration** `002_findings_appeals.sql`: `findings` (per stage attempt; reason code, visibility INTERNAL/INSTITUTION, responsible party, `requests_amendment`, state `OPEN → RESPONSE_PENDING → RESPONSE_SUBMITTED → RESOLVED | NOT_RESOLVED`), `finding_responses`, `amendments` (linked record; the frozen snapshot never changes), `appeals` (one per decision, linked to an APPEAL workflow instance).
- **Commands** (`modules/applications/commands-m2.ts`; shared helpers in `command-kit.ts`): `RAISE_FINDING`, `RETURN_TO_INSTITUTION` (only stages with `allowReturn`; needs an institution-visible finding), `RESPOND_TO_FINDING` (institution; when every returned finding is answered the attempt closes with outcome `RETURNED` and attempt N+1 opens for the previous owner, carrying checklist results — deficient items go back to pending with the earlier observation), `RESOLVE_FINDING`, `REJECT_FINDING_RESPONSE` (a NOT_RESOLVED finding is a recorded outcome: its deficient checklist item no longer blocks completion, so a committee can recommend rejection), `REQUEST_AMENDMENT`, `CLASSIFY` (manual, region-scoped, mandatory reason, trace keeps the automatic result; appeal-only routes excluded), `FILE_APPEAL` (REJECTED decisions only, demo 30-day window, new APPEAL workflow on the pinned policy version; original decision never modified).
- `NO_OPEN_FINDING` now queries `findings` directly for the current workflow (the `to_regclass` fallback remains only for `evc_visits` until M4).
- **Policy schema**: optional `appeal` (route, appealable outcomes, window days). Demo policy adds route `APPEAL_SAC` (SAC review → decision).
- **Policy change control** (`modules/policy/admin.ts`, `diff.ts`, `routes.ts`): list versions, detail with validation issues, create draft from a version (`POLICY_DRAFT`), save draft with optimistic version check, live validation endpoint, structured diff (meta, calendar, holidays, categories, classification, routes, stages, checklist items, decision, appeal), publish (`POLICY_PUBLISH` only, zero errors, effective date in the policy time zone, change note, audit with the change list), source register.
- **Case view** adds findings with responses (internal ones hidden from institutions), amendments, every workflow instance with its decision (primary and appeals), routes available for manual classification, and an "institution must respond" action panel.
- `npm run demo:scenarios` creates six prepared cases (in scrutiny, returned, awaiting classification, awaiting decision, rejected and under appeal, approved with conditions) through the API.

### Web

Case page: findings panel (raise, return, respond, amend, resolve / not resolved, attempt and status chips), classification form with route cards, appeal form, "Proceedings" card linking decisions and appeals, amendments under the submission, permitted actions with unavailable ones folded away. Policy pages (`/policy`): version list with case counts, source register, version detail with tabs Overview (structured tables with provenance chips) / Edit (JSON editor with live validation; a table-based editor is not built) / Compare (diff against any version) / Publish.

### Tests added (23)

`m2-workflow.test.ts`: W04 return → response → new attempt with preserved attempt 1, internal findings hidden, cross-institution response 404, W05 amendment keeps the snapshot hash, completion blocked until findings reviewed, W07 appeal linked and original decision unchanged, second appeal refused, SAC cannot return (`allowReturn: false`), W01 all five routes (EVC routes stop at EVC with the report blocker), W02 manual classification scope and validation, audit chain intact. `m2-policy.test.ts`: approver cannot draft, admin cannot publish, policy roles cannot see cases, validation errors block publish, stale save rejected, published versions immutable, pinned version for old cases and v2 for new ones, readable diff.

## Added after M1

- **One-click demo sign-in**: `POST /api/v1/auth/demo-login` (demo mode only, listed accounts only, 404 otherwise). The login page signs in when a role card is clicked.
- **UI redesign**: warm light/dark themes with toggle, bundled fonts (`web/public/fonts`, SIL OFL), intro screen, Lenis smooth scrolling, staggered page entrance, sliding nav highlight, top loading bar (`web/src/motion.tsx`). All motion is off under `prefers-reduced-motion`. Page layout brief for designers: [UI_PAGES.md](UI_PAGES.md).
- **Foundation modules for M3 and M5** (pure, tested, not wired yet): deadline calendar, email adapters, upload checks and private storage. See [FOUNDATIONS.md](FOUNDATIONS.md).
- Pitch outline [PITCH.md](PITCH.md) and limitations draft [LIMITATIONS.md](LIMITATIONS.md).

## Known gaps and notes for the next milestones

- Clocks cover stage handling, institution response, EVC scheduling and visit reports. Obligation, verification and document validity clocks remain M5; reuse the deadline engine/calendar.
- Jumping the demo clock far ahead records the skipped reminder steps as missed by design; reset the database (`npm run db:reset` then `npm run demo:scenarios`) for a clean demo.
- Heartbeats use real time; the ops page shows "no worker" unless `npm run dev:worker` runs (the "Run scheduler now" button works without it in demo mode).
- Digests and grouping of repeated reminders are not built.
- `evaluateCompletion` now queries accepted EVC reports directly; no missing-table fallback remains.
- The policy editor is JSON with live validation; a table-based editor for categories/classification/checklists is not built.
- Committee members only see cases they are assigned to; SAC/SHC therefore see an appeal only once assigned.
- Committee membership currently comes from `capability_grants.committee_id`; a separate `committee_appointments` table (BUILD_PLAN §7) is still to be added if needed.
- `docker-compose.yml` is provided but was not tested; the embedded PostgreSQL path was.
- Port 5173 was occupied on the original dev machine, so the web app uses 5180.
- `DEBUG_ERRORS=true` prints unhandled server errors to the console (useful in tests).
