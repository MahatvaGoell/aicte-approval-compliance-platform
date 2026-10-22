# Handoff: continuing on another laptop

Everything for this project is in this GitHub repository: <https://github.com/MahatvaGoell/aicte-approval-compliance-platform>. Read this file first, then [PROGRESS.md](PROGRESS.md) (what exists) and [NEXT_PROMPT.md](NEXT_PROMPT.md) (the next milestone's prompt).

## The goal

Win SIH 2026 with problem statement **SIH26262** — *Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System* (organisation AICTE, theme Smart Automation, software).

The coding agent builds the whole platform, milestone by milestone, from [BUILD_PLAN.md](BUILD_PLAN.md). Product and code rules are in [../AGENTS.md](../AGENTS.md).

## Rules the user set (follow always)

- **No AI or Claude attribution anywhere**: no `Co-Authored-By`, no "Generated with" lines in commits, PRs or docs. Commit under the user's own git identity.
- Commit and push to `main` when a milestone or a clear chunk is done and tests pass.
- Talk to the user in Hinglish, short and direct. They check the UI themselves; tell them what to click.
- Never present a demo rule or timeline as an official AICTE rule (provenance labels: `APH_CLAUSE`, `ADMIN_INSTRUCTION`, `DEMO_ASSUMPTION`).
- All data is synthetic. Never send real emails or call real external services.

## Status (22 Oct 2026)

| Milestone | State |
|---|---|
| M1 — auth, scopes, one complete workflow | Done |
| M2 — findings/returns, re-scrutiny, all routes, manual classification, appeals, policy versioning | Done |
| M3 — deadlines, escalation ladder, notifications, email outbox, worker, demo clock | Done (99 tests passing). Remaining small gaps are listed in PROGRESS.md "Known gaps" |
| M4–M8 | Not started (see BUILD_PLAN §21) |
| UI | Redesigned (warm light/dark themes, motion). Per-page layout brief for a designer: [UI_PAGES.md](UI_PAGES.md) |
| SIH idea PPT | Not made yet — see "Pending: the SIH presentation" below |

Other useful docs: [FOUNDATIONS.md](FOUNDATIONS.md) (tested deadline calendar, email adapters, upload checks, storage), [PITCH.md](PITCH.md), [LIMITATIONS.md](LIMITATIONS.md), [win-plan.html](win-plan.html), [sih/SIH26262_Research_and_Build_Blueprint.md](sih/SIH26262_Research_and_Build_Blueprint.md).

## Set up on the new laptop

Needs Node.js 22+ (24 used) and git. No Docker needed: PostgreSQL runs embedded.

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
npm run demo:scenarios    # optional, with the API running: six prepared demo cases
```

Login: click any role card on the login page (demo mode signs in with one click). The shared demo password is in the README.

Notes:
- The database must be UTF8; `db:start` creates it that way. If you ever see a WIN1252 error, stop the database, delete `var/pgdata`, and start again.
- Port 5173 was taken on the first laptop, so the web app uses 5180.
- `var/` (database files, email outbox, uploads) is local and not in git.

## Pending: the SIH presentation

The user wants the best possible idea PPT, **in the official SIH 2026 template**: [sih/SIH2026-IDEA-Presentation-Format.pptx](sih/SIH2026-IDEA-Presentation-Format.pptx).

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

Pehle ye files padh: docs/HANDOFF.md (sabse pehle), AGENTS.md, docs/PROGRESS.md, docs/NEXT_PROMPT.md, docs/BUILD_PLAN.md (zarurat ke hisaab se).

Rules: commits/docs me koi AI ya Claude attribution mat daalna (no Co-Authored-By). Mujhse Hinglish me short baat kar.

Kaam is order me:
1. HANDOFF.md ke "Set up on the new laptop" steps chala (npm install, .env, db:start background me, db:reset, npm test). Kuch fail ho toh fix kar.
2. PROGRESS.md ke "Known gaps" dekh; jo chhota fix turant ho sakta hai woh kar, tests pass karwa, commit + push.
3. SIH idea PPT bana docs/sih/SIH2026-IDEA-Presentation-Format.pptx template me, HANDOFF.md ke "Pending: the SIH presentation" table ke hisaab se: max 6 slides, flowcharts aur diagrams editable shapes me, har slide render karke check kar. Output docs/sih/SIH26262-Idea-Presentation.pptx me save kar aur mujhe bata kaha hai.
4. Phir docs/NEXT_PROMPT.md ke hisaab se agla milestone (M4) shuru kar.

Har step ke baad mujhe batana kya hua aur kya click karke check karu.
```
