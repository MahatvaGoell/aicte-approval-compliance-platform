# AICTE Approval & Compliance Platform — Build Plan (v2)

**SIH 2026 · Problem Statement 26262**
Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System

Working title: **AICTE Approval & Compliance Platform** (branding is configurable)
Plan dated 21 Oct 2026 · Built milestone by milestone by the coding agent(s) working in this repository.

v2 merges three inputs: the detailed product specification, the five "unique features" list, and the *SIH26262 Research and Build Blueprint*. Section 2 shows what came from where.

### Who does the work

There is no team split. The coding agent does all of it: schema, backend, worker, frontend, seed data, tests, load and recovery checks, the evaluation report, documentation, the demo script, the recorded demo run (Playwright video) and the pitch outline.

Only three things need a person, because no code can do them:
- Confirming real APH rules and timelines against the official handbook before any rule is labelled `APH_CLAUSE` (until then everything stays `DEMO_ASSUMPTION`).
- Giving permission for anything external (deployment, real emails, paid services).
- Presenting the demo to the jury.

---

## 1. Goal

One platform that runs the full administrative journey of an AICTE approval application and the compliance obligations that follow it.

Every case has a valid route, every pending action has an accountable owner, every deadline has a traceable basis, and every closure has verified evidence. For every application the platform answers:

- What stage is it in?
- Who is responsible?
- What action is required next, and when is it due?
- Which configured rule decided the route and the deadline?
- What has already happened?
- What needs an authorised human decision?

**Acceptance condition:** one complete application journey (returns, EVC visit, authorised decision, continuing compliance, lease renewal and escalation) whose rules, responsibilities and history can all be demonstrated and verified.

---

## 2. Where each feature comes from

### 2.1 From the "unique features" list

| Proposed feature | What we build | Reason |
|---|---|---|
| AI Compliance Copilot | **Gap panel**: Requirement → Evidence → Gap → Recommended action for every case, rule-based. Optional AI summary on top | Core must work without AI |
| Cross-Document Consistency Graph | **Consistency checks** comparing land area, institution name, address/district and lease validity across application, profile and confirmed document metadata. Each finding shows both values and sources; officer acknowledges | Stays out of document authentication (PS 26261). Relational tables, no graph database |
| Approval Readiness / What-If | **Submission readiness**: checklist coverage and missing items before submission, with a what-if view of what remains | Labelled "not an approval prediction" |
| Risk-Based Prioritisation | **Attention priority queue** with visible factors | Rule-based, labelled as such; never a validated risk score; never penalises institutions |
| Regulation-to-Checklist | **Checklists inside each policy version**, each item with a rule reference and provenance | Configurable APH rules |

### 2.2 Adopted from the Research and Build Blueprint

| Blueprint idea | Where it goes in this plan |
|---|---|
| **Traceable obligation and evidence register** as the anchor feature: condition → obligation → exact evidence version → verification result → closure, all linked | §11, becomes the centre of the pitch |
| Upload, reminder and regulatory closure are different events; submission timeliness, document validity and verification backlog are separate dimensions | §8, §11, §12 |
| Obligation lifecycle `OPEN → EVIDENCE_SUBMITTED → UNDER_VERIFICATION → FULFILLED / CLOSED_WITH_AUTHORISED_REASON`; rejection returns to `OPEN` with a reasoned result; due soon / overdue computed, not stored as states | §8 |
| Application vs **proposal** vs workflow instance vs stage attempt vs **recommendation** vs **decision**, all separate records | §7, §8 |
| **Frozen submission snapshot**; clarifications and amendments are linked additions, never silent edits | §9 |
| **Five route fixtures** including a deficiency + re-scrutiny path, plus an **unclassified case** that waits for authorised classification instead of guessing | §9 |
| SAC and SHC kept **distinct**; an appeal is its own linked workflow instance pointing at the original decision | §9 |
| **Capability grants** scoped by institution, region, bureau, committee appointment and case assignment, with valid-from/to dates; separate **policy approver** and **EVC scheduler** capabilities | §6 |
| Policy validation: missing anchors, unreachable stages, ambiguous matches, loops without exit; constrained predicates only, no user code | §9 |
| Three provenance labels: **APH/regulation clause**, **authorised administrative instruction**, **demo assumption**; a policy source register with issuer, year, dates, hash, clause locator and reviewer | §9 |
| Clock definitions per purpose; **valid-through date expires at next local midnight**; months as calendar operations; returns pause only clocks whose rule allows it | §10 |
| Downtime catch-up sends the current alert and records missed thresholds instead of a burst of stale reminders; periodic **reconciliation** of deadlines vs alerts | §10 |
| **Operations health view**: worker heartbeat, oldest pending job, failed deliveries, unresolved recipients | §10, §14 |
| Alert **acknowledgement** separate from case closure; provider acceptance shown separately from delivery | §13 |
| EVC milestones: **ready → proposed → confirmed → held → report submitted → report accepted → stage completed**; a visit never completes because time passed; "information unavailable" when the conflict directory is incomplete | §12 |
| **Quarantined uploads**, extracted metadata kept separate from reviewer-confirmed metadata; extraction states *suggested / ambiguous / not found / human confirmed* with page and excerpt | §12, §16 |
| A labelled **synthetic extraction dataset** (~60 pages, including prompt-injection text) with honest metrics | §16, §20 |
| Internal notes separated from institution-visible observations | §14 |
| Command-style API, structured errors with correlation ID, 409 on stale version, no generic "PATCH status", CSV formula-injection protection, idempotency key reuse with a different body rejected | §15 |
| Dashboards show last-refreshed time and a stale state; measured polling interval disclosed | §14 |
| Integration: raw source record retained, unknown codes go to a **reconciliation queue**, idempotent by source event/revision, field-authority matrix, read-only shadow mode first | §17 |
| Full **test matrix** (W01–R02) as the release gate; backup restore test; load test with 10,000 cases and 50 concurrent dashboard users | §20 |
| Seven-minute demo order that opens on an overdue case, plus showing recovery results and a permission rejection | §19 |
| Usage-based cost estimate instead of a made-up bill; explicit "features to defer" list | §22, §23 |

