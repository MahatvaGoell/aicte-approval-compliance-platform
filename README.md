# AICTE Approval & Compliance Platform

SIH 2026 · Problem Statement **SIH26262** — Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System.

A prototype platform that routes AICTE approval applications through configurable, versioned stages, keeps every regulatory decision with an authorised human, and records a tamper-evident history of every action.

> **Prototype notice.** All institutions, people and rules in this repository are synthetic. Routing and timing rules are labelled `DEMO_ASSUMPTION` and are **not** AICTE rules. There is no live connection to any AICTE system. This is not an official AICTE product.

- **Continuing on another machine: [docs/HANDOFF.md](docs/HANDOFF.md)**
- Build plan: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)
- Progress and what is next: [docs/PROGRESS.md](docs/PROGRESS.md)
- Foundation modules for deadlines, email and documents: [docs/FOUNDATIONS.md](docs/FOUNDATIONS.md)
- Screen-by-screen layout brief: [docs/UI_PAGES.md](docs/UI_PAGES.md)
- Pitch outline and limitations: [docs/PITCH.md](docs/PITCH.md), [docs/LIMITATIONS.md](docs/LIMITATIONS.md)
- Instructions for coding agents: [AGENTS.md](AGENTS.md)

## Stack

| Part | Technology |
|---|---|
| Web | React 18, TypeScript, Vite, React Router, TanStack Query |
| API | Node 22+, TypeScript, Fastify 5, Zod |
| Database | PostgreSQL (embedded for local dev, or Docker) |
| Tests | Vitest against a real PostgreSQL test database |

## Run it locally

Requirements: Node 22 or newer. Docker is optional.

```bash
npm install
cp .env.example .env
```

Start PostgreSQL (port 54329) in its own terminal, using **one** of:

```bash
npm run db:start            # embedded PostgreSQL, no Docker needed
docker compose up -d db     # or Docker
```

Then:

```bash
npm run db:reset            # creates schema + synthetic demo data (destroys local data)
npm run dev:api             # API on http://127.0.0.1:4000
npm run dev:web             # web on http://localhost:5180
npm test                    # API test suite (uses the aicte_test database)
```

With Docker, create the test database once: `docker compose exec db createdb -U aicte aicte_test`.

## Demo accounts

Milestones **M1–M4** are implemented. M4 adds **Expert visits**: readiness queue, conflict/availability suggestions, atomic reservations, rescheduling, acknowledgements and report revisions/acceptance. Reports are structured text; document attachments and post-approval obligations are M5.

Run `npm run dev:worker` alongside the API/web for reminders, and `npm run demo:scenarios` to prepare eight synthetic cases, including a ready EVC case and a confirmed visit. Sign in as `ro.west`, open **Expert visits**, then the case. Institution acknowledgement uses `inst.west`; appointed members use `evc1` and `evc2` demo cards. Advance the demo clock from Operations after confirmations to demonstrate a held visit and report review. PostgreSQL must have the bundled `btree_gist` extension available.

All demo accounts share the password **`Demo@2026`** (synthetic, demo mode only). The login page lists them.

| Account | Role |
|---|---|
| `inst.west@demo.aicte.test` | Institution representative (Demo Institute of Technology, Pune) |
| `inst.north@demo.aicte.test` | Institution representative (Lucknow) |
| `ro.west@demo.aicte.test` | Regional officer, Demo West |
| `bureau@demo.aicte.test` | Bureau officer, all regions (also holds an auditor role) |
| `scrutiny.west1@demo.aicte.test`, `scrutiny.west2@…` | Scrutiny committee members, Demo West |
| `authority@demo.aicte.test` | Competent authority |
| `auditor@demo.aicte.test` | Auditor (read-only) |
| `admin@demo.aicte.test`, `policy.admin@…`, `policy.approver@…` | Administration and policy roles (no case access) |

## Repository layout

```
server/
  migrations/        SQL migrations, applied in filename order
  scripts/           db (embedded PostgreSQL), migrate, reset, seed
  src/
    modules/         identity, applications, workflow, policy, audit, outbox, reference
    http/            request context, idempotency
    seed/            synthetic seed data and the demo policy
  test/              Vitest API tests
web/src/             React app (pages/, ui.tsx, api.ts, session.tsx, motion.tsx)
docs/                build plan, progress, strategy notes
```
