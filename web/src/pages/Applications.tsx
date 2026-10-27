import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { TrailingCard, useTrailingCard } from '../hoverCard';
import { Icon } from '../motion';
import { useSession } from '../session';
import { Empty, ErrorState, formatDate, humanise, Loading, Status } from '../ui';

export interface ListRow {
  id: string;
  app_no: string;
  lifecycle_state: string;
  decision_outcome: string | null;
  compliance_status: string;
  submitted_at: string | null;
  updated_at: string;
  region_id: string;
  institution_name: string;
  category_code: string;
  route_key: string | null;
  stage_key: string | null;
  stage_state: string | null;
  stage_entered_at: string | null;
  assignee_name: string | null;
}

interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  rows: ListRow[];
}

export interface Reference {
  regions: Array<{ id: string; name: string }>;
  cycles: Array<{ code: string }>;
  activePolicy: {
    id: string;
    versionNo: number;
    label: string;
    categories: Array<{ code: string; name: string; description: string; provenance: string }>;
    stages: Array<{ key: string; name: string }>;
    routes: Array<{ key: string; name: string }>;
  };
}

export function useReference() {
  return useQuery({ queryKey: ['reference'], queryFn: () => api.get<Reference>('/reference'), staleTime: 300_000 });
}

export function useApplications(params: Record<string, string | undefined>) {
  return useQuery({ queryKey: ['applications', params], queryFn: () => api.get<ListResponse>(`/applications${qs(params)}`) });
}

export function ageDays(from: string | null) {
  if (!from) return null;
  return Math.floor((Date.now() - new Date(from).getTime()) / 86_400_000);
}

/** Hover preview content for one case: what the list returns, plus the due date read lazily from the case detail. */
function CasePreview({ row, on, stageName, catName }: { row: ListRow | null; on: boolean; stageName: (k: string | null) => string; catName: (k: string) => string }) {
  const detail = useQuery({
    queryKey: ['case', row?.id],
    queryFn: () => api.get<any>(`/applications/${row!.id}`),
    enabled: on && !!row,
    staleTime: 60_000,
  });
  if (!row) return null;
  const live = !!row.stage_state && !['COMPLETED', 'CANCELLED'].includes(row.stage_state);
  const age = live ? ageDays(row.stage_entered_at) : null;
  const due = detail.data?.actionPanel?.due;
  return (
    <>
      <div className="dp-top">
        <div className="dp-sheet">
          <div className="dp-letterhead"><span>Case file</span><span>{row.region_id}</span></div>
          <div className="dp-lines" />
          <div className="dp-lines short" />
        </div>
        <div className="dp-title">
          <strong>{row.institution_name}</strong>
          <span className="small muted"><span className="mono">{row.app_no}</span> · {catName(row.category_code)}</span>
        </div>
      </div>
      <dl className="dp-kv">
        <dt>Status</dt><dd><Status value={row.lifecycle_state} /></dd>
        <dt>Stage</dt><dd>{row.stage_key ? `${stageName(row.stage_key)} · ${humanise(row.stage_state)}` : <span className="muted">No live stage</span>}</dd>
        <dt>Owner</dt><dd>{row.assignee_name ?? <span className="muted">Unassigned</span>}</dd>
        <dt>In stage</dt><dd className="num">{age === null ? <span className="muted">—</span> : `${age} ${age === 1 ? 'day' : 'days'}`}</dd>
        <dt>Due</dt>
        <dd>{due ? <>{formatDate(due.dueDate, false)}{due.overdueDays > 0 && <span className="dp-late"> · {due.overdueDays} d overdue</span>}</> : <span className="muted">{detail.isLoading ? '…' : 'Not recorded'}</span>}</dd>
        {row.decision_outcome && <><dt>Decision</dt><dd><Status value={row.decision_outcome} /></dd></>}
      </dl>
      <div className="dp-open">Open case<Icon name="arrow" /></div>
    </>
  );
}

