# UI pages: layout brief for design

One entry per screen: who uses it, what must be on it, and which states it needs. Design each screen; the coding agent then builds it on the existing theme and animations (`web/src/styles.css`, `web/src/motion.tsx`).

Status: **Built** = exists now (restyle it). **Next** = coming in a later milestone (design it fresh).

## How to send designs

- For each screen: **desktop 1440 wide** and **mobile 390 wide**. Dark mode is enough; light mode follows from the same tokens unless you want something specific.
- Figma link, PNG screenshots or an HTML mock all work. Name files by the number below, e.g. `05-case-workspace-desktop.png`.
- Mark anything that moves (what animates, on hover / on load / on click). If you don't mark it, the existing motion is used.
- Keep the fixed rules: status always **text plus colour** (never colour alone); every page shows the demo/synthetic notice; the system never shows "Approved/Rejected" buttons except to the competent authority.

## Shared parts (design once, used everywhere)

| Part | Must contain |
|---|---|
| **A. Sidebar** | Logo, product name, nav items with icons (changes by role), a short footer line. Mobile: becomes a top strip or drawer — your call. |
| **B. Top bar** | Avatar and user name, active role + scope chip (role switcher when a user has two roles), notifications bell (from M3, with unread count), theme toggle, sign out. |
| **C. Demo banner** | "Demonstration environment, all data synthetic". Small, always visible. Shows demo clock offset when set ("Demo clock +3 days"). |
| **D. Page header** | Section label `(02) Applications`, title, optional subtitle, primary action button on the right. |
| **E. Status chip** | Kinds: neutral, in progress, waiting, overdue, done, rejected, demo rule. |
| **F. Table** | Header row, hover row, clickable ID, status chip column, "due in / overdue by" column, empty and loading rows, pagination. |
| **G. Form controls** | Text, number, select, date, textarea, checkbox, file upload drop zone (M5), field error, form-level error box. |
| **H. Feedback** | Loading skeleton, empty state, error with "Try again", "not found / no access", success toast. |
| **I. Intro screen** | Already built (AICTE wordmark + counter). Redesign only if you want. |

## Screens

### 01 · Login and role picker — Built
**Who:** everyone. **Layout:** brand/hero side + "Choose who you are" side.
- Hero: product name, one-line promise, 3–5 step strip (Route → Clock → Escalate → Watch → Prove), "not an official AICTE system".
- Role cards grouped: Institutions (2), Regional offices and bureau (3), Committees (3), Authority (1), Policy/admin/audit (4). Each card: icon, role name, scope, handle. Click = signed in.
- Collapsed "sign in with email and password".
- States: signing-in on one card, error.

### 02 · Institution home — Built (simple), full version M6/M7
**Who:** institution representative.
- "What to do next" hero card: the single most urgent task, due date and why.
- Counters row: open applications, open findings, obligations due, documents expiring.
- My applications table (ID, category, cycle, stage, status, next owner).
- Upcoming EVC visits list; expiring documents list; readiness meter for a draft.
- Empty state for a new institution ("Start your first application").

### 03 · Application form (new / edit draft) — Built
**Who:** institution.
- Sections: Approval sought (cycle, category + category-specific fields), Campus (address, land area), Programmes (repeatable rows: name, level, intake; add/remove), Remarks, Declaration.
- **Readiness side panel** (sticky): checklist of what is still missing, turns green as fields fill.
- Footer: Save draft, Save and submit, note that submission freezes the application.
- States: field errors, "application incomplete" summary, saving, saved.

### 04 · Application list — Built
**Who:** officers, bureau, committee, auditor, institution.
- Filter bar: search, status, category, stage, region, submitted from/to, "assigned to me".
- Result count + last refreshed time.
- Table: application no., institution + region, category, stage, status, owner, waiting since / due, overdue chip.
- Export CSV button (M6). Empty and loading states.

