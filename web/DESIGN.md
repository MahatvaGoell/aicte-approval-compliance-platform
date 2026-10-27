---
name: "AICTE Approval & Compliance Platform"
description: "Ivory, forest and brass with a quiet operational hierarchy."
colors:
  "bg": "#f6f4ed"
  "surface": "#fffdf8"
  "surface-2": "#efeee5"
  "raised": "#fffdf8"
  "ink": "#293b31"
  "ink-2": "#4d5c50"
  "muted": "#61695b"
  "line": "#d8dccf"
  "line-2": "#e7e8de"
  "accent": "#2f5140"
  "accent-2": "#233f31"
  "accent-soft": "#e9ede2"
  "accent-ink": "#fffdf8"
  "ok": "#3c5b3c"
  "ok-soft": "rgba(47, 93, 70, 0.1)"
  "warn": "#795b26"
  "warn-soft": "rgba(154, 106, 31, 0.12)"
  "bad": "#a73432"
  "bad-soft": "rgba(163, 39, 31, 0.09)"
  "info": "#5c654d"
  "info-soft": "#eceee3"
  "demo": "#5c654d"
  "demo-soft": "#eceee3"
  "focus": "#2f5140"
  "brass": "#806332"
  "control-line": "#85907d"
  "hero": "#e7eadd"
  "hero-ink": "#314b38"
  "dark-bg": "#171f19"
  "dark-surface": "#202b23"
  "dark-surface-2": "#2c392f"
  "dark-raised": "#253128"
  "dark-ink": "#eeeede"
  "dark-ink-2": "#c8cdbd"
  "dark-muted": "#afb9a6"
  "dark-line": "#4a5848"
  "dark-line-2": "#2c392f"
  "dark-accent": "#c0cfad"
  "dark-accent-2": "#d8dfca"
  "dark-accent-soft": "#354632"
  "dark-accent-ink": "#20311e"
  "dark-ok": "#b8cda7"
  "dark-ok-soft": "rgba(121, 179, 148, 0.13)"
  "dark-warn": "#e2c88e"
  "dark-warn-soft": "rgba(215, 168, 90, 0.13)"
  "dark-bad": "#f1a69d"
  "dark-bad-soft": "rgba(229, 138, 127, 0.13)"
  "dark-info": "#c5cbae"
  "dark-info-soft": "#35422f"
  "dark-demo": "#c5cbae"
  "dark-demo-soft": "#35422f"
  "dark-focus": "#e2c88e"
  "dark-brass": "#dcc18d"
  "dark-control-line": "#829279"
  "dark-hero": "#2e3e2d"
  "dark-hero-ink": "#e5ead9"
typography:
  headline:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(26px, 2.6vw, 34px)"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.035em"
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
  label:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
  mono:
    fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, ui-monospace, monospace"
    fontSize: "12.5px"
    letterSpacing: "-0.01em"
rounded:
  "surface": "16px"
  "control": "9px"
  "button": "10px"
  "chip": "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.button}"
    padding: "10px 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "10px 16px"
    height: "40px"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  navigation-item:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  status-chip:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.chip}"
    padding: "2px 9px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "24px"
  disclosure:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "20px 22px"
---
# Design System: AICTE Approval & Compliance Platform

## Overview

**Creative North Star: "Old-money simplicity"**

The user-pinned old-money direction is expressed through warm ivory surfaces, forest-green actions and restrained brass details. The interface stays operational: clear labels, low ornament and a small number of immediately visible choices.

Supporting controls live in named disclosures and secondary navigation. Surface tone, borders and spacing establish hierarchy; the palette remains quiet in both themes. This replaces the earlier teal direction.

**Key Characteristics:**
- Warm neutrals with a restrained forest accent.
- Named groups expose secondary options without overwhelming the main task.
- Locally bundled sans-serif typography and text-labelled semantic status.
- Responsive controls, visible focus and reduced-motion support.

## Colors

The palette combines ivory paper tones, forest green, olive neutrals and restrained brass. The frontmatter records the exact light and explicit dark token values; automatic dark uses the same values as explicit dark.

### Primary

- **Forest:** action fill, active navigation, links and selected state.
- **Soft forest:** selection and low-emphasis action surfaces.
- **Brass:** a small supporting detail on document, trust and calendar marks.

### Neutral

- **Ivory:** page background, with a slightly brighter surface for containers and controls.
- **Forest ink:** primary text; softer olive ink and muted olive support secondary copy.
- **Quiet dividers:** structure containers; the stronger control stroke distinguishes interactive fields.
- **Deep forest:** dark background and raised layers, with pale olive accent and ivory text.

### Named Rules

**The Quiet Accent Rule.** Use the primary accent for actions and selection; brass remains a restrained detail rather than a competing action colour.

**The Text Before Colour Rule.** Status and provenance retain readable labels; colour never supplies their only meaning.

## Typography