### 2.3 Not adopted, and why

| Blueprint item | Decision |
|---|---|
| Django + Celery + Redis + Next.js stack | Keep TypeScript end to end (the product spec prefers a TypeScript backend; the blueprint itself says another stack is fine if the transaction and deadline design is kept). PostgreSQL job table replaces Redis/Celery |
| Name "ApprovalTrack" | Keep "AICTE Approval & Compliance Platform" as the spec asks; branding stays configurable |
| Team allocation and 4-week / 36-hour team schedules | Not needed; the coding agent builds everything (see "Who does the work" below and §21) |
| Provider webhook signature handling | No real provider in the demo; listed as a production requirement |
| PostgreSQL row-level security | Deferred; domain checks in every query are the primary control |

---

## 3. Product principles

1. Complete user journeys, not mock screens.
2. Every workflow action is explainable and names its rule, provenance and policy version.
3. Regulatory rules are configuration, versioned, effective-dated and source-referenced.
4. Final regulatory decisions stay with competent authorities. Automatic movement is administrative progression only; it never creates a recommendation or a decision.
5. Approval, ongoing compliance and appeal are separate dimensions.
6. Upload, verification, reminder and closure are separate, linked events.
7. Scheduled actions survive restarts and temporary failures.
8. Deny by default; permissions enforced on the backend for every list, detail, mutation, upload, download, search and export.
9. The core works with no AI API configured.
10. Simulated integrations and synthetic data are labelled everywhere.
11. No invented official deadlines, routes or committee powers. A team-proposed timing never appears as an APH mandate.

---

## 4. Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite, React Router, TanStack Query | Typed, fast, good loading/error/retry handling |
| Backend | Node 22+ + TypeScript + Fastify, Zod validation, OpenAPI generated from schemas | One language; modular monolith |
| Database | PostgreSQL (Docker Compose, or embedded PostgreSQL for laptops without Docker) | Transactions, constraints, row locks, `SKIP LOCKED` queues |
| Background work | Job/outbox table in PostgreSQL, separate worker process | Durable, retryable, restart-safe, no Redis |
| Documents | Private local storage behind a storage adapter, quarantine area | Swappable for S3/MinIO/government storage |
| Document text | `pdfjs-dist` for PDF text layers; optional `tesseract.js` OCR in an isolated worker with time and memory limits | Text first, OCR only when needed |
| Email | Outbox adapter (`.eml` files + preview screen) for demo; SMTP adapter for production | No real messages in demos |
| AI (optional) | Isolated adapter, off by default | Enhancement only |
| Tests | Vitest against real PostgreSQL with separate connections for concurrency; Playwright for the end-to-end journey | Tests exercise real SQL, locks and transactions |

---

## 5. Architecture

```
web (React) ──/api/v1──► api (Fastify, domain services) ──► PostgreSQL
                               │                              ▲  cases, rules, deadlines,
                               ▼                              │  audit, outbox, jobs
                    storage adapter (quarantine → private)    │
                    email adapter                worker ──────┘  deadline steps, delivery,
                    AI adapter (optional)                          digests, reconciliation,
                    integration adapter (mock)                     extraction, sync
```

### Backend modules

identity · institutions · applications (incl. proposals and snapshots) · workflow · policies (incl. source register) · reviews (findings, deficiencies) · committees (recommendations, appointments) · decisions · evc · compliance (obligations, submissions, verifications) · documents · deadlines · notifications · reporting · audit · integration · assist (gap panel, consistency, readiness, explanations, optional AI) · operations (health, failed jobs)

### Engineering rules

- Domain services own commands and transactions; HTTP handlers authenticate, scope and call services. Background jobs use the same services, never direct status writes.
- Each command: authenticate → scope the case → check capability, assignment and current state → compare expected version → validate inputs and prerequisites → evaluate the pinned rule → write transition, stage changes, audit event and outbox event **in one transaction**.
- One `Clock` service supplies "now" everywhere (demo clock and tests depend on it).
- Optimistic concurrency (`row_version`) plus row locks; idempotency keys scoped to actor and operation with a request fingerprint.
- Typed columns for ownership, scope, dates and lifecycle; JSONB only for snapshots and versioned rule payloads.

---

## 6. Roles, capabilities and access

Role names are functional. Their mapping to official designations is configuration. Underneath each role is a set of **capability grants**, each scoped (institution, region, bureau, committee appointment, case assignment) and time-bounded (valid from/to, delegation source).

