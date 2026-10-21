# Pitch outline (draft)

For the SIH 2026 jury on problem statement SIH26262. Update the numbers only from `docs/EVALUATION.md` once Milestone 8 produces it; until then, no figures go on a slide.

## One-line description

A platform that runs every AICTE approval file and every follow-up obligation on configured, versioned rules, shows who owns the next action and when it is due, chases deadlines automatically, and leaves every decision with the competent authority.

## Slides (SIH six-slide spine, plus appendix)

1. **Title** — PS 26262, team, theme Smart Automation. Line: "Rules that run themselves, decisions that stay human."
2. **Problem and solution**
   - Today: pendency, EVC scheduling, undertakings and lease renewals are followed up by phone and email.
   - Our answer in one diagram: Route → Clock → Escalate → Watch → Prove.
   - Anchor feature: the traceable obligation and evidence register (decision → condition → obligation → deadline → reminders → submission → exact document version → verification → closure).
   - One real quote from the college AICTE coordinator interview (to be collected).
3. **Technical approach**
   - Versioned policy as data (routes, checklists, deadlines, escalation ladders), every rule labelled APH clause / admin instruction / demo assumption.
   - Command-based workflow: authorisation, scope, version check, audit and outbox in one transaction.
   - Durable deadline engine on PostgreSQL with restart recovery and duplicate suppression.
   - Hash-chained audit log with an integrity check.
   - Stack: React, TypeScript, Fastify, PostgreSQL. No paid services; runs offline.
4. **Feasibility and safeguards**
   - The system never approves, rejects or penalises. Escalation only notifies.
   - Integration through documented adapters (mock adapter today), external-ID mapping and reconciliation; no claim of live AICTE connectivity.
   - Deny-by-default access by institution, region and assignment; tested with direct API attempts.
   - Open-source, self-hostable, synthetic data only in the prototype.
5. **Impact**
   - Map to the PS expected outcomes: less manual follow-up, fewer missed deadlines and expired documents, visible pendency, accountability through audit.
   - Show only measured prototype results with their test conditions. No projected national savings.
6. **Research and references** — APH 2024-27 and amendments, problem statement, interview, published EoA/SAC/SHC formats studied.

**Appendix:** data model, permission matrix, deadline maths examples, test matrix results, security controls, integration contract, limitations.

## Demo order (7 minutes)

See BUILD_PLAN.md §19. Open on an overdue case and its action panel; finish on the audit integrity check and a blocked unauthorised action.

## Likely questions

| Question | Answer to give |
|---|---|
| Can it approve applications? | No. Only a user holding the decision capability records decisions; the system routes, reminds and summarises. |
| What if the APH changes? | Publish a new policy version. Existing cases stay on their version unless an authorised migration is recorded. |
| Are you connected to AICTE? | No. A mock adapter shows the contract, ID mapping and reconciliation. Real integration needs AICTE's authorised API. |
| What if the scheduler is down? | Deadlines are rows in the database; the worker recovers on restart and sends only the current alert, recording missed thresholds. |
| What if a renewal is uploaded just before expiry? | Submission time, document validity and verification state are tracked separately; uploading never counts as verified. |
| How do you know it saves time? | We report only measured results on defined tasks; real savings need a pilot. |
