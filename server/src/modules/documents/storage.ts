import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../../lib/crypto.js';
import { inspectUpload, type UploadInspection, type UploadLimits, DEFAULT_LIMITS } from './uploadCheck.js';

// Private document storage. Objects are stored under random keys (never the user's filename) and are
// served only through an authorised API endpoint. Replace LocalStorageAdapter with an S3-compatible
// adapter for deployment; callers depend only on StorageAdapter.

export type StorageArea = 'quarantine' | 'objects';

export interface StorageAdapter {
  readonly name: string;
  put(area: StorageArea, data: Buffer): Promise<string>;
  move(key: string, from: StorageArea, to: StorageArea): Promise<void>;
  read(area: StorageArea, key: string): Promise<Buffer>;
  remove(area: StorageArea, key: string): Promise<void>;
  exists(area: StorageArea, key: string): Promise<boolean>;
  inventory?(area: StorageArea): Promise<Array<{ key: string; modifiedAt: Date }>>;
}

const KEY_RE = /^[0-9a-f]{32}$/;

export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'local';
  constructor(private root: string) {}

  private file(area: StorageArea, key: string) {
    if (!KEY_RE.test(key)) throw new Error('Invalid storage key');
    if (area !== 'quarantine' && area !== 'objects') throw new Error('Invalid storage area');
    // Two-character fan-out keeps directories small.
    return path.join(this.root, area, key.slice(0, 2), key);
  }

  async put(area: StorageArea, data: Buffer): Promise<string> {
    const key = crypto.randomBytes(16).toString('hex');
    const file = this.file(area, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data, { flag: 'wx', mode: 0o600 });
    return key;
  }

  async move(key: string, from: StorageArea, to: StorageArea) {
    const dest = this.file(to, key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(this.file(from, key), dest);
  }

  async read(area: StorageArea, key: string) {
    return fs.readFile(this.file(area, key));
  }

  async remove(area: StorageArea, key: string) {
    await fs.rm(this.file(area, key), { force: true });
  }

  async exists(area: StorageArea, key: string) {
    try {
      await fs.access(this.file(area, key));
      return true;
    } catch {
      return false;
    }
  }

  async inventory(area: StorageArea) {
    const rows: Array<{ key: string; modifiedAt: Date }> = [];
    const dir = path.join(this.root, area);
    const prefixes = await fs.readdir(dir, { withFileTypes: true }).catch((e) => { if (e.code === 'ENOENT') return []; throw e; });
    for (const prefix of prefixes) if (prefix.isDirectory() && /^[0-9a-f]{2}$/.test(prefix.name)) {
      for (const name of await fs.readdir(path.join(dir, prefix.name))) if (KEY_RE.test(name) && name.startsWith(prefix.name)) {
        const stat = await fs.stat(this.file(area, name)); if (stat.isFile()) rows.push({ key: name, modifiedAt: stat.mtime });
      }
    }
    return rows;
  }
}

export type IngestResult =
  | { accepted: true; storageKey: string; sha256: string; inspection: UploadInspection }
  | { accepted: false; inspection: UploadInspection };

/**
 * Quarantine → inspect → promote. Rejected files are deleted from quarantine and never reach object storage.
 * The returned hash identifies identical bytes; it does not establish that a document is genuine.
 */
export async function ingestUpload(storage: StorageAdapter, data: Buffer, declaredName: string, limits: UploadLimits = DEFAULT_LIMITS): Promise<IngestResult> {
  if (data.length > limits.maxBytes) {
    // Do not even write oversized bodies to disk.
    return { accepted: false, inspection: inspectUpload(data, declaredName, limits) };
  }
  const key = await storage.put('quarantine', data);
  try {
    const stored = await storage.read('quarantine', key);
    const inspection = inspectUpload(stored, declaredName, limits);
    if (!inspection.ok) {
      await storage.remove('quarantine', key);
      return { accepted: false, inspection };
    }
    await storage.move(key, 'quarantine', 'objects');
    return { accepted: true, storageKey: key, sha256: sha256(stored), inspection };
  } catch (err) {
    await storage.remove('quarantine', key).catch(() => undefined);
    await storage.remove('objects', key).catch(() => undefined);
    throw err;
  }
}
