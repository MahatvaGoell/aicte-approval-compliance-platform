import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { AppError, NotFoundError, getPool, maybe, q, withTx } from '../../db.js';
import { actionContext, requireCapability } from '../../http/context.js';
import { now, refreshDemoOffset } from '../../lib/clock.js';
import { recordAudit } from '../audit/audit.js';
import { OutboxEmailAdapter } from '../notifications/email.js';
import { emailAdapter, runTick } from '../../worker/tick.js';

// Operations view for the system administrator: worker health, deliveries, demo clock, email outbox preview.

function requireDemo() {
  if (!config.demoMode) throw new NotFoundError('Not found');
}

export async function opsHealth(at: Date) {
  const db = getPool();
  const [heartbeats, deliveries, oldest, alerts, outbox, deadlines, lastRun] = await Promise.all([
    q(db, `SELECT worker_id, started_at, last_seen_at, last_tick FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 10`),
    q(db, `SELECT state, count(*)::int AS n FROM deliveries GROUP BY state`),
    q(db, `SELECT min(created_at) AS oldest FROM deliveries WHERE state IN ('PENDING','RETRYING','SENDING')`),
    q(db, `SELECT state, count(*)::int AS n FROM alert_events WHERE state IN ('MISSED','UNRESOLVED') GROUP BY state`),
    q(db, `SELECT count(*)::int AS n, min(created_at) AS oldest FROM outbox_events WHERE state = 'PENDING'`),
    q(db, `SELECT count(*) FILTER (WHERE state = 'ACTIVE')::int AS active, count(*) FILTER (WHERE state = 'PAUSED')::int AS paused,
                  count(*) FILTER (WHERE state = 'ACTIVE' AND current_due_at <= $1)::int AS overdue FROM deadlines`, [at]),
    maybe(db, `SELECT value FROM system_settings WHERE key = 'scheduler_last_run_at'`),
  ]);
  const byState = Object.fromEntries(deliveries.map((d) => [d.state, d.n]));
  const alertsByState = Object.fromEntries(alerts.map((a) => [a.state, a.n]));
  const oldestPending = oldest[0].oldest ? new Date(oldest[0].oldest) : null;
  return {
    businessTime: at,
    demoMode: config.demoMode,
    emailAdapter: emailAdapter().name,
    schedulerLastRunAt: lastRun?.value ?? null,
    workers: heartbeats.map((h) => ({
      workerId: h.worker_id, startedAt: h.started_at, lastSeenAt: h.last_seen_at,
      // Heartbeats use real time, not the demo clock.
      healthy: Date.now() - new Date(h.last_seen_at).getTime() < 30_000, lastTick: h.last_tick,
    })),
    deliveries: {
      byState,
      pending: (byState.PENDING ?? 0) + (byState.RETRYING ?? 0) + (byState.SENDING ?? 0),
      failed: (byState.BOUNCED ?? 0) + (byState.DEAD ?? 0),
      oldestPendingAgeSeconds: oldestPending ? Math.max(0, Math.round((at.getTime() - oldestPending.getTime()) / 1000)) : null,
    },
    alerts: { missedSteps: alertsByState.MISSED ?? 0, unresolvedRecipients: alertsByState.UNRESOLVED ?? 0 },
    outbox: { pending: outbox[0].n, oldest: outbox[0].oldest },
    deadlines: deadlines[0],
  };
}

async function clockState() {
  await refreshDemoOffset(getPool());
  const row = await maybe(getPool(), `SELECT value FROM system_settings WHERE key = 'demo_clock_offset_ms'`);
  const offsetMs = row ? Number(row.value) : 0;
  return { demoMode: config.demoMode, offsetMs, offsetDays: offsetMs / 86_400_000, businessTime: now(), realTime: new Date() };
}

