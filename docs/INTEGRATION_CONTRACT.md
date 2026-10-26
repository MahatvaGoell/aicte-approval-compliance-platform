# Mock portal integration — contract v1 (B6a)

**Disconnected, synthetic, demonstration only.** This adapter reads a checked-in fixture or supplied synthetic JSON. It has no network client, credentials, live AICTE/NSWS connection, scraping or writeback. All source codes/mappings below are `DEMO_ASSUMPTION`, not official AICTE rules.

## Scope and authority

Each run belongs to one authorised region. Regional officers can view/sync their regions; bureau officers can view/sync all regions. Auditors and competent authorities can view only. Institutions, committee members and system/policy administrators receive no integration capability. An extra integration capability alone does not grant regional application visibility.

| Field | Authority | Import behaviour |
|---|---|---|
| External ID / event ID / revision | Mock source | Retained in immutable canonical source-event history |
| Institution code | Local institution register resolves the synthetic source code | Exact `aicte_permanent_id` lookup, current scope and selected region checked |
| Source title / status / updated-at | Mock source | Updates `integration_mirrors` only, with source-labelled status |
| Mapping version | Local versioned mock contract | Run pins `mock-portal-v1`; mapping document is retained and update/delete protected |
| Receipt time / run counts / cursor | Local importer | `now()`, transactionally recorded; source timestamps never become receipt time |
| Local application identity, snapshot, workflow/lifecycle, decision, policy, obligation, verified document and deadlines | Existing authorised local workflows | Never updated by this adapter; unexpected source fields are invalid |

`COMPLETE` maps to **SOURCE_REPORTED_COMPLETE**, not a local approval. The importer has no case-command execution path. Any future case mutation must use a separately permitted case import command and existing capability/authority checks.

## Source record

```json
{
  "externalId": "DEMO-WEST-LEASE",
  "eventId": "west-lease-1",
  "revision": 1,
  "institutionCode": "DEMO-1-10001",
  "sourceUpdatedAt": "2026-10-01T10:00:00+05:30",
  "fields": {"title": "Synthetic Pune lease export", "statusCode": "RECEIVED"}
}
```

- Identifiers use 1–100 ASCII letters, digits, `.`, `_`, `:`, `-`. Revision is a positive 32-bit integer. Gaps are allowed; revision is not inferred from receipt time.
- Institution codes must start with `DEMO-`. Title has 3–200 characters. Source timestamp must be an ISO instant with timezone. Both the record and `fields` are strict objects: local decision/lifecycle/policy/obligation keys are invalid. Title content is untrusted text, never an instruction. There is no URL/path adapter option.
- `mock-portal-v1` maps `RECEIVED` → `SOURCE_RECEIVED`, `PROCESSING` → `SOURCE_PROCESSING`, `COMPLETE` → `SOURCE_REPORTED_COMPLETE`. Unknown codes are retained for reconciliation, never coerced to a known state.

## API

Existing demo login/session and CSRF rules apply. Base path `/api/v1`.

**GET /integration/runs** (`INTEGRATION_VIEW`): optional `regionId`, `sourceSystem=MOCK_PORTAL`, `page` (1–100000), `pageSize` (1–100). Returns `{mock, connected:false, notice, provenance, mappingVersion, total, page, pageSize, rows, refreshedAt, syncStates}`. Rows contain run IDs, region, pinned mapping, timestamps, input kind, totals and `{accepted, duplicate, invalid, reconciliation}` counts; no raw payload. Totals, rows and cursors share the active scope and one read snapshot. A region outside scope yields no rows/cursors. `syncStates[].rowVersion` starts at 0 when that region has not synced.

**POST /integration/sync** (`INTEGRATION_RESOLVE`, regional visibility, demo mode): requires `Idempotency-Key` (8–128 characters), `x-requested-with: aicte-web`, and:

```json
{
  "sourceSystem": "MOCK_PORTAL",
  "regionId": "DEMO-WEST",
  "expectedVersion": 0,
  "reason": "Import the synthetic fixture into the disconnected source mirror.",
  "fixture": "portal-export"
}
```

Use the current `rowVersion` from GET, not a hard-coded 0 on later runs. `sourceSystem` defaults to MOCK_PORTAL. Choose the fixed fixture name (default when events are absent) **or** `events: [...]` with 1–500 synthetic records. No caller-provided path or URL. API body limit remains 1 MB. A fixture run selects only records tagged with its region, without exposing another region's skipped count.

