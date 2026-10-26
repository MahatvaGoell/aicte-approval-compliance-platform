// Dataset tooling only. No Python/PDF dependency is loaded by the API, web or ordinary npm tests.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(python, [fileURLToPath(new URL('./generate.py', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) console.error(`Cannot start ${python}: ${result.error.message}. See docs/EXTRACTION_DATASET.md for Python/Poppler setup.`);
process.exitCode = result.status ?? 1;
