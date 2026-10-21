import { config } from '../config.js';
import type { Db } from '../db.js';

/**
 * The single source of "now" for business logic. Nothing in the domain calls Date.now() directly,
 * which is what makes the labelled demo clock and deterministic tests possible.
 *
 * - Production (DEMO_MODE=false): real time, the stored offset is ignored.
 * - Demo mode: real time plus an administrator-set offset kept in system_settings.
 * - Tests: a fixed instant set with setTestNow().
 */
let testNow: Date | null = null;
let cachedOffsetMs = 0;
let cachedAt = 0;

export function setTestNow(d: Date | null) {
  testNow = d;
}

export function advanceTestNow(ms: number) {
  if (!testNow) throw new Error('advanceTestNow requires setTestNow first');
  testNow = new Date(testNow.getTime() + ms);
}

export async function refreshDemoOffset(db: Db) {
  if (!config.demoMode) {
    cachedOffsetMs = 0;
    return 0;
  }
  const res = await db.query(`SELECT value FROM system_settings WHERE key = 'demo_clock_offset_ms'`);
  cachedOffsetMs = res.rows[0] ? Number(res.rows[0].value) : 0;
  cachedAt = Date.now();
  return cachedOffsetMs;
}

/** Current business time. Call refreshDemoOffset at request/tick start; cached value used otherwise. */
export function now(): Date {
  if (testNow) return new Date(testNow.getTime());
  return new Date(Date.now() + (config.demoMode ? cachedOffsetMs : 0));
}

export function demoOffsetMs() {
  return config.demoMode && !testNow ? cachedOffsetMs : 0;
}

export function offsetCacheAgeMs() {
  return Date.now() - cachedAt;
}
