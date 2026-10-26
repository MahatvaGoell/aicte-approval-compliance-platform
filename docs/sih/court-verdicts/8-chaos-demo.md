# The verdict: GUILTY, 4 to 2

**The case:** Build a live "chaos demo" of reliability as a headline feature of ApprovalTrack for the SIH 2026 national round.

**The charge:** The case fails as stated: it should not go ahead the way it is described.

## How the jury voted

| Juror | Vote | Why |
|---|---|---|
| The Designer | GUILTY | A stranger watching a process get killed and restarted would not see in five seconds that this is about AICTE approvals no longer slipping, and the on-screen proof (a verify display and a lost/duplicate counter) is not shown to exist, so as described it is a headline about plumbing. |
| The Retired Judge | NOT GUILTY | The prosecution has shown that the crash-recovery claim is unproven, but unproven is not the same as failed, and every cost it names (time, build work, stage risk) is a guess the record cannot price, so it has not met its burden to show the plan should not go ahead. |
| The Competitor | GUILTY | As a rival I would not fear a team that spends its headline minute on a worker restart that any Postgres-backed queue can copy in a weekend, while six modules on its own deck (dashboards, EVC scheduling, document tracking and the rest) are still missing, and I would out-demo it by showing the whole platform. |
| The Statistician | GUILTY | A single rehearsed kill-and-restart is a sample of one, and the record offers no count of how many crash timings were tried, so making it the headline stakes the national demo on an untested path. |
| The Teenager | NOT GUILTY | Every approval-tracker demo is the same screens and tables, so the one moment where they kill the thing on stage and it just keeps going is the only bit anyone would actually remember or talk about afterwards. |
| The First-Time Customer | GUILTY | As someone who has never seen this product, I would buy it because it stops approvals slipping and shows me one view of who owns the next action, and a staged worker crash as the headline tells me about plumbing instead of that. |

## Charges that stuck

1. The headline is plumbing, not the pain: a worker restart does not show approvals stopping from slipping. (Jurors 1, 3, 6.)
2. The crash path is not shown to work, and the record does not say it has ever been tested. (Jurors 3, 4, 6.)
3. The proof is not built, since the audit viewer and the six deck modules are still unbuilt. (Jurors 1, 3.)

## What the defense got right

1. The cost is low and the fallback is safe, because the deadline engine and audit chain already exist, so this is mostly rehearsal, and a failed test means cutting the moment.
2. It proves the failure the problem names, since a lost or doubled reminder is exactly a deadline slipping.

## Conditions for acquittal

1. **Put the crash inside a deadline story.** Show a slipping deadline reaching its owner, with a plain "reminders due / sent / duplicates: 0" counter and the crash as a short beat.
2. **Break it off stage first.** Kill the worker many times at varied timings, including between sending and recording a reminder, and log zero losses or duplicates.
3. **Show a verify result that works.** Build a minimal audit-check screen and confirm it passes before the round.

## The sentence

The case fails as it stands, but the fix is framing, testing and one small screen. Make the crash a short beat in the ownership story, and run the kill off stage until it loses nothing. If one reminder is lost or doubled, cut the moment. The record does not say how much time remains, so start this week, and do not headline this until the evidence is in.

_The full trial is in /Users/arihantjain/Desktop/SIH_FINAL/court-trials/8-chaos-demo/.court/20261026-103454: the opening statements, the rebuttals and every juror's vote._

_Made with [/court](https://github.com/alexyc9381/court-skill), a free Claude Code skill by Alex Chen ([@nocodealex](https://instagram.com/nocodealex))._
