# Finale features — local implementation contract

This change belongs to `features-finale`, based on `origin/ui-redesign`. It is local only: three commits, no push, no main changes. All records are synthetic. The system measures, flags and verifies; only authorised humans record decisions. Every added process rule/threshold is `DEMO_ASSUMPTION`.

## Run and reproduce

Use the normal Node/npm setup, PostgreSQL 54329 and UTF8 database. Run `npm run keys:demo`, then migrations or `npm run db:reset` on a disposable demo database. Start API (4000), web (5180), witness (`npm run dev:witness`, loopback 4100) and worker (`npm run dev:worker`) in separate terminals. `npm run demo:scenarios` prepares the original nine cases; `npm run demo:finale` submits three overlap pairs and an honest non-match. The latter writes actual case identifiers to ignored `var/finale-cases.json`. DEMO_MODE must be true for demo key generation, synthetic finale fixtures and chain rewriting.

Approval keys live in ignored `var/keys`; witness keys and `checkpoints.jsonl` live independently in ignored `var/witness`. The witness never imports database access. Main-process defaults are `WITNESS_URL=http://127.0.0.1:4100` and `WITNESS_PUBLIC_KEY_PATH=./var/witness/keys/public.pem`. Only loopback HTTP and non-redirecting witness requests are allowed. Preserve keys with their records; restarting reuses them. A fresh database rehearsal also requires an explicitly fresh/archived witness ledger. Do not commit private keys or generated stores.

## A — no-reset custody accounting

Migration 008 adds `custody_segments`, a partial unique index for one open segment per case, an incomplete-history marker and finding attempt/justification/link fields. Submission opens office custody; returns transfer to institution; the response that opens a new attempt transfers back; decision entry uses authority custody; recording/closing ends custody. Each change and its audit share the existing command transaction. Existing deadline pause/carry/extension logic is unchanged.

`accountability(segments, now)` sums local calendar-date differences in Asia/Kolkata. Same-day transfers contribute zero. Institution + office + authority days always equal the recorded total. It is attribution over recorded intervals, not a delay prediction or legal service level. Missing historical intervals are excluded and disclosed, not guessed. `npm run backfill:custody` derives only stored transition instants and refuses attribution when returned findings lack corresponding history. Existing uncertain cases remain marked incomplete.

A re-scrutiny finding must link to an earlier finding of the same workflow/stage/earlier attempt or provide at least 20 characters of new-objection justification. Failure is 409 `NEW_OBJECTION_NEEDS_JUSTIFICATION`. This is our demo process rule, not an APH clause. Institution-visible findings expose that justification. The case strip shows first/current stored stage due dates and recorded returns. Report `returns-and-holding` and CSV use the existing case scope/exporter; missing values say Not recorded.

## B — double claims

Migration 009 adds synthetic resources, declared claim periods and flags. Faculty identity is a FAC-DEMO registration ID; lab/building identity is normalised survey/plot identifier plus address. Names are never identity inputs. The pure engine checks exact kind/key equality, inclusive period overlap, and different institutions or different programmes when the pinned optional policy says so. Old versions without `doubleClaim` remain unconfigured; they are not silently migrated.

Optional faculty/lab/building entries are validated in draft data and written at submission. Claims, new flags, audit and notification outbox events commit together. Worker rechecks also use each case's pinned version and deduplicate the same claim pair. CASE_REVIEW is granted to regional/bureau case officers. `REVIEW_DOUBLE_CLAIM` needs the normal Idempotency-Key/expectedVersion plus a flag version, outcome EXPLAINED or CONFIRMED, and a 20-character note. Confirmation records an officer's view only. Findings remain a separate command.

Institution responses contain only their own resource declaration, flag state and explicitly shared note for their case. Officer views link other case numbers only within current scope; other reviews' notes remain scoped. Otherwise the message is “Also claimed by another institution outside your scope”. Raw claim ID arrays are never returned. The report/CSV follow the same disclosure. The dashboard tile counts actual scoped cases with recorded flags, including reviewed flags; it is not a fraud or approval score.

## C — issue signature versus current record

Migration 010 adds `approval_letters` and `audit_checkpoints`. APPROVED/APPROVED_WITH_CONDITIONS issue a canonical Ed25519-signed demo payload in the decision transaction; rejected/deferred outcomes do not. Signed fields are immutable. Intake is summed from programmes in the frozen proposal/form; condition count and policy version are stored values. No validity end is added without a source field. `REVOKE_LETTER` is an authority-only case command requiring a reason; it changes only the letter's current revocation record, case concurrency version, audit and outbox.

Offline QR generation uses pinned qrcode 1.5.4. Public GET `/api/v1/public/verify/:token` requires no session and is limited to 60 requests per IP/minute per API process (demo abuse bound). It verifies canonical payload/signature with the named public key before returning signed fields. Invalid tokens return no decoded fields/current record. The explicit public allowlist contains institution/case issue fields and current revocation/open-condition count, never users, email, authority identity, private keys, review notes or revocation reasons. Untracked recorded conditions remain open. The case letter and authenticated standalone print page share one renderer; the public verifier sits outside the login shell.

The local witness owns a distinct Ed25519 key and appends signed checkpoints to JSONL with file sync. The worker creates a durable outbox request after 25 further events or 5 minutes (DEMO_ASSUMPTION; the first nonempty checkpoint is immediate), sends after commit, verifies the receipt and stores it with its audit. Concurrent/retried sends deduplicate at the witness and database. Generic notification processing does not consume these dedicated requests. The witness accepts monotone prefixes and refuses an alternate hash for an already witnessed ID.

`POST /api/v1/audit/verify` retains legacy top-level local-chain fields and adds separate `local` and `witness` objects. It checks live signed receipts and cached receipt consistency against stored prefix hashes/counts. Scope-limited responses omit global counts/broken IDs. Witness states are PASS, FAIL, NOT_WITNESSED or UNAVAILABLE; unavailable is never a pass. A database superuser can rewrite a local chain; the demo script proves why an earlier witnessed prefix still detects it. Same-host filesystem/key compromise and the unwitnessed tail remain limitations. Production needs an independently operated witness and protected trust/key management; no such external service is claimed or called.

## Verification recorded

Baseline 226/226; A 231/231; B 239/239; final 249/249 (22 files). New tests are named AC01–AC05, DC01–DC06, Q01–Q05 and WA01–WA04. Typecheck/build and whitespace checks pass. Browser flows, desktop/mobile and public dark rendering have no recorded console errors/body overflow. A separate QR decoder read the exact generated verification URL. The standalone print rendered one A4 page and was visually inspected. The real rewrite script produced local pass/witness fail at the first affected checkpoint; restoring the original synthetic snapshot returned both to pass without altering witness storage.

No roadmap-only or dropped features were built. Existing PDF C3/OCR work remains separate. Demo steps with exact roles/cases/clicks are in DEMO_SCRIPT.md.
