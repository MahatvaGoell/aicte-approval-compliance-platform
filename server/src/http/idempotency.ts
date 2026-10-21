import type { Db } from '../db.js';
import { ConflictError, ValidationError, one, q } from '../db.js';
import { canonicalJson, sha256 } from '../lib/crypto.js';

/**
 * Runs `fn` at most once per (user, Idempotency-Key). Must be called inside the command's transaction:
 * a concurrent duplicate blocks on the key's unique index until the first commits, then replays its response.
 * If the transaction rolls back, the key is released and the client can retry.
 */
export async function withIdempotency<T>(
  tx: Db,
  userId: string,
  key: string | undefined,
  operation: string,
  body: unknown,
  fn: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new ValidationError('An Idempotency-Key header (8-128 characters) is required for this operation');
  }
  const requestHash = sha256(canonicalJson({ operation, body }));
  const inserted = await q(
    tx,
    `INSERT INTO idempotency_keys (user_id, key, operation, request_hash) VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING RETURNING key`,
    [userId, key, operation, requestHash],
  );
  if (inserted.length === 0) {
    const existing = await one(tx, 'SELECT * FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]);
    if (existing.request_hash !== requestHash) {
      throw new ConflictError('This Idempotency-Key was already used for a different request', { code: 'IDEMPOTENCY_KEY_REUSED' });
    }
    return { result: existing.response as T, replayed: true };
  }
  const result = await fn();
  await tx.query('UPDATE idempotency_keys SET status_code = 200, response = $3 WHERE user_id = $1 AND key = $2', [
    userId, key, JSON.stringify(result ?? null),
  ]);
  return { result, replayed: false };
}
