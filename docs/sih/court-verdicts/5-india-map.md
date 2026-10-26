# The verdict: GUILTY, 6 to 0

**The case:** Build a public India-map pendency dashboard as a headline feature of ApprovalTrack for the SIH 2026 national round.

**The charge:** The case fails as stated: it should not go ahead the way it is described.

## How the jury voted

| Juror | Vote | Why |
|---|---|---|
| The Designer | GUILTY | A map is the clearest picture you can put on a stage, but as described it tells a stranger the wrong story in five seconds: invented pendency numbers for real Indian regions on an unlabelled public page read as real AICTE performance, and the picture strips out the one thing the product exists to show, who owns the next action. |
| The Retired Judge | GUILTY | The defense's case for a public headline map rests on things it admits are not in the record (queryable stage timestamps, a small-number suppression rule, a hosting plan for an offline laptop product, time to build it), and "likely" is not proof. |
| The Competitor | GUILTY | If I were a rival SIH team on SIH26262, I'd copy this in a weekend: a choropleth of made-up counts needs none of the deadline engine, audit log or 99 tests that I can't easily clone, so making it the headline means leading with the one part of ApprovalTrack anyone can match and burying the parts that would actually beat me. |
| The Statistician | GUILTY | A map is only as good as the numbers on it, and here every count, overdue figure and stage average is invented, with no minimum count per region to keep small numbers from pointing to specific colleges, so the headline feature puts its least defensible statistics front and centre. |
| The Teenager | GUILTY | A glowing map gets a "whoa" for ten seconds, but it's made-up numbers with every college and person stripped out, so there's nothing to actually do with it, and nobody opens a fake public map again next week. |
| The First-Time Customer | GUILTY | Seeing this for the first time, I'd look at a map that lights up regions with numbers the team made up, see no college or person I could chase, and go back to my phone and spreadsheet, because it doesn't tell me who owns my file's next step. |

## Charges that stuck
- The map shows invented numbers on a public page, which could be read as real AICTE performance. (5 jurors)
- The map hides every college and person, so it cannot show who owns the next action, the problem the case is about. (3 jurors)
- The record sets no minimum count per region, so a sparse region could point to one college. (2 jurors)

## What the defense got right
- It is a read-only view over data the working system already produces, such as the deadline engine and overdue escalation, so it is not new core logic.
- It shows the core problem in one picture, and it never approves or rejects anything, which fits the team's own product rules.

## Conditions for acquittal
- Turn the map into a login-only drill-down from a region to its overdue files and the officer who owns each next step. (4 jurors)
- Label every figure on the map as synthetic demo data. (3 jurors)
- Write a small-number threshold and a hosting plan, and check that stage timestamps can be queried, since the record does not confirm this. (2 jurors)

## The sentence
The idea shows a real problem in a striking way, but as a public headline it fails and should not go ahead as described. Demote it to one view inside the dashboards module, build the login drill-down first, and write the small-number rule before anyone sees the map. The record does not say how much time is left before the national round, so if those three steps cannot happen in time, leave the map out of the pitch.

_The full trial is in /Users/arihantjain/Desktop/SIH_FINAL/court-trials/5-india-map/.court/20261026-103453: the opening statements, the rebuttals and every juror's vote._

_Made with [/court](https://github.com/alexyc9381/court-skill), a free Claude Code skill by Alex Chen ([@nocodealex](https://instagram.com/nocodealex))._
