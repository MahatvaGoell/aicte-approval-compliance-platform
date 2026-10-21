import { closePool, q, getPool, withTx } from '../src/db.js';
import { seedBase } from '../src/seed/base.js';

async function main() {
  const existing = await q(getPool(), 'SELECT count(*)::int AS n FROM users');
  if (existing[0].n > 0) {
    console.log('Database already has users; run "npm run db:reset" to start from a clean synthetic seed.');
  } else {
    await withTx((tx) => seedBase(tx));
    console.log('Seeded synthetic demo data');
  }
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
