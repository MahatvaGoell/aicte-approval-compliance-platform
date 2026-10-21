import pg from 'pg';
import { config } from './config.js';

// Return dates as plain 'YYYY-MM-DD' strings instead of shifting them through local time.
pg.types.setTypeParser(1082, (v) => v);
// bigint ids (audit, jobs) fit comfortably in JS numbers at prototype scale.
pg.types.setTypeParser(20, (v) => Number(v));

export type Db = pg.Pool | pg.PoolClient;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_OVERRIDE ?? config.databaseUrl, max: 20 });
  }
  return pool;
}

export function setPool(p: pg.Pool) {
  pool = p;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function q<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query(sql, params as any[]);
  return res.rows as T[];
}

export async function one<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const rows = await q<T>(db, sql, params);
  if (rows.length === 0) throw new NotFoundError('Record not found');
  return rows[0];
}

export async function maybe<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(db, sql, params);
  return rows[0] ?? null;
}

/** Runs fn inside a transaction. All state changes and their audit events share this transaction. */
export async function withTx<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = 'You are not permitted to perform this action') {
    super(403, 'FORBIDDEN', message);
  }
}
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, 'CONFLICT', message, details);
  }
}
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(422, 'VALIDATION_FAILED', message, details);
  }
}
