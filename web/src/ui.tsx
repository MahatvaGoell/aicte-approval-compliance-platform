import { useId, type CSSProperties, type ReactNode } from 'react';
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

const WORDS: Record<string, string> = { ACCEPT: 'Accepted', REJECT: 'Rejected' };

export function humanise(s: string | null | undefined) {
  if (!s) return '—';
  if (WORDS[s]) return WORDS[s];
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

/** Turns CODE_WORDS inside server-written sentences into plain words for display. */
export function readable(text: string) {
  return text.replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b[A-Z]{4,}\b/g, (w) => humanise(w));
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

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Postmark date in the form 27 OCT 26, India time. */
export function stampDate(v: string | null | undefined) {
  if (!v) return '';
  const d = new Date(v);
  const day = d.toLocaleString('en-IN', { day: '2-digit', timeZone: 'Asia/Kolkata' });
  const month = d.toLocaleString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase();
  const year = d.toLocaleString('en-IN', { year: '2-digit', timeZone: 'Asia/Kolkata' });
  return `${day} ${month} ${year}`;
}

/** A round dated postmark: the record that a step was completed or verified. */
export function Postmark({ top, date, bottom = '', tone, size = 76, land = false, delay = 0, label }: {
  top: string; date: string; bottom?: string; tone?: 'bad'; size?: number; land?: boolean; delay?: number; label?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const seed = hash(top + date + bottom);
  const style = { width: size, height: size, '--r': `${(seed % 23) - 11}deg`, '--d': `${delay}ms` } as CSSProperties;
  return (
    <span className={`postmark ${tone ?? ''} ${land ? 'land' : ''}`} style={style} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 100 100">
        <defs>
          <filter id={`ink${id}`} x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed={seed % 97} result="grain" />
            <feDisplacementMap in="SourceGraphic" in2="grain" scale="2" result="rough" />
            <feTurbulence type="fractalNoise" baseFrequency="0.07" seed={(seed >> 3) % 89} result="blot" />
            <feColorMatrix in="blot" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.5" result="mask" />
            <feComposite in="rough" in2="mask" operator="in" />
          </filter>
          <path id={`t${id}`} d="M 12 50 A 38 38 0 0 1 88 50" />
          <path id={`b${id}`} d="M 7 50 A 43 43 0 0 0 93 50" />
        </defs>
        <g filter={`url(#ink${id})`} fill="none" stroke="currentColor">
          <circle cx="50" cy="50" r="46" strokeWidth="3" />
          <circle cx="50" cy="50" r="33" strokeWidth="1.4" />
          <path d="M 17 40 H 83 M 17 60 H 83" strokeWidth="1.4" />
          <text fontSize="9.4" fontWeight="800" letterSpacing="1" stroke="none" textAnchor="middle"><textPath href={`#t${id}`} startOffset="50%">{top.toUpperCase().slice(0, 18)}</textPath></text>
          {bottom && <text fontSize="7.8" fontWeight="700" letterSpacing="0.9" stroke="none" textAnchor="middle"><textPath href={`#b${id}`} startOffset="50%">{bottom.toUpperCase().slice(0, 20)}</textPath></text>}
          <text x="50" y="54.2" fontSize="11.2" fontWeight="800" letterSpacing="-0.2" stroke="none" textAnchor="middle">{date}</text>
        </g>
      </svg>
    </span>
  );
}

export function initials(name: string) {
  return name.replace(/\(.*\)/, '').split(/[\s.]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

/** The same name plate for a responsible person wherever they appear. */
export function NamePlate({ name, role }: { name: string; role?: string }) {
  return (
    <span className="plate">
      <span className="plate-ini" aria-hidden="true">{initials(name) || '—'}</span>
      <span className="plate-text"><strong>{name}</strong>{role && <span>{role}</span>}</span>
    </span>
  );
}

/** One urgency ramp: calm, near, soon, today, late. */
export function urgencyOf(d: { state?: string; overdueDays: number; daysLeft: number }) {
  if (d.state === 'PAUSED') return 'paused';
  if (d.overdueDays > 0) return 'late';
  if (d.daysLeft <= 1) return 'today';
  if (d.daysLeft <= 3) return 'soon';
  if (d.daysLeft <= 14) return 'near';
  return 'calm';
}

const RAMP: [string, string][] = [['calm', '15+ d'], ['near', '4–14'], ['soon', '2–3'], ['today', 'Today'], ['late', 'Late']];

export function Urgency({ due }: { due: { state?: string; overdueDays: number; daysLeft: number } }) {
  const u = urgencyOf(due);
  const [n, unit] = u === 'paused' ? ['—', 'Clock paused']
    : u === 'late' ? [String(due.overdueDays), due.overdueDays === 1 ? 'day overdue' : 'days overdue']
    : u === 'today' ? ['Today', 'Due today']
    : [String(due.daysLeft), 'days left'];
  return (
    <span className={`urgency u-${u}`}>
      <b>{n}</b><span>{unit}</span>
      {u !== 'paused' && (
        <span className="ramp" aria-hidden="true">
          {RAMP.map(([key, label]) => <i key={key} className={key === u ? 'on' : ''}><em>{label}</em></i>)}
        </span>
      )}
    </span>
  );
}

/** Decorative consignment bars derived from the application number. */
export function Barcode({ value }: { value: string }) {
  const bars: number[] = [];
  for (const ch of value) { const c = ch.charCodeAt(0); bars.push((c % 3) + 1, ((c >> 2) % 2) + 1, ((c >> 1) % 3) + 1); }
  return (
    <span className="barcode" aria-hidden="true">
      {bars.map((w, i) => <i key={i} style={{ width: i % 2 ? w : w + 0.4, marginRight: i % 2 ? w + 1 : 1.2 }} />)}
    </span>
  );
}

/** The mark a document carries: a dated postmark once verified, a rubber stamp otherwise. */
export function DocStamp({ state, top, date, bottom, size = 80 }: { state: string; top?: string; date?: string; bottom?: string; size?: number }) {
  const tone = TONE[state] ?? 'neutral';
  if (tone === 'ok') return <Postmark top={top ?? 'Verified'} date={date || 'ON RECORD'} bottom={bottom ?? humanise(state)} size={size} land label={`${humanise(state)}${date ? `, ${date}` : ''}`} />;
  return <span className={`rubber ${tone === 'bad' ? 'bad' : 'pending'}`}>{humanise(state)}</span>;
}
