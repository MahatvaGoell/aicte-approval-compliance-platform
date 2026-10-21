// Starts a local PostgreSQL server without Docker (real PostgreSQL binaries via embedded-postgres).
// Teammates with Docker can use docker-compose.yml instead; both listen on port 54329.
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../src/config.js';

const dataDir = path.join(repoRoot, 'var', 'pgdata');
const password = process.env.PG_SUPERUSER_PASSWORD ?? 'aicte_dev_password';

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'aicte',
  password,
  port: 54329,
  persistent: true,
  // Force UTF-8 regardless of the Windows code page; otherwise text such as "→" or Hindi fails to store.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => undefined,
});

async function main() {
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    console.log('Initialising PostgreSQL data directory at', dataDir);
    await pg.initialise();
  }
  await pg.start();
  for (const name of ['aicte', 'aicte_test']) {
    try {
      await pg.createDatabase(name);
      console.log('Created database', name);
    } catch {
      // already exists
    }
  }
  console.log('PostgreSQL ready on 127.0.0.1:54329 (databases: aicte, aicte_test). Press Ctrl+C to stop.');
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => undefined, 1 << 30);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