Response: `{mock, connected:false, notice, run:{id, sourceSystem, regionId, mappingVersion, state, total, counts, startedAt, completedAt}, syncState:{regionId,rowVersion}, replayed}`. A new committed run increments the regional cursor once. Same key/body replays the original result, with current scope rechecked. Another key with a stale cursor returns 409. Invalid envelopes/filters return 422; forbidden capabilities 403; outside-region targets, cross-region source identities and scoped unmatched institution codes 404. Only all-region operators may retain truly unmatched institution codes for reconciliation. Known institutions in a different selected region always return 404.

## Processing and recovery

Every observation has immutable parsed raw JSON, SHA-256 of canonical JSON, ordinal and local receipt time, linked to its run/mapping. This retains duplicate, malformed and conflicting rows too; it does not claim preservation of original transport whitespace/key order.

Canonical identities are unique by `(source system, external ID, event ID)` and separately `(source system, external ID, revision)`. First-seen addressable events remain recorded even if invalid or queued. Reusing either identity with changed contents is an identity conflict. Repeated identical canonical payloads, including previously invalid/conflicting observations, are duplicates: another raw receipt is retained, but no mirror update or additional reconciliation item is created.

An accepted higher revision updates only mirror title/status/source-time and its latest-source-event pointer; source history remains. Lower/equal revisions cannot overwrite it. A newer revision with a regressing timestamp, or a change to an accepted institution binding, is queued. Source identities cannot move across regions.

| Outcome | Meaning | Creates an OPEN reconciliation item? |
|---|---|---|
| ACCEPTED | Valid/mapped source fields applied to mirror | No |
| DUPLICATE | Same payload already observed in this source/region | No |
| INVALID | Missing/bad identity, invalid shape/date or forbidden field | Yes |
| RECONCILIATION | Unknown code/institution, conflicting identity/binding, old revision or regressing source time | Yes |

All counters are mutually exclusive and sum to `total`; invalid rows are not counted again as reconciliation. Their queue items still exist for review. Stable reason codes are `INVALID_IDENTITY`, `INVALID_RECORD`, `UNKNOWN_CODE`, `INSTITUTION_UNMAPPED`, `IDENTITY_CONFLICT`, `INSTITUTION_BINDING_CONFLICT`, `OUT_OF_ORDER`, `SOURCE_TIME_REGRESSION`. Validation details and source content remain in the linked raw/item records.

A source advisory transaction lock serialises identity allocation across regions; the cursor version rejects stale same-region requests. Lock order for future resolution code: integration source lock before audit lock. Raw/canonical records, mirror, queue, run totals, cursor, idempotency response, audit and outbox commit together. Failed transactions leave none of those changes and the same key can retry. Completed runs, mapping documents and source histories have update/delete guards; a database superuser can bypass application protections.

Each observation and completed run is audited. One generic `INTEGRATION_SYNC_COMPLETED` outbox event records run counts; it contains no source document/title and triggers no external service or email. Audit's application-less import events remain visible only to all-region audit grants under B5's rules.

## Fixture and checks

`server/fixtures/portal-export.json` has 11 synthetic records across three regions. Fresh results:

| Region | Total | Accepted | Duplicate | Invalid | Reconciliation |
|---|---:|---:|---:|---:|---:|
| DEMO-WEST | 8 | 2 | 1 | 2 | 3 |
| DEMO-NORTH | 2 | 2 | 0 | 0 | 0 |
| DEMO-SOUTH | 1 | 1 | 0 | 0 | 0 |

West has valid/changed/duplicate records, malformed content, an unknown code, a late revision, conflicting event reuse and an invalid authority-field injection. New-key West retry: 0 accepted, 8 duplicates, 0 invalid, 0 reconciliation; mirror/queue unchanged. Run `npm -w server run test -- test/m6-integration.test.ts` for 16 B6a acceptance tests, including concurrency, full rollback and local-state isolation.

B6b remains pending: scoped reconciliation API, reasoned/versioned resolve/retry and Integration web page. B6a creates queue records but exposes no resolution action or integration UI. This is an atomic, bounded local mock importer, not a production connector or background import scheduler.
