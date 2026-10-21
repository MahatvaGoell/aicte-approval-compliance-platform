import { buildApp } from './app.js';
import { config } from './config.js';

const app = await buildApp();
await app.listen({ port: config.port, host: '127.0.0.1' });
console.log(`API listening on http://127.0.0.1:${config.port} (demo mode: ${config.demoMode})`);
