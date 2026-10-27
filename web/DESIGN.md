---
name: "AICTE Approval & Compliance Platform"
description: "A registered-post counter: beige paper or soot-black counter, warm black ink, sepia postmarks, natural red only when work is late or returned."
colors:
  "bg": "#f3eee3"
  "rail": "#ece5d6"
  "surface": "#fbf8f1"
  "surface-2": "#ebe3d3"
  "raised": "#fffdf8"
  "ink": "#1b1713"
  "ink-2": "#463d33"
  "on-ink": "#fbf8f1"
  "accent-2": "#3a3129"
  "muted": "#685c4e"
  "line": "#d9cdb8"
  "line-2": "#e7dfcf"
  "control-line": "#a8987f"
  "stamp": "#5b4431"
  "stamp-soft": "rgba(91, 68, 49, 0.09)"
  "ok": "#4c3f31"
  "ok-soft": "#e9e1d0"
  "info": "#5c5043"
  "info-soft": "#ebe4d6"
  "bad": "#923a2c"
  "bad-soft": "#f3e0d8"
  "hatch": "rgba(146, 58, 44, 0.11)"
  "focus": "#6b4f36"
  "hero": "#eae2d1"
  "hero-ink": "#2c251e"
  "dark-bg": "#030202"
  "dark-rail": "#060403"
  "dark-surface": "#080605"
  "dark-surface-2": "#120d0a"
  "dark-raised": "#0c0907"
  "dark-ink": "#f1e8da"
  "dark-ink-2": "#cdbfac"
  "dark-on-ink": "#0c0907"
  "dark-accent": "#ece0cb"
  "dark-accent-2": "#f6ecdb"
  "dark-muted": "#a49684"
  "dark-line": "#2b231c"
  "dark-line-2": "#19130f"
  "dark-control-line": "#5c4e40"
  "dark-stamp": "#d2bb9c"
  "dark-stamp-soft": "rgba(210, 187, 156, 0.08)"
  "dark-ok": "#d6c4aa"
  "dark-ok-soft": "#16100c"
  "dark-info": "#c9b9a4"
  "dark-info-soft": "#140f0c"
  "dark-bad": "#e89c8e"
  "dark-bad-soft": "#2a1411"
  "dark-hatch": "rgba(232, 156, 142, 0.1)"
  "dark-focus": "#dcc5a5"
  "dark-hero": "#080605"
  "dark-hero-ink": "#ecdfcb"
typography:
  display:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(38px, 4.6vw, 60px)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(28px, 2.7vw, 36px)"
    fontWeight: 680
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  consignment:
    fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, ui-monospace, monospace"
    fontSize: "clamp(26px, 3.2vw, 40px)"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "-0.045em"
  next-action:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(21px, 2.1vw, 27px)"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "\"cv11\", \"ss01\""
  label:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "0.1em"
  count:
    fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, ui-monospace, monospace"
    fontSize: "46px"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "-0.05em"
  mono:
    fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, ui-monospace, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "-0.01em"
rounded:
  paper: "2px"
  stamp: "3px"
  chip: "4px"
  input: "5px"
  sm: "6px"
  md: "8px"
  round: "50%"
spacing:
  hair: "4px"
  xs: "8px"
  sm: "14px"
  md: "22px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.accent-2}"
    textColor: "{colors.on-ink}"
  button-default:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
    height: "40px"
  button-danger:
    backgroundColor: "{colors.bad-soft}"
    textColor: "{colors.bad}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "9px 12px"
    height: "40px"
  chip-ok:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    rounded: "{rounded.chip}"
    padding: "2px 8px"
  chip-bad:
    backgroundColor: "{colors.bad-soft}"
    textColor: "{colors.bad}"
    rounded: "{rounded.chip}"
    padding: "2px 8px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "24px"
  delivery-note:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "26px 28px 24px"
  nav-item:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  nav-item-active:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
  cubby:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "20px 22px 18px"
  cubby-late:
    backgroundColor: "{colors.bad-soft}"
    textColor: "{colors.bad}"
  rubber-stamp:
    textColor: "{colors.stamp}"
    rounded: "{rounded.stamp}"
    padding: "4px 9px 3px"
