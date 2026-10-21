# Instructions for coding agents

Read [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) (the specification) and [docs/PROGRESS.md](docs/PROGRESS.md) (what is done) before changing anything.

## Non-negotiable product rules

- The system never approves, rejects or penalises. Only a user with the `DECISION_RECORD` capability records decisions. Escalations only notify.
- Every rule carries provenance: `APH_CLAUSE`, `ADMIN_INSTRUCTION` or `DEMO_ASSUMPTION`. Never present a demo rule or timeline as an AICTE rule.
- Approval outcome, compliance status and lifecycle are separate fields. Upload ≠ verification ≠ closure.
- Each case keeps the policy version it started on.
- All data is synthetic. Never send real emails or call real external services.

## Engineering conventions (follow the existing code)

- Every state change and its `recordAudit(...)` call happen in the **same transaction** (`withTx`). Side effects for later processing go through `emitEvent(...)` (outbox) in that transaction.
- Case transitions go only through `POST /api/v1/applications/:id/commands`. Add a new command to `COMMANDS` in `server/src/modules/applications/commands.ts` with a `guard` (no input; drives "permitted actions") and a `run`. No generic status-update endpoints.
- Mutations require an `Idempotency-Key` (`withIdempotency`) and an `expectedVersion` (optimistic concurrency, `row_version`).
- Permissions: capabilities in `server/src/modules/identity/permissions.ts`; scope queries with `applicationScopeSql` / `institutionScopeSql`. Out-of-scope records return 404, not 403.
- Time: always use `now()` from `server/src/lib/clock.ts`, never `new Date()` for business logic.
- Schema changes: add a new numbered file in `server/migrations/` (do not edit `001_init.sql`).
- Errors: throw `AppError` subclasses from `server/src/db.ts`; they become `{ error: { code, message, details, correlationId } }`.
- Validation: Zod at the API boundary; policy documents validated by `validatePolicy`.
- Web: data via TanStack Query and `web/src/api.ts`; reuse `Status`, `Loading`, `ErrorState`, `MutationError` from `web/src/ui.tsx`; colours only through CSS tokens in `styles.css`; status always shown as text plus colour.

## Checks before you finish

```bash
npm run typecheck
npm test
```

All tests must pass. Add tests for new behaviour (see `server/test/`), named after the test IDs in BUILD_PLAN.md §20 where they apply.

Local database: `npm run db:start` (embedded PostgreSQL on 54329) or `docker compose up -d db`, then `npm run db:reset`. The database must be UTF8.
