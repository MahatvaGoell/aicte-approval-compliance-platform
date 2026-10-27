# Finale features plan (Codex)

Three features to build before the finale, in the order below. The other five ideas (Evidence Recall Network, Document Contradiction Finder, Queue Fairness Proof, Policy Impact Simulator, Decision Proof Compiler) are roadmap-slide only. Do not build them.

Paste the block below into Codex, opened in the repository root.

```text
You are adding three finale features to the AICTE Approval & Compliance Platform (SIH 2026, PS SIH26262, team Infera). This prompt is the full plan; follow it from start to end. Talk to me in short Hinglish.

Final feature list:
- BUILD NOW (top 3): A. No-Reset Accountability Clock, B. Double-Claim Detector (faculty + lab + building in one engine), C. Verify QR + Witnessed Audit.
- ROADMAP ONLY, do NOT build: Evidence Recall Network, Document Contradiction Finder, Queue Fairness Proof, Policy Impact Simulator, Decision Proof Compiler.
- DROPPED, do NOT build: random EVC assignment, delay predictor, committee findings, continuity guard.

## 0. Before you start
1. Read, in order: AGENTS.md, docs/BUILD_PLAN.md (§9 provenance, §10 deadlines, §19 demo, §20 tests), docs/PROGRESS.md, docs/FOUNDATIONS.md.
2. Branch: `git fetch origin && git checkout -b features-finale origin/ui-redesign`. Work only on `features-finale`.
3. Local only. Commit after each step. Do NOT push, do NOT force push, do NOT touch main. The owner pushes at night.
4. No AI attribution anywhere: no Co-Authored-By, no "Generated with" in commits, docs or code comments.
5. Baseline before any change: `npm run typecheck` and `npm test` must pass (226 tests). Report the count.

## Non-negotiable rules (from AGENTS.md, repeated because these features touch them)
- The system never approves, rejects or penalises. Every feature here only FLAGS, MEASURES or VERIFIES. A human with the right capability decides.
- Every new rule carries provenance. Use `DEMO_ASSUMPTION` for every threshold or rule here. Never write "AICTE rule" unless it is an APH clause already in the source register.
- All data synthetic. No real email, no real external service. The witness server below is a second LOCAL process, not an external service.
- No invented numbers in UI, docs or slides. Show only what is computed from stored records. If a value is not recorded, show "Not recorded".
- State change + `recordAudit(...)` in the same `withTx`. Side effects through `emitEvent(...)`.
- Case changes only through `POST /api/v1/applications/:id/commands` (add to COMMANDS with a guard + run). Mutations need Idempotency-Key and expectedVersion.
- Scope: use `applicationScopeSql` / `institutionScopeSql`. Out of scope = 404. Never disclose another institution's case to an institution user.
- Time: `now()` from server/src/lib/clock.ts only.
- Migrations: new numbered files only. Current last is 007. Use 008, 009, 010 in the order below. Never edit 001.
- Web: TanStack Query + web/src/api.ts; reuse Status, Loading, ErrorState, MutationError, Postmark, NamePlate, Disclosure from web/src/ui.tsx; colours only through CSS tokens in styles.css; status = text + colour. The UI is being redesigned on another branch: put new pages in NEW files, and add CSS only as one block at the END of styles.css under a comment `/* ---------- finale features ---------- */` so merges stay easy. Light theme is the priority.
- Name tests after the IDs below; put them in server/test/.

## Build order
Step A: No-Reset Accountability Clock (cheapest, builds on M3).
Step B: Double-Claim Detector (headline feature).
Step C: Verify QR + Witnessed Audit (most moving parts).
Stop after each step: typecheck + test + build, update docs/PROGRESS.md and docs/WORK_LOG.md (3–5 lines), one local commit, report back.

---

## Step A — No-Reset Accountability Clock (migration 008)
Tagline: "File peeche ja sakti hai, accountability nahi."

What exists: `deadlines` (STAGE_HANDLING re-points to the next attempt, generations), `deadline_pause_segments`, `pauseForReturn` in server/src/modules/deadlines/engine.ts, RETURN_TO_INSTITUTION and the response/new-attempt commands in server/src/modules/applications/commands-m2.ts, `findings` with raised_at / returned_at.

Build:
1. Migration `008_custody.sql`: table `custody_segments` (id, application_id, holder CHECK IN ('OFFICE','INSTITUTION','AUTHORITY'), stage_key, started_at, ended_at NULL, opened_by_transition text, reason). One open segment per application at a time (partial unique index on application_id WHERE ended_at IS NULL).
2. Write segments inside the SAME transaction as the existing commands: submission opens OFFICE; RETURN_TO_INSTITUTION closes OFFICE and opens INSTITUTION; the institution's response that starts the new attempt closes INSTITUTION and opens OFFICE; the decision stage opens AUTHORITY; decision recorded / closed closes the last one. Audit each change.
3. Backfill script for existing cases (`npm run backfill:custody`), derived only from stored transitions/findings timestamps. If a period cannot be derived, leave it out and mark the case "custody history incomplete" instead of guessing.
4. Pure function `accountability(segments, now)` → { totalDays, institutionDays, officeDays, authorityDays, returns: n } in calendar days, Asia/Kolkata, using the existing calendar helpers. The three parts must add up to the total; test it.
5. The stage clock is NOT reset by a return: show both the original due date of the first attempt and the current due date, and "returned N times". Do not change existing deadline behaviour (D04/D05 must still pass); this is accounting on top.
6. New objection in re-scrutiny needs a justification: in RAISE_FINDING, when the stage attempt is > 1 and the finding is not linked to a finding raised in an earlier attempt, require `newObjectionJustification` (min 20 chars) or return 409 `NEW_OBJECTION_NEEDS_JUSTIFICATION`. Add columns in 008: `findings.raised_in_attempt int`, `findings.new_objection_justification text`. Visible to the institution when the finding is.
7. API: include `accountability` in the case view (server/src/modules/applications/view.ts). Add a `returns-and-holding` report to the reports module (same scope rules, CSV via existing exporter).
8. Web: on the case page, a strip under the consignment slip: "Total N days · With institution N · With office N · Returned N times" (mono numbers, text labels). In the finding form, a justification textarea that appears only for a new objection in re-scrutiny.
9. Label the "no new objection without justification" rule `DEMO_ASSUMPTION` (it is our process rule, not a verified APH clause).
Tests: AC01 segments add up to total across 2 returns; AC02 return does not reset original due date, current due follows existing rules; AC03 new objection in attempt 2 without justification → 409, with justification → saved + audited; AC04 institution user sees only own case numbers; AC05 backfill never invents a segment.

---

## Step B — Double-Claim Detector (migration 009)
Tagline: "Ek teacher, ek lab, ek hi claim." One engine for faculty, labs and buildings.

Build:
1. Migration `009_resource_claims.sql`:
   - `resources` (id, kind CHECK IN ('FACULTY','LAB','BUILDING'), identity_key text NOT NULL, display_name, is_synthetic bool, UNIQUE(kind, identity_key)). Faculty key = a synthetic registration id (e.g. `FAC-DEMO-0001`), never a real ID number. Lab/building key = normalised survey/plot number + normalised address.
   - `resource_claims` (id, resource_id, application_id, institution_id, programme_code NULL, usage text, period_from date, period_to date NULL, source CHECK IN ('APPLICATION_FORM','SEED'), created_at).
   - `claim_flags` (id, resource_id, claim_ids uuid[], kind 'OVERLAPPING_CLAIM', state CHECK IN ('OPEN','EXPLAINED','CONFIRMED'), detected_at, rule_ref, provenance, reviewed_by NULL, reviewed_at NULL, review_note NULL).
2. Policy: add an optional `doubleClaim` section to the policy document (exclusive kinds, whether same-institution different-programme counts, overlap rule) with `provenance: 'DEMO_ASSUMPTION'`; extend `validatePolicy`; add it to server/src/seed/policy-v1.ts. Running cases keep their own policy version.
3. Application form: optional lists for faculty (registration id, name, programme), labs and buildings (identifier, address) in the draft details (server/src/modules/applications/forms.ts + web form). Claims are written on submission, in the submission transaction.
4. Pure function `findDoubleClaims(claims, rule)`: EXACT match on (kind, identity_key) only, overlapping periods, different institution (or different programme if the rule says so). No fuzzy name matching: we never accuse on a similar name. Deterministic, unit tested.
5. Detection runs on submission (same tx) and via a worker job for re-checks; new flags go through `emitEvent` → notification to the case officer(s) of every involved case. Flags never block, return or reject a case.
6. Command `REVIEW_DOUBLE_CLAIM` (guard: case officer of the case with CASE_REVIEW-type capability; input: outcome EXPLAINED | CONFIRMED + note min 20 chars). CONFIRMED only records the officer's view; raising a finding stays a separate, existing command.
7. Disclosure (S01): an officer sees the other case's number only if it is in their scope; otherwise "Also claimed by another institution outside your scope". Institution users see only that a flag exists on their own case and the officer's note when the officer makes it visible; never the other institution's name.
8. Seed: 3 synthetic pairs for the demo (one faculty in two colleges, one lab claimed by two programmes, one building on two applications), plus one honest non-match (same name, different registration id → NOT flagged).
9. Web: case page Disclosure "Double claims" (resource, kind, period, other claim per scope rules, state, review form); a `double-claims` report with CSV; dashboard count goes in the existing sorting rack only if it is a real count from this table.
Tests: DC01 same faculty id, overlapping periods, two institutions → one flag; DC02 same name different id → no flag; DC03 non-overlapping periods → no flag; DC04 out-of-scope officer and institution user never see the other institution; DC05 review is audited and needs a note; DC06 flag never changes lifecycle, decision or compliance status.

---

## Step C — Verify QR + Witnessed Audit (migration 010)
Taglines: "Fake approval letter ab nahi chalega." / "Admin bhi history chupke se nahi badal sakta."

C1. Signed approval letter + QR
1. Migration `010_letters_witness.sql`: `approval_letters` (id, decision_id UNIQUE, application_id, letter_no, payload jsonb, signature text, key_id, issued_at, revoked_at NULL, revoke_reason NULL).
2. When RECORD_DECISION records APPROVED or APPROVED_WITH_CONDITIONS, create the letter in the same transaction. Payload (canonical JSON): letter_no, app_no, institution name, category, outcome, decision date, intake from the proposal, number of conditions, policy version. Validity end only if a stored field exists; otherwise omit it. Do not invent a "valid till".
3. Sign with Ed25519 from `node:crypto`. Key generated by `npm run keys:demo` into var/keys/ (git-ignored), key_id stored. Labelled DEMO KEY in UI.
4. QR (`qrcode` npm package, offline) encodes `${APP_BASE_URL}/verify/<base64url(payload)>.<base64url(signature)>`.
5. Public endpoint `GET /api/v1/public/verify/:token` (no session, rate limited, no personal data): returns signature valid / invalid, the signed fields, and SEPARATELY the current record: revoked?, open conditions count from the compliance module. Label them "Signed at issue" and "Current record (checked now)".
6. Web: public page `/verify/:token` outside the login shell; printable letter view on the case page with the QR. Tampered token (seat number changed) → "This letter was not issued by this system".
7. Command `REVOKE_LETTER` (authority capability, reason required). Honest copy: "Verifies letters issued by this demo system only."
Tests: Q01 valid token verifies; Q02 one changed field fails; Q03 revoked letter shows revoked; Q04 public endpoint leaks no personal data or other cases; Q05 rejected/deferred decisions get no letter.

C2. Witnessed audit
1. A second process `npm run dev:witness` (server/src/witness/*, port 4100, localhost only) with its own key and its own append-only store (var/witness/checkpoints.jsonl). It never reads the main database.
2. The worker sends a checkpoint every N audit events or every M minutes (DEMO_ASSUMPTION): { lastId, lastHash, count, at }. The witness signs it and returns a receipt; the main DB keeps the receipt in `audit_checkpoints` (in 010).
3. Extend `POST /audit/verify`: (a) local chain recompute as today; (b) fetch witness checkpoints and check that the stored hash at each checkpoint id still matches. Report both results separately. If the witness is down, say "Witness unavailable", never "intact".
4. Demo script `npm run demo:rewrite-chain` (demo mode only, refuses otherwise): edits one old audit row directly in PostgreSQL as superuser and recomputes every later hash. Expected result: local check PASSES, witness check FAILS at the first checkpoint after the edit. This is the demo moment.
5. Update `INTEGRITY_LIMITS` text honestly: in the demo the witness runs on the same machine; in production it must be run by a separate organisation. Remove "Independent protected checkpoints are not implemented" only after this works.
6. Web: Audit log integrity result shows two lines, "Local chain" and "Witness", each with its own status text.
Tests: WA01 untouched chain passes both; WA02 rewritten chain passes local, fails witness at the right checkpoint; WA03 witness down → "unavailable", not pass; WA04 witness receipts are verified with the witness public key.

---

## Done means
- All old tests + new tests pass; typecheck and build pass.
- docs/PROGRESS.md and docs/WORK_LOG.md updated; docs/DEMO_SCRIPT.md gets one demo beat per feature with the exact role, case and clicks.
- Every number shown in the UI comes from stored records.
- Three local commits (one per step) on `features-finale`. Nothing pushed.
```

## Notes for the owner (not for Codex)
- If time runs out, cut from the bottom: drop C2 (witness) before C1 (QR), and keep A and B.
- The redesign branch (`ui-redesign`) changes `web/src/styles.css` and page files. Codex keeps its CSS in one block at the end and new pages in new files, so the night merge stays small. Expect conflicts only in `Case.tsx` and the application form.
- PPT: write "on synthetic demo letters" next to the QR claim, and "flags for officer review" next to the double-claim claim. No accuracy or time-saved percentages until they are measured.