export function ApplicationTable({ rows, showAssignee }: { rows: ListRow[]; showAssignee: boolean }) {
  const ref = useReference();
  const navigate = useNavigate();
  const card = useTrailingCard<ListRow>();
  const stageName = (k: string | null) => ref.data?.activePolicy.stages.find((s) => s.key === k)?.name ?? humanise(k);
  const catName = (k: string) => ref.data?.activePolicy.categories.find((c) => c.code === k)?.name ?? humanise(k);
  return (
    <>
      <div className="table-wrap doc-table app-table" tabIndex={0} role="region" aria-label="Applications table" {...card.wrapProps}>
        <table>
          <thead>
            <tr>
              <th>Application</th>
              <th className="hide-sm">Institution</th>
              <th className="hide-sm">Category</th>
              <th>Status</th>
              <th className="hide-sm">Current stage</th>
              {showAssignee && <th className="hide-sm">Owner</th>}
              <th className="num hide-sm">Days in stage</th>
              <th className="hide-sm">Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} tabIndex={-1} {...card.rowProps(r)} onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) navigate(`/applications/${r.id}`); }}>
                <td>
                  <Link to={`/applications/${r.id}`} className="mono">{r.app_no}</Link>
                  <span className="doc-case-sm">{r.institution_name}</span>
                </td>
                <td className="hide-sm">{r.institution_name}<div className="small muted">{r.region_id}</div></td>
                <td className="hide-sm">{catName(r.category_code)}</td>
                <td><Status value={r.lifecycle_state} /></td>
                <td className="hide-sm">{r.stage_key ? <>{stageName(r.stage_key)} <div><Status value={r.stage_state} /></div></> : <span className="muted">—</span>}</td>
                {showAssignee && <td className="hide-sm">{r.assignee_name ?? <span className="muted">Unassigned</span>}</td>}
                <td className="num hide-sm">{r.stage_state && !['COMPLETED', 'CANCELLED'].includes(r.stage_state) ? <span className="age">{ageDays(r.stage_entered_at)}</span> : <span className="muted">—</span>}</td>
                <td className="hide-sm"><Status value={r.decision_outcome} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TrailingCard cardRef={card.cardRef} on={!!card.active}>
        <CasePreview row={card.shown} on={!!card.active} stageName={stageName} catName={catName} />
      </TrailingCard>
    </>
  );
}

const LIFECYCLES = ['DRAFT', 'SUBMITTED', 'AWAITING_CLASSIFICATION', 'IN_PROCESS', 'AWAITING_DECISION', 'DECISION_RECORDED', 'CLOSED', 'WITHDRAWN'];

export function ApplicationsPage() {
  const { me } = useSession();
  const ref = useReference();
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(params.entries());
  const list = useApplications(filters);
  const internal = me.activeGrant.role !== 'INSTITUTION_REP';

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <>
      <header className="page-head">
        <div><h1>Applications</h1><p>Every application on record in your scope. Open one to pick up its next action.</p></div>
      </header>
      <div className="card application-filters" role="search">
        <div className="filters filters-primary">
        <label className="search-field">Search<Icon name="search" /><input id="f-q" placeholder="Application no. or institution" value={filters.q ?? ''} onChange={(e) => set('q', e.target.value)} /></label>
        <label>Status
          <select id="f-life" value={filters.lifecycleState ?? ''} onChange={(e) => set('lifecycleState', e.target.value)}>
            <option value="">Any</option>
            {LIFECYCLES.map((l) => <option key={l} value={l}>{humanise(l)}</option>)}
          </select>
        </label>
        </div>
        <details className="filter-more" open={['categoryCode', 'stageKey', 'regionId', 'submittedFrom', 'submittedTo', 'assignedToMe'].some((key) => !!filters[key])}>
          <summary>More filters <span className="small muted">Category, stage, region and dates</span></summary>
          <div className="filters">
        <label>Category
          <select id="f-cat" value={filters.categoryCode ?? ''} onChange={(e) => set('categoryCode', e.target.value)}>
            <option value="">Any</option>
            {ref.data?.activePolicy.categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </label>
        <label>Stage
          <select id="f-stage" value={filters.stageKey ?? ''} onChange={(e) => set('stageKey', e.target.value)}>
            <option value="">Any</option>
            {ref.data?.activePolicy.stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
        </label>
        {internal && (
          <label>Region
            <select id="f-region" value={filters.regionId ?? ''} onChange={(e) => set('regionId', e.target.value)}>
              <option value="">Any in my scope</option>
              {ref.data?.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
        <label>Submitted from<input id="f-from" type="date" value={filters.submittedFrom ?? ''} onChange={(e) => set('submittedFrom', e.target.value)} /></label>
        <label>Submitted to<input id="f-to" type="date" value={filters.submittedTo ?? ''} onChange={(e) => set('submittedTo', e.target.value)} /></label>
        {internal && (
          <label className="row" style={{ fontWeight: 400 }}>
            <input id="f-mine" type="checkbox" checked={filters.assignedToMe === 'true'} onChange={(e) => set('assignedToMe', e.target.checked ? 'true' : '')} />
            Assigned to me
          </label>
        )}
          </div>
        </details>
      </div>
      {list.isLoading ? <div className="card"><Loading /></div>
        : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} />
        : list.data!.rows.length === 0 ? <div className="card"><Empty>No applications match these filters.</Empty></div>
        : <>
          <div className="list-meta"><span>{list.data!.total} matching</span><span>Last refreshed {formatDate(new Date(list.dataUpdatedAt || Date.now()).toISOString())}</span></div>
          <ApplicationTable rows={list.data!.rows} showAssignee={internal} />
        </>}
      {list.data && list.data.total > list.data.pageSize && (
        <div className="pager">
          <button className="secondary" disabled={list.data.page <= 1} onClick={() => set('page', String(list.data!.page - 1))}>Previous</button>
          <span className="small muted">Page {list.data.page} of {Math.ceil(list.data.total / list.data.pageSize)}</span>
          <button className="secondary" disabled={list.data.page * list.data.pageSize >= list.data.total} onClick={() => set('page', String(list.data!.page + 1))}>Next</button>
        </div>
      )}
    </>
  );
}
