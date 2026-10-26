# The verdict: GUILTY, 6 to 0

**The case:** Build a public "Verify this letter" page with a QR code on approval documents as a headline feature of ApprovalTrack for the SIH 2026 national round.

**The charge:** The case fails as stated: it should not go ahead the way it is described.

## How the jury voted

| Juror | Vote | Why |
|---|---|---|
| The Designer | GUILTY | "Scan to verify this letter" is easy to grasp in five seconds, but as the headline it tells a stranger that ApprovalTrack is a forgery checker for parents, when the problem it solves is approval files whose deadlines slip and that nobody clearly owns, so the clearest moment in the pitch tells the wrong story. |
| The Retired Judge | GUILTY | The case asks to make this the headline feature, but the reason for it is a claim with no source behind it, and the defense admitted every gap that matters: no evidence, no defined public boundary, and possibly no letter generation for the QR to sit on. A plan that rests on what the team hopes is true has not met its burden. |
| The Competitor | GUILTY | If a rival team showed up with this as their headline I would copy the QR-and-hash page in an afternoon, then beat them on the thing AICTE actually asked for, because their headline is a thin layer on a letter generator they have not built, while the core modules they promised are missing. |
| The Statistician | GUILTY | A headline feature built to fight forged letters needs some idea of how often forgeries happen, and with no count, no incident and no source there is no base rate at all, so the bet rests on a hunch and not on numbers. |
| The Teenager | GUILTY | Scanning a QR and getting a green tick is cool for about five seconds, but it's a tick on fake letters from a laptop that isn't even really public, so nobody's talking about it next week, and it definitely shouldn't be the headline. |
| The First-Time Customer | GUILTY | If I were a parent scanning that QR this week, a green tick from a student project's laptop that can only vouch for its own synthetic letters, not for anything AICTE actually issued, would not make me believe a letter any more than I already do, so as a headline it promises a trust I would not give it. |

## Charges that stuck

1. The QR page is the wrong headline, since the problem statement asks for workflow and alerts, not a forgery checker. (4 jurors)
2. It cannot reach the fake-letter problem: there is no AICTE link, and letter generation is not built. (4 jurors)
3. The motivation has no source, count or incident behind it. (2 jurors)

## What the defense got right

1. The audit chain is already built and tested, so an edited letter visibly failing the scan is cheap proof of real engineering.
2. Showing only genuine or not-genuine plus the hash answers the undefined public boundary, and the page never approves or rejects anything.

## Conditions for acquittal

1. Move the QR out of the headline into a demo beat that shows only genuine or not-genuine plus the hash, and script an edited-letter catch this week. (Jurors 1, 3, 6)
2. Find a cited source for forged AICTE letters, with a count or dated incident, and drop the claim if none exists. (Jurors 2, 4, 5)
3. Confirm the platform generates the letter the QR would sit on, or build the smallest generator that does. (Jurors 2, 5, 6)

## The sentence

Your idea survives as a demo, not a headline. Keep the workflow problem in front and show the QR check as proof that your audit chain catches tampering. Before spending build time, find a documented case of forged letters. The record does not say how much time is left before the national round, and without that you cannot judge whether this fits beside your six unbuilt modules. Find that number first.

_The full trial is in /Users/arihantjain/Desktop/SIH_FINAL/court-trials/2-verify-qr/.court/20261026-103453: the opening statements, the rebuttals and every juror's vote._

_Made with [/court](https://github.com/alexyc9381/court-skill), a free Claude Code skill by Alex Chen ([@nocodealex](https://instagram.com/nocodealex))._