| Role | Scope | Key capabilities | Cannot |
|---|---|---|---|
| Institution representative | Own institution, authorised cycle | Draft, submit, respond to findings, upload evidence and renewals, see own published outcomes | See other institutions or internal notes |
| Regional officer | Granted region | Review, record findings, return cases, complete stages, manage queues, verify evidence and documents | Record decisions |
| Bureau officer | Granted regions/bureau | Monitor pendency and escalations, reassign, review compliance, permitted extensions | Record decisions |
| Scrutiny member | Assigned stage | Complete checklist, record findings and recommendations | Act outside assignment |
| EVC scheduler (capability) | Granted region | Prepare and confirm visit proposals, coordinate availability | Appoint committees |
| EVC member | Active appointment and visit | Visit checklist, findings, report | Access other visits |
| SAC / SHC member | Distinct appointment per committee | Review the assigned hearing or appeal record, recommend | Act on the other committee's cases |
| Competent authority | Explicit decision grant | Record decisions, authorise exceptions, extensions, reopening, migrations, closure with reason | Change configuration |
| System administrator | System | Users, grants, settings, demo clock | Regulatory decisions; publishing policy |
| Policy administrator | Policy drafts | Draft and validate workflow/deadline configuration | Publish; case decisions |
| Policy approver | Policy publication | Review, compare and publish versions | Case decisions |
| Auditor | Read-only, granted scope | Histories, audit log, reports; sensitive fields controlled | Modify anything |

Revoked grants and expired appointments take effect immediately (tested). Hiding a button is never the security control; API tests try direct access across institutions, regions and roles.

---

## 7. Data model

| Area | Tables |
|---|---|
| Identity | `users`, `capability_grants` (role, capability, scope, valid from/to, delegation source), `sessions` |
| Reference | `regions`, `institutions`, `institution_contacts`, `committees`, `committee_appointments`, `cycles` |
| Policy | `policy_versions` (JSON rules, status, effective dates, checksum, publisher, approver), `policy_sources` (issuer, title, academic year, publication and effective dates, retrieval date, file hash, clause locator, reviewer, provenance) |
| Applications | `applications` (lifecycle, frozen submitted snapshot, form schema version), `proposals` (requested category, classification status), `amendments`, `workflow_instances` (pinned policy, route, decision trace, appeal link), `stage_instances` (attempt no., lifecycle, owner), `task_assignments`, `transitions` |
| Reviews | `checklist_items`, `findings` (requirement ref, observation, evidence request, visibility), `finding_responses`, `recommendations`, `consistency_acknowledgements` |
| Decisions | `decisions` (authority, outcome, conditions, issued time, original decision link for appeals) |
| Documents | `document_records`, `document_versions` (storage key, hash, media type, quarantine state, predecessor), `extracted_fields` (value, excerpt, page, method, state), `confirmed_metadata` (reviewer, time) |
| EVC | `expert_profiles`, `expert_availability`, `declared_conflicts`, `evc_visits` (ready_at, mode, timezone, slots, milestones), `expert_reservations` (time range, no-overlap constraint), `visit_findings`, `visit_events` |
| Compliance | `obligations`, `evidence_submissions` (receipt time, exact document versions, timeliness), `verification_results` (verifier, accept/reject, reasons) |
| Deadlines | `deadlines` (clock type, anchor, basis, calendar, original and current due, generation), `deadline_pause_segments`, `deadline_adjustments`, `escalations` |
| Jobs and alerts | `jobs` (dedupe key, attempts, lease), `job_attempts`, `alert_events` (unique on deadline + generation + threshold + recipient + channel), `worker_heartbeats` |
| Notifications | `notifications` (event, recipient, channel, status, read, acknowledged), `delivery_attempts` (provider accepted vs delivered vs bounced), `correspondence` (drafts needing authorisation) |
| Audit | `audit_events` (actor, active capability, before/after version, reason, rule and version, documents, correlation ID, visibility, prev hash, hash) |
| Integration | `import_records` (source system, external ID, event ID/revision, raw record, mapping version, reconciliation status), `integration_mappings`, `sync_runs`, `reconciliation_queue` |
| Other | `system_settings`, `idempotency_keys` |

Constraints: unique stage attempt per workflow, unique import event, unique alert event, unique idempotency record, no cross-institution links, one live stage per workflow instance. Indexes on active deadlines by due time, stage queues by scope and state, audit by case and time, jobs by state and next attempt.

---

## 8. State models

These are proposed software states, not official AICTE status codes.

**Application:** `DRAFT → SUBMITTED → AWAITING_CLASSIFICATION (only if no rule matches) → IN_PROCESS → AWAITING_DECISION → DECISION_RECORDED → CLOSED`; `WITHDRAWN` from draft/submitted.

**Decision outcome** (separate): `APPROVED | APPROVED_WITH_CONDITIONS | REJECTED | DEFERRED`.
**Compliance** (separate, computed from obligations): `NONE | OPEN | OVERDUE | ALL_FULFILLED`.
**Appeal** (separate): own workflow instance linked to the original decision, which is preserved.

**Stage instance:** `QUEUED → ASSIGNED → IN_PROGRESS → AWAITING_RESPONSE → COMPLETED`, or `CANCELLED`. A return closes the attempt and opens a new attempt (re-scrutiny); earlier findings stay and are marked still-valid or superseded.