### 05 · Case workspace — Built (main screen of the demo)
**Who:** everyone with access to the case; content differs by role.
- Header: application no., lifecycle chip, decision chip, compliance chip, "synthetic record", institution · category · cycle · region · submitted.
- **Next action panel** (hero): next action sentence, responsible person, due date and its basis, waiting since, why pending, rule reference, blocking items.
- **Route card**: stages as steps (done / current / not started / returned with attempt count) + "why this route" with rule and provenance chip.
- **Work area** (only for the person whose turn it is): checklist table with Satisfied/Deficient/N.A. per item + observation; recommendation form; complete stage button; decision form for the authority only.
- **Gap panel** (M7): what is missing, from whom.
- **Evidence register / obligation trail** (M5): decision → condition → obligation → deadline → reminders → submission → document version → verification → closure, each step clickable.
- Stage history table; full history timeline.
- Right column: assign form (officer), "Your permitted actions" with reasons for unavailable ones, recommendations, submitted application snapshot (+ hash).

### 06 · Scrutiny findings and institution response — M2
**Who:** committee/officer raise findings; institution replies.
- Finding list: finding text, severity, raised by, due date for response, status (open / responded / accepted / re-raised).
- Institution side: reply box + attach documents per finding, submit response.
- Officer side: accept or re-raise each response; "return case to institution" with reason.
- Attempt tabs (Scrutiny attempt 1, 2…) so earlier rounds stay visible.

### 07 · Policy versions, source register and comparison — M2
**Who:** policy administrator, policy approver.
- Version list: version, status (draft / validated / published / superseded), author, published by, date.
- Version detail: routes, stages, checklists, deadline rules — each rule with provenance chip (APH clause / admin instruction / demo rule) and source reference.
- **Diff view**: side by side or inline, added/removed/changed rules highlighted.
- Validation result panel (errors / warnings).
- Publish button (approver only) with confirmation.
- Source register: list of source documents (APH clause, admin instruction) with page/clause.

### 08 · Notification centre — M3
**Who:** everyone.
- Bell dropdown in top bar (latest 5) + full page.
- List: icon by type, message, linked case, time, read/unread, acknowledged.
- Filters: unread, escalations, deadlines.
- Delivery status shown separately: accepted / delivered / bounced / retrying / failed.

### 09 · Email outbox preview — M3 (demo only)
**Who:** admin in demo mode.
- Left: list of generated emails (to, subject, time, status). Right: rendered preview.
- Retry history for failed ones; a "simulated failure" label.

### 10 · Operations — M3
**Who:** system administrator.
- Worker health (running / stale), job queue counts, failed jobs with retry, dead letters.
- **Demo clock** control: current business time, "+1 day / +7 days / reset" buttons.
- Reconciliation runs and missed thresholds.

### 11 · EVC queue, calendar and visit detail — M4
**Who:** regional officer / EVC scheduler, EVC members, institution.
- Queue: cases ready for visit, ready since, days waiting, urgency.
- Suggestion panel: proposed expert panel with factors (eligibility, conflicts, workload, travel), "information unavailable" warnings.
- Calendar (week/month) with visits and expert reservations; conflict highlighted.
- Visit detail: mode (physical / online / hybrid), members and their confirmation, institution acknowledgement, checklist, report submitted / accepted, reschedule history.
- Expert directory table.

### 12 · Documents and renewal — M5
**Who:** institution uploads; officer reviews.
- Document register: document type, current version, valid until, status (valid / expiring / expired / awaiting verification).
- Upload drop zone with check results (type, size, encrypted, damaged) shown live.
- Version history per document (hash, uploader, time, predecessor).
- Metadata review: suggested expiry date with page + excerpt, reviewer confirms or corrects.

### 13 · Obligation register and verification — M5 (anchor feature)
**Who:** institution, officer, bureau.
- Table: obligation, from which decision condition, due date + basis, reminder status, submission status, verification status, closed?
- Detail drawer: the full trail (decision → … → closure) as a vertical chain; extension history (original vs new deadline, reason, authoriser).
- Verify action (accept / reject with reason) for officers.

### 14 · Officer work queue — M6/M7
**Who:** regional officer, committee member.
- "Needs attention today" with reason per row.
- Priority-ordered queue: case, stage, pending action, due + basis, overdue by, blocker, evidence state, action button.
- Tabs: due soon, overdue, evidence awaiting verification, EVC, escalations.

