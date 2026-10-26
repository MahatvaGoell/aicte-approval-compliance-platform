# Synthetic expiry-date corpus — C1

**Dataset only; no extraction accuracy has been measured.** All institutions, names, addresses, issuers and records are fictional. Every page says synthetic/not official. These documents confer no approval or entitlement. The corpus is not connected to case uploads or any live service.

## Files and coverage

`server/fixtures/extraction/pdfs/` contains **24 valid PDFs / 32 pages**: **16 text PDFs (20 pages)** and **8 image-only scans (12 pages)**. Combined PDF size: **978,538 bytes** in the verified toolchain. `server/fixtures/extraction/expected.json` is the machine-readable ground truth, with SHA-256/size for every file. Labels are authored in `server/scripts/extraction/definitions.py`, separately from any future parser, and are not inferred by extraction.

Eight template families are split by family: five development families (**15 documents**) and three heldout families (**9 documents**). Families have distinct title/font/body layout configurations, but share four renderer styles, a synthetic notice/footer and some fictional prose. This is a small authored test corpus, not a representative or blind production benchmark. Keep future tuning on the development families and report heldout results separately; visible labels do not constitute blinded evaluation.

| IDs | Kind | Family / split | Labelled cases |
|---|---|---|---|
| 01–03 | Text, text, scan | lease-basic / development | issue + execution + expiry; slash DMY, month-name hyphen and numeric hyphen |
| 04–06 | Text, text, scan | fire-card / development | month-first, dotted DMY, valid leap day |
| 07–09 | Text, text, scan | certificate-letter / development | day/month name, invalid February date, registration distractor |
| 10–12 | Text, text, scan | lease-annex / development | expiry on page 2/3; old review date distractor |
| 13–15 | Text, text, scan | review-memo / development | conflicting expiries, ambiguous numeric date, cross-page conflict |
| 16–18 | Text, text, scan | fire-grid / heldout | fixed past expiry, missing expiry in text and scan |
| 19–21 | Text, text, scan | renewal-annex / heldout | inert instruction-like text + page-2 expiry, invalid leap day, faint/rotated scan |
| 22–24 | Text, text, scan | certificate-note / heldout | issue/execution/registration only, expiry before issue, page-3 scan expiry |

Gold outcomes: **15 UNAMBIGUOUS, 4 AMBIGUOUS, 5 NOT_FOUND**. These are label counts, not extractor results. The fixed past-expiry fixture is dated 2025; nothing in generation depends on today's clock.

## Reproduce locally

Dataset authoring/QA uses **Python 3.13**, **Poppler `pdftoppm` 26.07.0**, and the versions pinned in `server/scripts/extraction/requirements.txt`: reportlab 4.4.9, Pillow 12.3.0, pypdf 6.10.0, pdfplumber 0.11.9. Python/Poppler are developer tools only; no Python dependency is added to the API, web or ordinary `npm test`. Existing bundled equivalents may be used. No dependency was downloaded for C1.

Install the requirements into your own environment if needed, and put Poppler's `pdftoppm` on PATH. The npm wrapper uses `$PYTHON` when set; otherwise `python` on Windows and `python3` elsewhere. For an isolated environment on Windows:

```powershell
python -m venv var/pdf-venv
& ./var/pdf-venv/Scripts/python.exe -m pip install -r server/scripts/extraction/requirements.txt
$env:PYTHON = (Resolve-Path ./var/pdf-venv/Scripts/python.exe).Path
```

On POSIX use `python3 -m venv var/pdf-venv`, its `bin/python -m pip`, and `export PYTHON="$PWD/var/pdf-venv/bin/python"`. Dependency setup may need a pre-provisioned package cache; generation/checking never uses the network.

From the repository root:

```bash
npm run fixtures:extraction          # overwrite only the 24 owned PDFs + expected.json
npm run fixtures:extraction:check    # strict PDF parse, hashes/sizes, pages, text/scan and text rectangles
npm run fixtures:extraction:verify   # regenerate in ignored temp space and compare all bytes/manifest
npm run fixtures:extraction:qa       # render all 32 pages + labelled-ink checks + contact sheets
npm -w server run test -- test/c1-extraction-dataset.test.ts
```