---

# Design System: AICTE Approval & Compliance Platform

## Overview

**Creative North Star: "The Registered-Post Counter"**

Every application travels like a registered consignment. Each office hop gets a round dated postmark. The live hop shows where the file sits and when it is due, and nothing counts as done until someone acknowledges it. The interface is a post-office counter. Paper sheets with letterheads and ruled lines lie on a beige counter in light mode and on a soot-black counter in dark mode. Warm black ink carries the text and the primary actions. Sepia stamp ink marks completion, and natural red appears only when work is late, returned or failing.

Density is moderate and register-like. Pages lead with one sheet that owns the next action, the delivery note. Under it come the consignment slip with its route of hops, and then a register of tables and folded disclosures for the supporting record. A fixed, very faint paper-fibre noise keeps large beige or black fields from looking flat. The system refuses the card-grid admin dashboard. Counts sit in a ruled sorting rack with slip piles. They are not floating tiles.

The palette is pinned to the user's rules. Light mode is a bright off-white beige with no muddy cast. Dark mode is near-black with a faint brown undertone. No green, blue, purple, olive, gold or brass appears anywhere, and status always carries text.

**Key Characteristics:**
- Beige paper or soot-black counter, warm black ink, sepia stamps, natural red only for late or returned work.
- Round dated postmarks with an ink-roughened SVG edge record completed stages and verified documents.
- Dashed lines mean pending or a perforation. Solid lines mean done or committed.
- Consignment numbers, dates, counts and clocks are set in JetBrains Mono with tabular figures.
- Paper depth comes from two soft, low shadows. The sheet that owns the next action gets the larger lift.
- One 5-band urgency ramp (calm, near, soon, today, late) appears wherever a clock appears.

## Colors

The palette is warm black ink on beige paper with a single sepia stamp ink. Natural red is the only hue that departs from brown. Each light token has a `dark-` counterpart that the theme swaps in through `prefers-color-scheme` or `data-theme`.

### Primary
- **Counter Ink** (`ink` / `dark-ink`): body text, headings, primary buttons, the live hop disc, active segmented and tab states, the table-head rule and the filled urgency band. The accent is the ink, so `accent` aliases it in light mode. In dark mode the primary button uses the slightly warmer `dark-accent` parchment.
- **Ink Hover** (`accent-2` / `dark-accent-2`): hover fill for primary buttons only.

### Secondary
- **Sepia Stamp Ink** (`stamp` / `dark-stamp`): postmarks, the brand mark, AD sign-off marks, rubber stamps, solid lines between completed hops, timeline dots and the demo tag. `stamp-soft` is the halo behind the input focus ring and the work-card dot.

### Tertiary
- **Natural Red** (`bad` / `dark-bad`): overdue counts, returned hops, errors, rejected and expired statuses, the notification badge and late urgency. `bad-soft` is its borderless fill, and `hatch` is the 135-degree hatch that marks overdue fields.

### Neutral
- **Counter Beige / Soot Counter** (`bg`): page ground.
- **Rail** (`rail`): sidebar and demo banner.
- **Paper** (`surface`): cards, tables, slips and rack cubbies.
- **Fresh Sheet** (`raised`): inputs, buttons, the delivery note, document sheets and hover rows. It is the topmost paper.
- **Pressed Paper** (`surface-2`): avatar plates, disclosure icon discs and skeletons.
- **Second Ink** (`ink-2`): secondary text and labels. **Faded Ink** (`muted`): captions, metadata and table heads.
- **Rule** (`line`, `line-2`): card borders, dashed tear lines and table row rules. **Control Edge** (`control-line`): input and button strokes, pending dashed hops and dashed fieldsets.
- **Status browns** (`ok`, `ok-soft`, `info`, `info-soft`): approved and informational chips. They stay inside the brown family and are told apart by their text, fill and border style.
- **Counter Window** (`hero`, `hero-ink`): the login hero panel and the intro overlay.
- **Focus** (`focus`): the 2px focus outline.

