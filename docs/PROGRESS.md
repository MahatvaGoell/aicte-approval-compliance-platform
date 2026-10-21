# Progress

Last updated: 21 Oct 2026 · Specification: [BUILD_PLAN.md](BUILD_PLAN.md) · Agent rules: [../AGENTS.md](../AGENTS.md)

| Milestone | Status |
|---|---|
| M1 — Auth, scopes, records, one complete workflow | **Done** (30 API tests passing; web screens built, browser check pending) |
| M2 — Returns, re-scrutiny, all routes, classification, appeals, policy versioning | **Next** — prompt in [NEXT_PROMPT.md](NEXT_PROMPT.md) |
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

### Tests (`server/test/`, 30 passing)

Full Only-Scrutiny journey; completion blocked without partial change (W03); route explanation; conditional route; no-match classification (W02); frozen snapshot (W05); recommendation does not decide (W06); institution view hides internal notes; audit coverage + chain verify; idempotent replay and key reuse (C01, C02); stale version and simultaneous commands (C03); full rollback on failure (C04); login errors, lockout, session required, CSRF, cookie flags; cross-institution, cross-region, unassigned member, admin/policy roles, auditor read-only (S01); revoked grant (S02); role switch; audit trigger and tamper detection.

### Web (`web/`, port 5180)

Login (demo account picker), shell with role-aware navigation, role switcher and demo banner; home ("My work" / institution's applications); application list with filters and paging; new/edit draft form with field errors; case page (action panel, route progress with rule explanation, checklist, recommendation, completion conditions, assignment, decision form, permitted actions with reasons, recommendations, submission summary, stage history, history timeline); audit log with integrity check. Loading, empty, error, unauthorised and retry states.

## Known gaps and notes for the next milestones

- Browser walkthrough of the web screens has not been done by the agent; the team is checking manually.
- `evaluateCompletion` in `modules/workflow/workflow.ts` checks `findings` and `evc_visits` with a `to_regclass` fallback because those tables do not exist yet. **Replace with direct queries** once M2 (findings) and M4 (EVC) add the tables.
- No deadlines yet; the case page shows "No deadline policy is configured for this step yet" (M3).
- `outbox_events` are written but nothing consumes them yet (M3 worker).
- Committee membership currently comes from `capability_grants.committee_id`; a separate `committee_appointments` table (BUILD_PLAN §7) is still to be added if needed.
- `docker-compose.yml` is provided but was not tested; the embedded PostgreSQL path was.
- Port 5173 was occupied on the original dev machine, so the web app uses 5180.
- `DEBUG_ERRORS=true` prints unhandled server errors to the console (useful in tests).
