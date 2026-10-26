/** Maximum rows in one export. Larger results are refused rather than silently truncated, so a CSV always reconciles with its report. */
export const EXPORT_MAX_ROWS = 5000;

/**
 * One CSV cell. Values that a spreadsheet could read as a formula (leading = + - @, tab or carriage return) get a
 * leading apostrophe, then every cell is quoted with embedded quotes doubled.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // BOM so spreadsheet applications read the file as UTF-8; CRLF line ends per RFC 4180.
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
