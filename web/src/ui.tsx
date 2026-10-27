import type { ReactNode } from 'react';
import { ApiError } from './api';
import { Icon } from './motion';

const TONE: Record<string, string> = {
  DRAFT: 'neutral', SUBMITTED: 'accent', AWAITING_CLASSIFICATION: 'warn', IN_PROCESS: 'accent', AWAITING_DECISION: 'info',
  DECISION_RECORDED: 'ok', CLOSED: 'neutral', WITHDRAWN: 'neutral',
  QUEUED: 'warn', ASSIGNED: 'accent', IN_PROGRESS: 'accent', AWAITING_RESPONSE: 'warn', COMPLETED: 'ok', CANCELLED: 'neutral',
  NOT_STARTED: 'neutral',
  VALID:'ok', EXPIRED:'bad', NOT_VERIFIED:'warn', VALIDITY_UNAVAILABLE:'neutral', PENDING_VERIFICATION:'warn', ACCEPT:'ok', REJECT:'bad',
  EVIDENCE_SUBMITTED:'warn', UNDER_VERIFICATION:'accent', FULFILLED:'ok', CLOSED_WITH_AUTHORISED_REASON:'neutral',
  WAITING: 'warn', PROPOSED: 'warn', CONFIRMED: 'info', HELD: 'accent', REPORT_SUBMITTED: 'warn', REPORT_ACCEPTED: 'ok', RESCHEDULED: 'neutral', INTERNAL: 'neutral', INSTITUTION: 'info',
  APPROVED: 'ok', APPROVED_WITH_CONDITIONS: 'ok', REJECTED: 'bad', DEFERRED: 'warn',
  NONE: 'neutral', OPEN: 'warn', OVERDUE: 'bad', ALL_FULFILLED: 'ok',
  SOURCE_RECEIVED:'info', SOURCE_PROCESSING:'accent', SOURCE_REPORTED_COMPLETE:'neutral', RESOLVED:'ok', DISMISSED:'neutral', APPLIED:'ok', STILL_BLOCKED:'warn',
  PENDING: 'neutral', SATISFIED: 'ok', DEFICIENT: 'bad', NOT_APPLICABLE: 'neutral',
  DEMO_ASSUMPTION: 'demo', APH_CLAUSE: 'ok', ADMIN_INSTRUCTION: 'info',
};

export function humanise(s: string | null | undefined) {
  if (!s) return '—';
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

export function Status({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return <span className="muted">—</span>;
  return <span className={`chip ${TONE[value] ?? 'neutral'}`}>{label ?? humanise(value)}</span>;
}

export function Provenance({ value }: { value: string }) {
  const label = value === 'DEMO_ASSUMPTION' ? 'Demo rule' : value === 'APH_CLAUSE' ? 'APH clause' : 'Admin instruction';
  return <span className={`chip ${TONE[value] ?? 'neutral'}`} title={value}>{label}</span>;
}

export function formatDate(v: string | null | undefined, withTime = true) {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleString('en-IN', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }
    : { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack loading-block" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />)}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  if (e?.status === 404) return <div className="card empty">This record does not exist or is outside your access.</div>;
  if (e?.status === 401) return <div className="card empty">Your session has ended. <a href="/login">Sign in again</a>.</div>;
  if (e?.status === 403) return <div className="card empty">Your active role does not have access to this page.</div>;
  return (
    <div className="alert bad" role="alert">
      <strong>{e?.message ?? 'Something went wrong.'}</strong>
      {e?.correlationId && <div className="small mono">Reference: {e.correlationId}</div>}
      {onRetry && <div style={{ marginTop: 8 }}><button onClick={onRetry}>Try again</button></div>}
    </div>
  );
}

/** Shows a failed mutation with field-level problems, if any. */
export function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  const list = Array.isArray(e?.details) ? e!.details : null;
  return (
    <div className="alert bad" role="alert">
      <strong>{e?.message ?? 'The action failed.'}</strong>
      {list && (
        <ul>
          {list.map((d: any, i: number) => <li key={i}>{d.detail ?? (d.field ? `${d.field}: ${d.message}` : d.message ?? JSON.stringify(d))}</li>)}
        </ul>
      )}
      {e?.correlationId && <div className="small mono">Reference: {e.correlationId}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Disclosure({ title, subtitle, icon, count, children, id, open = false }: {
  title: string; subtitle?: string; icon: string; count?: number; children: ReactNode; id?: string; open?: boolean;
}) {
  return <details className="disclosure" id={id} open={open}>
    <summary><span className="disclosure-icon"><Icon name={icon} /></span><span className="disclosure-label"><strong>{title}</strong>{subtitle && <span className="small muted">{subtitle}</span>}</span>{count != null && <span className="disclosure-count num">{count}</span>}<Icon name="chevron" /></summary>
    <div className="disclosure-body">{children}</div>
  </details>;
}
