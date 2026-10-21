# Progress

Last updated: 22 Oct 2026 · Specification: [BUILD_PLAN.md](BUILD_PLAN.md) · Agent rules: [../AGENTS.md](../AGENTS.md)

| Milestone | Status |
|---|---|
| M1 — Auth, scopes, records, one complete workflow | **Done** (web screens checked in the browser) |
| M2 — Returns, re-scrutiny, all routes, classification, appeals, policy versioning | **Done** |
| M3 — Deadlines, worker, notifications, escalation, demo clock | Not started |
| M4 — EVC queue, scheduling, conflicts, reports | Not started |
| M5 — Documents, obligations, verification, lease renewal | Not started |
| M6 — Dashboards, reports, audit viewer, mock integration | Not started |
| M7 — Differentiators (action/gap panel, priority queue, consistency, readiness, preview) | Not started |
| M8 — Optional AI, load/recovery tests, docs, evaluation, rehearsal | Not started |

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

- `evaluateCompletion` still checks `evc_visits` with a `to_regclass` fallback; replace it with a direct query in M4.
- The policy editor is JSON with live validation; a table-based editor for categories/classification/checklists is not built.
- Committee members only see cases they are assigned to; SAC/SHC therefore see an appeal only once assigned.
- No deadlines yet; the case page shows "No deadline policy is configured for this step yet" (M3).
- `outbox_events` are written but nothing consumes them yet (M3 worker).
- Committee membership currently comes from `capability_grants.committee_id`; a separate `committee_appointments` table (BUILD_PLAN §7) is still to be added if needed.
- `docker-compose.yml` is provided but was not tested; the embedded PostgreSQL path was.
- Port 5173 was occupied on the original dev machine, so the web app uses 5180.
- `DEBUG_ERRORS=true` prints unhandled server errors to the console (useful in tests).
