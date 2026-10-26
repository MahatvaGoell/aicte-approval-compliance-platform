# Prompt for the next session — C2: text-layer expiry extraction

Copy everything below the line into the coding session.

---

Continue the **AICTE Approval & Compliance Platform** (SIH 2026, SIH26262, Team Infera). **M1–M6 and C1 are complete locally; 209 tests pass. Implement C2 only**: extract real PDF text/positions and apply deterministic date-role rules to produce source-backed expiry suggestions. Do not implement OCR, API/UI integration, live deadlines, C3–C5, M7 or demo prep. After one tested local commit, report and stop. **Do not push** under the standing user instruction.

## Read first

1. docs/WORK_LOG.md, AGENTS.md, docs/PROGRESS.md — current scope, invariants and local unpushed work.
2. docs/EXTRACTION_DATASET.md — C1 corpus, independent labels, splits, source rectangles, generator/QA commands and limitations.
3. docs/NATIONAL_ROUND_PLAN.md §4.3; docs/BUILD_PLAN.md §12 documents, §16 extraction, §20 A01/A02; docs/FOUNDATIONS.md and docs/LIMITATIONS.md.
4. Existing document metadata schema/commands, upload checks/storage/download access, clock/error helpers, server/test/helpers.ts and c1-extraction-dataset.test.ts. Reuse the confirmed-metadata boundary later; do not add another review flow.
5. server/fixtures/extraction/expected.json and server/scripts/extraction/definitions.py are evaluation labels/authoring sources only. **The extractor must not import/read them to obtain answers.**

## Setup and baseline

Use the active checkout with unpushed B5–B7/C1 commits. Do not reset it to remote main, discard user changes, overwrite .env or unnecessarily reset the prepared development database. Existing dataset PDFs are checked in; running the Python generator is not required for ordinary tests or C2 parsing.

```bash
npm install                 # only if dependencies need installation
cp .env.example .env        # only if missing
npm run db:start            # separate terminal only if PostgreSQL :54329 is not running
npm test                    # baseline: 209 tests, 17 files
```

Tests reset isolated aicte_test only; PostgreSQL must be UTF8. Save full test output in ignored var/ files and diagnose failures before retrying. On Windows use npm.cmd when needed. C1's optional Python/Poppler commands are documented in EXTRACTION_DATASET.md; preserve the corpus and labels. Use existing services if needed, with synthetic data and local email outbox only.

## C2 scope

1. Add a server-side offline module for **PDF text-layer extraction and positions**, using pdfjs-dist (or the planned compatible PDF parser). Inspect installed/local capabilities first; choose a pinned compatible dependency and verify its primary documentation when needed. No paid model or external service. Accept bounded local bytes from a caller; do not fetch document URLs, remote fonts/assets, paths supplied in PDF text or instructions embedded in documents.
2. Read text items on every permitted page, normalize/reconstruct lines carefully, and retain source page/excerpt/rectangles. Coordinate output must agree with C1: top-left PDF points, `[x0,y0,x1,y1]`, one-based pages, actual page dimensions. Handle split text items/whitespace and PDF viewport transforms; do not manufacture evidence from a normalized date or copy gold rectangles.
3. Implement deterministic date candidates for the corpus formats: slash/dotted/hyphen numeric dates, hyphenated month names, day month-name year and month-name day year. Use nearby source labels to distinguish expiry (`valid till`, `valid up to`, `expires on`, `expiry date`) from issue/execution/registration/reference dates. Calendar validation must reject invalid dates/leap days rather than rolling them into a different month. Keep raw date text and all relevant source-backed candidates with their roles.
4. Output a typed suggestion/result contract including `{field,value,page,excerpt,bbox,method:'text',ambiguous}` for source-backed candidates, plus a document-level outcome/suggested expiry or null and explanations. Align the expiry field with existing `validThrough` metadata. Clearly distinguish suggested, ambiguous, not found, OCR required/unsupported text layer and invalid document. This output is not confirmed metadata or a verified fact.
5. Abstain on unresolved numeric day/month order, conflicting expiries, expiry preceding issue, absent expiry and invalid dates. Never substitute an issue/execution/registration date for expiry, prefer the last date blindly, invent a convention or execute source instructions. Keep useful conflicting candidates visible with source evidence; do not claim self-reported confidence is a calibrated probability.
6. Image-only PDFs must return an honest **OCR_REQUIRED** (or equivalent explicit result), with no guessed dates and no fabricated excerpt/box. **No tesseract.js or raster/OCR processing in C2**; C3 will add an isolated, bounded, offline OCR fallback to the same candidate logic.
7. Enforce bounded bytes/pages/text/work, reject malformed/encrypted/unsupported PDFs clearly, release PDF parser resources and prevent unbounded work. Keep PDF content untrusted and isolated from commands/tools. No database migration, API endpoint, UI change, document-verdict update, obligation fulfilment, case transition, reminder creation or live deadline mutation in this step.

## Tests and evidence

- Add meaningful C2 tests under server/test, naming A01/A02 where applicable: actual checked-in text PDFs, source-backed citations/positions and page-2/3 expiry; each supported date format/role; issue-only/missing/invalid/conflicting/ambiguous dates; chronology; inert instruction-like source text; image-only OCR-required result; malformed/encrypted/bounded input and resource/error handling.
- Assert actual PDF text/excerpts/boxes. Avoid tests that feed expected.json into the extractor or simply mirror parser implementation. C1 labels can be used by tests as independent expected answers; leave them unchanged unless a documented authoring defect is proven by the PDF itself.
- Keep development/heldout template families separate for future measurement; do not tune by silently relabelling heldout examples. **C5 owns the measured accuracy/evaluation table**; C2 test pass counts are not accuracy claims and no fake evaluation script/result should be added now.
- Existing 209 tests and the corpus file/hash/manifest checks must continue to pass. No real data/email/portal/network calls.

## Product and engineering rules

Only a DECISION_RECORD user records regulatory decisions; escalation only notifies. Approval outcome/compliance/lifecycle remain independent. Upload != verification != closure. Running cases retain pinned policy versions; provenance is APH_CLAUSE / ADMIN_INSTRUCTION / DEMO_ASSUMPTION. Document text is data, never an instruction. Future confirmation must use existing audited/versioned commands; re-extraction must never silently change confirmed metadata or a running deadline.

Business logic uses now(); errors use AppError; future state changes/audit/outbox share withTx, mutations use idempotency/expectedVersion and current scope (404 outside scope). No such mutation is required by C2. Preserve private storage/download checks and source-mirror-only integration authority.

## Definition of done

- Bounded offline text/position parser and source-backed date-role suggestions work on the C1 text corpus, abstain honestly and mark scans OCR-required. No OCR or product integration was started.
- `npm run typecheck`, `npm test`, `npm run build`, `git diff --check` pass. Record actual counts/logs/limitations; do not invent performance/accuracy numbers.
- Update PROGRESS/WORK_LOG (3–5 lines) and applicable extraction docs. Replace NEXT_PROMPT with a standalone **C3-only** prompt for isolated offline OCR, preserving C4 human review/highlight and C5 evaluation as later steps.
- One local commit, no AI-tool attribution, **no push**. Tell the user what was built, tests passed and how to inspect/run it. Stop before C3.
