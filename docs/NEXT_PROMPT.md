# Prompt for the next session — Milestone 5

Copy everything below the line into the coding session.

---

You are continuing the **AICTE Approval & Compliance Platform** (SIH 2026, SIH26262). M1–M4 are complete. Implement **Milestone 5 only**: private document versions, approval obligations, evidence receipts, verification and lease renewal.

## Read first

1. AGENTS.md — product and engineering rules.
2. docs/BUILD_PLAN.md — §7–8 models, §10 deadlines, §11 evidence register, §12 documents/compliance, §15 API, §20 O01–O03/S01–S03, §21 milestones.
3. docs/PROGRESS.md — implementation and known gaps. Read the M4 section and preserve existing behaviour.
4. docs/FOUNDATIONS.md — reuse documents/storage.ts and uploadCheck.ts; strengthen their limitations where needed, do not replace the adapter architecture.
5. Skim applications/commands.ts, command-kit.ts, commands-m2.ts, evc/commands.ts and service.ts, deadlines/engine.ts and calendar.ts, identity/permissions.ts, test/helpers.ts, m4-evc.test.ts, web/src/caseCommand.ts and pages/CaseM4.tsx.

## Setup

```bash
npm install
cp .env.example .env              # only if missing
npm run db:start                  # separate terminal, PostgreSQL UTF8 / port 54329
npm run db:reset                  # disposable synthetic development database only
npm test                         # baseline: 119 passing
npm run dev:api                   # API 4000; separate terminal: npm run dev:web (5180)
npm run dev:worker                # separate terminal; local outbox only
npm run demo:scenarios            # eight prepared synthetic cases, including EVC
```

## Existing M4 boundary

Visits now proceed through readiness → proposal → confirmation with reservations → institution/member confirmations → explicit held record → report revision → regional acceptance → explicit stage completion. `visit_reports`, `visit_findings` and `visit_events` are append-only. Reports are structured text; attachments are not yet built. EVC commands use case/visit versions and the common command/idempotency boundary. Keep report acceptance separate from regulatory approval. Expert directory management and offline inspection are outside M5.

## Milestone 5 scope

Build working vertical slices (migration → service/command → API → web → tests).

1. **New migration 005_documents_compliance.sql**: logical institution/case documents; immutable byte versions with private storage key, SHA-256, uploader, receipt time and predecessor; metadata review and verification records; obligations linked to exact decision conditions; evidence submissions/receipts and exact version links; verification outcomes and history. Add attachment references to visit reports/findings and finding responses without updating immutable historical report content. Protect version bytes and historical receipts from rewriting.
2. **Private uploads/downloads**: reuse quarantine → inspect → promote and the StorageAdapter. Multipart limits match config. Validate actual bytes, extension, size and safe parsing; current PDF inspection is heuristic, so do not claim malware scanning or document authenticity. Handle orphaned uploads and failures safely. Every upload, download, list, preview, attachment and count rechecks current scope; opaque random keys never become public file URLs. Out-of-scope returns 404. Use synthetic files only.
3. **Evidence register**: decision → condition → obligation → deadline/rule → receipt → exact document version → metadata/verification → closure, with links to each record. Approval outcome, compliance status and workflow lifecycle stay separate. Upload is not verification and does not fulfil an obligation by itself.
4. **Obligation lifecycle**: OPEN → EVIDENCE_SUBMITTED → UNDER_VERIFICATION → FULFILLED / CLOSED_WITH_AUTHORISED_REASON. Rejection preserves receipt/reason and reopens the obligation. Due-soon/overdue are computed, not lifecycle states. Authorised users create obligations from recorded conditions; use manual entry first, optional reviewed templates second. Changes require capability, scope, reason, expectedVersion and idempotency; case changes use the existing case command endpoint. Audit/outbox stay in the same transaction.
5. **Separate clocks**: obligation submission, verification waiting and document validity reuse the existing engine/calendar/worker. Record submission timeliness at receipt independently of later officer verification. An on-time submission remains on time when review is late. Valid-through dates expire at next local midnight. Renewed uploads leave the previously verified document expired until the replacement is accepted. Extensions preserve original due/history and invalidate stale generations. No invented official timelines; every sample rule is DEMO_ASSUMPTION.
6. **Metadata**: reviewer-confirmed institution/address/land area/issue/valid-through values, each linked to exact version and evidence page/excerpt when available. Keep suggested/extracted values separate from confirmed values. Do not implement optional AI/OCR extraction or cross-document consistency scoring in M5; handle unavailable/ambiguous data honestly.
7. **Human verification**: explicitly accept/reject each submitted version and each obligation it satisfies, with reasons. Partial adequacy closes only the selected, satisfied obligations; unrelated obligations stay open. Preserve all earlier verification decisions and expired versions. Lease renewal must demonstrate this complete flow.
8. **Web/API/demo**: document register, private upload/download, metadata review, obligation register, submission receipts, verification queue and linked evidence trail on the case. Follow capabilities, shared theme, loading/empty/error/retry states, and accessible labelled forms. Notifications link to authorised records, without report/document content in emails. Add a pending-obligation case and an expired lease with a submitted replacement to demo scenarios.

## Tests required

- **O01** on-time evidence awaiting verification after the deadline: original timeliness retained; verifier backlog distinct.
- **O02** renewal upload does not clear expired status; explicit acceptance switches the verified current version while old history remains.
- **O03** reject/partial evidence: receipts preserved, reason required, only satisfied obligations close.
- **S01/S02** cross-institution, cross-region, unassigned, revoked/expired grants: no data/bytes/count/preview disclosure.
- **S03** disguised, oversized, empty, damaged/encrypted upload and unsafe filename; no private files promoted or leaked on rejection.
- **D02/D03/D05** validity at next local midnight, holidays/month end and extension/stale alerts.
- Exact version linking, immutable historical bytes/records, independent approval/compliance states, concurrency/idempotency/version rejection and atomic rollback of commands/audit/outbox. Cover storage failure/orphan cleanup.
- Existing 119 tests must still pass. Use fixed business clock, real PostgreSQL, local storage and local outbox; no external services.

## Definition of done

- npm run typecheck, npm test and npm run build pass.
- Browser demo: approved condition → obligation → reminder → evidence receipt → human rejection/correction → accepted replacement → explicit fulfilment, preserving original submission timeliness and old expired document history.
- Update PROGRESS.md with actual test counts, features and limitations. Update README/HANDOFF as needed.
- Replace NEXT_PROMPT.md with a **Milestone 6** prompt based on BUILD_PLAN §14, §17, §20 and §21.
- Do not implement M6 dashboards/integration, M7 simulation/consistency, M8 AI or the separately proposed national-level additions.
- Commit and push tested work to GitHub main as authorised by the user. No AI-tool attribution in commits, PRs or docs.
