# Foundation modules for Milestones 3 and 5

Built in parallel with Milestone 2 on branch `foundations-m3-m5`. They are pure or adapter-level modules with tests and no schema changes, so M3 and M5 can wire them in without redesigning them. Nothing in M1/M2 calls them yet.

Current integration: M3 uses the calendar/email adapters; M5 uses quarantine upload checks and private storage. M5 adds optional inventory for orphan reconciliation, operational-time grace, scoped hash-checked downloads and database-backed immutable versions. See PROGRESS.md for acceptance tests and limitations.

| Module | File | Tests | Used by |
|---|---|---|---|
| Deadline calendar | `server/src/modules/deadlines/calendar.ts` | `server/test/calendar.test.ts` (14) | M3 deadline engine, M7 policy preview, ageing in dashboards |
| Email adapters | `server/src/modules/notifications/email.ts` | `server/test/email.test.ts` (7) | M3 notification delivery worker, outbox preview screen |
| Upload checks | `server/src/modules/documents/uploadCheck.ts` | `server/test/documents-storage.test.ts` (10, shared) | M5 document upload endpoint |
| Private storage | `server/src/modules/documents/storage.ts` | same file | M5 document versions, authorised download |

These tests need no database.

## Deadline calendar (`calendar.ts`)

Conventions, which M3 should keep:
- Local dates are `YYYY-MM-DD` in the policy's time zone; instants are stored in UTC.
- Counting starts the day after the anchor event.
- Something due on a date is met until the end of that local day. `dueAt` is the **exclusive** instant (next local midnight). A document *valid through* a date expires at the same instant (`validityExpiresAt`).

Functions:
- `computeDue(anchor, { amount, unit, rollForwardToWorkingDay? }, calendar)` → `dueDate`, `dueAt`, skipped weekends/holidays, roll-forward and a plain-language `text`. Store the whole result as the deadline's `explanation` JSON.
- Units: `WORKING_DAYS`, `CALENDAR_DAYS`, `CALENDAR_MONTHS` (month-end clamp: 31 Jan + 1 month = 28/29 Feb).
- `workingDaysPaused` / `calendarDaysPaused` and `extendDueDateByWorkingDays` for pause/resume: on resume, extend the due date by the working days lost, and record a `deadline_adjustments` row.
- `elapsedDays(from, to, cal, unit, pauses)` for ageing that excludes institution-response time.
- `overdueDays(dueAt, now)`.
- `ladderStepAt(dueDate, offsetDays, tz)`: when an escalation step fires. Negative = before the due date (start of that local day); `0` = the moment the deadline passes; `+n` = n days after.

The calendar comes from the pinned policy version (`policy.doc.calendar`), so a case keeps the calendar it started with.

## Email adapters (`email.ts`)

- `createEmailAdapter(config)` returns the outbox adapter (default, `EMAIL_ADAPTER=outbox`) or SMTP (`EMAIL_ADAPTER=smtp` + `SMTP_URL`).
- `send(message, attemptNo)` resolves `{ outcome: 'ACCEPTED', providerRef, duplicate }` or throws `EmailDeliveryError` with `permanent: true|false`. Retry only when `permanent` is false; use `retryDelayMs(attemptNo)` for backoff; move to a dead state after the configured max attempts.
- `messageId` must be stable per notification (use the notification id). The outbox adapter refuses to write the same id twice and reports `duplicate: true`, which models provider idempotency for the "worker died after send" case (N03). Never claim exactly-once external delivery.
- "Accepted" is not "delivered". Show them separately.
- Demo failure simulation from `.env`: `EMAIL_TRANSIENT_FAILURE_DOMAINS` (fails the first 2 attempts) and `EMAIL_PERMANENT_FAILURE_DOMAINS` (always bounces). Give one seeded contact an address at each domain for the N04 demo.
- `OutboxEmailAdapter.list()` / `read(file)` back the "Email outbox (local preview)" screen. Gate that route behind demo mode and an admin capability.
- Reminders must not contain attachments or sensitive case details; link to the case instead.

## Upload checks and storage (`uploadCheck.ts`, `storage.ts`)

- `ingestUpload(storage, bytes, declaredName, limits)` does quarantine → inspect → promote. Rejected files are deleted and never reach object storage. Returns `storageKey` (random, 32 hex) and `sha256`.
- Accepted types: PDF, PNG, JPEG, detected from file content. The extension must match. Encrypted, damaged, empty, oversized or very long PDFs are rejected with specific problem codes for the UI.
- `sanitizeFilename` is for display only. The storage key is never derived from the user's filename.
- Downloads go through an API route that rechecks the caller's current scope and SHA-256, then returns bounded bytes from `storage.read('objects', key)` with `Content-Disposition: attachment` and the detected type. M5 buffers files within the configured upload bound; it is not a streaming object-storage implementation.
- The hash proves identical bytes, not authenticity. Document authenticity is out of scope (that is PS 26261).
- Wire `MAX_UPLOAD_MB` from config into `limits.maxBytes`, and set the Fastify multipart limit to the same value so oversized bodies are cut off before buffering.
- For deployment, add an S3-compatible `StorageAdapter`; callers only depend on the interface.

## Notes for whoever merges this

- Only new files were added; no existing file was changed, so there should be no conflicts with Milestone 2.
- After merging, add these modules to `docs/PROGRESS.md`, link `docs/FOUNDATIONS.md`, `docs/PITCH.md` and `docs/LIMITATIONS.md` from the README, and mention them in the Milestone 3 prompt.
