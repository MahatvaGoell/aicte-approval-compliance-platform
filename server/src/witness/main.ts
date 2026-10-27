import path from 'node:path';
import {repoRoot} from '../config.js';
import {createWitness} from './server.js';
const app=await createWitness(path.join(repoRoot,'var','witness'));
await app.listen({host:'127.0.0.1',port:4100});
console.log('Local demo witness ready at http://127.0.0.1:4100. It never reads the main database.');
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>app.close().then(()=>process.exit(0)));
