import { config } from '../src/config.js';

// Point every pool at the disposable test database before any module opens a connection.
process.env.DATABASE_URL_OVERRIDE = config.testDatabaseUrl;
process.env.NODE_ENV = 'test';
