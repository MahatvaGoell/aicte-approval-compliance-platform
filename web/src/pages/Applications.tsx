import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
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

function ageDays(from: string | null) {
  if (!from) return null;
  return Math.floor((Date.now() - new Date(from).getTime()) / 86_400_000);
}

export function ApplicationTable({ rows, showAssignee }: { rows: ListRow[]; showAssignee: boolean }) {
  const ref = useReference();
  const stageName = (k: string | null) => ref.data?.activePolicy.stages.find((s) => s.key === k)?.name ?? humanise(k);
  const catName = (k: string) => ref.data?.activePolicy.categories.find((c) => c.code === k)?.name ?? humanise(k);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Application</th>
            <th>Institution</th>
            <th>Category</th>
            <th>Status</th>
            <th>Current stage</th>
            {showAssignee && <th>Owner</th>}
            <th className="num">Days in stage</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/applications/${r.id}`} className="mono">{r.app_no}</Link></td>
              <td>{r.institution_name}<div className="small muted">{r.region_id}</div></td>
              <td>{catName(r.category_code)}</td>
              <td><Status value={r.lifecycle_state} /></td>
              <td>{r.stage_key ? <>{stageName(r.stage_key)} <div><Status value={r.stage_state} /></div></> : <span className="muted">—</span>}</td>
              {showAssignee && <td>{r.assignee_name ?? <span className="muted">Unassigned</span>}</td>}
              <td className="num">{r.stage_state && !['COMPLETED', 'CANCELLED'].includes(r.stage_state) ? ageDays(r.stage_entered_at) : '—'}</td>
              <td><Status value={r.decision_outcome} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      <div className="section-head">
        <h1>Applications</h1>
        <span className="muted small">{list.data ? `${list.data.total} matching` : ''}</span>
      </div>
      <div className="card filters" role="search">
        <label>Search<input id="f-q" placeholder="Application no. or institution" value={filters.q ?? ''} onChange={(e) => set('q', e.target.value)} /></label>
        <label>Status
          <select id="f-life" value={filters.lifecycleState ?? ''} onChange={(e) => set('lifecycleState', e.target.value)}>
            <option value="">Any</option>
            {LIFECYCLES.map((l) => <option key={l} value={l}>{humanise(l)}</option>)}
          </select>
        </label>
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
      {list.isLoading ? <div className="card"><Loading /></div>
        : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} />
        : list.data!.rows.length === 0 ? <div className="card"><Empty>No applications match these filters.</Empty></div>
        : <ApplicationTable rows={list.data!.rows} showAssignee={internal} />}
      {list.data && list.data.total > list.data.pageSize && (
        <div className="row">
          <button disabled={list.data.page <= 1} onClick={() => set('page', String(list.data!.page - 1))}>Previous</button>
          <span className="small muted">Page {list.data.page} of {Math.ceil(list.data.total / list.data.pageSize)}</span>
          <button disabled={list.data.page * list.data.pageSize >= list.data.total} onClick={() => set('page', String(list.data!.page + 1))}>Next</button>
        </div>
      )}
      <p className="small muted">Last refreshed {formatDate(new Date(list.dataUpdatedAt || Date.now()).toISOString())}.</p>
    </>
  );
}
