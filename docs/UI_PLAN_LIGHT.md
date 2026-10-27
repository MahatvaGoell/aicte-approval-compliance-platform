# UI plan: light theme for the finale demo

Light theme only. Dark theme comes later, if time is left. Same palette as now: beige paper, ink black, sepia stamps, red only for late or error. The user's reference shots (docs/ui-refs, images 1–7) give the layout and feel. Their colours are recoloured to our tokens.

Fixed rules: the system never approves or rejects; no made-up numbers; status is always text plus colour; `server/` is not touched; fonts stay Inter + JetBrains Mono (offline); motion stays in CSS and switches off under `prefers-reduced-motion`.

## Order (same as the demo)

| # | Page | Why first | References |
|---|---|---|---|
| 1 | Shell + tokens | Every page uses it | 1, 3, 5 |
| 2 | My work | First thing in the demo (officer queue) | 1, 2, 4 |
| 3 | Case page | Seen most in the demo | 3, 4, 5 |
| 4 | Documents | Expiry-date confirm, the "wow" beat | 6, 7 |
| 5 | Second wave | Dashboard, Applications list, Login | 6, 5 |

One page = one commit. After each page: typecheck, build, light screenshots at 1440 and 390, the user checks it, then commit.

---

## 1. Shell and tokens

Feel from refs 1, 3, 5: softer and roomier. Big rounded panels on a quiet ground, fewer borders, more white space.

- New tokens in `styles.css`: `--radius-lg: 12px`, `--radius-xl: 16px`, a softer `--panel-shadow`. Cards and panels move from 8px to 12px. Paper documents stay at 2px, because they are cut sheets.
- Pills: date pills, counts and the "days in stage" chip become pill-shaped (999px) on `surface-2`. Status chips keep their dot + text.
- Sidebar: same items. More padding, the active item keeps the "pulled slip" look, group labels stay quiet.
- Top bar compact, as in handoff 4B: on mobile the brand row + crumb + demo banner comes down from ~200px to about 110px. The demo banner becomes one line with the DEMO tag.
- Paper grain stays very faint, as in handoff 4B.

## 2. My work (refs 1, 2, 4)

Layout: page heading on the left, a "Today" side panel on the right, a board below.

- **Greeting header** (ref 4): "Good morning, R. Patil" plus today's date and role · scope. Display only, from the browser clock.
- **Board** (ref 1): three columns that follow the lifecycle only.
  - Starting: draft, submitted, awaiting classification.
  - In process: in process, awaiting decision.
  - On record: decision recorded, closed, withdrawn.
  - Each column has a heading with a mono count pill. An empty column shows a dashed "Nothing here" slot, like ref 1.
- **Case card**: app number (mono), institution, category · stage, a status chip, the owner name plate and a "N d in stage" pill. The card lifts 2px on hover, and the whole card is a link.
- **Board / List toggle**: List is the current table, so nothing is lost.
- **"Today" side panel** (replaces the chat in ref 1, because we have no chat data): unread notifications count, the latest 3 notifications as small slips, and a "Open notifications" link. Real data only.
- **Stacked cards on mobile** (ref 2): at 390px the columns become one list, and each column header is a sticky pill.
- Not shown: due dates on cards, because the applications list API does not return them. The case page shows them instead.

Existing work: a half-built board is already uncommitted in `web/src/pages/Home.tsx`. It becomes the starting point for this step.

## 3. Case page (refs 3, 4, 5)

Layout from ref 5: a main column on the left and a summary panel on the right. The timeline idea comes from ref 3.

- **Compact consignment slip on top**: app number, status chips, barcode and the meta line, all smaller. The perforation becomes clear punched holes (handoff 4B).
- **Next-action block** (ref 5's black tile, in ink): one big ink panel with the next action sentence, the responsible person and the primary button. It is the only dark block on the page, so the eye goes there first.
- **Route timeline** (ref 3):
  - A horizontal date axis with a vertical "today" line and a round dated marker.
  - Each stage attempt is a bar from its start date to its end date. A finished stage gets a postmark at its end. The live stage gets a due marker, and its bar turns red with a hatch if late.
  - It is built only from stored stage dates and deadlines. If a date is missing, the bar is not drawn and "Date not recorded" is shown instead.
  - At 390px the timeline turns vertical.
- **Summary panel on the right** (ref 5 "Hi Jenny" side):
  - Owner name plate.
  - The urgency number with the 5-band ramp.
  - Due date and stage.
  - A slot for the friend's Accountability Clock: total days, with institution, with office, returned N times. It is hidden until the field exists in the API.
- **Secondary panels below** (ref 4): Documents, Obligations, Deadline details, History, Assignment and Application details stay as named disclosures, restyled as soft 12px panels.
  - The Documents panel shows a small fanned stack of paper sheets (ref 4 "Notes" stack), with letterhead and ruled lines, as in handoff 4B.
- **Slots for the friend's features**, which appear when the API has them:
  - a "Double claims" disclosure;
  - an "Approval letter" card with the QR and a Print button.

## 4. Documents (refs 6, 7)

Default view: a compact register table (ref 6). The current paper-sheet grid stays as a "Sheets" view (ref 7 pile).

- **Table**: #, document title + file name, case (mono), type, version, received, status (dot + text). One line per row, and the row tints on hover.
- **Hover preview** (ref 6 popup), which is the one the user asked for:
  - One floating card follows the cursor with a soft lag: a small easing step per frame, 18px from the pointer. It flips near the screen edges. It fades and scales in over 180ms.
  - Inside: a mini paper sheet (letterhead, ruled lines, a DocStamp), the title, type, version count, received date, state, visibility, and valid-through only if a confirmed value exists ("Not recorded" otherwise). An "Open in case →" line closes the card.
  - Keyboard: focusing a row shows the same card next to the row. Touch: no hover, so a tap opens the case.
  - Under reduced motion the card does not follow the cursor. It appears next to the row instead.
  - Only fields the list API already returns are shown. If the preview needs more, it reads the existing document detail endpoint lazily on hover, cached by TanStack Query.
- **Table / Sheets toggle** at the top right, like ref 6's grid/list icons.
- **Later, when C4 lands**: the suggested-expiry review on the sheet. A sepia highlighter on the excerpt, a dashed "Suggested · not verified" stamp, and a postmark after the officer confirms.

## 5. Second wave (only if time is left)

- **Dashboard**: the lead row (Overdue, Due within 7 days) becomes two big soft panels; the holding rack becomes one row of pills with counts. Handoff 4B asks for less tile grid.
- **Applications list**: the same compact table style as Documents, with the same hover preview for cases (stage, owner, due).
- **Login**: rounder role cards and a softer hero. Light polish only.
- Already done in this world: Notifications, Audit log, Policy, Reports. Reports is still uncommitted.

## 6. Merge with the friend's branch

The friend works on `features-finale` with server changes and new UI files. To keep the night merge small:

- I do not touch `server/` or migrations.
- The case page keeps its slot components (accountability strip, double claims, letter card) as small separate components, so the friend's code plugs in.
- My CSS stays grouped by page in `styles.css`. The friend's CSS is one block at the end.
- Expected conflicts: `Case.tsx` and `styles.css`. I resolve them after the friend pushes.

## 7. Open points for the user

- Should the "Today" panel on My work show notifications (real data), or be left out?
- Documents default view: Table (ref 6) or Sheets (ref 7)? Plan default: Table.
- Is a greeting with the person's name ("Good morning, R. Patil") fine in a government tool, or plain "Your work"?
