import 'dotenv/config';
import { config } from '../config.js';
import { closePool } from '../db.js';
import { defaultWorkerId, heartbeat, runTick } from './tick.js';

// Background worker: outbox → notifications, deadline scan, email delivery, periodic reconciliation.
// Safe to run several copies: every claim uses row locks with SKIP LOCKED and unique keys.

const workerId = defaultWorkerId();
const startedAt = new Date();
let stopping = false;
let ticks = 0;

async function loop() {
  console.log(`worker ${workerId} started (poll ${config.workerPollMs} ms)`);
  while (!stopping) {
    try {
      const r = await runTick(workerId, { reconcile: ticks % 60 === 0 });
      ticks++;
      await heartbeat(workerId, startedAt, r);
      const busy = r.scan.alerts + r.scan.missed + r.delivery.claimed + r.outbox.events;
      if (busy) console.log(new Date().toISOString(), JSON.stringify({ outbox: r.outbox, scan: r.scan, delivery: r.delivery }));
    } catch (err) {
      console.error('tick failed:', err instanceof Error ? err.message : err);
    }
    await new Promise((res) => setTimeout(res, config.workerPollMs));
  }
  await closePool();
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stopping = true; });
loop();
