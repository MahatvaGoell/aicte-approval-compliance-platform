import { canonicalJson } from '../../lib/crypto.js';

// Structured, human-readable difference between two policy documents. Pure: used by the API, the
// policy screens and tests. Works on raw documents so a draft that does not validate can still be compared.

export interface PolicyChange {
  section: 'meta' | 'calendar' | 'holidays' | 'categories' | 'classification' | 'routes' | 'stages' | 'checklist' | 'decision' | 'appeal' | 'evc';
  key: string;
  change: 'added' | 'removed' | 'changed';
  summary: string;
  fields?: Array<{ field: string; before: unknown; after: unknown }>;
}

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

function show(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.length ? v.join(', ') : '(none)';
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  }
  return String(v);
}

function fieldChanges(a: Record<string, any>, b: Record<string, any>, ignore: string[] = []) {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((k) => !ignore.includes(k)).sort();
  return keys.filter((k) => !same(a?.[k], b?.[k])).map((k) => ({ field: k, before: a?.[k], after: b?.[k] }));
}

function describe(fields: Array<{ field: string; before: unknown; after: unknown }>) {
  return fields.map((f) => `${f.field}: ${show(f.before)} → ${show(f.after)}`).join('; ');
}

function keyed(
  out: PolicyChange[],
  section: PolicyChange['section'],
  label: string,
  before: Record<string, any>,
  after: Record<string, any>,
  ignore: string[] = [],
) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    if (a && !b) out.push({ section, key: k, change: 'removed', summary: `${label} ${k} removed` });
    else if (!a && b) out.push({ section, key: k, change: 'added', summary: `${label} ${k} added${b.name ? ` (${b.name})` : ''}` });
    else {
      const fields = fieldChanges(a, b, ignore);
      if (fields.length) out.push({ section, key: k, change: 'changed', summary: `${label} ${k}: ${describe(fields)}`, fields });
    }
  }
}

const byKey = <T extends Record<string, any>>(list: T[] | undefined, key: keyof T) =>
  Object.fromEntries((list ?? []).map((x) => [String(x[key]), x]));

export function diffPolicies(before: any, after: any): PolicyChange[] {
  const out: PolicyChange[] = [];
  const meta = fieldChanges(
    { title: before?.title, academicYear: before?.academicYear, schemaVersion: before?.schemaVersion },
    { title: after?.title, academicYear: after?.academicYear, schemaVersion: after?.schemaVersion },
  );
  if (meta.length) out.push({ section: 'meta', key: 'document', change: 'changed', summary: describe(meta), fields: meta });

  const cal = fieldChanges(before?.calendar ?? {}, after?.calendar ?? {}, ['holidays']);
  if (cal.length) out.push({ section: 'calendar', key: 'calendar', change: 'changed', summary: `Calendar: ${describe(cal)}`, fields: cal });
  keyed(out, 'holidays', 'Holiday', byKey(before?.calendar?.holidays, 'date'), byKey(after?.calendar?.holidays, 'date'));

  keyed(out, 'categories', 'Category', byKey(before?.categories, 'code'), byKey(after?.categories, 'code'));
  keyed(out, 'classification', 'Classification rule', byKey(before?.classification, 'id'), byKey(after?.classification, 'id'));
  keyed(out, 'routes', 'Route', before?.routes ?? {}, after?.routes ?? {});
  keyed(out, 'stages', 'Stage', before?.stages ?? {}, after?.stages ?? {}, ['checklist']);

  const items = (doc: any) => {
    const m: Record<string, any> = {};
    for (const [stageKey, st] of Object.entries<any>(doc?.stages ?? {})) {
      for (const item of st.checklist ?? []) m[`${stageKey}/${item.code}`] = item;
    }
    return m;
  };
  keyed(out, 'checklist', 'Checklist item', items(before), items(after));

  const dec = fieldChanges(before?.decision ?? {}, after?.decision ?? {});
  if (dec.length) out.push({ section: 'decision', key: 'decision', change: 'changed', summary: `Decision: ${describe(dec)}`, fields: dec });

  if (before?.appeal && !after?.appeal) out.push({ section: 'appeal', key: 'appeal', change: 'removed', summary: 'Appeal configuration removed' });
  else if (!before?.appeal && after?.appeal) out.push({ section: 'appeal', key: 'appeal', change: 'added', summary: `Appeal route ${after.appeal.routeKey} added` });
  else if (before?.appeal) {
    const ap = fieldChanges(before.appeal, after.appeal);
    if (ap.length) out.push({ section: 'appeal', key: 'appeal', change: 'changed', summary: `Appeal: ${describe(ap)}`, fields: ap });
  }
  const evc = fieldChanges(before?.evc ?? {}, after?.evc ?? {});
  if (evc.length) out.push({ section: 'evc', key: 'evc', change: 'changed', summary: `EVC: ${describe(evc)}`, fields: evc });
  return out;
}
