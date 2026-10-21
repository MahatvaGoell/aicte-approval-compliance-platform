import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EmailDeliveryError, OutboxEmailAdapter, retryDelayMs } from '../src/modules/notifications/email.js';

let dir: string;
let adapter: OutboxEmailAdapter;
const msg = (over: Partial<{ messageId: string; to: string; subject: string; text: string }> = {}) => ({
  messageId: 'n-123', to: 'office.pune@demo.aicte.test', subject: 'Reminder: scrutiny due', text: 'Body text', ...over,
});

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'outbox-test-'));
  adapter = new OutboxEmailAdapter({
    dir, from: 'Demo <no-reply@demo.aicte.test>', transientFailureDomains: ['flaky.demo.test'], permanentFailureDomains: ['bounce.demo.test'],
  });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('outbox email adapter', () => {
  it('writes the message to a local .eml file and marks it as not delivered', async () => {
    const r = await adapter.send(msg(), 1);
    expect(r).toEqual({ outcome: 'ACCEPTED', providerRef: 'n-123.eml', duplicate: false });
    const content = await adapter.read('n-123.eml');
    expect(content).toContain('To: office.pune@demo.aicte.test');
    expect(content).toContain('X-Demo-Outbox: not delivered');
    expect(await adapter.list()).toEqual(['n-123.eml']);
  });

  it('does not create a second message when the same id is sent again (N03)', async () => {
    await adapter.send(msg(), 1);
    const again = await adapter.send(msg(), 2);
    expect(again.duplicate).toBe(true);
    const both = await Promise.all([adapter.send(msg({ messageId: 'n-200' }), 1), adapter.send(msg({ messageId: 'n-200' }), 1)]);
    expect(both.filter((b) => !b.duplicate)).toHaveLength(1);
    expect((await adapter.list()).sort()).toEqual(['n-123.eml', 'n-200.eml']);
  });

  it('simulates temporary failures that succeed on a later attempt', async () => {
    const m = msg({ messageId: 'n-flaky', to: 'someone@flaky.demo.test' });
    await expect(adapter.send(m, 1)).rejects.toMatchObject({ permanent: false });
    await expect(adapter.send(m, 2)).rejects.toMatchObject({ permanent: false });
    expect((await adapter.send(m, 3)).outcome).toBe('ACCEPTED');
  });

  it('simulates a permanent bounce (N04)', async () => {
    const err = await adapter.send(msg({ to: 'x@bounce.demo.test' }), 1).catch((e) => e);
    expect(err).toBeInstanceOf(EmailDeliveryError);
    expect(err.permanent).toBe(true);
  });

  it('rejects header injection and invalid addresses as permanent failures', async () => {
    await expect(adapter.send(msg({ subject: 'Hi\r\nBcc: victim@example.com' }), 1)).rejects.toMatchObject({ permanent: true });
    await expect(adapter.send(msg({ to: 'not-an-address' }), 1)).rejects.toMatchObject({ permanent: true });
    await expect(adapter.send(msg({ messageId: '../escape' }), 1)).rejects.toMatchObject({ permanent: true });
    await expect(adapter.read('../secret.eml')).rejects.toThrow();
  });

  it('returns an empty list when nothing has been written', async () => {
    const empty = new OutboxEmailAdapter({ dir: path.join(dir, 'missing'), from: 'x <x@demo.aicte.test>' });
    expect(await empty.list()).toEqual([]);
  });
});

describe('retry backoff', () => {
  it('doubles from one minute and caps at one hour', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});
