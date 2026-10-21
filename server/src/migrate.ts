import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { repoRoot } from './config.js';

const migrationsDir = path.join(repoRoot, 'server', 'migrations');

/** Applies pending SQL migrations in filename order, each in its own transaction. */
export async function migrate(connectionString: string, log = console.log) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const enc = (await client.query('SHOW server_encoding')).rows[0].server_encoding;
    if (enc !== 'UTF8') {
      throw new Error(`Database encoding is ${enc}; UTF8 is required. Recreate the database with UTF8 encoding.`);
    }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

/** Drops everything in the public schema. Used by db:reset and the test harness only. */
export async function dropAll(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await client.end();
  }
}
