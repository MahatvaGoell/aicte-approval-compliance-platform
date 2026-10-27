# Codex prompt: UI redesign of the prototype screens

Copy everything inside the block into Codex, opened in the repository root. Attach or paste the reference code/design where the prompt says `REFERENCE`.

```text
You are redesigning the web UI of an existing, working app. The backend, rules and behaviour are finished and tested. Your job is ONLY the look and layout of 8 screens, plus the shared shell. Do not change what the app does.

## 0. Project in one paragraph
ApprovalTrack: an AICTE approval workflow and compliance platform (SIH 2026, PS SIH26262). Institutions submit applications, officers and committees scrutinise them, an EVC visits, a competent authority decides, and conditions become tracked obligations with deadlines and evidence. The system routes, reminds and records. It never approves or rejects; only the competent authority records a decision. All data is synthetic.
Stack: React 18 + TypeScript + Vite + TanStack Query + react-router-dom 6 (web/), Fastify + PostgreSQL (server/). No CSS framework: plain CSS with tokens in web/src/styles.css.

## 1. First, read (in this order, do not skip)
1. AGENTS.md (rules, especially the "Web" bullets)
2. docs/UI_PAGES.md (per-screen layout brief, shared parts, states)
3. web/src/styles.css, web/src/ui.tsx, web/src/motion.tsx, web/src/App.tsx (shell: sidebar, top bar, demo banner, nav indicator, intro, theme toggle)
4. The 8 page files listed in section 3

## 2. Then run it and LOOK at the current design before changing anything
```bash
npm install && cp -n .env.example .env
npm run db:start        # terminal 1, keep running
npm run db:reset
npm run dev:api         # terminal 2
npm run dev:worker      # terminal 3
npm run dev:web         # terminal 4 -> http://localhost:5180
npm run demo:scenarios  # with the API running: creates 9 synthetic demo cases
```
Open http://localhost:5180, click a role card to sign in (no password needed in demo mode), and walk through every screen below in BOTH light and dark mode (theme toggle in the top bar) at desktop (1440) and mobile (390) width. Take screenshots of the current state into `docs/ui-before/` (named like `05-case-desktop-dark.png`). Write 5-10 lines in your first reply on what the current design is (palette, type, layout, motion) so I know you understood it before you change it.

Current design in short: warm neutral "editorial operations console", one burgundy accent (--accent #6b1e2b light, #c9637a dark), Inter + JetBrains Mono bundled locally in web/public/fonts, rounded cards (14px / 10px), left sidebar with an animated nav indicator, top bar with role switcher + bell + theme toggle, an always-visible DEMO banner, section eyebrow like "(02) APPLICATIONS", staggered page entrance, grain overlay, light and dark themes driven by CSS variables and `data-theme`.

## 3. Scope: the 8 prototype screens (and the files behind them)
| # | Screen | Route | Main files |
|---|---|---|---|
| 1 | Login / role picker | /login | web/src/pages/Login.tsx (+ Intro in motion.tsx) |
| 2 | Home / My work | / | web/src/pages/Home.tsx |
| 3 | Applications list | /applications | web/src/pages/Applications.tsx |
| 4 | New application form | /applications/new (and /:id/edit) | web/src/pages/ApplicationForm.tsx |
| 5 | Case detail (MOST IMPORTANT) | /applications/:id | web/src/pages/Case.tsx, CaseM2.tsx, CaseM3.tsx, CaseM4.tsx, CaseM5.tsx |
| 6 | Dashboard (officer + management tabs) | /dashboard | web/src/pages/Dashboard.tsx |
| 7 | Documents and Obligations | /documents, /obligations | web/src/pages/Compliance.tsx, CaseM5.tsx |
| 8 | Expert visits (EVC) | /evc | web/src/pages/Evc.tsx, CaseM4.tsx |
Shared shell used by all: web/src/App.tsx (sidebar, topbar, demo banner), web/src/styles.css, web/src/ui.tsx, web/src/motion.tsx.

Out of scope for the redesign (they must keep working and simply inherit the new tokens and shared components, no per-page work): Reports, Notifications, Audit, Policy list/detail, Operations, Mock integration, 404. Check once at the end that they still look coherent.

## 4. REFERENCE (new design / reference code)
<<< I will paste or attach the reference design and code here. Treat it as the target look. Where the reference and the rules in section 5 conflict, the rules in section 5 win; tell me about each conflict instead of silently picking one. >>>

## 5. Hard rules (do not break)
Behaviour and data
- Do NOT touch server/, migrations, API contracts, query keys, command names, permissions logic or business rules. Do not change what any button does, which buttons show for which role, or the order of steps in a flow. Presentational changes only.
- Keep all data fetching via TanStack Query and web/src/api.ts. Keep `Status`, `Provenance`, `Loading`, `ErrorState`, `MutationError`, `Empty` (you may restyle and improve them, keep their props working so other pages do not break).
- Do not rename routes. Keep the `sectionFor()` eyebrow numbering working.
Product wording and safety
- Status is always TEXT plus colour, never colour alone.
- The DEMO banner ("Demonstration environment. All institutions, people and rules are synthetic...") stays visible on every page, including the demo clock offset when set.
- The system never shows Approve/Reject style buttons except to the competent authority role exactly as today. Do not add any button that sounds like the system decides.
- Provenance chips (APH_CLAUSE / ADMIN_INSTRUCTION / DEMO_ASSUMPTION) stay wherever they are today.
- Never claim a live AICTE connection. No real emails. No fake numbers or percentages in copy; use only values that come from the data.
Engineering
- Colours only through CSS tokens (variables) in styles.css. Define BOTH light and dark values for every token you add or change, in all three places they are declared (:root, the prefers-color-scheme dark block, and :root[data-theme="dark"]). Check contrast (text 4.5:1, large text/UI 3:1) in both themes.
- Fonts must be bundled locally (web/public/fonts). No Google Fonts, no CDN, no external images, no remote scripts: the app must work fully offline. If you want a new font, add the woff2 files locally (open-licence only) and keep Inter/JetBrains Mono as fallback.
- Avoid new npm dependencies. If one is truly needed (icons, charts), tell me why first; it must be bundled, not loaded from a CDN. Existing `Icon` set is in motion.tsx; extend it instead of adding an icon package where possible.
- Motion lives in CSS, must respect `prefers-reduced-motion`, and must not block interaction or delay content by more than ~600 ms.
- Accessibility: keep semantic HTML, visible focus rings, labels on inputs, keyboard operable nav and tables, `aria-*` already present. Minimum touch target 40px on mobile.
- Responsive: every one of the 8 screens must work at 1440, 1024, 768 and 390 px width with no horizontal page scroll (tables may scroll inside their own container). On mobile the sidebar becomes a drawer or top strip.
- Keep the demo smooth: no layout shift on load, loading skeletons for every async block, empty states for every list.
- Do not leave dead CSS for removed classes, but also do not do a risky mass-rename: other (out-of-scope) pages share classes like .card, .chip, .btn, .table, .row, .grid, .small, .muted. Change them in a way that keeps those pages looking right.

## 6. Work plan (follow this order, report after each step)
Step A. Understand: sections 1-2, screenshots into docs/ui-before/, short summary of current design. Wait for nothing; continue to B.
Step B. Design tokens and shared components first: update tokens (colour, type scale, spacing, radius, shadow, motion durations) for light AND dark, then shell (sidebar, top bar, demo banner, page header/eyebrow, buttons, chips/status, cards, tables, form controls, tabs, skeleton/empty/error). After B, every page already looks "new-ish" through shared styles. Show me screenshots of Login + Applications list in light and dark before going further.
Step C. Screens in this order: 5 Case detail, 6 Dashboard, 1 Login, 3 Applications list, 2 Home, 4 Application form, 7 Documents and Obligations, 8 Expert visits. Case detail is what judges see most: spend the most effort there (route/stage stepper, "next action" hero, work area, findings, EVC, obligation and evidence trail, history).
Step D. Check the out-of-scope pages (Reports, Notifications, Audit, Policy, Operations, Mock integration) still render coherently with the new tokens; fix only breakage.
Step E. Polish: motion, empty/loading/error states, mobile layouts, dark mode contrast, keyboard focus.

## 7. Verify before you say "done"
```bash
npm run typecheck
npm test
npm run build
```
All three must pass (npm test is the backend suite; it must still be green because you did not touch server/). Then, with the dev servers running, open each of the 8 screens in light + dark, at 1440 and 390 width, signed in as these roles, and confirm no console errors and no broken layout:
- institution: inst.west (home, new application, case with a returned finding, obligations)
- officer: ro.west (case in scrutiny, classification, EVC queue, documents review)
- authority: authority (case awaiting decision: decision form only here)
- bureau (dashboard, reports link-through)
Demo cases created by `npm run demo:scenarios` cover each state (01001 in scrutiny, 01002 returned, 01004 awaiting decision, 01006 open obligation, 01007/01008 EVC, 01009 renewal).
Save the final screenshots into `docs/ui-after/` with the same names as in `docs/ui-before/`.

## 8. Git and style rules
- Work on a new branch `ui-redesign`. Small, clear commits. DO NOT push, DO NOT open a PR, DO NOT force push, until I say so.
- No AI or Codex attribution anywhere: no Co-Authored-By, no "Generated with", no "by Codex" in commits, code comments or docs.
- Code comments: only where the reason is not obvious. Match the existing code style.
- Talk to me in Hinglish, short and direct. After each step tell me: what changed, which files, and what to click to check it.

## 9. Definition of done
- All 8 screens match the reference design, in light and dark, desktop and mobile.
- Every existing action on those screens still works exactly as before.
- typecheck, npm test and build pass. No console errors.
- Out-of-scope pages are not broken.
- docs/ui-before and docs/ui-after screenshots exist, and docs/UI_PAGES.md has a short "Redesign notes" section listing new tokens/components and anything I should know.
```