**Display and Body Font:** locally bundled Inter, with Segoe UI and system sans fallbacks.
**Label/Mono Font:** locally bundled JetBrains Mono, with monospace fallbacks, for identifiers and recorded technical values.

**Character:** familiar and compact. Most operational content uses one sans family; weight and spacing separate headings from controls without a decorative display voice.

### Hierarchy

- **Headline:** the shared page-heading role in frontmatter. Individual case headings use a fixed 28px size; the Work and login surfaces have larger, surface-specific headings.
- **Title:** compact section headings; primary case-work headings can use 18px.
- **Body:** the shared base text, with table content at 13.5px and secondary copy at 12.5px.
- **Label:** visible field labels and concise descriptions. Buttons use 13px semibold text; standard status chips use 11.5px.

**The Named Group Rule.** Keep secondary options under a clear, descriptive group name rather than exposing every control at once.

## Layout

The shell pairs a sticky 232px desktop sidebar with a flexible content area. Main content is capped at 1680px and uses 36px desktop side padding. Between 861px and 1060px the sidebar becomes 204px and the content padding becomes 24px. At 860px and below, the sidebar becomes a compact brand row and an explicitly labelled Menu; the expanded navigation uses two columns and closes after route navigation. Content side padding becomes 16px.

The token spacing steps are recorded in frontmatter; recurring compositions also use 14px stack gaps and 22px page gaps. Generic two-column work areas collapse at 1060px. Case and form context columns collapse at 1120px. Dashboard figures use three columns, then two at 720px; document folders use three, two at 1100px, and one at 580px. Tables retain an internal horizontal scroll container, with a 640px minimum table width on mobile.

## Elevation & Depth

This is a hybrid of tonal layering and restrained soft shadows. Containers are distinguished primarily by surface, thin border and generous separation. The form, dashboard figures and disclosure interiors are flatter than the general card. The sidecar records the source shadow vocabulary, including separate dark values, without promoting stronger hover shadows to a universal treatment.

Motion supports feedback: page content settles by 5px over 240ms; hover and selected-state transitions remain brief, while the loading shimmer is continuous until data arrives. The non-blocking brand intro finishes within 500ms. Reduced-motion rules reduce animation and transition duration to 0.01ms.

## Shapes

Containers are gently curved; controls use a tighter radius and text chips remain pill-shaped. The actual source values are in frontmatter. Borders are usually one pixel. The document register uses a folder silhouette as a surface-specific link treatment, not a required shape for all cards.

## Components

### Buttons

Quiet, familiar action controls. Primary buttons use forest fill and contrasting text; secondary buttons use the neutral surface and a stronger control stroke. Both use 10px corners, 10px by 16px padding, and a 40px minimum height. Mobile controls rise to a 44px minimum. Hover moves buttons up by one pixel; active state reduces their scale slightly. Keyboard focus uses a two-pixel visible outline with a three-pixel offset.

### Chips

Text remains the state authority. Standard chips combine a small dot, readable label, semantic text colour and matching soft background. Neutral chips use a border. Chips wrap when space is constrained; the case route uses a smaller, unfilled status treatment.

### Cards / Containers

Ivory or dark-forest surface, a quiet one-pixel border and gently curved corners. Shared cards use 24px padding, reduced to 20px on mobile. Avoid adding a new visual layer when spacing or a divider already supplies the grouping.

### Inputs / Fields

Visible labels sit above full-width controls. The raised surface and stronger border identify the interactive boundary. Focus uses the accent border and a four-pixel soft accent surround. Errors use the existing semantic bad colour and text; disabled controls keep their existing state and opacity.

### Navigation

The active item uses a soft accent surface and accent text. Primary destinations remain separate from More tools. The desktop highlight follows the active primary link; mobile uses a labelled button and expanded two-column navigation rather than a hidden horizontal strip. Icons are inline SVG in the existing stroke system.

### Named disclosures

A descriptive title, optional subtitle, optional count and chevron form the closed state. Opening reveals the existing content in place; forms remain mounted. The full summary is keyboard-operable. Interiors use dividers and remove redundant nested card shells. This is the recurring mechanism for secondary records and tools.

## Do's and Don'ts

### Do:
- **Do** use the existing semantic tokens in both themes.
- **Do** keep labels, keyboard focus and text status visible.
- **Do** preserve forms and their state when placing them inside a disclosure.
- **Do** reserve strong visual emphasis for the current task and its action.

### Don't:
- **Don't** reintroduce the rejected teal palette.
- **Don't** add decorative metrics or imply an automatic regulatory decision.
- **Don't** create competing accent colours or expose every secondary option at once.
- **Don't** load remote fonts, scripts or images into the offline interface.

Not canonized: repository-required numbered section labels and existing compact eyebrow labels are compatibility details in this build, not a new-surface design rule. The source is authoritative where surface-specific values differ from the shared roles above.