**Finding / deficiency:** `RESPONSE_PENDING → RESPONSE_SUBMITTED (verification pending) → RESOLVED | NOT_RESOLVED`.

**Obligation (undertaking):** `OPEN → EVIDENCE_SUBMITTED → UNDER_VERIFICATION → FULFILLED`, `CLARIFICATION_REQUIRED` and rejection return it to `OPEN` with a reasoned verification result; `CLOSED_WITH_AUTHORISED_REASON` by an authority.
Computed alongside, never as lifecycle states: *due soon*, *overdue*, *extended*, *submission timeliness* (on time / late / not submitted), *verification waiting* (belongs to the verifier's queue, not the institution's).

**Document version:** `QUARANTINED → PENDING_VERIFICATION → VERIFIED | REJECTED`; the previous verified version becomes `SUPERSEDED` only when a replacement is verified. Expired versions are never rewritten.
Record status shown: `VALID | EXPIRING_SOON | EXPIRED | REPLACEMENT_UPLOADED (awaiting verification) | EXPIRED + REPLACEMENT_UPLOADED`.

**Extracted field:** `SUGGESTED | AMBIGUOUS | NOT_FOUND | HUMAN_CONFIRMED`.

**EVC visit:** `READY (ready_at recorded) → PROPOSED → CONFIRMED → HELD → REPORT_SUBMITTED → REPORT_ACCEPTED`, then the stage owner completes the stage. `RESCHEDULED` and `CANCELLED` keep history.

---

## 9. Workflow engine and policy versioning

A policy version is a JSON document in a constrained schema (only supported predicates and actions; no user code). It defines:

- **Classification rules**: proposal category → route, with explicit precedence. No match or an ambiguous match → `AWAITING_CLASSIFICATION` for an authorised officer.
- **Routes** (five demo fixtures):
  1. Only Scrutiny
  2. Scrutiny → EVC
  3. EVC → committee stage when its trigger applies (SAC and SHC as separate stages)
  4. Only EVC
  5. Scrutiny with deficiency response and re-scrutiny
- **Stages**: kind, owner capability, eligible capabilities, checklist items with rule refs, completion conditions (`CHECKLIST_COMPLETE`, `NO_OPEN_FINDING`, `EVC_REPORT_ACCEPTED`, `RECOMMENDATION_RECORDED`), return rules, deadline policy, escalation ladder.
- **Timing rules**: anchor event, unit (calendar/working days, calendar months), calendar, time zone, cutoff interpretation, allowed pause reasons, responsible authority.
- **Calendar**: time zone, weekend days, holidays.
- **Escalation ladders**, **EVC settings**, **obligation templates**, **document types** with reminder offsets.
- **Decision stage**: allowed outcomes and authority capability. Every route ends in an explicit decision stage; finishing a processing stage never means approval.
- **Provenance** on every rule: `APH_CLAUSE` (with source register entry and clause locator), `ADMIN_INSTRUCTION`, or `DEMO_ASSUMPTION`.

Engine guarantees: unauthorised transitions blocked; prerequisites checked; returns need reason code, explanation, requested evidence, recipient and due-date basis; previous review records preserved; no stage skipped; no unrequired stage entered; reassignment and reopening recorded; duplicate and conflicting commands rejected. The submitted snapshot is frozen; amendments are linked records.

Change control: draft → validate (missing anchors, unreachable stages, ambiguous matches, loops without exit, contradictory predicates) → compare with published version → preview against frozen fixture cases → publish by a **policy approver** with an effective date. Existing cases stay pinned. Migration needs authorisation, a reason, an impact preview, both version references and recorded deadline regeneration.

Editor: table-based structured editor. A visual builder is optional and comes last.

---

## 10. Deadlines and escalation

**Clocks are defined separately:** application age, stage elapsed time, officer handling time, institution response time, EVC scheduling due, visit report due, obligation submission due, verification due, document validity.

- Calendar days, working days (weekends + holidays) and calendar months; UTC storage with the source time zone kept.
- A document *valid through* a date expires at the start of the next local day; the original date is always displayed.
- Each deadline shows original due, current effective due, the calculation explanation, every pause segment and extension (reason, authoriser), overdue duration and alert history.
- A return pauses only clocks whose published rule allows pausing for that reason; others keep running.
- Extensions allowed only for configured capabilities; original date preserved.
- Escalation ladder (demo assumption): reminders at 30, 7 and 1 days before; overdue action at expiry; case officer after 1 day; supervisor after 3 days. Recipients resolved from scope and capability grants, never hardcoded. Escalation requests attention only.

**Reliable processing:**
1. A business transaction creates or changes a deadline and bumps its generation.
2. A scheduler scans due thresholds every minute (demo) in small batches.
3. Workers claim jobs with `FOR UPDATE SKIP LOCKED` and an expiring lease; abandoned claims are recovered.
4. Alert events are unique on deadline + generation + threshold + recipient + channel.
5. In-app notification and email delivery intent are written in the same transaction.
6. Email is sent after commit with timeouts, bounded retries, backoff and a dead-letter state.
7. Before delivery, the job rechecks that the item is still active and the generation is current; stale reminders are cancelled.
8. After downtime, only the current actionable alert is sent and skipped thresholds are recorded as missed.
9. A reconciliation job compares deadlines against generated alerts and repairs gaps.
10. Operations view shows worker heartbeats, oldest pending job age, failed deliveries and unresolved recipients.

