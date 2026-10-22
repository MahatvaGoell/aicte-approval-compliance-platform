import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { useMeta, useSession } from '../session';
import { Empty, ErrorState, formatDate, humanise, Loading, MutationError, Status } from '../ui';

// Operations view (system administrator): worker health, deliveries, demo clock and the local email outbox.

const DELIVERY_TONE: Record<string, string> = {
  PENDING: 'PENDING', SENDING: 'IN_PROGRESS', RETRYING: 'AWAITING_RESPONSE', ACCEPTED: 'SATISFIED', BOUNCED: 'DEFICIENT', DEAD: 'DEFICIENT', CANCELLED: 'NOT_APPLICABLE',
};

function Stat({ label, value, tone, hint }: { label: string; value: string | number; tone?: 'ok' | 'warn' | 'bad'; hint?: string }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value num">{value}</span>
      {hint && <span className="small muted">{hint}</span>}
    </div>
  );
}

export function OpsPage() {
  const { can } = useSession();
  const meta = useMeta();
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ['ops-health'], queryFn: () => api.get<any>('/ops/health'), refetchInterval: 15_000 });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastTick, setLastTick] = useState<any>(null);
  const demo = meta.data?.demoMode;

  async function run(label: string, fn: () => Promise<any>) {
    setBusy(label); setError(null);
    try {
      const r = await fn();
      if (label === 'tick') setLastTick(r);
      await qc.invalidateQueries();
    } catch (e) { setError(e); } finally { setBusy(null); }
  }
  const clock = (body: any) => run('clock', () => api.post('/ops/clock', body));

  const h = health.data;
  return (
    <>
      <div className="section-head">
        <h1>Operations</h1>
        {demo && <button className="primary" disabled={!!busy} onClick={() => run('tick', () => api.post('/ops/tick', {}))}>{busy === 'tick' ? 'Running…' : 'Run scheduler now'}</button>}
      </div>
      <p className="muted">Background work runs in the worker process (<span className="mono">npm run dev:worker</span>). Escalations only notify; nothing here changes a case.</p>
      <MutationError error={error} />
      {lastTick && (
        <div className="alert ok">
          Scheduler pass at {formatDate(lastTick.at)}: {lastTick.scan.alerts} alert(s), {lastTick.scan.missed} missed step(s), {lastTick.outbox.notified} notification(s) from events,
          {' '}{lastTick.delivery.accepted} email(s) accepted, {lastTick.delivery.retrying} retrying, {lastTick.delivery.bounced} bounced, {lastTick.delivery.cancelled} cancelled as stale.
        </div>
      )}
      {health.isLoading ? <div className="card"><Loading rows={4} /></div> : health.error ? <ErrorState error={health.error} onRetry={() => health.refetch()} /> : (
        <>
          <div className="stats">
            <Stat label="Workers" value={h.workers.filter((w: any) => w.healthy).length} tone={h.workers.some((w: any) => w.healthy) ? 'ok' : 'warn'} hint={h.workers.length ? `${h.workers.length} seen` : 'No worker has reported'} />
            <Stat label="Active deadlines" value={h.deadlines.active} hint={`${h.deadlines.paused} paused`} />
            <Stat label="Overdue" value={h.deadlines.overdue} tone={h.deadlines.overdue ? 'bad' : 'ok'} />
            <Stat label="Emails waiting" value={h.deliveries.pending} tone={h.deliveries.pending ? 'warn' : 'ok'} hint={h.deliveries.oldestPendingAgeSeconds != null ? `oldest ${Math.round(h.deliveries.oldestPendingAgeSeconds / 60)} min` : undefined} />
            <Stat label="Failed emails" value={h.deliveries.failed} tone={h.deliveries.failed ? 'bad' : 'ok'} hint="bounced or out of attempts" />
            <Stat label="Missed steps" value={h.alerts.missedSteps} hint="passed while not running" />
            <Stat label="No recipient" value={h.alerts.unresolvedRecipients} tone={h.alerts.unresolvedRecipients ? 'warn' : 'ok'} />
            <Stat label="Events waiting" value={h.outbox.pending} />
          </div>
          <div className="grid-2">
            <div className="stack">
              <Deliveries />
              {demo && <Outbox />}
            </div>
            <div className="stack">
              {demo && can('DEMO_CLOCK') && (
                <section className="card stack" aria-labelledby="clock-title">
                  <h2 id="clock-title">Demo clock</h2>
                  <p className="small muted">Moves business time forward for every user so deadlines, reminders and escalations can be shown. Demo mode only; always shown in the banner; audited.</p>
                  <div className="clock-face">
                    <span className="small muted">Business time</span>
                    <strong className="num">{formatDate(h.businessTime)}</strong>
                    <span className="small muted">Offset {((meta.data?.demoClockOffsetMs ?? 0) / 86_400_000).toFixed(1)} days</span>
                  </div>
                  <div className="row">
                    <button disabled={!!busy} onClick={() => clock({ action: 'advance', days: 1 })}>+1 day</button>
                    <button disabled={!!busy} onClick={() => clock({ action: 'advance', days: 7 })}>+7 days</button>
                    <button disabled={!!busy} onClick={() => clock({ action: 'advance', days: 30 })}>+30 days</button>
                    <button className="danger" disabled={!!busy} onClick={() => clock({ action: 'reset' })}>Reset</button>
                  </div>
                  <p className="small muted">After moving the clock, run the scheduler to process the steps that are now due.</p>
                </section>
              )}
              <section className="card stack" aria-labelledby="workers-title">
                <h2 id="workers-title">Workers</h2>
                {h.workers.length === 0 ? <p className="small muted">No worker heartbeat yet. Start one with <span className="mono">npm run dev:worker</span>, or use "Run scheduler now".</p> : (
                  <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {h.workers.map((w: any) => (
                      <li key={w.workerId} className="small">
                        <Status value={w.healthy ? 'SATISFIED' : 'DEFICIENT'} label={w.healthy ? 'Running' : 'Stale'} /> <span className="mono">{w.workerId}</span>
                        <div className="muted">Last seen {formatDate(w.lastSeenAt)}</div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="small muted">Email adapter: {h.emailAdapter}{h.emailAdapter === 'outbox' ? ' (local files, nothing is sent)' : ''}. Last scheduler pass: {h.schedulerLastRunAt ? formatDate(h.schedulerLastRunAt) : 'never'}.</p>
              </section>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Deliveries() {
  const qc = useQueryClient();
  const [state, setState] = useState('');
  const list = useQuery({ queryKey: ['ops-deliveries', state], queryFn: () => api.get<any[]>(`/ops/deliveries${qs({ state })}`), refetchInterval: 15_000 });
  const [error, setError] = useState<unknown>(null);
  async function retry(id: string) {
    setError(null);
    try { await api.post(`/ops/deliveries/${id}/retry`, {}); await qc.invalidateQueries({ queryKey: ['ops-deliveries'] }); } catch (e) { setError(e); }
  }
  return (
    <section className="card stack" aria-labelledby="del-title">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h2 id="del-title">Email deliveries</h2>
        <select value={state} onChange={(e) => setState(e.target.value)} style={{ width: 'auto' }} aria-label="Filter by state">
          <option value="">All states</option>
          {Object.keys(DELIVERY_TONE).map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
        </select>
      </div>
      <p className="small muted">"Accepted" means the adapter took the message. It is not proof of delivery.</p>
      <MutationError error={error} />
      {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} /> : list.data!.length === 0 ? <Empty>No deliveries.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Message</th><th>State</th><th>Attempts</th><th>Updated</th><th></th></tr></thead>
            <tbody>
              {list.data!.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div>{d.subject}</div>
                    <div className="small muted">{d.to_address}{d.app_no && <> · <Link to={`/applications/${d.application_id}`}>{d.app_no}</Link></>}</div>
                    {d.last_error && <div className="small" style={{ color: 'var(--bad)' }}>{d.last_error}</div>}
                    {d.duplicate_suppressed && <div className="small muted">Resent after a lost acknowledgement; the provider already had it, so no second message.</div>}
                  </td>
                  <td><Status value={DELIVERY_TONE[d.state]} label={humanise(d.state)} /></td>
                  <td className="num">{d.attempts}/{d.max_attempts}</td>
                  <td className="small">{formatDate(d.updated_at)}</td>
                  <td>{d.state === 'DEAD' && <button onClick={() => retry(d.id)}>Retry</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Outbox() {
  const files = useQuery({ queryKey: ['ops-outbox'], queryFn: () => api.get<any>('/ops/outbox'), refetchInterval: 15_000 });
  const [open, setOpen] = useState<string | null>(null);
  const msg = useQuery({ queryKey: ['ops-outbox', open], enabled: !!open, queryFn: () => api.get<any>(`/ops/outbox/${open}`) });
  const parsed = msg.data ? parseEml(msg.data.raw) : null;
  return (
    <section className="card stack" aria-labelledby="outbox-title">
      <h2 id="outbox-title">Email outbox (local preview)</h2>
      <p className="small muted">In the demo, emails are written to local files instead of being sent.</p>
      {files.isLoading ? <Loading /> : files.error ? <ErrorState error={files.error} /> : files.data.files.length === 0 ? <Empty>No messages yet.</Empty> : (
        <div className="outbox">
          <ul>
            {files.data.files.map((f: string) => (
              <li key={f}><button className={open === f ? 'on' : ''} onClick={() => setOpen(f)}>{f.replace(/\.eml$/, '')}</button></li>
            ))}
          </ul>
          <div className="outbox-view">
            {!open ? <p className="small muted">Choose a message.</p> : msg.isLoading ? <Loading /> : parsed && (
              <div key={open} className="stack" style={{ gap: 6 }}>
                <div className="small"><span className="muted">To</span> {parsed.headers.To}</div>
                <div className="small"><span className="muted">Subject</span> <strong>{parsed.headers.Subject}</strong></div>
                <div className="small muted">{parsed.headers.Date}</div>
                <pre className="eml">{parsed.body}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function parseEml(raw: string) {
  const [head, ...rest] = raw.split(/\r?\n\r?\n/);
  const headers: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return { headers, body: rest.join('\n\n') };
}