### 15 · Management dashboard — M6
**Who:** bureau officer, competent authority, auditor.
- KPI cards: pending, overdue, average ageing, obligations due soon, renewal backlog, open escalations.
- Region × stage pendency heatmap/table; ageing buckets chart; workload by officer; bottleneck list; trend line.
- Every number clickable → filtered list. Last refreshed time + stale state.

### 16 · Reports and exports — M6
**Who:** bureau, auditor.
- Report picker, filters, preview table, Download CSV.

### 17 · Policy impact preview — M7 (second differentiator)
**Who:** policy administrator/approver.
- Change one rule (e.g. reminder 7 → 14 days before expiry).
- Result: which cases/reminders change, before vs after dates, count summary. Then publish.

### 18 · Audit log with integrity check — Built (basic), full M6
**Who:** auditor, admin.
- Filters: actor, case, action type, date.
- Event list: time, actor, action, entity, details.
- **Integrity check** button → animated chain verification, result "Chain intact · N events" or the first broken link.

### 19 · Users and capability administration — M6
**Who:** system administrator.
- User list; user detail with grants (role, scope, valid from/to, delegated by); add/revoke grant; lock/unlock.

### 20 · Not found / no access / session ended — Built (plain)
- Friendly full-page states with a way back.

## Priority if time is short

Design first: **01 Login, 05 Case workspace, 02 Institution home, 14 Officer queue, 15 Management dashboard, 13 Obligation register**. These carry the demo. Then 04, 03, 06, 11, 12, 08. The rest can reuse the shared parts.

## Redesign notes — 27 Oct 2026

- Direction: warm ivory, forest green and restrained brass, with matching dark values. This replaces the initially proposed teal palette following the user's feedback. The supplied compositions are adapted to a simpler operational interface; no decorative metrics, external imagery or new dependencies were added. Reference-only account creation/password recovery, HR actions, water-production metrics and contact-page functions are not added to the existing product flow.
- Shared tokens: `--hero` / `--hero-ink`, `--brass`, `--control-line`, spacing and motion tokens. Existing surface, text, accent and semantic status tokens remain the shared foundation. All colour tokens are declared for light, automatic dark and explicit dark. Locally bundled Inter and JetBrains Mono remain in use.
- Shared `Disclosure` groups secondary case records without unmounting forms. Primary navigation stays separate from **More tools**; mobile navigation uses an explicitly labelled **Menu**. Search/status remain visible before **More filters**. The active scope, theme toggle, sign-out, notification bell, section numbering and synthetic notice remain available.
- Login shows the selected workspace's demo accounts rather than every account together. Case opens on the next action and route; current work stays visible, with documents, obligations, detailed clocks and history in named sections. Dashboard figures retain their existing filtered report destinations. Document folders link to the same exact case/document anchors. The form overview reports entered fields only; it is not a new readiness or approval rule.
- Motion is limited to short page settling, selection/hover feedback and loading. The intro no longer blocks input and finishes within 500ms; reduced-motion preferences suppress animation.
- Baseline screenshots: `ui-before/` (36 PNGs). Final matching screenshots: `ui-after/`, plus role and secondary-page captures, contact sheets and layout/contrast checks. The running demo/database were reused without reset. No application, recommendation, visit, document verification or decision was submitted during browser QA.
- Verification: typecheck, production build and all 226 existing tests pass. The nine routes represented by the eight-screen brief (Documents and Obligations are separate routes) were checked in both themes at 1440, 1024, 768 and 390px with no horizontal page overflow. Tables scroll in their own containers. Institution response and absence of decision controls, officer classification/document review, authority-only decision form, bureau management drill-down, mobile menu, keyboard disclosure, empty search and reduced motion were checked. Reports, Notifications, Audit, Policy, Operations and Mock integration retain coherent shared styling. This is a presentation change; no server, migration, permission, command, query-key or API-contract changes.

### Palette revision

The latest user request supersedes the forest/brass palette: bright off-white beige in light mode, near-black surfaces with beige text and controls in dark mode. Success, information and demo states are neutral; warning/error sections use natural red with no border. Layouts, actions and role permissions are unchanged.

Dark-theme refinement: canvas `#030202`, main surfaces `#080605` and raised surfaces `#0c0907`. The large hero area now uses the same nearly black surface instead of visible brown. Light mode is unchanged.
