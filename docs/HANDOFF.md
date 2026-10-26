# Handoff: continuing on another laptop

> **National round (26 Oct 2026): M1–M6 and C1–C2 are complete locally (226 tests). Read [WORK_LOG.md](WORK_LOG.md) first**, then AGENTS/PROGRESS/NEXT_PROMPT. Next step is C3, isolated offline OCR fallback only. Stop after each step. Pushing remains paused under the user's standing instruction.

Project repository: <https://github.com/MahatvaGoell/aicte-approval-compliance-platform>. **Recent B5–B7/C1–C2 changes are local and not yet pushed**, so a fresh GitHub clone will not contain the complete M6 closure, corpus or text extractor. Preserve the current checkout and commits; do not reset it to remote main. Read [PROGRESS.md](PROGRESS.md) for actual local status and [NEXT_PROMPT.md](NEXT_PROMPT.md) for the next step.

## The goal

Win SIH 2026 with problem statement **SIH26262** — *Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System* (organisation AICTE, theme Smart Automation, software).

The coding agent builds the whole platform, milestone by milestone, from [BUILD_PLAN.md](BUILD_PLAN.md). Product and code rules are in [../AGENTS.md](../AGENTS.md).

## Rules the user set (follow always)

- **No AI or Claude attribution anywhere**: no `Co-Authored-By`, no "Generated with" lines in commits, PRs or docs. Commit under the user's own git identity.
- One step = one tested local commit; update WORK_LOG with 3–5 lines and report back before starting the next step. **Do not push** until the user explicitly lifts the current no-push instruction. This overrides older commit-and-push text.
- Talk to the user in Hinglish, short and direct. They check the UI themselves; tell them what to click.
- Never present a demo rule or timeline as an official AICTE rule (provenance labels: `APH_CLAUSE`, `ADMIN_INSTRUCTION`, `DEMO_ASSUMPTION`).
- All data is synthetic. Never send real emails or call real external services.

## Status (26 Oct 2026)

| Milestone | State |
|---|---|
| M1 — auth, scopes, one complete workflow | Done |
| M2 — findings/returns, re-scrutiny, all routes, manual classification, appeals, policy versioning | Done |
| M3 — deadlines, escalation ladder, notifications, email outbox, worker, demo clock | Done (99 tests passing). Remaining small gaps are listed in PROGRESS.md "Known gaps" |
| M4 — EVC readiness, conflicts, reservations, reports | Done; see PROGRESS.md for acceptance checks and limitations |
| M5 — private documents, obligations, evidence receipts, verification and lease renewal | Done; 139 tests passing; browser journey verified |
| M6 — dashboards, reports/CSV, scoped audit, mock integration/reconciliation | Done locally; **204 tests**, typecheck/build/whitespace and browser/API acceptance pass; see [M6_ACCEPTANCE.md](M6_ACCEPTANCE.md) |
| C — offline PDF expiry extraction | **C1–C2 done**: 24 PDFs + bounded text/date-role suggestions/CLI; 226 tests. [PDF_TEXT_EXTRACTION.md](PDF_TEXT_EXTRACTION.md). Next **C3 only**, then C4 review-highlight / C5 evaluation |
| M7 / demo prep | Not started; follow after PDF feature; no M8 AI/load work is authorised by the national step plan |
| UI | Redesigned (warm light/dark themes, motion). Per-page layout brief for a designer: [UI_PAGES.md](UI_PAGES.md) |
| SIH idea PPT | Done: [sih/SIH26262-Idea-Presentation.pptx](sih/SIH26262-Idea-Presentation.pptx) (and `.pdf`). Internal round cleared |
| National round | Plan in [NATIONAL_ROUND_PLAN.md](NATIONAL_ROUND_PLAN.md); feature verdicts in [sih/court-verdicts/](sih/court-verdicts/) |

Other useful docs: [FOUNDATIONS.md](FOUNDATIONS.md) (tested deadline calendar, email adapters, upload checks, storage), [PITCH.md](PITCH.md), [LIMITATIONS.md](LIMITATIONS.md), [win-plan.html](win-plan.html), [sih/SIH26262_Research_and_Build_Blueprint.md](sih/SIH26262_Research_and_Build_Blueprint.md).

## Set up on the new laptop

Needs Node.js 22.13+ or 24+ (C2 tested on 26.3.0) and git. No Docker needed: PostgreSQL runs embedded.

