# Known limitations and production requirements (draft)

Keep this file current at the end of every milestone.

## Prototype boundaries

- **Rules are demonstration rules.** Every route, checklist item, timeline and escalation interval is labelled `DEMO_ASSUMPTION`. None has been verified against the Approval Process Handbook 2024-27 or its amendments. A domain reviewer must confirm each rule before it is labelled `APH_CLAUSE`.
- **Synthetic data only.** Institutions, people, documents and addresses are fictional.
- **No live AICTE integration.** The mock adapter imports local synthetic JSON into separate mirror tables; B6b adds human reconciliation with retained raw records and immutable review history. There is no network connector, writeback or background import scheduler. Corrections cannot force old/conflicting identities or change local case decisions. Real integration needs an authorised API contract, identity federation and agreement on which system owns each field. See INTEGRATION_CONTRACT.md.
- **No real notifications.** The demo email adapter writes local files. SMS and WhatsApp are not implemented.
- **Document authenticity is not verified.** Upload checks inspect size, headers/extensions, encryption markers and rough PDF structure/page count; they are heuristic, not malware scanning or full parsing/render validation. SHA-256 checks byte integrity only. Metadata is manually confirmed. Issuer/registry verification is out of scope (PS 26261). Storage is a local private filesystem with bounded in-memory downloads.
- **PDF extraction remains suggestion-only and outside product flows.** C2 reads bounded text PDFs with English date-role rules, source excerpts and coarse text-item rectangles; no OCR, source-highlight UI, metadata confirmation wiring or measured accuracy exists yet. Image-only/partial/unsupported text requires OCR/manual review, with no guessed date. Worker V8/work budgets do not constitute a complete OS/native-memory sandbox. C1's 24 authored PDFs share renderer styles/prose and are not representative production or blinded benchmark data. See PDF_TEXT_EXTRACTION.md / EXTRACTION_DATASET.md.
- **Existing dependency advisories remain.** The current audit reports issues in pre-existing framework/tool/mail dependencies outside PDF.js. C2 does not perform unrelated forced upgrades; a separate reviewed dependency-maintenance step is needed before a real deployment.
- **Exactly-once external email is not guaranteed.** Internal alerts are deduplicated; a provider can accept a message whose acknowledgement is lost. Uncertain sends are reconciled and reported, not hidden.
- **Audit immutability is limited.** Application sessions cannot change audit rows. A superuser can rewrite a fully consistent local chain; signed checkpoints in the separate local witness detect a rewrite of an already witnessed prefix. The demo witness is on the same machine and does not protect against compromise of that machine/its keys. Events after the latest checkpoint remain unwitnessed. Production requires a witness operated by a separate organisation and protected keys/storage.
- **M6 reporting is bounded.** The original M6 reports and the two finale reports support scoped drill-down/CSV; exports above 5000 rows are rejected, not truncated. Dashboards poll every 30 seconds. Expiring-document drill-down, historical trends and escalation totals are explicitly unavailable; the underlying Documents/Notifications screens remain available. No load/performance claims have been measured in M6.
- **Login rate limiting is per API process and in memory.**
- **Single-region, single-node deployment.** Load results, once measured, apply only to the tested hardware and dataset.

## Production requirements

- Official identity provider (SSO) and MFA for privileged roles; reviewed delegation rules.
- Hosting approved by the sponsoring organisation; TLS everywhere; secrets in a managed store.
- Vulnerability assessment and penetration test; incident response ownership.
- Review of CERT-In directions (logging, clock synchronisation, incident reporting) and DPDP Act / Rules applicability for the deployment date.
- Data retention schedule, backups with tested restores, and protected audit checkpoint exports.
- Approved SMTP/SMS providers with delivery callbacks (signed and deduplicated).
- Accessibility audit against GIGW; the prototype follows it as a reference only.
- Domain validation of every workflow rule, committee constitution and decision authority with AICTE officials.

## Finale-specific boundaries

- Custody totals cover recorded calendar-date intervals in Asia/Kolkata; same-day transfers count zero. Incomplete history is disclosed and excluded, not inferred. This is accounting, not a regulatory delay prediction.
- Double claims use exact synthetic identities and declared periods under DEMO_ASSUMPTION exclusivity. No fuzzy matching, real-ID lookup, fraud accusation or automatic case outcome is implemented. Older pinned policies without the optional section remain unconfigured.
- Approval signatures use locally generated DEMO KEYS, with no external PKI or official issuer verification. Public checks expose only the signed issue fields and separately checked revocation/open conditions. A signature is not proof that a source document is authentic. Demo key rotation/recovery and production public-service rate limiting need a separately reviewed design.
- The public verification limiter is per API process and in memory. The witness is a loopback prototype with its own append-only JSONL; independent organisational operation, authenticated production transport, retention and disaster recovery are not claimed.
