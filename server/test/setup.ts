import { config } from '../src/config.js';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Point every pool at the disposable test database before any module opens a connection.
process.env.DATABASE_URL_OVERRIDE = config.testDatabaseUrl;
process.env.NODE_ENV = 'test';
config.storageDir = path.join(os.tmpdir(), 'aicte-test-storage-' + crypto.randomUUID());

// Ordinary tests cannot contact or contaminate the development witness ledger.
config.witnessUrl='http://127.0.0.1:9';
config.witnessPublicKeyPath=path.join(config.storageDir,'missing-witness-public.pem');
