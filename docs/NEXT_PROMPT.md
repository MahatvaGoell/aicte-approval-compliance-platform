# Prompt for the next session — C3: isolated offline OCR fallback

Copy everything below the line into the coding session.

---

Continue the **AICTE Approval & Compliance Platform** (SIH 2026, SIH26262, Team Infera). **M1–M6 and C1–C2 are complete locally; 226 tests pass. Implement C3 only**: bounded isolated offline OCR for pages without usable text, reusing the C2 date-role/source-evidence contract. No API/UI, metadata confirmation, live deadline, C4/C5/M7 or demo-prep work. One tested local commit, report and stop. **Do not push** under the standing user instruction.

## Read first

1. docs/WORK_LOG.md, AGENTS.md, docs/PROGRESS.md and docs/LIMITATIONS.md.
2. docs/PDF_TEXT_EXTRACTION.md — current C2 API, worker lifecycle, budgets, abstention/coverage rules, coordinate/box precision and CLI.
3. docs/EXTRACTION_DATASET.md — 24 PDFs / 32 pages (16 text, 8 real image-only scans), ground truth, template splits and scan transforms. Gold data is for tests only.
4. docs/NATIONAL_ROUND_PLAN.md §4.3; docs/BUILD_PLAN.md §12, §16, §20 A01/A02; docs/FOUNDATIONS.md.
5. server/src/modules/documents/extraction/{text,types,lines,rules}.ts and pdf-worker.mjs; server/scripts/extract-pdf.ts; c1/c2 tests; existing metadata review commands/storage/upload checks. Do not replace the tested foundation or invent a new review workflow.

## Setup and baseline

Use the active checkout, preserving unpushed B5–B7/C1–C2 commits and user changes. Do not reset to remote main, overwrite .env or reset prepared development data unnecessarily.

```bash
npm install                 # if dependencies need installation
cp .env.example .env        # only if missing
npm run db:start            # only if UTF8 PostgreSQL :54329 is not running
npm test                    # baseline: 226 tests, 18 files
npm run extract:pdf -- server/fixtures/extraction/pdfs/expiry-01.pdf
```

Node 22.13+ or 24+ is required by pinned pdfjs-dist 6.4.299 (C2 tested on 26.3.0). Current parser is bytes-only, does not write data and needs no Python/Poppler. Reuse healthy local services if needed; no real email or portal/external document service. Test resets affect isolated aicte_test only. Save full logs to ignored var/ and diagnose failures before retrying. On Windows use npm.cmd as needed.

## Existing boundary

C2 streams actual PDF text/positions, reconstructs source lines and date-role candidates, handles rotated/CropBox/UserUnit viewports and abstains on ambiguous/invalid/conflicting/chronologically inconsistent dates. Whole-text-item rectangles are explicitly TEXT_ITEM precision. Image-only/partial/unsupported text currently returns OCR_REQUIRED and no document-level suggestion. Existing tests cover expiry/issue/execution/registration/reference separation, real development fixtures, inert source instructions, all scans, malformed/encrypted/bounded inputs, cancellation/timeouts and two-worker capacity. Preserve these behaviours.

Only DECISION_RECORD users record regulatory decisions; escalation only notifies. Approval/compliance/lifecycle remain separate. Upload != verification != closure. Each case retains its policy version. Rules use provenance APH_CLAUSE / ADMIN_INSTRUCTION / DEMO_ASSUMPTION. Suggested fields are unconfirmed; extraction cannot approve/reject, verify a document, fulfil an obligation, save confirmed metadata or silently change a deadline.

## C3 scope

1. Add **tesseract.js OCR fallback in an isolated bounded worker**, plus the page-image rendering required to feed it. Inspect current installed dependencies/renderer capabilities first and use pinned compatible versions/primary documentation. The current optional PDF.js canvas dependency may need explicit reproducible provisioning if selected; avoid a machine-specific global-tool dependency.
2. Runtime must be genuinely **offline**: language/core/WASM/worker assets are local, versioned or pinned with documented provenance/license and integrity checks as appropriate. No language/CDN/model/download fallback during extraction or tests. Missing/corrupt local assets must produce an actionable failure, never a silent network request. Development-time dependency provisioning is separate from runtime; record exactly how a fresh checkout gets local assets.
3. Keep text first. Render/OCR only pages requiring fallback. Bound input bytes, total/page counts, DPI/pixels, OCR text/word count, time, worker concurrency/queues and memory/work. Reclaim rendering/OCR/PDF workers and capacity on success/failure/timeout/abort. C2 V8 limits are not an OS/native-memory sandbox; do not claim a complete memory/security isolation guarantee without evidence.
4. Build source lines/candidates from **actual OCR text and word rectangles**, not expected.json, fixture definitions or guessed normalized strings. Reuse C2 date-role/calendar/abstention logic. Extend candidate method/precision types honestly for text versus OCR and preserve raw recognized text. OCR confidence may inform a cautious quality flag; never present it as calibrated probability or permission to skip review.
5. Convert rendered pixel boxes through the actual page viewport/DPI/rotation/crop/unit transforms into top-left PDF viewport points, one-based pages. Distinguish OCR word boxes from C2 text-item boxes. Handle the actual faint/rotated scan conservatively; do not invent a clean excerpt/date or silently repair uncertain date digits. Failed/low-quality OCR or unreadable pages must keep a null document-level suggestion and an explicit reason/coverage state.
6. For mixed documents, combine supported text and OCR evidence per page without duplicating candidates or ignoring conflicting expiry entries on another page. Do not return SUGGESTED while a required page remains unreadable/unprocessed. Blank versus unreadable pages must be represented honestly, with documented policy and tests.
7. Preserve the bytes-only internal API and developer CLI or add a clearly named combined entry point; document the C2 text-only path separately if retained. OCR output remains `confirmed:false`, suggestion-only. No DB migration, persistent job/product integration, HTTP endpoint, UI/highlight, metadata/audit command changes, case mutation or deadline creation in C3.

## Tests and evidence

- Preserve all 226 tests, C1 PDF/hash/label integrity and C2 text behaviour. Keep text-only tests explicitly text-only if the combined entry point can now OCR scans.
- Test actual development-family scans (including page-2 expiry and cross-page conflicts), mixed text/scans, empty/unreadable results, source text/word boxes, viewport conversion, duplicate suppression across paths, asset missing/corrupt/offline behaviour, limits/timeouts/cancellation/failure cleanup/capacity recovery.
- Use synthetic files only. Never read gold labels at runtime, alter corpus labels to match OCR output or send files to an external service. Keep heldout template answers for later evaluation; report limitations honestly.
- No accuracy percentage or benchmark table in C3. **C5 owns measured extraction evaluation**. Passing tests are functional evidence, not a production-accuracy claim.

## Definition of done

- Reproducible local OCR assets and bounded isolated text-first fallback work with source-backed evidence/word boxes and honest abstention/coverage results; no network dependency at runtime.
- `npm run typecheck`, `npm test`, `npm run build`, `git diff --check` pass. Save/diagnose failures; record actual counts, assets/setup/limits and how to inspect the CLI result.
- Update PROGRESS/WORK_LOG (3–5 lines), extraction docs/limitations and applicable setup handoff. Replace NEXT_PROMPT with **C4 only**, wiring suggestions/source highlight into existing M5 human review; keep C5 evaluation separate.
- One local commit without AI-tool attribution, **no push**. Tell the user what was built, tests passed and how to check it. Stop before C4.
