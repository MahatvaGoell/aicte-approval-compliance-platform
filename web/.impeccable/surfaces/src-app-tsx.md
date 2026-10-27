---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/pages/Case.tsx","src/pages/Login.tsx","src/pages/Dashboard.tsx"]
---

# Approval workspace direction

Mode: Operate. Scope: shared shell plus Login, Home, Applications, Application form, Case workspace, Dashboard, Documents/Obligations, Expert visits. Other pages inherit tokens and shared components only.

User-pinned: bright off-white beige light theme; almost-black dark theme with the faintest brown undertone (bg ~#030202, panels ~#080605/#0c0907); no green, blue, purple, olive, gold or brass; natural red only for compact borderless warnings/errors. Must not feel empty/flat, crowded, or template-like. Documents must look like real paper. Highlight the PS: workflow automation, compliance monitoring, alerts.

Constraints: frontend only; routes, API, query keys, actions and role gates unchanged; status always has text; demo notice and provenance stay; offline local fonts (Inter, JetBrains Mono); reduced motion respected; 390–1440px. No push or PR. package-lock.json and docs/CODEX_UI_REDESIGN_PROMPT.md are user changes outside this work.

## Direction contract

THESIS: Every application travels like a registered consignment: each office hop is postmarked with date and office, the live hop shows where it sits and when it is due, and nothing counts as done until acknowledged. Refuses the card-grid admin dashboard.

OWN-WORLD: Beige post-office paper (light) / soot-black counter (dark). Warm black ink, sepia stamp ink, natural red only for overdue/returned. Round dated postmarks (double ring, office arc text, date bar) for completed stages and verifications; perforated tear lines between slip segments; mono consignment numbers; paper sheets with letterhead and ruled fields for documents; hatch pattern marks overdue.

STORY: The officer sees which consignments are with them and which are late, opens one, reads the delivery note (next action, who, by when), acts, and watches the stamp land.

FIRST VIEWPORT: Case: mono application number as headline over a slip strip (institution, category, cycle, region); a horizontal route of office hops with postmarks; the live hop expanded as the delivery note with responsible name plate, due date on the urgency ramp, blockers; primary action at the note's right edge.

FORM: Registered Post with AD; position 4 of the grounded list; seed key 0b2e3f09. Raises: one dominant region per screen; one fixed urgency ramp; number-as-headline; hatch for overdue; fixed person name plates.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature interaction: the postmark stamp lands (scale-in with a short press, ink settles) when a stage completes or a document is verified; route hops draw in sequence on case open. Motion 120–320ms, no blocking.
