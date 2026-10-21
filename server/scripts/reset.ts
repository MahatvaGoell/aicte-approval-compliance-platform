// Drops and recreates the database schema, then loads the synthetic seed. Never point this at real data.
import { config } from '../src/config.js';
import { closePool, withTx } from '../src/db.js';
import { dropAll, migrate } from '../src/migrate.js';
import { seedBase } from '../src/seed/base.js';

async function main() {
  if (!config.demoMode && process.env.ALLOW_RESET !== 'true') {
    throw new Error('Refusing to reset: DEMO_MODE is false. Set ALLOW_RESET=true only for disposable databases.');
  }
  await dropAll(config.databaseUrl);
  await migrate(config.databaseUrl);
  await withTx((tx) => seedBase(tx));
  await closePool();
  console.log('Database reset and seeded with synthetic demo data');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
