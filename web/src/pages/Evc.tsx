import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { useMeta, useSession } from '../session';
import { Disclosure, Empty, ErrorState, formatDate, humanise, Loading, Provenance, Status } from '../ui';

export function EvcPage() {
  const { can } = useSession();
  const [state, setState] = useState(''), [region, setRegion] = useState(''), [page, setPage] = useState(1);
  const queue = useQuery({ queryKey: ['evc','queue', state, region, page], queryFn: () => api.get<any>(`/evc/queue${qs({ state, region, page })}`), refetchInterval: 30_000 });
  return <>
    <header className="page-head"><div><h1>Expert visits</h1><p>Ready cases, confirmed reservations and report review. The queue refreshes every 30 seconds.</p>
      <div className="evc-flow" aria-label="Visit steps">{['Plan', 'Confirm', 'Visit', 'Review'].map((step, i) => <span key={step}><b>{i + 1}</b>{step}</span>)}</div></div></header>
    <section className="card stack evc-queue">
      <h2>Readiness queue</h2>
      <div className="form-grid">
        <label>Visit state<select value={state} onChange={(e) => { setState(e.target.value); setPage(1); }}><option value="">All states</option>{['WAITING','PROPOSED','CONFIRMED','HELD','REPORT_SUBMITTED','REPORT_ACCEPTED'].map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Region<select value={region} onChange={(e) => { setRegion(e.target.value); setPage(1); }}><option value="">All accessible regions</option>{['DEMO-WEST','DEMO-NORTH','DEMO-SOUTH'].map((r) => <option key={r}>{r}</option>)}</select></label>
      </div>
      {queue.isLoading ? <Loading /> : queue.error ? <ErrorState error={queue.error} onRetry={() => queue.refetch()} /> : <>
        <p className="small muted">{queue.data.total} accessible cases · refreshed {formatDate(queue.data.refreshedAt)}</p>
        {queue.data.rows.length ? <div className="table-wrap"><table><thead><tr><th>Case / institution</th><th>Ready since</th><th>Scheduling due</th><th>Visit</th></tr></thead><tbody>{queue.data.rows.map((r: any) => <tr key={r.application_id}>
          <td><Link className="mono" to={`/applications/${r.application_id}`}>{r.app_no}</Link><div className="small muted">{r.institution} · {r.region_id}</div></td>
          <td>{formatDate(r.ready_at)}<div className="small">{r.waitingDays} days since readiness</div></td>
          <td>{r.scheduling_due_date ? <>By end of {formatDate(r.scheduling_due_date, false)}</> : '—'}{r.overdue && <Status value="OVERDUE" />}</td><td><Status value={r.visit_state} /></td>
        </tr>)}</tbody></table></div> : <Empty>No ready cases match your active scope and filters.</Empty>}
        <div className="pager"><button className="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</button><span>Page {page}</span><button className="secondary" disabled={page * 50 >= queue.data.total} onClick={() => setPage((p) => p + 1)}>Next</button></div>
      </>}
    </section>
    <VisitCalendar />
    {can('EVC_SCHEDULE') && <Disclosure title="Expert directory" subtitle="Eligibility, specialisms and availability" icon="users"><ExpertDirectory /></Disclosure>}
  </>;
}
function VisitCalendar() {
  const meta = useMeta();
  const [selectedDate, setDate] = useState(''), [period, setPeriod] = useState('week');
  const date = selectedDate || meta.data?.businessTime.slice(0,10) || '';
  const start = date ? new Date(`${period === 'month' ? date.slice(0,7) + '-01' : date}T00:00:00+05:30`) : null;
  const end = start ? (period === 'month'
    ? new Date(Date.UTC(Number(date.slice(0,4)), Number(date.slice(5,7)), 1) - 330 * 60_000)
    : new Date(start.getTime() + 7 * 86400_000)) : null;
  const range = start && end ? qs({ from: start.toISOString(), to: end.toISOString() }) : '';
  const query = useQuery({ queryKey: ['evc','calendar',range], queryFn: () => api.get<any>(`/evc/calendar${range}`), enabled: !!range, refetchInterval: 30_000 });
  return <section className="card stack"><h2>Visit calendar and reservations</h2>
    <div className="form-grid"><label>Calendar date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><label>View<select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="week">Week</option><option value="month">Month</option></select></label></div>
    <p className="small muted">Range starts at midnight in India. Each visit shows its source time zone; cancelled and replaced visits retain history.</p>
    {query.isLoading || !range ? <Loading /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : query.data?.rows.length ? <div className="evc-calendar">{query.data.rows.map((v: any) => <article className="evc-calendar-item" key={v.id}>
      <Link to={`/applications/${v.application_id}`}>{v.app_no}</Link> <Status value={v.state} />
      <p>{new Date(v.starts_at).toLocaleString('en-IN', { timeZone: v.timezone })} — {new Date(v.ends_at).toLocaleTimeString('en-IN', { timeZone: v.timezone })}</p>
      <p className="small muted">{v.timezone} · {humanise(v.mode)}</p>
      <ul>{v.members?.map((m: any) => <li key={m.name}>{m.name} · {m.reserved ? 'Reserved' : 'Released'} · {m.confirmedAt ? 'Member confirmed' : 'Member confirmation pending'}</li>)}</ul>
    </article>)}</div> : <Empty>No visits in this range for your active scope.</Empty>}
  </section>;
}
function ExpertDirectory() {
  const query = useQuery({ queryKey: ['evc','experts'], queryFn: () => api.get<any>('/evc/experts') });
  return <section className="card stack"><h2>Expert directory</h2><p className="small muted">Synthetic directory. Missing information blocks selection. Conflict and availability checks are repeated for each proposed slot.</p>
    {query.isLoading ? <Loading /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : !query.data.rows.length ? <Empty>No experts in the directory for this scope.</Empty> : <div className="table-wrap"><table><thead><tr><th>Expert / specialisms</th><th>Home region</th><th>Eligibility / capacity</th><th>Directory / availability</th></tr></thead><tbody>{query.data.rows.map((e: any) => <tr key={e.user_id}>
      <td>{e.name}<div className="small">{e.specialisms.join(', ')}</div><Provenance value={e.provenance} /></td><td>{e.home_region_id ?? 'Information unavailable'}</td><td>{e.eligible ? 'Eligible' : 'Not eligible'} · max {e.max_visits_per_month}/month</td>
      <td>{e.directory_complete ? 'Directory complete' : 'Information unavailable'}{e.availability?.map((a: any, i: number) => <div className="small muted" key={i}>{formatDate(a.from, false)} — {formatDate(a.to, false)}</div>)}</td>
    </tr>)}</tbody></table></div>}
  </section>;
}
