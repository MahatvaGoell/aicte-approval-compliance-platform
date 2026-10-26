# Known limitations and production requirements (draft)

Keep this file current at the end of every milestone.

## Prototype boundaries

- **Rules are demonstration rules.** Every route, checklist item, timeline and escalation interval is labelled `DEMO_ASSUMPTION`. None has been verified against the Approval Process Handbook 2024-27 or its amendments. A domain reviewer must confirm each rule before it is labelled `APH_CLAUSE`.
- **Synthetic data only.** Institutions, people, documents and addresses are fictional.
- **No live AICTE integration.** The B6a mock adapter imports local synthetic JSON into separate mirror tables; reconciliation UI/resolution remains B6b. There is no network connector or writeback. Real integration needs an authorised API contract, identity federation and agreement on which system owns each field. See INTEGRATION_CONTRACT.md.
- **No real notifications.** The demo email adapter writes local files. SMS and WhatsApp are not implemented.
- **Document authenticity is not verified.** Upload checks inspect size, headers/extensions, encryption markers and rough PDF structure/page count; they are heuristic, not malware scanning or full parsing/render validation. SHA-256 checks byte integrity only. Metadata is manually confirmed. Issuer/registry verification is out of scope (PS 26261). Storage is a local private filesystem with bounded in-memory downloads.
- **Exactly-once external email is not guaranteed.** Internal alerts are deduplicated; a provider can accept a message whose acknowledgement is lost. Uncertain sends are reconciled and reported, not hidden.
- **Audit immutability is limited.** Application sessions cannot change audit rows, and the hash chain detects changes, but a database superuser can still alter data. Independent checkpoint export is a production requirement.
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