```bash
git clone https://github.com/MahatvaGoell/aicte-approval-compliance-platform.git
cd aicte-approval-compliance-platform
npm install
cp .env.example .env
npm run db:start          # terminal 1: embedded PostgreSQL on port 54329 (keep it running)
npm run db:reset          # terminal 2: migrations + synthetic seed
npm test                  # all tests must pass
npm run dev:api           # terminal 2: API on http://localhost:4000
npm run dev:worker        # terminal 3: background worker (deadlines, notifications, email outbox)
npm run dev:web           # terminal 4: web on http://localhost:5180
npm run demo:scenarios    # optional, with the API running: nine prepared synthetic demo cases
```

Login: click any role card on the login page (demo mode signs in with one click). The shared demo password is in the README.

Notes:
- The database must be UTF8; `db:start` creates it that way. If you ever see a WIN1252 error, stop the database, delete `var/pgdata`, and start again.
- Port 5173 was taken on the first laptop, so the web app uses 5180.
- `var/` (database files, email outbox, uploads) is local and not in git.

## SIH presentation reference (already delivered)

The internal-round idea deck is already delivered. The following is the original template brief for future deck edits; it is **not the next build step**. Official template: [sih/SIH2026-IDEA-Presentation-Format.pptx](sih/SIH2026-IDEA-Presentation-Format.pptx).

Template rules (from its last slide): **at most 6 slides including the title slide**; points, diagrams and infographics, no paragraphs. Delete the instructions slide (slide 7) in the final file.

| Slide | Template heading | What to put there |
|---|---|---|
| 1 | Title page | PS ID SIH26262; title "Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System"; theme Smart Automation; PS category Software; Team ID and Team Name as placeholders `[ ]` for the user to fill |
| 2 | Idea title / proposed solution | Tagline "Rules that run themselves. Decisions that stay human." The five verbs Route → Clock → Escalate → Watch → Prove as a flow; how it addresses the problem; innovation: traceable obligation and evidence register, policy impact preview, the system never decides |
| 3 | Technical approach | Stack (React + TypeScript, Fastify, PostgreSQL, background worker, no paid services, runs offline); **flowchart** of a case: submit → snapshot frozen → policy classifies (no match → officer classifies) → scrutiny (finding → return → response → new attempt) → EVC → SAC/SHC → competent authority decides → conditions become obligations; rejected → appeal. Small architecture diagram |
| 4 | Feasibility and viability | Already working (M1–M3, automated tests passing: run `npm test` for the current count); risks (rule accuracy vs APH, integration with AICTE portal, adoption) with mitigations (versioned rules with provenance labels, mock integration adapter, role-based screens) |
| 5 | Impact and benefits | Mapped to the PS outcomes: less manual follow-up, fewer missed deadlines and expired documents, visible pendency by region and stage, accountability through a tamper-evident audit. No invented percentages |
| 6 | Research and references | AICTE Approval Process Handbook 2024-27 and amendments; PS SIH26262; what was studied; note that all demo data is synthetic |

Keep the template's look (title bar, footer, logos). Replace "Your Team Name" in the oval on every slide. Diagrams should be native PowerPoint shapes (editable). Render every slide and check it before handing it over.

## The prompt to paste on the new laptop

Copy everything inside the block into Claude Code, opened in the cloned repository folder:

```text
Main is project continue kar raha hoon from another laptop. Repo: AICTE Approval & Compliance Platform (SIH 2026, PS SIH26262).

Pehle ye files padh: docs/WORK_LOG.md (sabse pehle), AGENTS.md, docs/PROGRESS.md, docs/NEXT_PROMPT.md, docs/PDF_TEXT_EXTRACTION.md, docs/EXTRACTION_DATASET.md. M1-M6 aur C1-C2 local checkout me complete hain (226 tests); fresh GitHub clone abhi behind ho sakta hai.

Rules: commits/docs me koi AI ya Claude attribution mat daalna (no Co-Authored-By). Mujhse Hinglish me short baat kar.

Kaam: NEXT_PROMPT.md ka C3 step only — isolated bounded offline OCR fallback, local language/core assets, actual OCR text/word positions, existing date-role rules reuse. expected.json sirf tests ke liye. API/UI/metadata/deadline writes/M7 abhi mat banao. Existing services reuse karo; .env overwrite ya prepared development DB reset mat karo jab tak zarurat na ho. Baseline npm test 226 pass hona chahiye.

End: typecheck + test + build + diff check, PROGRESS/WORK_LOG update, NEXT_PROMPT ko C4 ke liye replace, ek local commit. Push nahi. C3 ke baad ruk ke bata.

Har step ke baad mujhe batana kya hua aur kya click karke check karu.
```