We do not claim exactly-once external email; uncertain sends are reconciled and the limit is documented.

**Demo clock:** offset applied by the Clock service, only with `DEMO_MODE=true`, only by the administrator, always shown as a banner. It exercises the real deadline logic and persistence. Ignored in production.

---

## 11. Anchor feature: traceable obligation and evidence register

This is the feature the pitch is built around.

One panel per case (and per institution) links, in order:

**approval decision → condition → obligation → due rule and deadline → reminders and escalations → submission receipt → exact document version → extracted and confirmed fields → verification result → closure**

Every link opens the underlying record. It is built from ordinary tables and joins, shown as a table plus timeline (a visual graph is optional).

Worked example (fictional): a condition requires a renewed lease deed by 30 November 2026.

1. The obligation links to the decision, institution, case, required evidence, due date, verifier and escalation policy.
2. When the reminder window opens, the institution's task list and the officer's view show the same obligation.
3. If the date passes, the obligation shows overdue and an escalation event records its recipient.
4. The institution uploads a renewal. The screen shows **Submitted, awaiting verification**, states separately whether the submission was on time, and whether the current verified document has expired.
5. The system suggests the expiry date with page and excerpt; the reviewer confirms it.
6. Acceptance makes the new version current and fulfils only the obligations it explicitly satisfies. Rejection keeps the receipt and reopens the obligation with reasons. Neither rewrites the expired historical version.

Second differentiator: **policy impact preview**, e.g. change a demo reminder from 7 to 14 days before expiry, see exactly which reminders change, compare versions, then publish. Deterministic recalculation, not AI and not legal interpretation.

---

## 12. EVC, documents and compliance details

### EVC

- A case joins the queue only when preliminary requirements are complete; `ready_at` is recorded and scheduling delay is measured from it.
- Expert directory: specialisms, eligibility, availability, reservations, declared conflicts. Conflict checks: own institution, declared conflict, affiliation (domain reviewer decides which are mandatory). Missing directory data shows **information unavailable**, never "no conflict".
- Suggestions: filter by eligibility, composition, availability and no overlap; rank by deadline urgency, expert workload and travel practicality. Each factor shown.
- Confirmation by the EVC scheduler reserves all members in one transaction; a database no-overlap constraint rejects a competing confirmation.
- Rescheduling replaces reservations with history and reason; alerts regenerate.
- Visit modes: physical, online, hybrid. Institution acknowledgement and member confirmation tracked.
- Completion requires report submission and acceptance; individual findings and attachments stored separately.

### Documents

- Logical document with immutable versions: own storage key, SHA-256, uploader, receipt time, predecessor.
- Upload into quarantine; check scope, allowed format by file signature, size, page count; reject encrypted or damaged files; then move to private storage.
- Downloads re-check access on every request and stream through an authorised endpoint.
- External reminders never contain attachments or sensitive details.
- Hash equality proves identical bytes only; it does not prove authenticity.

### Compliance

- Obligations created from authorised decision conditions (manual entry first, templates second).
- Submissions link exact document versions and issue a receipt.
- Verification records accept/reject, reasons and verifier; only explicitly satisfied obligations close.
- Extensions keep original and new deadline, reason and authoriser.

---

## 13. Notifications and correspondence

- In-app centre and email adapter. Events: assignment, clarification request, EVC reminder, obligation deadline, document expiry, overdue escalation, review outcome, daily digest.
- Each notification records cause, recipient, channel, created time, delivery status, retry history, read and acknowledged state.
- Acknowledging an alert does not close the underlying case. Unacknowledged escalation and failed delivery are different states.
- Provider "accepted" is shown separately from "delivered" or "bounced".
- Repeated reminders grouped; digests configurable.
- Letters and case briefs are drafts until an authorised user approves issue.
- Demo email goes to a local outbox with preview; simulated domains reproduce temporary and permanent failures.

---

## 14. Dashboards and screens

| Dashboard | Shows |
|---|---|
| Institution | What to do next, deadline and reason, verification state; applications and stages; upcoming visits; open findings; obligations; expiring documents; readiness |
| Officer | What needs attention today and why; attention priority queue; due soon and overdue; evidence awaiting verification; EVC queue; escalations |
| Management | Region × stage pendency and ageing; workload; bottlenecks; visit readiness vs scheduled; obligations due soon; renewal verification backlog; unresolved escalations; trends |

Every actionable row: case/institution ID, stage, accountable owner, pending action, due date and basis, overdue duration, blocker, evidence state and the permitted action. Waiting reasons are categorised: institution response, officer review, visit availability, external information, unknown.

Every summary drills down to the same authorised records with the same filters; summary, drill-down and export reconcile. Each dashboard shows last refreshed time and a stale/failed state; refresh is polling with the measured interval disclosed. Internal notes are never shown to institutions.

### Screens

1. Login (demo role switcher in demo mode)
2. Institution home and profile
3. Application draft and submission (with readiness)
4. Application list with filters
5. Case workspace: action panel, gap panel, evidence register, timeline
6. Scrutiny review and finding response
7. EVC queue, calendar and visit detail
8. Obligation register and verification
9. Document register, renewal and metadata review
10. Officer work queue
11. Management dashboard
12. Notification centre and email outbox preview
13. Reports and exports
14. Policy editor, source register, comparison and impact preview
15. Audit viewer with integrity check
16. User and capability administration
17. Operations: failed jobs, worker health, reconciliation, integration sync runs

