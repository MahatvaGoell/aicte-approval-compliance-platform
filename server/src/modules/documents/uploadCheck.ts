// Upload checks run on the bytes, never on the client's declared type alone.
// Passing these checks means "acceptable file", not "genuine document": authenticity needs issuer verification.

export type AllowedType = 'application/pdf' | 'image/png' | 'image/jpeg';

export interface UploadLimits {
  maxBytes: number;
  maxPdfPages: number;
  allowed: AllowedType[];
}

export const DEFAULT_LIMITS: UploadLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxPdfPages: 200,
  allowed: ['application/pdf', 'image/png', 'image/jpeg'],
};

export interface UploadProblem {
  code: 'EMPTY' | 'TOO_LARGE' | 'TYPE_NOT_ALLOWED' | 'EXTENSION_MISMATCH' | 'PDF_ENCRYPTED' | 'PDF_DAMAGED' | 'TOO_MANY_PAGES';
  message: string;
}

export interface UploadInspection {
  ok: boolean;
  detectedType: AllowedType | null;
  safeFilename: string;
  sizeBytes: number;
  pdfPageEstimate: number | null;
  problems: UploadProblem[];
}

const EXTENSIONS: Record<AllowedType, string[]> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
};

export function detectType(buf: Buffer): AllowedType | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Strips any path, keeps a conservative character set and bounds the length. Display only; never a storage key. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.normalize('NFKC').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '').replace(/\s+/g, ' ').trim();
  const bounded = cleaned.length > 120 ? cleaned.slice(0, 80) + cleaned.slice(-40) : cleaned;
  return bounded || 'document';
}

function extensionOf(name: string) {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** Rough page count from page objects; enough to enforce a processing limit, not to render. */
function estimatePdfPages(text: string): number {
  return (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

export function inspectUpload(buf: Buffer, declaredName: string, limits: UploadLimits = DEFAULT_LIMITS): UploadInspection {
  const problems: UploadProblem[] = [];
  const safeFilename = sanitizeFilename(declaredName);
  if (buf.length === 0) {
    return { ok: false, detectedType: null, safeFilename, sizeBytes: 0, pdfPageEstimate: null, problems: [{ code: 'EMPTY', message: 'The file is empty' }] };
  }
  if (buf.length > limits.maxBytes) {
    problems.push({ code: 'TOO_LARGE', message: `The file is larger than ${Math.round(limits.maxBytes / 1024 / 1024)} MB` });
  }
  const detected = detectType(buf);
  if (!detected || !limits.allowed.includes(detected)) {
    problems.push({ code: 'TYPE_NOT_ALLOWED', message: 'Only PDF, PNG and JPEG files are accepted' });
  } else if (!EXTENSIONS[detected].includes(extensionOf(safeFilename))) {
    problems.push({ code: 'EXTENSION_MISMATCH', message: `The file content is ${detected} but the name ends in ".${extensionOf(safeFilename) || '(none)'}"` });
  }
  let pages: number | null = null;
  if (detected === 'application/pdf') {
    const text = buf.toString('latin1');
    if (/\/Encrypt\b/.test(text)) problems.push({ code: 'PDF_ENCRYPTED', message: 'Password-protected or encrypted PDFs cannot be accepted' });
    if (!text.slice(-2048).includes('%%EOF')) problems.push({ code: 'PDF_DAMAGED', message: 'The PDF appears to be incomplete or damaged' });
    pages = estimatePdfPages(text);
    if (pages > limits.maxPdfPages) problems.push({ code: 'TOO_MANY_PAGES', message: `The PDF has more than ${limits.maxPdfPages} pages` });
  }
  return { ok: problems.length === 0, detectedType: detected, safeFilename, sizeBytes: buf.length, pdfPageEstimate: pages, problems };
}
