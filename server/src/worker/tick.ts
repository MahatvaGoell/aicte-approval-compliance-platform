import os from 'node:os';
import { config } from '../config.js';
import { getPool, withTx } from '../db.js';
import { now, refreshDemoOffset } from '../lib/clock.js';
import { reconcileDeadlines, scanDeadlines } from '../modules/deadlines/scheduler.js';
import type { EmailAdapter } from '../modules/notifications/email.js';
import { createEmailAdapter } from '../modules/notifications/email.js';
import { deliverEmails, processOutbox } from '../modules/notifications/worker.js';
import { reconcileDocumentStorage } from '../modules/documents/service.js';

// One pass of background work. The worker process runs it in a loop; demo mode can also trigger it from the
// operations screen so a presentation does not depend on timing.

let adapter: EmailAdapter | null = null;
export function emailAdapter() {
  adapter ??= createEmailAdapter(config);
  return adapter;
}
export function setEmailAdapter(a: EmailAdapter | null) {
  adapter = a;
}

export const defaultWorkerId = () => `${os.hostname()}:${process.pid}`;

export async function heartbeat(workerId: string, startedAt: Date, lastTick: unknown) {
  await withTx((tx) => tx.query(
    `INSERT INTO worker_heartbeats (worker_id, started_at, last_seen_at, last_tick) VALUES ($1,$2,now(),$3)
     ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = now(), last_tick = EXCLUDED.last_tick`,
    [workerId, startedAt, JSON.stringify(lastTick)],
  ));
}

export async function runTick(workerId = defaultWorkerId(), opts: { reconcile?: boolean } = {}) {
  await refreshDemoOffset(getPool());
  const at = now();
  const outbox = await processOutbox(at);
  const scan = await scanDeadlines(at);
  // Notifications created by the scan are delivered in the same pass.
  const outbox2 = await processOutbox(at);
  const delivery = await deliverEmails(emailAdapter(), at, workerId);
  const reconcile = opts.reconcile ? await reconcileDeadlines(at) : null;
  const storage = opts.reconcile ? await reconcileDocumentStorage() : null;
  await withTx((tx) => tx.query(`INSERT INTO system_settings (key, value) VALUES ('scheduler_last_run_at', $1)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(at.toISOString())]));
  return { at, outbox: { events: outbox.events + outbox2.events, notified: outbox.notified + outbox2.notified }, scan, delivery, reconcile, storage };
}
