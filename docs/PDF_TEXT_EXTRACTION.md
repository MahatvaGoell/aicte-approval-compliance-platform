# PDF text-layer expiry suggestions — C2

C2 is an offline internal module and developer CLI. It does **not** update document metadata, cases, obligations or deadlines. No API endpoint/UI integration/OCR was added. Every result is `confirmed:false`, with `DEMO_ASSUMPTION` provenance for the extraction heuristics. A later authorised human confirmation remains mandatory.

## Inspect a synthetic PDF

```bash
npm run extract:pdf -- server/fixtures/extraction/pdfs/expiry-01.pdf
```

This reads the explicit local file and prints JSON. It does not fetch a URL or upload anything. The example yields `SUGGESTED`, `validThrough:"2027-03-31"`, and separate issue/execution/expiry candidates with their source lines, page and rectangles. Some ancillary numeric dates remain ambiguous even when the authored C1 label assumes DMY; the extractor does not import a date convention from gold labels. The CLI exits nonzero for invalid/limited/cancelled documents; ambiguity/not-found/OCR-required are honest analysis outcomes.

Requires Node **22.13+ or 24+** (tested on 26.3.0) and the pinned **pdfjs-dist 6.4.299** dependency. Python/Poppler are not required to run C2 or ordinary tests. C1 corpus regeneration remains optional and documented in EXTRACTION_DATASET.md.

## Internal contract

`extractPdfExpiry(bytes:Uint8Array, {limits?, signal?})` is exported from `server/src/modules/documents/extraction/text.ts`. The caller retains ownership of its bytes; only an exact copied view is transferred to the worker. A future product caller must independently enforce current document/case access and use the existing reviewed-metadata command to confirm anything. This primitive performs no storage lookup, database write, audit/event write or case command.

The result contains:

- `extractor:pdfjs-text-v1`, `method:text`, provenance and `confirmed:false`.
- `outcome`, nullable suggested `validThrough`, structured `reasons`, `candidates`, pages/source lines and `ocrRequiredPages`.
- Candidate `{field,value,raw,role,validity,alternatives,page,excerpt,bbox,excerptBbox,method,ambiguous,bboxPrecision,roleEvidence}`. Only EXPIRY maps to `validThrough`; ISSUE maps to `issuedOn`; execution/registration/reference/unknown roles retain a null metadata field.
- VALID candidates carry a calendar-validated ISO date; INVALID candidates have null value; AMBIGUOUS numeric candidates retain distinct alternatives. Source excerpts retain the raw date, not a formatted replacement.
- Role evidence is the immediately preceding source label, on the same line or a close aligned label-only preceding line. Arbitrary keyword matches elsewhere, cross-page lookups and distant column labels do not qualify.

| Outcome | Meaning |
|---|---|
| SUGGESTED | One unambiguous labelled expiry, with no detected contradiction or incomplete text coverage; still needs human confirmation |
| AMBIGUOUS | Numeric order, conflicting/invalid entries or issue/expiry chronology needs review; suggested date is null |
| NOT_FOUND | No valid labelled expiry; other date roles are never substituted |
| OCR_REQUIRED | At least one page lacks usable supported text; any partial text candidates remain evidence, but no document-level date is suggested |
| INVALID_DOCUMENT | Empty/non-PDF, encrypted, malformed, unsupported required resources or failed worker/protocol |
| LIMIT_EXCEEDED | Byte/page/item/text/candidate/time or worker-resource budget exceeded; no partial success is returned |
| CANCELLED | Abort signal stopped work; capacity is reclaimed |

Invalid limit overrides throw `ValidationError` (422). More than two concurrent workers throws `AppError` 503 `EXTRACTION_BUSY`; there is no unbounded queue. No raw parser exception or source content is copied into error messages.

## Parsing and evidence

PDF.js reads local bytes and streams text items page by page. Lines are reconstructed from item positions in the **unrotated layout viewport**; evidence boxes use the actual displayed viewport, including page rotation, CropBox and UserUnit. Split items may join with geometry-derived whitespace. Excerpts are source text reconstructed from PDF.js items, not byte-for-byte PDF operator strings; no gold fixture data supplies text, dates or positions.

