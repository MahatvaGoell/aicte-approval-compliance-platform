# The verdict: GUILTY, 6 to 0

**The case:** Build a 10,000-application simulation with what-if policy analysis as a headline feature of ApprovalTrack for the SIH 2026 national round.

**The charge:** The case fails as stated: it should not go ahead the way it is described.

## How the jury voted

| Juror | Vote | Why |
|---|---|---|
| The Designer | GUILTY | A stranger can't get this in five seconds: "pendency falls X% under synthetic inputs we chose, for a capacity knob the product doesn't model, shown on dashboards that don't exist" takes a paragraph of caveats to explain, and it hides the product's clear story of one view of who owns the next action. |
| The Retired Judge | GUILTY | The defense is asking me to accept, on hope, the very capability the feature rests on: by its own admission the record never shows the engine can run a simulated year quickly and in isolation, or that it models EVC capacity at all, and an unproven foundation cannot carry a headline feature. |
| The Competitor | GUILTY | As the rival team, I'd ignore the simulation: I can fake the same what-if chart from a simple queue model on invented inputs in a day, because their "measured" numbers are invented inputs too. Then I'd beat them where the judges compare deck to demo, on the dashboards and document tracking they promised and haven't built. |
| The Statistician | GUILTY | Running 10,000 synthetic files gives precise-looking numbers, but they are not a sample of anything, so where pendency "builds up" and how much a 20% EVC rise cuts it just play back the team's own chosen settings, and calling that "measured" invites a regulator judge to throw out the whole feature. |
| The Teenager | GUILTY | A slider that makes 10,000 fake files pile up looks cool for about thirty seconds, but once a judge asks where the numbers came from and the honest answer is "we made them up," nobody's talking about it next week, and right now it doesn't even have a screen to show up on. |
| The First-Time Customer | GUILTY | Seeing this for the first time, I would not believe a headline "pendency falls X%" when the team picked every input itself, and a synthetic label does not make me trust it more than the phone-and-spreadsheet follow-up I already know. |

## Charges that stuck

1. The results replay the team's own inputs, which are all invented, so "pendency falls X%" proves nothing about the real system. (5 jurors)
2. The results have no screen to appear on, because the dashboards and document tracking they would use are not built yet. (3 jurors)
3. The headline lever is missing: EVC capacity is not modelled and EVC scheduling is not built. (2 jurors)

## What the defense got right

1. It reuses a tested engine: five configurable routes, the deadline engine and 99 passing automated tests. This is new use of working code, not a new product.
2. Framed as comparisons under stated inputs and labelled synthetic, the output is honest about its limits and follows the team's own labelling rule.

## Conditions for acquittal

1. Prove the engine can run a simulated year on a fake clock, against a separate database, with no writes to the real audit log or outbox, and with EVC capacity set as a stage setting. (2 jurors)
2. Cite a public source for each input, or label it "demo assumption" on screen. If no public figure exists, say so. (2 jurors)
3. Replace the single headline with a before-and-after on one rule change the system already versions, with every assumption printed on that screen. (1 juror)

## The sentence

Do not go ahead as described. Build the proof first: the existing engine running a simulated year, with every input either sourced or labelled as an assumption. Until then, drop the "pendency falls X%" headline and show a before-and-after on one rule change instead. A regulator will trust a run you can show, not numbers you chose.

_The full trial is in /Users/arihantjain/Desktop/SIH_FINAL/court-trials/4-simulation/.court/20261026-103453: the opening statements, the rebuttals and every juror's vote._

_Made with [/court](https://github.com/alexyc9381/court-skill), a free Claude Code skill by Alex Chen ([@nocodealex](https://instagram.com/nocodealex))._
