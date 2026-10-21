import type { Db } from '../../db.js';
import type { ActionContext } from '../audit/audit.js';

/**
 * Records a domain event in the same transaction as the change that caused it (transactional outbox).
 * If the transaction commits, the event exists; the worker turns events into notifications and jobs.
 */
export async function emitEvent(
  tx: Db,
  ctx: ActionContext,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
) {
  await tx.query(
    `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload, correlation_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [eventType, aggregateType, aggregateId, JSON.stringify(payload), ctx.correlationId, ctx.at.toISOString()],
  );
}