### Named Rules
**The Red Means Late Rule.** Natural red appears only for overdue, returned, rejected, expired or failed states. Warnings and errors are borderless `bad-soft` fills with `bad` text, and they never carry a coloured side stripe.

**The Ink Is The Accent Rule.** No hue other than warm browns and natural red. Never introduce green, blue, purple, olive, gold or brass, even for success. Approved states use the ink-brown `ok` with text.

**The Sepia Belongs To Stamps Rule.** Stamp ink marks completion and authority: postmarks, AD marks, rubber stamps and finished hop lines. Do not use it for links, buttons or decoration.

## Typography

**Display Font:** Inter (bundled locally; Segoe UI, system-ui fallback)
**Body Font:** Inter
**Label/Mono Font:** JetBrains Mono (bundled locally; Cascadia Mono, Consolas fallback)

**Character:** Inter carries the clerk's voice with tight negative tracking at size. JetBrains Mono carries everything a post office would print or frank: consignment numbers, dates, counts, clocks and letterheads. Only two files of Inter are bundled (400, and a bold cut serving weights 500 to 800), so nominal weights of 600 to 700 all render from the bold cut.

### Hierarchy
- **Display** (700, clamp(38px, 4.6vw, 60px), 1.02): the home counter headline and the login hero only.
- **Headline** (680, clamp(28px, 2.7vw, 36px), 1.15): page titles.
- **Consignment** (mono 650, clamp(26px, 3.2vw, 40px), 1): the application number on the case slip.
- **Next action** (650, clamp(21px, 2.1vw, 27px), 1.25, max 46ch): the one sentence of the delivery note.
- **Title** (650, 17px): section and card heads. Case-main cards use 18px and context cards use 14px.
- **Body** (400, 14px, 1.55, `cv11` and `ss01` on): running text. Lead paragraphs stop at 44 to 64ch.
- **Label** (650, 10.5px, 0.1em, uppercase): table heads and sidebar group labels only.
- **Count** (mono 650, 46px; 64px in the lead rack, 36px in the holding rack, 30px for urgency): numbers that must read at a glance.
- **Mono** (400, 12.5px): inline codes, dates, rule references and postmark text.

### Named Rules
**The Franked Figures Rule.** Any identifier, date, count or clock is set in JetBrains Mono with tabular numerals. Prose never is.

**The Two Faces Rule.** Inter and JetBrains Mono, served from `/fonts`, are the whole type system. The app works offline, so it never uses a web-font CDN or a third family.

## Layout

A fixed 248px sidebar rail (210px from 861px to 1060px) sits beside a sticky, blurred topbar and a content column capped at 1320px with 30px/32px padding. Pages are a single grid with a 22px gap. The case workspace splits into a main column and a 300px sticky context column. The application form is a 270px sticky guide beside one paper sheet. Each paper sheet starts with a letterhead that ends in a solid 1.5px ink rule. Sections inside a sheet are separated by dashed tear lines.

The dashboard is a sorting board. A lead rack of two large cubbies holds time pressure, and an auto-fit holding rack (minimum 190px) holds waiting states. All cubbies are joined by 1px `line` gutters inside one bordered frame. Each cubby carries a slip pile of up to six sheets that grows with its count.

Breakpoints are 1180px (context and guide stack), 1060px (two-column grids collapse; racks go to two columns), 860px (the sidebar becomes a top bar with a menu button, controls grow to a 44px minimum, and the delivery note stacks) and 560px (the hop track turns vertical, racks go to one column and the document library goes to two columns). Rhythm runs on 4, 8, 14, 22 and 32px steps. Card padding is 24px, or 20px on mobile.

## Elevation & Depth

