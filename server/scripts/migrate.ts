import { config } from '../src/config.js';
import { migrate } from '../src/migrate.js';

migrate(config.databaseUrl)
  .then(() => console.log('Migrations complete'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