Coordinates use **one-based pages, top-left PDF viewport points**, `[x0,y0,x1,y1]`, with each page's actual width/height/rotation. `bboxPrecision:TEXT_ITEM` is deliberate: a candidate rectangle encloses the actual contributing **whole text items**, which may include its source label or whole line. It is not a glyph-tight date box. `excerptBbox` encloses the full source line; role evidence has its own rectangle. Future highlights must respect the precision and viewport transform rather than pretending these are OCR word/glyph boxes.

Supported rules cover numeric slash/dot/hyphen dates, ISO year-first dates, day/month-name/year, month-name/day/year and English ordinal days. Month names can be full or abbreviated. Real calendar/leap/century validation avoids JavaScript date rollover. Numeric dates are interpreted both ways when possible; unresolved day/month order abstains, even in a locally India-themed demo. Equal day/month values have one interpretation. Past dates remain dates: no expiry-status clock is derived here.

Labels distinguish valid-till/up-to/until/through, expires-on, expiry/expiration date from issued-on/dated, executed-on, registered-on and review/reference dates. Conflicting expiry dates, an invalid entry alongside a valid one, uncertain issue dates and expiry before issue cause abstention. Instruction-like text/PDF JavaScript is data; it is never called or granted authority. No PDF actions, attachments or links are executed.

## Bounded/offline processing

Each document uses a fixed Node worker entry point. PDF.js consumes a Uint8Array, disables streaming/range/auto-fetch, XFA, system-font/font-face loading and WASM/image rendering for this text path. `fetch` is disabled in that worker. The resource factory permits only named standard font files under the installed PDF.js package; remote CMaps/fonts/WASM and document-supplied paths are not loaded. Required unsupported resources produce an honest failure.

Default hard ceilings (callers may lower, never raise): **10 MiB**, **200 pages**, **20,000 items/page / 100,000 items/document**, **60,000 characters/page / 500,000/document**, **200 date candidates**, **10 seconds**. Page cleanup, stream cancellation, PDF loading-task destruction and parent worker termination cover success/failure/timeout/cancellation. Parent capacity is released before its promise resolves. Worker V8 budgets are 128 MiB old generation, 16 MiB young generation and a 4 MiB stack. These are heap/work limits, not a complete OS/native-memory sandbox; no national-scale throughput or total-process memory claim has been measured.

## Verification and limits

Baseline **209/209** tests passed before implementation. `c2-text-extraction.test.ts` adds **17 tests**; full suite **226/226**, typecheck, production build and whitespace checks pass. Saved full outputs: `var/c2-baseline-tests.log`, `var/c2-text-tests.log`, `var/c2-full-tests.log` (ignored). C1 hashes/labels remain unchanged.

Tests use real **development-family** PDFs for supported formats, page-2/3 evidence and invalid/conflicting/ambiguous dates; independent complete synthetic PDF buffers cover split items, neighbouring labels/columns, missing roles, chronology, source instructions/PDF JavaScript, viewport rotation/crop/unit transforms, unsupported rotated text, malformed input and resource limits. All eight actual image-only corpus PDFs return OCR-required with no fabricated text/date. One additional synthetic encrypted negative-test PDF under `server/test/fixtures/` is separate from the 24-file corpus. Timeout/cancellation/capacity tests confirm a subsequent valid parse can run. Heldout date answers are not used to tune the parser; **C5 owns accuracy evaluation**. Test pass counts are not extraction-accuracy measurements.

Current limits: English date/label rules, horizontal left-to-right source layout, conservative line/column reconstruction, coarse text-item boxes, no authentication of source claims or hidden-text authenticity. Blank pages and unsupported layouts conservatively require OCR/manual review; mixed text/image documents cannot be declared complete from partial text. OCR, source viewer/highlight, persisted suggestion jobs and human review wiring remain C3/C4. No measured production accuracy/performance is claimed. Existing dependency advisories outside PDF.js remain in the repository; no unrelated forced dependency upgrades were performed.

Primary API references checked during implementation: [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html) and [Mozilla Node example](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs). Exact installed types/source were used for version-specific options.
