# AICTE Approval & Compliance Platform

SIH 2026 · Problem Statement **SIH26262** — Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System.

A prototype platform that routes AICTE approval applications through configurable, versioned stages, keeps every regulatory decision with an authorised human, and records a tamper-evident history of every action.

> **Prototype notice.** All institutions, people and rules in this repository are synthetic. Routing and timing rules are labelled `DEMO_ASSUMPTION` and are **not** AICTE rules. There is no live connection to any AICTE system. This is not an official AICTE product.

- **Continuing on another machine: [docs/HANDOFF.md](docs/HANDOFF.md)**
- Build plan: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)
- Progress and what is next: [docs/PROGRESS.md](docs/PROGRESS.md)
- M6 acceptance checks and limits: [docs/M6_ACCEPTANCE.md](docs/M6_ACCEPTANCE.md)
- Synthetic PDF corpus and generator: [docs/EXTRACTION_DATASET.md](docs/EXTRACTION_DATASET.md)
- Text-layer extraction/CLI: [docs/PDF_TEXT_EXTRACTION.md](docs/PDF_TEXT_EXTRACTION.md)
- Next authorised step: [docs/NEXT_PROMPT.md](docs/NEXT_PROMPT.md) (C3 offline OCR only)
- Foundation modules for deadlines, email and documents: [docs/FOUNDATIONS.md](docs/FOUNDATIONS.md)
- Screen-by-screen layout brief: [docs/UI_PAGES.md](docs/UI_PAGES.md)
- Pitch outline and limitations: [docs/PITCH.md](docs/PITCH.md), [docs/LIMITATIONS.md](docs/LIMITATIONS.md)
- Instructions for coding agents: [AGENTS.md](AGENTS.md)

## Stack

| Part | Technology |
|---|---|
| Web | React 18, TypeScript, Vite, React Router, TanStack Query |
| API | Node 22.13+ or 24+, TypeScript, Fastify 5, Zod |
| Database | PostgreSQL (embedded for local dev, or Docker) |
| Tests | Vitest against a real PostgreSQL test database |

## Run it locally

Requirements: Node 22.13+ or 24+ (PDF.js compatibility). Docker is optional.

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

Milestones **M1–M6** are implemented. M6 adds role dashboards with filtered drill-down, reconciled reports/CSV, scoped audit search/integrity verification and a disconnected mock import/reconciliation workspace. C1 adds **24 labelled synthetic PDFs / 32 pages** (16 text, 8 image-only scans), a reproducible generator and dataset QA. C2 adds bounded offline text-layer expiry suggestions with source evidence/abstention and a developer CLI. All **226 tests** pass. OCR and UI integration remain pending; document metadata still needs manual human review. Uploading never fulfils an obligation automatically.

For M6, sign in as `ro.west` → **Dashboard** → **management** → select Demo West → **Applications in process** → **Download CSV**. The count, listed case IDs and export use the same filters/scope. Sign in as `auditor` → **Audit log** → **Verify integrity** to inspect the hash chain and its limits. As `ro.west`, **Mock integration** → enter an import reason → **Run mock sync** → **Open review** for an unknown source code. Retry preserves its blocked state; an explicit reviewed correction or dismissal needs a reason. All integration statuses belong to the source mirror; they never decide a local case. See [docs/INTEGRATION_CONTRACT.md](docs/INTEGRATION_CONTRACT.md).

Run `npm run dev:worker` alongside the API/web for reminders, and `npm run demo:scenarios` after a reset to prepare nine synthetic cases. For M5, sign in as `ro.west`, open **Obligations**, then case **01009**: its expired verified lease remains current while a replacement receipt waits for human review. Reject/correct or confirm metadata → accept document → explicitly fulfil the obligation. Case **01006** has a pending obligation for `inst.north` / `ro.north`. Use synthetic PDF/PNG/JPEG files only (default maximum 10 MB); checks do not establish authenticity.

For M4, open **Expert visits** as `ro.west`. Institution acknowledgement uses `inst.west`; appointed members use `evc1` and `evc2`. Advance the demo clock from Operations after confirmations to demonstrate a held visit and report review. PostgreSQL must have the bundled `btree_gist` extension available. Inspect C1 under `server/fixtures/extraction/`; generator/QA setup is in `docs/EXTRACTION_DATASET.md`. Run `npm run extract:pdf -- server/fixtures/extraction/pdfs/expiry-01.pdf` for the C2 source-backed JSON suggestion; this does not save metadata or change the UI. Completed work through C2 is included in the authorised GitHub main publication. Next is **C3, offline OCR only**; follow `docs/NEXT_PROMPT.md` and stop after that step.

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
