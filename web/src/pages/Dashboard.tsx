import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { Icon } from '../motion';
import { useSession } from '../session';
import { Empty, ErrorState, formatDate, humanise, Loading } from '../ui';
import { FilterBar, filtersFromParams, useCatalogue, useStageName } from './Reports';

type View = 'institution' | 'officer' | 'management';

const VIEW_LABEL: Record<View, string> = { institution: 'Your institution', officer: 'Work needing attention', management: 'Pendency and ageing' };
// Only late work turns red; everything else reads through its label and count.
const LATE = new Set(['overdue', 'obligations-overdue']);
// Time pressure leads the board; the holding states sit in the rack below it.
const LEAD = new Set(['overdue', 'due-soon']);

function useViews(): View[] {
  const { me, can } = useSession();
  if (me.activeGrant.role === 'INSTITUTION_REP') return ['institution'];
  if (!can('REPORTS_VIEW')) return [];
  const officer = can('STAGE_ASSIGN') || can('STAGE_WORK') || can('EVC_REVIEW');
  return officer ? ['officer', 'management'] : ['management'];
}

export function DashboardPage() {
  const views = useViews();
  const [params, setParams] = useSearchParams();
  const requested = params.get('view') as View | null;
  const view: View | undefined = requested && views.includes(requested) ? requested : views[0];
  const filters = filtersFromParams(params);
  const catalogue = useCatalogue();
  const stageName = useStageName();

  const dash = useQuery({
    queryKey: ['dashboard', view, filters],
    enabled: !!view,
    queryFn: () => api.get<any>(`/dashboards/${view}${qs(filters)}`),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => ((q.state.data as any)?.pollSeconds ?? 30) * 1000,
  });

  if (!view) {
    return <div className="card empty">Your active role has no dashboard. Switch role or open a case from the Applications page.</div>;
  }

  const drill = (report: string, f: Record<string, string | undefined>) => `/reports/${report}${qs(f)}`;
  const defs = new Map<string, any>((catalogue.data?.reports ?? []).map((r: any) => [r.name, r]));
  const failedButStale = dash.isError && !!dash.data;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{VIEW_LABEL[view]}</h1>
          <p>Active scope only. Every slot opens the same records, with the same filters, on the Reports page.</p>
        </div>
        {views.length > 1 && (
          <div className="seg" role="tablist" aria-label="Dashboard view">
            {views.map((v) => (
              <button key={v} role="tab" aria-selected={v === view}
                onClick={() => { const next = new URLSearchParams(params); next.set('view', v); setParams(next); }}>
                {v === 'officer' ? 'Officer' : 'Management'}
              </button>
            ))}
          </div>
        )}
      </header>

      <details className="dashboard-filters" open={Object.values(filters).some(Boolean)}>
        <summary><Icon name="sliders" /><strong>Filter dashboard</strong><span className="small muted">Region, category and reporting period</span><Icon name="chevron" /></summary>
        <FilterBar report={undefined} params={params} setParams={setParams} hideKeys={['stageKey']} />
      </details>

      {dash.isLoading ? <div className="card"><Loading rows={4} /></div>
        : dash.isError && !dash.data ? <ErrorState error={dash.error} onRetry={() => dash.refetch()} />
        : (
          <>
            <p className="dash-meta" aria-live="polite">
              <span className="live-dot">Live · refreshes every {dash.data.pollSeconds} s{dash.isFetching && ' · refreshing…'}</span>
              <span>Last refreshed {formatDate(dash.data.refreshedAt)}</span>
            </p>
            {failedButStale && (
              <div className="alert warn" role="alert">
                <strong>The last refresh failed, so these figures may be out of date.</strong>
                <div style={{ marginTop: 8 }}><button onClick={() => dash.refetch()}>Retry now</button></div>
              </div>
            )}

            {dash.data.tiles.length === 0 ? <div className="card"><Empty>No figures are available for these filters.</Empty></div> : (
              <div className="sorting" aria-label="Key figures">
                {(() => {
                  const lead = dash.data.tiles.filter((t: any) => LEAD.has(t.key));
                  return lead.length > 0 && lead.every((t: any) => t.count === 0) && (
                    <p className="clear-line"><Icon name="check" />Nothing is overdue or due in the next 7 days.
                      {lead.map((t: any) => <Link key={t.key} to={drill(t.report, t.filters)}>{t.label}: none</Link>)}</p>
                  );
                })()}
                {[dash.data.tiles.filter((t: any) => LEAD.has(t.key) && dash.data.tiles.some((x: any) => LEAD.has(x.key) && x.count > 0)), dash.data.tiles.filter((t: any) => !LEAD.has(t.key))].filter((g: any[]) => g.length).map((group: any[], gi: number) => (
              <div className={group.some((t: any) => LEAD.has(t.key)) ? 'rack lead' : 'rack'} key={gi}>
                {group.map((t: any) => (
                  <Link key={t.key} to={drill(t.report, t.filters)} className={`cubby ${t.count === 0 ? 'zero' : ''} ${t.count > 0 && LATE.has(t.key) ? 'late' : ''}`}
                    title={defs.get(t.key)?.denominator}>
                    <span className="cubby-label">{t.label}</span>
                    {t.count > 0 && <span className="pile" aria-hidden="true">{Array.from({ length: Math.min(t.count, 6) }).map((_, k) => <i key={k} style={{ '--k': k } as any} />)}</span>}
                    <span className="cubby-count num">{t.count === 0 ? <span className="none">None</span> : t.count}</span>
                    <span className="cubby-foot">{t.count > 0 && LATE.has(t.key) ? 'Late · open the list' : 'Open the list'}<Icon name="arrow" /></span>
                  </Link>
                ))}
              </div>
                ))}
              </div>
            )}

            {dash.data.matrix && (
              <section className="card stack">
                <h2>Pendency by region and stage</h2>
                {dash.data.matrix.length === 0 ? <Empty>No applications are in process for these filters.</Empty> : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Region</th><th>Live stage</th><th>In process</th><th>Average age</th><th>Oldest</th></tr></thead>
                      <tbody>
                        {dash.data.matrix.map((c: any) => (
                          <tr key={`${c.regionId}-${c.stageKey ?? 'none'}`}>
                            <td>{c.regionName}</td>
                            <td>{c.stageKey ? stageName(c.stageKey) : 'No live stage (for example awaiting classification)'}</td>
                            <td className="num"><Link to={drill(c.report, c.filters)}>{c.pending}</Link></td>
                            <td className="num">{c.avgAgeingDays === null ? '—' : `${c.avgAgeingDays} d`}</td>
                            <td className="num">{c.maxAgeingDays === null ? '—' : `${c.maxAgeingDays} d`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="small muted">Age is the time since the live stage was entered. Cases with no live stage have no stage age.</p>
              </section>
            )}

            {dash.data.unavailable?.length > 0 && (
              <section className="card stack">
                <h2>Not available yet</h2>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  {dash.data.unavailable.map((u: any) => <li key={u.key}><strong>{u.label}:</strong> <span className="muted">{u.reason}</span></li>)}
                </ul>
              </section>
            )}

            <details className="card">
              <summary>How these numbers are defined</summary>
              <ul className="small" style={{ paddingLeft: 18 }}>
                {dash.data.tiles.map((t: any) => defs.get(t.key) && (
                  <li key={t.key}><strong>{t.label}.</strong> {defs.get(t.key).denominator} <span className="muted">{defs.get(t.key).ageingAnchor}</span></li>
                ))}
              </ul>
              <p className="small muted">{dash.data.note} Time-based thresholds are demo assumptions, not AICTE rules.</p>
            </details>
          </>
        )}
    </>
  );
}
