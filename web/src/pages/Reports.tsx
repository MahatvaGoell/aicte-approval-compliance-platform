import {DoubleClaimSummary} from './CaseDoubleClaims';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, download, qs } from '../api';
import { useSession } from '../session';
import { Empty, ErrorState, formatDate, humanise, Loading, MutationError, Status } from '../ui';

export const FILTER_KEYS = ['regionId', 'institutionId', 'categoryCode', 'stageKey', 'submittedFrom', 'submittedTo'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

export function filtersFromParams(params: URLSearchParams) {
  const out: Record<string, string> = {};
  for (const k of FILTER_KEYS) { const v = params.get(k); if (v) out[k] = v; }
  return out;
}

export function useCatalogue() {
  return useQuery({ queryKey: ['report-catalogue'], queryFn: () => api.get<any>('/reports'), staleTime: 60_000 });
}

function useReference() {
  return useQuery({ queryKey: ['reference'], queryFn: () => api.get<any>('/reference'), staleTime: 5 * 60_000 });
}

/** Policy stage names (for example "Expert visit committee") instead of raw keys. */
export function useStageName() {
  const ref = useReference();
  const names = new Map<string, string>((ref.data?.activePolicy.stages ?? []).map((s: any) => [s.key, s.name]));
  return (key: string) => names.get(key) ?? humanise(key);
}

/** Filters live in the URL so a dashboard tile, a shared link and the report page always agree. */
export function FilterBar({ report, params, setParams, hideKeys = [] }: {
  report: { filters: readonly string[] } | undefined; params: URLSearchParams; setParams: (p: URLSearchParams) => void; hideKeys?: FilterKey[];
}) {
  const { me } = useSession();
  const ref = useReference();
  const office = me.activeGrant.role !== 'INSTITUTION_REP';
  const show = (k: FilterKey) => !hideKeys.includes(k) && (!report || report.filters.includes(k));
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    next.delete('page');
    setParams(next);
  };
  const active = FILTER_KEYS.some((k) => params.get(k));
  const dateBad = !!params.get('submittedFrom') && !!params.get('submittedTo') && params.get('submittedFrom')! > params.get('submittedTo')!;
  return (
    <section className="card stack" aria-label="Filters">
      <div className="row">
        {office && show('regionId') && (
          <label>Region
            <select value={params.get('regionId') ?? ''} onChange={(e) => set('regionId', e.target.value)}>
              <option value="">All in my scope</option>
              {ref.data?.regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
        {show('categoryCode') && (
          <label>Application type
            <select value={params.get('categoryCode') ?? ''} onChange={(e) => set('categoryCode', e.target.value)}>
              <option value="">All types</option>
              {ref.data?.activePolicy.categories.map((c: any) => <option key={c.code} value={c.code}>{c.name ?? humanise(c.code)}</option>)}
            </select>
          </label>
        )}
        {show('stageKey') && (
          <label>Live stage
            <select value={params.get('stageKey') ?? ''} onChange={(e) => set('stageKey', e.target.value)}>
              <option value="">All stages</option>
              {ref.data?.activePolicy.stages.map((s: any) => <option key={s.key} value={s.key}>{s.name}</option>)}
              <option value="NONE">No live stage</option>
            </select>
          </label>
        )}
        {show('submittedFrom') && <label>Submitted from<input type="date" value={params.get('submittedFrom') ?? ''} onChange={(e) => set('submittedFrom', e.target.value)} aria-invalid={dateBad} /></label>}
        {show('submittedTo') && <label>Submitted to<input type="date" value={params.get('submittedTo') ?? ''} onChange={(e) => set('submittedTo', e.target.value)} aria-invalid={dateBad} /></label>}
        {active && <button className="secondary" onClick={() => setParams(new URLSearchParams(Array.from(params).filter(([k]) => !(FILTER_KEYS as readonly string[]).includes(k) && k !== 'page')))}>Clear filters</button>}
      </div>
      {dateBad && <div className="alert bad" role="alert">“Submitted from” must not be after “Submitted to”.</div>}
      {params.get('institutionId') && <p className="small muted">Filtered to one institution.</p>}
    </section>
  );
}

const WAITING: Record<string, string> = {
  INSTITUTION_RESPONSE: 'Institution response', OFFICER_REVIEW: 'Officer review', VISIT_AVAILABILITY: 'Visit availability',
  EXTERNAL_INFORMATION: 'External information', UNKNOWN: 'Not known',
};

function ReportIndex() {
  const cat = useCatalogue();
  return (
    <>
      <div className="section-head"><h1>Reports</h1></div>
      <p className="muted">Each report is a list of the records behind a dashboard number, limited to your active scope.</p>
      {cat.isLoading ? <div className="card"><Loading /></div> : cat.error ? <ErrorState error={cat.error} onRetry={() => cat.refetch()} />
        : cat.data.reports.length === 0 ? <div className="card"><Empty>Your active role has no reports.</Empty></div>
        : (
          <div className="stack">
            {cat.data.reports.map((r: any) => (
              <section key={r.name} className="card stack">
                <h2><Link to={`/reports/${r.name}`}>{r.label}</Link></h2>
                <p className="small">{r.denominator}</p>
                <p className="small muted">{r.ageingAnchor}</p>
              </section>
            ))}
          </div>
        )}
    </>
  );
}

export function ReportsPage() {
  const { name } = useParams();
  if (!name) return <ReportIndex />;
  return <ReportDetail name={name} />;
}

function ReportDetail({ name }: { name: string }) {
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = 25;
  const stageName = useStageName();
  const cat = useCatalogue();
  const def = cat.data?.reports.find((r: any) => r.name === name);
  const dateBad = !!filters.submittedFrom && !!filters.submittedTo && filters.submittedFrom > filters.submittedTo;

  const q = useQuery({
    queryKey: ['report', name, filters, page],
    enabled: !dateBad,
    queryFn: () => api.get<any>(`/reports/${name}${qs({ ...filters, page, pageSize })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const { can } = useSession();
  const exportCsv = useMutation({
    mutationFn: () => download(`/reports/${name}/csv${qs(filters)}`),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    },
  });

  const goPage = (p: number) => { const next = new URLSearchParams(params); next.set('page', String(p)); setParams(next); };
  const data = q.data;
  const isObligation = data?.entity === 'obligation';
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <div className="section-head">
        <div>
          <h1>{data?.label ?? def?.label ?? humanise(name)}</h1>
          <p className="small muted" style={{ marginTop: 6 }}><Link to="/dashboard">← Dashboard</Link> · <Link to="/reports">All reports</Link></p>
        </div>
        {can('REPORTS_EXPORT') && (
          <div className="stack" style={{ justifyItems: 'end' }}>
            <button className="primary" disabled={exportCsv.isPending || dateBad || q.isLoading} onClick={() => exportCsv.mutate()}>
              {exportCsv.isPending ? 'Preparing CSV…' : 'Download CSV'}
            </button>
            <span className="small muted">Same filters and scope as this list. Each export is recorded in the audit log.</span>
          </div>
        )}
      </div>
      <MutationError error={exportCsv.error} />
      {exportCsv.isSuccess && <div className="alert ok" role="status">CSV downloaded for the filters shown below.</div>}
      <FilterBar report={def} params={params} setParams={setParams} />

      {q.isLoading ? <div className="card"><Loading rows={5} /></div>
        : q.isError && !data ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : !data ? null : (
          <section className="card stack">
            {q.isError && (
              <div className="alert warn" role="alert">
                <strong>The last refresh failed, so this list may be out of date.</strong>
                <div style={{ marginTop: 8 }}><button onClick={() => q.refetch()}>Retry now</button></div>
              </div>
            )}
            <p className="small muted" aria-live="polite">
              {data.total} {data.total === 1 ? 'record' : 'records'} · last refreshed {formatDate(data.refreshedAt)} · polls every 30 s{q.isFetching && ' · refreshing…'}
            </p>
            {data.rows.length === 0 ? <Empty>No records match these filters in your active scope.</Empty> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Case</th><th>{isObligation ? 'Condition' : 'Stage'}</th><th>Owner</th><th>Pending action</th>
                      <th>Due and basis</th><th>Overdue</th><th>Waiting for</th><th>Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r: any) => (
                      <tr key={r.id}>
                        <td><Link to={`/applications/${r.applicationId}`}>{r.appNo}</Link><div className="small muted">{r.institution} · {r.regionId}</div></td>
                        <td>
                          {isObligation ? <>{r.condition}<div className="small"><Status value={r.obligationState} /></div></>
                            : <>{r.stageKey ? stageName(r.stageKey) : 'No live stage'}<div className="small">{r.stageState ? <Status value={r.stageState} /> : <Status value={r.lifecycleState} />}</div></>}
                        </td>
                        <td>{r.owner ?? <span className="muted">Not shown</span>}</td>
                        <td>
                          {r.pendingAction}
                          {isObligation && r.submissionOnTime !== null && (
                            <div className="small"><span className={`chip ${r.submissionOnTime ? 'ok' : 'bad'}`}>{r.submissionOnTime ? 'Submitted on time' : 'Submitted late'}</span></div>
                          )}
                        </td>
                        <td>{r.dueAt ? <>{formatDate(r.dueAt)}<div className="small muted">{r.dueBasis}</div></> : <span className="muted">No running clock</span>}</td>
                        <td className="num">{r.overdue ? <span className="chip bad">{r.overdueDays} d overdue</span> : <span className="muted">—</span>}</td>
                        <td>{r.waitingReason ? WAITING[r.waitingReason] ?? humanise(r.waitingReason) : <span className="muted">Not shown</span>}</td>
                        <td className="num">{r.doubleClaims&&<DoubleClaimSummary claims={r.doubleClaims}/>} {r.accountability&&!r.accountability.recorded&&<div>Not recorded · Custody history incomplete</div>}{r.accountability?.recorded&&<div className="small">Total {r.accountability.totalDays} · institution {r.accountability.institutionDays} · office {r.accountability.officeDays} · authority {r.accountability.authorityDays} · returns {r.accountability.returns}{r.accountability.historyIncomplete?" · Custody history incomplete":""}</div>}{r.ageingDays === null ? '—' : `${r.ageingDays} d`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="row">
              <button className="secondary" disabled={page <= 1} onClick={() => goPage(page - 1)}>Previous</button>
              <span>Page {page} of {pages}</span>
              <button className="secondary" disabled={page >= pages} onClick={() => goPage(page + 1)}>Next</button>
            </div>
            <details>
              <summary>How this list is defined</summary>
              <p className="small">{data.definition.denominator}</p>
              <p className="small muted">{data.definition.ageingAnchor} Time-based thresholds are demo assumptions, not AICTE rules.</p>
            </details>
          </section>
        )}
    </>
  );
}