Generate/verify/QA need Poppler. `check` needs the pinned Python packages, but does not render. The generator uses fixed dates/IDs and ReportLab's invariant PDF metadata; `.gitattributes` keeps the manifest LF and PDFs binary across Git checkouts. Byte-for-byte regeneration was verified after the final layout changes on the above toolchain. Different Poppler/font substitutions, OS or compression/library versions can change scan bytes; do not silently refresh gold hashes to hide a reproduction mismatch. The manifest records authoring package versions. Text/date labels are stable even when another rendering stack changes bytes.

Output is fixed to the repository's extraction dataset. The tool verifies resolved output directories, refuses symlink targets/ancestors, never recursively deletes/moves files and only overwrites its known fixture names and manifest. Unexpected corpus files cause the exact-file-set check to fail. Temporary pristine PDFs/images use a unique ignored `var/extraction-generate-*` directory and are cleaned by Python's temporary-directory context. Do not point QA/generation at unrelated directories.

## Label contract and coordinates

`schemaVersion: 1`, `synthetic: true`, provenance `DEMO_ASSUMPTION`. Each fixture records ID/file/kind/template family/split/tags, page count/size, expected state/expiry, candidates, scan settings, byte size and SHA-256. `server/scripts/extraction/manifest.ts` validates identity/path, real ISO dates, label consistency, candidate excerpts, rectangles, page bounds and split separation.

- `UNAMBIGUOUS`: exactly one document-level expiry can be used; expected expiry is an ISO date backed by a valid labelled EXPIRY candidate.
- `AMBIGUOUS`: expected expiry is null. Includes conflicting expiry entries, unresolved `04/05/2027` with both valid interpretations, and a legible expiry preceding issue. Do not guess or silently apply a locale convention.
- `NOT_FOUND`: expected expiry is null. Issue/execution/registration dates do not substitute for expiry. An invalid expiry like 31 February does not roll over into March.
- Candidate roles: ISSUE, EXECUTION, REGISTRATION, EXPIRY, REFERENCE. A VALID candidate has an ISO `value`; INVALID and AMBIGUOUS candidates have null value. Ambiguous candidates retain distinct alternatives. The excerpt is the exact authored source line, including its date literal.
- Coordinates: **PDF points (1/72 inch), top-left origin**, `[x0,y0,x1,y1]`, page numbers **one-based**. Every page is **600 × 840 points**. `bbox` covers the date glyphs; `excerptBbox` covers the whole source line. These are ground-truth rectangles, not extractor predictions or OCR boxes.
- Scans are rendered at **144 dpi (1200 × 1680)**, embedded as a raster image on each PDF page, with no selectable/invisible OCR text. Fixture 21 is rotated **+1.3° counter-clockwise** with contrast **0.58**. Its rectangles are transformed about page centre and stored as enclosing axis-aligned boxes. Other scans use zero rotation/full contrast.
- To overlay on a top-left viewer, multiply point coordinates by the rendered viewport scale. A bottom-left coordinate system requires `yTop = pageHeight - yPdf`; preserve page rotation/viewport transforms in a future viewer. Source snippets and coordinates must come from actual text/OCR in C2/C3, never from reading expected.json at runtime.

## C1 verification record

- Baseline **204/204** tests passed. Five focused dataset tests cover coverage/gold semantics, exact files/hashes, path/page/rectangle rejection, invalid/invented/ambiguous values and duplicate/template-split/scan-setting rejection. Full suite: **209 tests**.
- Strict pypdf opens every file, verifies page count/size and absence of encryption/forms/attachments/page actions. All text pages contain the synthetic notice; all scan pages have exactly one raster image and empty extracted text.
- pdfplumber checks source excerpts and labelled text rectangle positions against the generated text layer. Render QA checks every labelled date rectangle contains ink, including rotated scan boxes. These are fixture checks, not OCR/expiry extraction measurements.
- All **32 pages** rendered at 144 dpi; six contact sheets inspected across all eight families. Full-page inspection included the instruction fixture/page-2 expiry, faint rotated scan, and page-3 image-only expiry. A border crossing the first source line was corrected before final regeneration/QA. No clipping or overlap remained in the inspected final output.
- `typecheck`, `npm test`, production build and whitespace checks pass. Logs: `var/c1-baseline-tests.log`, `var/c1-full-tests.log`; images: `var/extraction-qa/expiry-XX-N.png`, `contact-01.png` through `contact-06.png` (ignored).

Next is **C2, text-layer extraction and date-role rules only**. OCR fallback, web suggestion/highlight and accuracy evaluation remain C3/C4/C5. No API/UI, live deadline, case mutation, database schema or portal integration was changed by C1.
