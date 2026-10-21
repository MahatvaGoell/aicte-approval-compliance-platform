import type { PolicyDocument, Predicate, StageDef } from './schema.js';

// Pure functions over a policy document. No database access, so preview and simulation reuse them.

export function ruleRef(versionNo: number, path: string) {
  return `policy v${versionNo} · ${path}`;
}

function getField(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as any)[key] : undefined), obj);
}

export function evaluatePredicate(p: Predicate, input: Record<string, unknown>): boolean {
  const v = getField(input, p.field);
  switch (p.op) {
    case 'eq': return v === p.value;
    case 'neq': return v !== p.value;
    case 'in': return Array.isArray(p.value) && p.value.includes(v);
    case 'gt': return typeof v === 'number' && v > Number(p.value);
    case 'gte': return typeof v === 'number' && v >= Number(p.value);
    case 'lt': return typeof v === 'number' && v < Number(p.value);
    case 'lte': return typeof v === 'number' && v <= Number(p.value);
    case 'exists': return v !== undefined && v !== null && v !== '';
    case 'isTrue': return v === true;
    case 'isFalse': return v === false || v === undefined;
  }
}

export interface ClassificationTrace {
  status: 'CLASSIFIED' | 'NO_MATCH' | 'AMBIGUOUS';
  routeKey: string | null;
  matchedRuleId: string | null;
  ruleRef: string | null;
  provenance: string | null;
  evaluated: Array<{
    ruleId: string;
    routeKey: string;
    priority: number;
    matched: boolean;
    predicates: Array<{ field: string; op: string; value: unknown; actual: unknown; result: boolean }>;
  }>;
  explanation: string;
}

/** Picks the route for a proposal. Never guesses: no match or a tie means manual classification. */
export function classify(
  doc: PolicyDocument,
  versionNo: number,
  proposal: { categoryCode: string; details: Record<string, unknown> },
): ClassificationTrace {
  const evaluated = doc.classification
    .filter((r) => r.categoryCode === proposal.categoryCode)
    .map((r) => {
      const predicates = r.when.map((p) => ({
        field: p.field,
        op: p.op,
        value: p.value,
        actual: getField(proposal.details, p.field) ?? null,
        result: evaluatePredicate(p, proposal.details),
      }));
      return { ruleId: r.id, routeKey: r.routeKey, priority: r.priority, matched: predicates.every((x) => x.result), predicates };
    });
  const matched = evaluated.filter((e) => e.matched);
  if (matched.length === 0) {
    return {
      status: 'NO_MATCH', routeKey: null, matchedRuleId: null, ruleRef: null, provenance: null, evaluated,
      explanation: `No classification rule in policy v${versionNo} matches category ${proposal.categoryCode}. The application waits for an authorised officer to classify it.`,
    };
  }
  const top = Math.max(...matched.map((m) => m.priority));
  const best = matched.filter((m) => m.priority === top);
  const routes = new Set(best.map((b) => b.routeKey));
  if (routes.size > 1) {
    return {
      status: 'AMBIGUOUS', routeKey: null, matchedRuleId: null, ruleRef: null, provenance: null, evaluated,
      explanation: `Rules ${best.map((b) => b.ruleId).join(', ')} match with equal priority but select different routes. The application waits for an authorised officer to classify it.`,
    };
  }
  const winner = best[0];
  const rule = doc.classification.find((r) => r.id === winner.ruleId)!;
  const route = doc.routes[winner.routeKey];
  return {
    status: 'CLASSIFIED',
    routeKey: winner.routeKey,
    matchedRuleId: winner.ruleId,
    ruleRef: ruleRef(versionNo, `classification/${winner.ruleId}`),
    provenance: rule.provenance,
    evaluated,
    explanation: `Category ${proposal.categoryCode} matched rule "${winner.ruleId}" (priority ${winner.priority}), which selects route "${route.name}": ${route.stages.map((s) => doc.stages[s].name).join(' → ')}.`,
  };
}

export function routeStages(doc: PolicyDocument, routeKey: string): Array<{ key: string; def: StageDef }> {
  const route = doc.routes[routeKey];
  if (!route) throw new Error(`Unknown route ${routeKey}`);
  return route.stages.map((key) => ({ key, def: doc.stages[key] }));
}