export async function opsRoutes(app: FastifyInstance) {
  app.get('/ops/health', async (req) => {
    requireCapability(req, 'OPS_VIEW');
    return opsHealth(now());
  });

  app.get('/ops/deliveries', async (req) => {
    requireCapability(req, 'OPS_VIEW');
    const f = z.object({ state: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    return q(
      getPool(),
      `SELECT d.id, d.to_address, d.subject, d.state, d.attempts, d.max_attempts, d.next_attempt_at, d.provider_ref, d.duplicate_suppressed,
              d.last_error, d.created_at, d.updated_at, n.application_id, a.app_no,
              (SELECT json_agg(json_build_object('attempt', x.attempt_no, 'at', x.at, 'outcome', x.outcome, 'detail', x.detail) ORDER BY x.id)
                 FROM delivery_attempts x WHERE x.delivery_id = d.id) AS attempt_log
         FROM deliveries d JOIN notifications n ON n.id = d.notification_id LEFT JOIN applications a ON a.id = n.application_id
        ${f.state ? 'WHERE d.state = $1' : ''} ORDER BY d.updated_at DESC LIMIT ${f.limit}`,
      f.state ? [f.state] : [],
    );
  });

  // Puts a delivery that ran out of attempts back in the queue. A permanent bounce is not retried: the
  // address must be corrected first.
  app.post<{ Params: { id: string } }>('/ops/deliveries/:id/retry', async (req) => {
    requireCapability(req, 'OPS_VIEW');
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new NotFoundError('Delivery not found');
    const ctx = actionContext(req);
    return withTx(async (tx) => {
      const d = await maybe(tx, 'SELECT * FROM deliveries WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!d) throw new NotFoundError('Delivery not found');
      if (d.state !== 'DEAD') throw new AppError(409, 'NOT_RETRYABLE', d.state === 'BOUNCED' ? 'A permanent bounce is not retried; correct the address first' : `A ${d.state.toLowerCase()} delivery cannot be retried`);
      await tx.query(`UPDATE deliveries SET state = 'RETRYING', max_attempts = attempts + 3, next_attempt_at = $2, updated_at = $2 WHERE id = $1`, [d.id, ctx.at]);
      await recordAudit(tx, ctx, { entityType: 'delivery', entityId: d.id, action: 'DELIVERY_REQUEUED', before: { state: d.state }, after: { state: 'RETRYING' }, reason: 'Requeued from the operations view' });
      return { id: d.id, state: 'RETRYING' };
    });
  });

  app.get('/ops/clock', async (req) => {
    requireCapability(req, 'OPS_VIEW');
    return clockState();
  });

  // Demo clock: only in demo mode, only for the DEMO_CLOCK capability, always audited and shown in the banner.
  app.post('/ops/clock', async (req) => {
    requireCapability(req, 'DEMO_CLOCK');
    requireDemo();
    const body = z.discriminatedUnion('action', [
      z.object({ action: z.literal('advance'), days: z.number().min(-365).max(365) }),
      z.object({ action: z.literal('set'), offsetDays: z.number().min(-365).max(3650) }),
      z.object({ action: z.literal('reset') }),
    ]).parse(req.body);
    const before = await clockState();
    const offsetMs = body.action === 'reset' ? 0
      : body.action === 'set' ? Math.round(body.offsetDays * 86_400_000)
      : before.offsetMs + Math.round(body.days * 86_400_000);
    if (offsetMs < 0) throw new AppError(422, 'CLOCK_BEFORE_REAL_TIME', 'The demo clock cannot run behind real time');
    await withTx(async (tx) => {
      await tx.query(`INSERT INTO system_settings (key, value) VALUES ('demo_clock_offset_ms', $1)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(offsetMs)]);
      await recordAudit(tx, actionContext(req), {
        entityType: 'system_setting', entityId: 'demo_clock_offset_ms', action: 'DEMO_CLOCK_CHANGED',
        before: { offsetMs: before.offsetMs }, after: { offsetMs }, reason: `Demo clock ${body.action}`,
      });
    });
    return clockState();
  });

  // Runs one pass of background work now (demo mode), so a presenter does not wait for the worker.
  app.post('/ops/tick', async (req: FastifyRequest) => {
    requireCapability(req, 'OPS_VIEW');
    requireDemo();
    return runTick('api-manual-tick', { reconcile: true });
  });

  app.get('/ops/outbox', async (req) => {
    requireCapability(req, 'OPS_VIEW');
    requireDemo();
    const adapter = emailAdapter();
    if (!(adapter instanceof OutboxEmailAdapter)) return { adapter: adapter.name, files: [] };
    return { adapter: adapter.name, files: await adapter.list(100) };
  });

  app.get<{ Params: { file: string } }>('/ops/outbox/:file', async (req) => {
    requireCapability(req, 'OPS_VIEW');
    requireDemo();
    const adapter = emailAdapter();
    if (!(adapter instanceof OutboxEmailAdapter)) throw new NotFoundError('Not found');
    try {
      return { file: req.params.file, raw: await adapter.read(req.params.file) };
    } catch {
      throw new NotFoundError('Message not found');
    }
  });
}
