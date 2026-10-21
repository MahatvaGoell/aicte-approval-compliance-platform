# Prompt for the next agent session — Milestone 2

Copy everything below the line into the coding agent.

---

You are continuing the **AICTE Approval & Compliance Platform** (SIH 2026, problem statement SIH26262) in this repository. Milestone 1 is complete. Your job is **Milestone 2** only.

## Read first

1. `AGENTS.md` — product rules and code conventions. Follow them exactly.
2. `docs/BUILD_PLAN.md` — the specification (especially §8 state models, §9 workflow engine and policy versioning, §15 API, §20 tests, §21 milestones).
3. `docs/PROGRESS.md` — what exists and known gaps.
4. Skim `server/src/modules/applications/commands.ts`, `server/src/modules/workflow/workflow.ts`, `server/src/modules/policy/*`, `server/test/helpers.ts` and `web/src/pages/Case.tsx` before writing code. Match their style.

## Setup

```bash
npm install
cp .env.example .env              # if .env does not exist
npm run db:start                  # separate terminal (or: docker compose up -d db)
npm run db:reset
npm test                          # must show 30 passing before you start
```

## Milestone 2 scope

Build each item as a working vertical slice (migration → service/command → API → web → tests).

1. **Findings and deficiency returns** (new migration `002_findings.sql`)
   - Tables `findings` (application, stage instance, checklist code, reason code, explanation, requested evidence, responsible party, visibility INTERNAL/INSTITUTION, state `RESPONSE_PENDING → RESPONSE_SUBMITTED → RESOLVED | NOT_RESOLVED`, raised by/at) and `finding_responses` (text, submitted by/at; document links come in M5).
   - Commands: `RAISE_FINDING` (assigned stage owner with `FINDING_RAISE`), `RETURN_TO_INSTITUTION` (requires at least one open institution-visible finding, a reason and a response-due basis note; stage → `AWAITING_RESPONSE`, application lifecycle reflects it), `RESOLVE_FINDING` / `REJECT_FINDING_RESPONSE` (officer, with reason).
   - Institution: `RESPOND_TO_FINDING` (capability `FINDING_RESPOND`, own institution only). When every returned finding has a response, close the current attempt (`outcome = RETURNED`, preserved) and open a **new attempt** of the same stage (`attempt_no + 1`, re-scrutiny) carrying over checklist results for reference, assigned to the same owner if still eligible.
   - Only stages with `allowReturn: true` in the policy may return.
   - Replace the `to_regclass` fallback for `NO_OPEN_FINDING` in `evaluateCompletion` with a direct query.

2. **Manual classification** for `AWAITING_CLASSIFICATION` cases: command `CLASSIFY` (capability `CLASSIFY`, region scope) choosing a route from the case's pinned policy version, with a mandatory reason. Records the decision trace and starts the first stage.

3. **Committee stages** (SAC/SHC in routes EVC_SAC / EVC_SHC) work through the existing commands, kept distinct by committee kind. EVC stage itself stays blocked on `EVC_REPORT_ACCEPTED` until M4 — that is expected.

4. **Appeals (W07)**: command `FILE_APPEAL` by the institution on a `REJECTED` decision, with grounds. Creates a new workflow instance `kind = APPEAL`, `appeal_of_decision_id` set, using a configured appeal route (add `appeal` config to the policy schema, e.g. route `EVC_SAC`, provenance DEMO_ASSUMPTION). The original decision is never modified. Show the link both ways in the case view.

5. **Linked amendments (W05)**: `amendments` table and `REQUEST_AMENDMENT` (institution, only while a finding requests it) storing changed fields as a linked record; the frozen snapshot never changes. Case view shows snapshot + amendments.

6. **Policy versioning and change control**
   - API per BUILD_PLAN §15: create draft (copy of a version), update draft (Zod + `validatePolicy`), validate (errors/warnings), diff two versions (routes, stages, checklists, classification, calendar — structured, human-readable), publish (only `POLICY_PUBLISH`, requires zero errors, effective date, change note; audit event), list versions, view `policy_sources`.
   - `POLICY_ADMIN` drafts but cannot publish; `POLICY_APPROVER` publishes but cannot draft; neither can see cases.
   - Existing cases keep their pinned version. Add a test that publishes v2 with a different route for a category and shows old cases unchanged and new submissions on v2.
   - Web: policy list, version detail with provenance chips, a table-based structured editor for categories/classification/stages/checklists (JSON editor fallback is acceptable for less common fields), validation results, diff view, publish screen. No visual drag-and-drop builder.

7. **Web for the above**: findings panel on the case page (raise, return, respond, resolve, with status chips and history of attempts), institution "Respond to findings" flow, classification form, appeal button and appeal link, amendment display, policy admin pages. Keep loading/empty/error/unauthorised/retry states.

## Tests required (Vitest, `server/test/m2-*.test.ts`)

- **W01** five route fixtures select and progress through the intended stages (EVC stages may stop at the EVC stage for now; assert they stop there with the right blocker).
- **W02** manual classification after no match.
- **W04** return → response → new attempt; original attempt, findings and checklist preserved.
- **W05** amendment is a linked record; snapshot hash unchanged.
- **W07** appeal creates a linked instance; original decision unchanged.
- Return blocked on a stage with `allowReturn: false`; institution cannot respond to another institution's finding (404); internal findings hidden from institutions.
- Policy: draft validation errors block publish; admin cannot publish; approver cannot draft; pinned version for existing cases; diff output for a known change.
- All existing tests still pass.

## Definition of done

- `npm run typecheck` and `npm test` pass.
- Update `docs/PROGRESS.md` (mark M2 done, list what was built, tests added, known gaps) and replace `docs/NEXT_PROMPT.md` with a prompt for **Milestone 3** in the same style, based on BUILD_PLAN §10 and §21.
- Do not invent official AICTE rules or timelines; label everything demo.
- Commit with a clear message. Do not add AI-tool attribution lines to commits.