Each screen has loading, empty, error, unauthorised and retry states. Accessibility: status text and icons as well as colour, labels, keyboard navigation, visible focus, readable dates, form input preserved after a recoverable failure, and no enabled action the backend will always reject. GIGW used as a reference, without claiming certification.

---

## 15. API

Base path `/api/v1`, OpenAPI generated.

| Endpoint | Purpose |
|---|---|
| `GET /me` | Identity, active scope and capabilities |
| `POST /applications` · `GET /applications` · `GET /applications/{id}` | Draft, filtered list, case detail with permitted actions |
| `POST /applications/{id}/submit` | Freeze snapshot, classify, create workflow instance |
| `POST /applications/{id}/commands` | All case transitions (`COMPLETE_STAGE`, `RETURN`, `REASSIGN`, `REOPEN`, `CLASSIFY`, `RECORD_DECISION`...), with expected version and idempotency key |
| `GET /applications/{id}/timeline` · `/evidence-trail` · `/explain` · `/gaps` · `/consistency` | Timeline, linked register, action panel, gap panel, consistency checks |
| `POST /stages/{id}/findings` · `POST /findings/{id}/responses` | Findings and responses |
| `GET /evc/queue` · `POST /evc/visits/{id}/suggestions` · `POST /evc/visits/{id}/confirm` · `POST /evc/visits/{id}/reschedule` · `POST /evc/visits/{id}/report` | EVC |
| `POST /documents/uploads` · `GET /documents/versions/{id}/download` · `POST /documents/versions/{id}/metadata-review` · `POST /documents/versions/{id}/verification` | Documents |
| `GET /obligations` · `POST /obligations/{id}/submissions` · `POST /submissions/{id}/verification` · `POST /obligations/{id}/extensions` | Compliance |
| `GET /dashboards/{view}` · `GET /reports/{name}` (JSON/CSV) | Dashboards and exports |
| `GET /notifications` · `POST /notifications/{id}/acknowledge` | Alerts |
| `POST /policies` · `POST /policies/{id}/validate` · `GET /policies/{id}/diff` · `POST /policies/{id}/preview` · `POST /policies/{id}/publish` · `POST /applications/{id}/migrate-policy` | Policy change control |
| `GET /audit` · `POST /audit/verify` | Audit |
| `POST /integration/sync` · `GET /integration/runs` · `GET /integration/reconciliation` | Integration |
| `GET /ops/health` · `GET /ops/jobs` · `POST /ops/jobs/{id}/retry` · `POST /demo/clock` | Operations and demo |

Errors return a stable code, message and correlation ID. `409` for stale versions or conflicting commands; idempotency key reuse with a different body is rejected. Authorisation is checked before any case detail is revealed. No generic status-patch endpoint. CSV exports neutralise spreadsheet formulas.

---

## 16. Optional AI (after the core path works)

- **Document field extraction**: text layer first, OCR fallback in an isolated worker, pattern rules for obvious dates and IDs, LLM only for semantic interpretation. Structured output: field, value, excerpt, page, ambiguity, method. The excerpt must exist in the source text. Candidate dates (issue, execution, expiry, registration) shown together; absent fields abstain. Reviewer confirmation required before any deadline uses the value; re-extraction never silently changes a live deadline.
- **Case brief**: draft from structured records with record references on each statement; disputed or unverified facts marked; officer approves before use.
- **Rule explanation** in plain language.
- **Policy Q&A** only over a curated, versioned APH set with page and clause metadata, filtered by year and version; refuses when evidence is missing or conflicting.

Guardrails: same permissions as the user (filtered before retrieval); document text treated as untrusted and kept apart from instructions; no tool execution from documents; model output cannot call case commands; no self-reported confidence presented as probability; synthetic files only for the hackathon. With AI disabled, everything still works.

Evaluation: ~60 labelled synthetic pages (clean text, scans, multiple dates, missing dates, contradictory fields, an unsupported language, instruction-like text), split by template. Metrics: field exact match, date-role accuracy, unsupported-value rate, correct abstention, citation validity, processing time, human correction rate.

---

## 17. Integration with existing AICTE systems

- Documented contract and a working **mock** adapter importing a fixture portal export (valid, changed, duplicate, invalid, unknown-code and out-of-order records).
- Raw source record and mapping version retained; imports idempotent by source system + external ID + event ID/revision; late and out-of-order events handled.
- Unknown codes go to a reconciliation queue, never coerced into a valid state.
- External events update mirror fields or call permitted import commands; they never bypass authority checks.
- Field-authority matrix (which system owns which field); read-only shadow reconciliation before any writeback.
- No scraping of authenticated portals; no claim of live AICTE connectivity. NSWS-style forwarding is shown as the integration boundary.

---

## 18. Audit and security