Depth is paper lying on a counter: low, soft, warm shadows with a 1px top highlight. They are never hard or offset. Sheets that are stacked, like the document piles and the rack slips, are shown by rotated layers underneath rather than by deeper shadows. In dark mode the shadows turn almost black, and the counter's tonal steps (`bg` to `surface` to `raised`) carry most of the depth.

### Shadow Vocabulary
- **Paper rest** (`box-shadow: 0 1px 0 rgba(70,50,30,0.05), 0 12px 26px -20px rgba(70,48,26,0.42)`; dark `0 1px 0 rgba(255,240,220,0.03), 0 14px 30px -22px rgba(0,0,0,0.9)`): cards, tables, slips, disclosures and the rack.
- **Paper lift** (`box-shadow: 0 2px 0 rgba(70,50,30,0.05), 0 22px 40px -24px rgba(70,48,26,0.5)`; dark `0 1px 0 rgba(255,240,220,0.04), 0 24px 44px -24px rgba(0,0,0,0.95)`): the delivery note, the decision form, the form sheet, the work card and hover on sheets and disclosures.

### Named Rules
**The One Sheet Lifted Rule.** At rest, only the sheet that owns the user's next action takes paper lift. Everything else rests flat on the counter until hovered.

## Shapes

Corners are small and practical: 8px for cards, slips and racks; 6px for buttons and nav items; 5px for inputs; 4px for chips; 3px for rubber stamps; and 2px for paper documents, so they read as cut sheets. Circles are reserved for postal marks: postmarks, the live hop, avatar plates, section numbers and draft checks. Dashed strokes mean a perforation or a pending state, and solid strokes mean committed. Perforated tear lines are a 1.5px dashed rule with semicircle notches cut from both ends. Documents carry a folded top-right dog-ear. The overdue hatch is a 135-degree repeating stripe, 7px on and 7px off.

### Named Rules
**The Dashed Means Pending Rule.** A dashed stroke says "not yet" or "tear here", and a solid stroke says "done". Pending hops, warn chips, pending rubber stamps and empty draft checks are dashed. Completed hop lines and entered checks are solid.

## Components

### Buttons
Buttons press like a counter stamp.
- **Shape:** gently rounded (6px), 40px minimum height (44px at 860px and below), and 650 weight at 13px.
- **Primary:** an ink fill with `on-ink` text, which becomes a parchment fill with near-black text in dark mode. Hover moves to `accent-2`.
- **Default / Secondary:** a `raised` paper (secondary is transparent) with a `control-line` stroke. Hover darkens the stroke to ink.
- **Hover / Active:** hover lifts the button 1px and adds a soft ink-tinted drop shadow. Active presses it 1px down and removes the shadow over 60ms. A trailing arrow slides 3px on hover.
- **Danger:** a borderless `bad-soft` fill with `bad` text. **Link:** an underlined ink text button.

### Chips
- **Style:** text is always present, preceded by a 5px dot in the current colour, in 11.5px at 650 weight on a 4px radius. The border is the current colour at 32%.
- **Variants:** `ok` and `info` get a soft fill. `warn` uses a dashed sepia border, `demo` a dotted border and `neutral` a hollow dot. `bad` is borderless red on `bad-soft`, and `accent` is an ink border on paper.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** `surface` with a 1px `line` border.
- **Shadow Strategy:** paper rest, with lift reserved as described above.
- **Internal Padding:** 24px (20px on mobile).
- **Disclosures:** folded sections with a round icon disc, a title and subtitle, a mono count pill and a chevron. They open with a dashed rule under the summary and animate their height over 320ms.

### Inputs / Fields
- **Style:** a `raised` fill with a 1px `control-line` stroke, 5px radius and 9px/12px padding.
- **Focus:** the border turns ink, with a 1px ink ring and a 3px `stamp-soft` halo. Global focus-visible is a 2px `focus` outline offset by 3px.
- **Error:** 12px `bad` text under the field with a single 350ms shake. Fieldsets and upload zones use dashed `control-line` borders.

