# Mock portal integration — contract v1 (B6a/B6b)

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

## Human reconciliation (B6b)

**GET /integration/reconciliation** (`INTEGRATION_VIEW`): filters `regionId`, `runId` (UUID), `state=OPEN|RESOLVED|DISMISSED|ALL` (default OPEN), `reasonCode`, `page` (1–100000), `pageSize` (1–100). Returns scoped `{mock,connected:false,notice,provenance,total,page,pageSize,rows,refreshedAt}`. Each row includes item/run/source IDs, original reason, mapping, state/version and latest attempt outcome. Counts and rows share one read snapshot. Out-of-scope filters return empty results.

**GET /integration/reconciliation/:id** (`INTEGRATION_VIEW`): independently scopes the item (404 outside scope), then returns `item`, `raw`, `runCounts`, `currentMirror`, pinned `statusCodes`, visible `institutionOptions` and immutable ordered `attempts`. `item.rowVersion` and `item.cursorVersion` are the current mutation versions; `canResolve`, `canCorrect`, `canCorrectInstitution` describe available review fields. Raw JSON/hash/receipt, original validation and import outcome remain visible. `runCounts` are historical import counts, separate from current queue-state counts.

**POST /integration/reconciliation/:id/resolve** (`INTEGRATION_RESOLVE`, regional visibility, demo mode): same CSRF and idempotency headers as sync. Example:

```json
{
  "action": "CORRECT_AND_RETRY",
  "expectedVersion": 1,
  "expectedCursorVersion": 1,
  "reason": "Reviewed the synthetic export and confirmed the received source code.",
  "corrections": {"statusCode": "RECEIVED"}
}
```

Use versions from the current detail response. `reason` is required (10–2000 characters). Actions:

| Action | Effect |
|---|---|
| RETRY | Revalidate the retained original record against its pinned mapping and current mirror ordering. No corrections body. |
| CORRECT_AND_RETRY | Apply only explicit reviewed `title`, `statusCode`, `sourceUpdatedAt`, `institutionCode` fields to a separate evaluated copy; revalidate before mirror application. At least one correction required. |
| DISMISS | Close the queue item with a reason; leave the mirror unchanged. No corrections body. |

Source system/external/event IDs and revision cannot be edited or invented. Existing institution bindings are fixed; an originally unmapped institution may be corrected only to a visible institution in the same region. Unknown codes require an explicit reviewed mapping choice; they are never silently coerced. Corrections preserve unexpected original keys, so an injected local authority field still fails validation. Conflicting identities, old revisions, changed bindings and regressing source times cannot bypass the importer guards. The original mapping document stays pinned and immutable.

Response: `{mock,connected:false,notice,provenance,item:{id,state,rowVersion},attempt:{id,outcome,reasonCode},syncState:{regionId,rowVersion},replayed}`. Outcomes are APPLIED (queue RESOLVED), STILL_BLOCKED (queue stays OPEN, reason/details retained), or DISMISSED. Every committed attempt advances item **and regional cursor** versions, including blocked retries/dismissals. Both sync and review must use the latest regional cursor; stale item/cursor returns 409 with no partial change. Same-key/body replay returns the recorded result after current capability/scope checks, even after closure; changed body/key reuse and new attempts on closed items conflict.

Source lock precedes audit lock. Attempt, mirror, queue, cursor, idempotency, audit and outbox are one transaction. An immutable attempt retains action/outcome/reason, actor/time, original item/cursor versions, evaluated copy, explicit corrections, pinned mapping/canonical IDs and mirror before/after where evaluated. Original raw/canonical events and run counts never change. A corrected mirror points to `latest_resolution_id`; a later valid source revision clears that current pointer while preserving all review attempts. Reviews emit a generic outbox event without source content and send no email.

Web `/integration` provides sync, historical runs, filtered/paged queue, raw/detail and reasoned reviews/history. Auditors/authorities can inspect only. Regional officers/bureau can review their active scope. Institutions and other excluded roles have no integration access. Run `npm -w server run test -- test/m6-reconciliation.test.ts` for 18 B6b tests. This remains a bounded local mock, with no live portal connection, writeback or background import scheduler.