- Audit: actor, active capability, institution and case, action, previous and resulting version, reason, server time, rule and policy version, documents, correlation ID, visibility.
- Append-only for application identities (database triggers); corrections are new events; hash chain for tamper detection with periodic protected checkpoint exports. Never described as absolutely immutable.
- Server-managed sessions (httpOnly, SameSite, Secure behind TLS), CSRF protection, scrypt password hashing, login rate limits and lockout.
- Parameterised SQL, rate limits, secrets only from environment, redacted logs.
- Quarantined uploads, private storage, re-checked downloads.
- Health checks: liveness separate from readiness (not ready without the database).
- Documented backup and restore; restore tested into an isolated database.
- Production requirements (documented, not claimed): official SSO and MFA, delegation review, vulnerability assessment, incident ownership, CERT-In and DPDP applicability review, retention schedules, approved hosting.

---

## 19. Demo data and demo

### Data

- About 100 narrative cases across three synthetic jurisdictions with obvious demo names; flagged `is_synthetic` and labelled in the UI.
- Covers all five route fixtures, an unclassified case, an appeal, returned and resubmitted cases, scheduled/held/delayed EVCs, open and overdue obligations, an authorised extension, expiring and expired leases, a renewal awaiting verification, a rejected renewal, a failed notification and a retry.
- Separate generated dataset of 10,000 cases for load tests.
- One seed command resets the exact demo state.
- Demo accounts for each role at `@demo.aicte.test`, demo mode only.

### Seven-minute demo

| Time | Show | Point |
|---|---|---|
| 0:00–0:40 | Officer queue → overdue case → action panel | Pendency has an owner, reason and next action |
| 0:40–1:35 | Institution submits; engine shows route and matching rule | Routing is configurable and explainable |
| 1:35–2:20 | Finding raised, response submitted, re-scrutiny completed | Returns keep history and authority |
| 2:20–3:05 | EVC suggestion confirmed; a competing overlap rejected | Scheduling enforces constraints |
| 3:05–4:10 | Condition → obligation → upload → suggested expiry date confirmed | Documents link to ongoing obligations |
| 4:10–5:00 | Demo clock jump → reminder, overdue, escalation | Deadline engine acts on its own |
| 5:00–5:45 | Renewal verified; full evidence trail | Closure needs authorised verification |
| 5:45–6:20 | Draft reminder change 7 → 14 days, impact preview | Controlled configurability |
| 6:20–7:00 | Recovery test results, blocked unauthorised action, measured numbers | Claims backed by evidence |

The full 16-step journey (submit → route → deficiency → response → re-scrutiny → EVC queue → confirmed visit → escalation → report and review → decision → undertaking → evidence → verification → lease near expiry → replacement verified → dashboards and audit) is scripted in `docs/DEMO_SCRIPT.md`, with prepared cases at each stage as a fallback. A recorded run and a local offline setup are kept as backups.

---

## 20. Tests, release gate and measurements

### Test matrix (release gate)

| ID | Scenario | Required result |
|---|---|---|
| W01 | Five route fixtures | Correct required stages for each |
| W02 | Unmatched or ambiguous classification | Waits for authorised classification |
| W03 | Completion without required recommendation or evidence | Rejected, no partial change |
| W04 | Authorised return and new review round | Reason, response and history kept |
| W05 | Direct edit to a submitted snapshot | Denied; amendment is a linked record |
| W06 | Committee recommendation recorded | Decision still pending until authority acts |
| W07 | Appeal or hearing created | Distinct linked process; original decision preserved |
| C01 | Same command twice, same key | One result, same response |
| C02 | Key reused with a different body | Conflict |
| C03 | Two reviewers on the same version | One succeeds, the other gets 409 |
| C04 | Failure mid-transaction | Stage, audit and outbox roll back together |
| D01 | Threshold crossed in local time zone | Alert within the scan tolerance |
| D02 | Document valid through a date | Expires at next local midnight |
| D03 | Leap day, month end, holiday | Correct calendar result |
| D04 | Clarification without a permitted pause | Deadline continues |
| D05 | Extension or migration | History kept; old generation cancelled |
| D06 | Scheduler down across several thresholds | Current alert sent, no burst of stale ones |
| N01 | Two workers claim the same alert | One alert event |
| N02 | Worker dies after claim | Lease expiry makes it recoverable |
| N03 | Worker dies after send | Uncertain delivery reconciled, no exactly-once claim |
| N04 | Permanent bounce | Visible failure, bounded retry, operations task |
| E01 | Two visits reserve one expert at the same time | Database rejects the second |
| E02 | Reschedule or cancel | Reservations and alerts updated with history |
| E03 | Visit time passes without a report | Not marked complete |
| O01 | On-time evidence awaiting verification past deadline | Timeliness preserved; verifier backlog shown |
| O02 | Renewal uploaded while old document expired | Expired state visible until replacement accepted |
| O03 | Evidence rejected or partly adequate | Only satisfied obligations close |
| S01 | Cross-institution or out-of-scope requests | No case, document, search, aggregate or export disclosure |
| S02 | Revoked grant or expired appointment | Access removed |
| S03 | Disguised, oversized or damaged upload | Rejected or quarantined, no unsafe parsing |
| A01 | Multiple dates, missing field, unsupported language | Correct candidates and abstention, nothing fabricated |
| A02 | Instruction-like text inside a document | No action taken |
| R01 | Dashboard vs drill-down vs export | Counts reconcile |
| R02 | Backup restored to an isolated database | Cases, versions and deadlines reconcile |

Plus the specification's own tests: approved application with pending compliance, policy change with existing cases unchanged, audit completeness, notification duplicate prevention, worker restart recovery.