### Navigation
- **Sidebar:** the `rail` surface with uppercase group labels. Items are ink-2 at 500 weight with a 17px stroked SVG icon. The active item is a paper slip pulled from the rack: a `raised` indicator with paper shadow that slides between items over 420ms. Secondary tools fold under a dashed-ruled "More tools" disclosure.
- **Mobile (860px and below):** the sidebar collapses to a top bar with a menu button. Items become a two-column grid of bordered slips, and the active item is filled with ink.
- **Segmented and tabs:** a 3px-padded paper tray. The selected item is filled with ink.

### Consignment Slip and Route (signature)
The case header is a slip with a mono consignment number, a decorative barcode and a key-value line. A perforated tear line separates it from the route. Each hop on the route is a 76px slot. A completed hop is a postmark that lands with the stamp animation, and its connector is drawn as a solid stamp line. The live hop is an ink disc with a faint outer ring, and it turns red when the file was returned. A pending hop is a dashed empty circle. Completed hops carry an AD sign-off mark: a small rotated mono "AD" box in stamp ink beside "Signed off by ...".

### Delivery Note (signature)
The next action owns the page. The note is a raised sheet with paper lift. The main side holds the next-action sentence, a name plate and "Why this action?". A due column, divided off by a dashed rule, holds the urgency clock, the mono due date and the primary jump button. When the file is late, the due column is hatched on `bad-soft`. Blockers sit in a full-width borderless red strip.

### Postmark, Rubber Stamp and Urgency (signature)
- **Postmark:** a round double-ring SVG with arc text on top and bottom and a centred mono date. Its edge is roughened by turbulence, and it rotates by a deterministic -11 to 11 degrees. It lands with a 320ms scale-and-blur stamp (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **Rubber stamp:** a 1.5px bordered uppercase mono label rotated -3 degrees, used for unverified document states. It is dashed while pending and red when bad.
- **Urgency:** a large mono figure with a unit, above a five-band ramp (15+ d, 4 to 14, 2 to 3, Today, Late). The live band is filled with ink, or with red when late.

### Sorting Rack (signature)
Cubbies hold a label, a mono count and a footer arrow, with a slip pile that drops in with a staggered 420ms slip-in. Zero counts fade to muted 400 weight. A late cubby is hatched on `bad-soft` with red count and label.

### Paper Documents (signature)
Document sheets have a 1:1.3 aspect ratio, a 2px radius, a mono letterhead over a solid ink rule, ruled lines that fade out, and a dog-eared corner. A verified sheet carries a postmark. Stacked sheets fan out on hover.

## Do's and Don'ts

### Do:
- **Do** put the next action, its owner and its due clock in one lifted delivery note before any supporting record.
- **Do** mark a completed stage or verified document with a dated postmark, and a sign-off with the AD mark.
- **Do** use the single five-band urgency ramp everywhere a deadline appears, and hatch late fields on `bad-soft`.
- **Do** set consignment numbers, dates, counts and clocks in JetBrains Mono with tabular numerals.
- **Do** keep motion to the established set: stamp landing (320ms), hop drawing (320ms), page settle (360ms, staggered by 30ms), and the loading shimmer as the only infinite loop. All of it is disabled under `prefers-reduced-motion`.
- **Do** give every status a text label. Colour and border style only reinforce it.

### Don't:
- **Don't** use green, blue, purple, olive, gold or brass, or any muddy beige or grey-brown cast in light mode.
- **Don't** use red for anything other than late, returned, rejected, expired or failed. Don't outline warnings or give them coloured side stripes.
- **Don't** lay out counts as a grid of separate floating cards. They belong in the ruled sorting rack.
- **Don't** add an uppercase kicker or eyebrow above a heading. Tracked uppercase is for table heads, sidebar group labels and mono letterheads.
- **Don't** use hard offset shadows, glassy blur on content, or a third typeface or font CDN.
- **Don't** use dashed strokes for completed states, or solid strokes for pending ones.
