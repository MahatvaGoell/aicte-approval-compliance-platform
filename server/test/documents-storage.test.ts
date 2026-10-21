import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestUpload, LocalStorageAdapter } from '../src/modules/documents/storage.js';
import { DEFAULT_LIMITS, detectType, inspectUpload, sanitizeFilename } from '../src/modules/documents/uploadCheck.js';

// Minimal synthetic files built in memory; no real documents are used.
const pdf = (body = '1 0 obj << /Type /Page >> endobj', end = '%%EOF') => Buffer.from(`%PDF-1.4\n${body}\ntrailer << >>\n${end}\n`, 'latin1');
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);

describe('upload inspection (S03)', () => {
  it('detects types from content, not from the name', () => {
    expect(detectType(pdf())).toBe('application/pdf');
    expect(detectType(png)).toBe('image/png');
    expect(detectType(jpeg)).toBe('image/jpeg');
    expect(detectType(Buffer.from('MZ\x90\x00 executable'))).toBeNull();
  });

  it('accepts a well-formed PDF and counts pages', () => {
    const r = inspectUpload(pdf('1 0 obj << /Type /Page >> endobj 2 0 obj << /Type /Page >> endobj 3 0 obj << /Type /Pages >> endobj'), 'lease-deed.pdf');
    expect(r.ok).toBe(true);
    expect(r.pdfPageEstimate).toBe(2);
  });

  it('rejects a disguised executable', () => {
    const r = inspectUpload(Buffer.from('MZ fake program'), 'lease.pdf');
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.code)).toContain('TYPE_NOT_ALLOWED');
  });

  it('rejects content that does not match the extension', () => {
    expect(inspectUpload(png, 'lease.pdf').problems.map((p) => p.code)).toContain('EXTENSION_MISMATCH');
    expect(inspectUpload(jpeg, 'photo.jpeg').ok).toBe(true);
  });

  it('rejects empty, oversized, encrypted, damaged and very long PDFs', () => {
    expect(inspectUpload(Buffer.alloc(0), 'x.pdf').problems[0].code).toBe('EMPTY');
    expect(inspectUpload(pdf(), 'x.pdf', { ...DEFAULT_LIMITS, maxBytes: 10 }).problems.map((p) => p.code)).toContain('TOO_LARGE');
    expect(inspectUpload(pdf('<< /Encrypt 5 0 R >>'), 'x.pdf').problems.map((p) => p.code)).toContain('PDF_ENCRYPTED');
    expect(inspectUpload(pdf(undefined, ''), 'x.pdf').problems.map((p) => p.code)).toContain('PDF_DAMAGED');
    const many = pdf(Array.from({ length: 5 }, (_, i) => `${i} 0 obj << /Type /Page >> endobj`).join('\n'));
    expect(inspectUpload(many, 'x.pdf', { ...DEFAULT_LIMITS, maxPdfPages: 3 }).problems.map((p) => p.code)).toContain('TOO_MANY_PAGES');
  });

  it('sanitises file names for display', () => {
    expect(sanitizeFilename('..\\..\\windows\\system32\\evil.pdf')).toBe('evil.pdf');
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('lease<script>.pdf')).toBe('lease_script_.pdf');
    expect(sanitizeFilename('')).toBe('document');
    expect(sanitizeFilename('a'.repeat(300) + '.pdf').length).toBeLessThanOrEqual(120);
  });
});

describe('private storage with quarantine', () => {
  let root: string;
  let storage: LocalStorageAdapter;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-test-'));
    storage = new LocalStorageAdapter(root);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('promotes an accepted file to object storage under a random key and returns its hash', async () => {
    const r = await ingestUpload(storage, pdf(), 'Lease Deed.pdf');
    expect(r.accepted).toBe(true);
    if (!r.accepted) return;
    expect(r.storageKey).toMatch(/^[0-9a-f]{32}$/);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await storage.exists('objects', r.storageKey)).toBe(true);
    expect(await storage.exists('quarantine', r.storageKey)).toBe(false);
    expect((await storage.read('objects', r.storageKey)).equals(pdf())).toBe(true);
  });

  it('deletes a rejected file from quarantine and stores nothing', async () => {
    const r = await ingestUpload(storage, Buffer.from('MZ not a document'), 'lease.pdf');
    expect(r.accepted).toBe(false);
    const leftovers = await fs.readdir(path.join(root, 'quarantine'), { recursive: true }).catch(() => []);
    expect(leftovers.filter((f) => /[0-9a-f]{32}$/.test(String(f)))).toHaveLength(0);
  });

  it('never overwrites an existing object: each upload gets a new key', async () => {
    const a = await ingestUpload(storage, pdf(), 'a.pdf');
    const b = await ingestUpload(storage, pdf(), 'a.pdf');
    expect(a.accepted && b.accepted).toBe(true);
    if (a.accepted && b.accepted) {
      expect(a.storageKey).not.toBe(b.storageKey);
      expect(a.sha256).toBe(b.sha256); // identical bytes, identical hash
    }
  });

  it('refuses keys that could escape the storage folder', async () => {
    await expect(storage.read('objects', '../../secret')).rejects.toThrow('Invalid storage key');
    await expect(storage.read('nope' as any, 'a'.repeat(32))).rejects.toThrow('Invalid storage area');
  });
});