### Proposed prototype targets (not AICTE service levels)

- All P0 tests pass; no known cross-institution disclosure.
- A due internal alert created within two minutes with a one-minute scheduler.
- Dashboard p95 under one second with 10,000 cases and 50 concurrent users on a documented machine.
- A failed delivery visible in the operations view.

### Measurements

`npm run evaluate` writes `docs/EVALUATION.md` with conditions and actual results: route fixture pass rate, deadline calculation correctness, alert detection latency, duplicate alert count, audit coverage, expired-document detection, EVC conflict rejection, dashboard response times, time to identify owner and next action, extraction metrics, and a manual follow-up comparison on a defined task with the same cases and completion criteria. No invented improvement percentages; synthetic results are labelled as such.

---

## 21. Milestones

Effort split guide: about 65% core workflow, 20% security/testing/recovery, 15% differentiators and presentation.

| # | Build | Done when |
|---|---|---|
| **M1** | Schema revision, auth and sessions, capability grants and scoping, institutions, applications with proposals and frozen snapshot, command endpoint, one complete scrutiny path, audit and outbox from the first transition | One application goes draft → decision via commands; duplicate and invalid commands rejected; cross-institution API tests pass |
| **M2** | Five route fixtures, classification and unclassified handling, returns and re-scrutiny attempts, findings and responses, recommendations vs decisions, appeal linkage, policy versions with validation, diff, approver-only publish, source register | W01–W07 and C01–C04 pass |
| **M3** | Clock service, deadline engine (calendars, months, valid-through, pause segments, extensions), scheduler, jobs with leases, alert events, in-app notifications, email outbox, retries, dead letters, catch-up, reconciliation, operations view, demo clock | D01–D06 and N01–N04 pass |
| **M4** | EVC readiness queue, expert directory, conflicts, suggestions with factors, confirmed reservations with no-overlap constraint, reschedule, held/report submitted/report accepted | E01–E03 pass; conflict-free visit confirmed |
| **M5** | Quarantined uploads, document versions, manual metadata review, obligation register, submissions with receipts, verification, extensions, lease renewal, evidence trail panel | O01–O03 and S03 pass; lease case explainable from one panel |
| **M6** | Role dashboards with drill-down, reports and CSV exports, audit viewer with integrity check, mock integration with reconciliation queue | R01 passes; sync run reported |
| **M7** | Action panel, gap panel, attention priority queue, consistency checks, readiness, bottleneck analysis, policy impact preview, institution timeline | All differentiators demoable |
| **M8** | Optional AI extraction and case brief with dataset evaluation, Playwright journey, load test, backup restore test, accessibility pass, docs, evaluation report, demo rehearsal | A01, A02, R02 pass; full demo runs three times from a reset |

Each milestone ends with a working vertical slice and passing tests. If time runs short, cut in this order: AI extraction, visual policy editing, scheduling suggestions. Document tracking, EVC alerts and human verification are never cut.

---

## 22. Cost and operating assumptions

The local prototype needs no paid services: email outbox, manual confirmed metadata, local extraction, synthetic data. For a hosted pilot, estimate from usage: document count × versions × size × retention for storage; scanned pages × throughput for extraction; notifications after deduplication and digests; optional model calls with per-document page and token budgets. Provider prices are checked when services are chosen, not assumed.

---

## 23. Out of scope

Blockchain, custom-trained LLMs, autonomous approval agents, national fraud or risk scores, facial recognition, GPS inspection proof, native mobile apps, microservices, historical delay prediction (until representative lawful data exists), issuer or registry verification (until an authorised integration exists), advanced scheduling optimisation (until eligibility and conflict rules are dependable). OCR or an LLM cannot establish document authenticity.

---

## 24. Deliverables

- Source code (`server/`, `web/`), migrations, seed fixtures, load dataset generator
- README with local setup (embedded PostgreSQL or Docker Compose), `.env.example` without secrets, worker setup
- `docs/ARCHITECTURE.md`, `docs/API.md` (+ OpenAPI), `docs/PERMISSIONS.md`, `docs/POLICIES.md` (examples with provenance), `docs/INTEGRATION.md`, `docs/OPERATIONS.md` (backup/restore, failed jobs)
- Automated tests and Playwright journey
- Demo credentials, `docs/DEMO_SCRIPT.md`, recorded fallback
- `docs/EVALUATION.md` (measured results), `docs/LIMITATIONS.md`, `docs/PITCH.md`

---

## 25. Boundaries

- No external deployment, purchases or real notifications without explicit permission.
- No claim of live AICTE connectivity or official endorsement.
- Demo rules and timelines stay labelled `DEMO_ASSUMPTION` until verified against the official Approval Process Handbook 2024-27 and the applicable amendments.

---

## 26. Status

| Item | Status |
|---|---|
| npm workspaces (`server`, `web`) and dependencies | Done |
| `.env.example` | Done |
| Database schema `server/migrations/001_init.sql` | Written, not yet run; needs revision in M1 for proposals, snapshots, recommendations, decisions, capability grants, policy sources, obligation lifecycle, extraction fields, expert reservations, alert events, import records and worker heartbeats |
| Config, DB helpers, migration runner, embedded PostgreSQL script | Written, not yet run |
| M1–M8 | Not started |
