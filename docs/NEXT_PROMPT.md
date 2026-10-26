# Prompt for the next session — C1: synthetic PDF expiry dataset

Copy everything below the line into the coding session.

---

Continue the **AICTE Approval & Compliance Platform** (SIH 2026, SIH26262, Team Infera). **M1–M6 are complete locally, with 204 tests passing. Implement C1 only**: a reproducible labelled synthetic PDF dataset for the later offline expiry-date feature. Do not start C2–C5, M7 or demo preparation. Report after one tested local commit and stop. **Do not push**; the standing user no-push instruction overrides older milestone push text.

## Read first

1. docs/WORK_LOG.md, AGENTS.md, docs/PROGRESS.md — current state, product/engineering rules and local unpushed work.
2. docs/NATIONAL_ROUND_PLAN.md §4.3 — offline text/OCR extraction, human confirmation and measured evaluation; the user-approved staged order below is the scope boundary.
3. docs/BUILD_PLAN.md §12 documents, §16 extraction guardrails, §20 A01/A02; docs/FOUNDATIONS.md and docs/LIMITATIONS.md.
4. Existing server document storage/upload/schema/metadata-review modules, server/test/helpers.ts, package scripts and .gitignore. M6 acceptance is recorded in docs/M6_ACCEPTANCE.md.
5. Use the PDF skill if available for PDF generation, rendering and visual inspection. Avoid introducing an unrelated framework or paid service.

## Setup and baseline

Use the active checkout; do not reset it to remote main or discard unpushed B5–B7 commits. Preserve existing user changes. Reuse healthy PostgreSQL/API/web services; .env is local and must not be overwritten.

```bash
npm install                   # only if dependencies need installation
cp .env.example .env          # only if .env is missing
npm run db:start              # separate terminal only if PostgreSQL :54329 is not running
npm test                      # baseline: 204 tests in the current local checkout
```

PostgreSQL must be UTF8. Tests reset only the isolated aicte_test database; do not reset the prepared development database unnecessarily. API/web/worker are not required for a dataset-only change. If UI inspection becomes necessary, use existing localhost API :4000/web :5180 and the local outbox only. On Windows use npm.cmd where PowerShell blocks npm.ps1. Keep full test outputs in ignored var/ files; diagnose failures before retrying.

## Existing boundary to preserve

- Only a user with DECISION_RECORD records a regulatory decision; escalation only notifies. Approval outcome, compliance and lifecycle are independent.
- Upload, metadata confirmation, document acceptance, evidence receipt and obligation fulfilment remain separate. M5 metadata review is manual; extraction must later produce suggestions only.
- Every rule carries APH_CLAUSE / ADMIN_INSTRUCTION / DEMO_ASSUMPTION provenance; synthetic document text is not an official AICTE rule or instruction.
- All source data is synthetic. No real institution/person/document, real email, external service call, paid AI, portal connection or production upload.
- Existing case transitions stay behind application commands; mutations require current scope/capabilities, versions, idempotency, same-transaction audit and outbox. Business logic uses now(). Schema changes require a new migration after 007; **C1 needs no schema change**.
- M6 reports/CSV, audit and source mirrors/reconciliation remain unchanged. Do not treat external/mock status as approval.

## C1 scope — dataset only

1. Add a documented local generator and a checked-in corpus of **20–30 valid synthetic certificate/lease/fire-NOC PDFs**, with `expected.json` as independent ground truth. Choose a consistent dataset directory, for example `server/fixtures/extraction/`; keep rendered QA images/temp files under ignored var/. Use an existing suitable dependency/runtime where possible; any added generator dependency must be recorded and reproducible.
2. Include actual **text PDFs and scanned/image-only PDFs**. Scanned fixtures must contain raster page images without an embedded selectable-text layer; a rotated or faint scan is useful. Some examples should put expiry on page 2 or later. All names/addresses/identifiers must be obviously fictional and visibly labelled synthetic.
3. Cover expiry phrases `valid till`, `valid up to`, `expires on`, `expiry date`; formats such as `31/03/2027`, `31-Mar-2027`, `March 31 2027`, `31.03.2027`, and day/month-name/year. Include issue/execution dates alongside expiry, no-expiry documents, invalid dates, conflicting expiry candidates and ambiguous numeric dates. Include instruction-like document text as inert source content, never executable instructions.
4. Define a stable manifest schema with fixture ID/path, text/scan kind, template family/split, page count, expected expiry (`YYYY-MM-DD` or null), expected result state (unambiguous / ambiguous / not found), and labelled candidate dates with role/page/source excerpt. Keep issue dates distinct from expiry. Add known source rectangles/coordinate conventions where practical for later highlight evaluation. Ground truth comes from fixture definitions, not from the future extractor's own output.
5. Make generation deterministic in content, stable IDs/names and expected labels: fixed fixture dates/seed, no current-date-dependent labels, no network assets/fonts/data. Explain any unavoidable PDF-byte metadata variability. Avoid overwriting unrelated files; clean/rebuild only the exact dataset output directory after verifying its resolved path.
6. Render and visually inspect the generated PDFs; validate readable pages, intended scan/text distinction, page counts and manifest/file alignment. Check at least each template family and tricky case, including page-2 expiry, conflicting dates, absent expiry and image-only scans. Fix malformed PDFs; do not reuse the intentionally minimal upload-test PDF bytes as the evaluation corpus.
7. Document the generator command, dataset coverage, label definitions, coordinate system, regeneration and QA checks. This step establishes fixtures only: **do not claim extraction accuracy**, implement date parsing/OCR, run fake evaluation, add API/UI/review/deadline logic, or upload the corpus to user cases.

## Later steps — context only, not authorised in this turn

- C2: pdfjs-dist text/positions and deterministic date-role rules; source-backed candidates `{field,value,page,excerpt,bbox,method:'text'|'ocr',ambiguous}`; abstain when uncertain.
- C3: isolated, bounded tesseract.js OCR fallback with locally available language data; no runtime network dependency.
- C4: suggestions and source highlight in the existing M5 review screen. Officer confirms/edits through existing audited commands; extraction never silently changes live deadlines.
- C5: real `npm run evaluate:extraction` results with per-PDF/total and text-versus-scan correct/wrong/abstain metrics; then prompt for M7.

## Definition of done

- 20–30 valid synthetic PDFs and expected.json match a reproducible generator, with text and genuinely image-only cases and honest labels.
- Generator/manifest checks and render/visual QA complete. Add focused tests only for substantive new generator/manifest behaviour; preserve all existing 204 tests. No implementation-mirroring tests or invented extraction metrics.
- `npm run typecheck`, `npm test`, `npm run build`, `git diff --check` pass; save full output if anything fails.
- Update PROGRESS.md with actual counts/coverage/limitations and WORK_LOG.md with 3–5 lines. Replace NEXT_PROMPT.md with a standalone **C2-only** prompt in this style, keeping C3–C5 separate.
- Make **one local commit**, no AI-tool attribution, **no push**. Tell the user what was generated, how it was checked, the command/path to inspect it, and that C2 is next. Stop before C2.
