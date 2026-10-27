import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { useMeta, useSession } from '../session';
import { Icon } from '../motion';
import { Empty, ErrorState, humanise, Loading, NamePlate, Status } from '../ui';
import { ageDays, ApplicationTable, useApplications, useReference, type ListRow } from './Applications';
import { SEVERITY_LABEL, SEVERITY_TONE, slipTime } from './Notifications';

// Board columns follow the case lifecycle only; nothing here is a prediction or a decision.
const COLUMNS: Array<{ key: string; title: string; hint: string; states: string[] }> = [
  { key: 'start', title: 'Starting', hint: 'Draft, submitted or waiting to be classified', states: ['DRAFT', 'SUBMITTED', 'AWAITING_CLASSIFICATION'] },
  { key: 'live', title: 'In process', hint: 'A stage is running or a decision is awaited', states: ['IN_PROCESS', 'AWAITING_DECISION'] },
  { key: 'record', title: 'On record', hint: 'Decision recorded, closed or withdrawn', states: ['DECISION_RECORDED', 'CLOSED', 'WITHDRAWN'] },
];

function TaskBoard({ rows, showAssignee }: { rows: ListRow[]; showAssignee: boolean }) {
  const ref = useReference();
  const stageName = (k: string | null) => ref.data?.activePolicy.stages.find((s) => s.key === k)?.name ?? humanise(k);
  const catName = (k: string) => ref.data?.activePolicy.categories.find((c) => c.code === k)?.name ?? humanise(k);
  return (
    <div className="board">
      {COLUMNS.map((col) => {
        const items = rows.filter((r) => col.states.includes(r.lifecycle_state));
        return (
          <section key={col.key} className="board-col" aria-label={col.title}>
            <header className="board-head">
              <h3>{col.title}</h3>
              <span className={`board-count num ${items.length ? 'on' : ''}`} aria-label={`${items.length} cases`}>{items.length}</span>
            </header>
            <p className="small muted board-hint">{col.hint}</p>
            {items.length === 0 ? <div className="board-empty">Nothing here</div> : (
              <ul className="board-list">
                {items.map((r) => {
                  const live = r.stage_state && !['COMPLETED', 'CANCELLED'].includes(r.stage_state);
                  const age = live ? ageDays(r.stage_entered_at) : null;
                  return (
                    <li key={r.id}>
                      <Link className="task-card" to={`/applications/${r.id}`}>
                        <span className="task-top">
                          <span className="mono task-no">{r.app_no}</span>
                          {age !== null && <span className="task-age num">{age} d in stage</span>}
                        </span>
                        <strong>{r.institution_name}</strong>
                        <span className="small muted">{catName(r.category_code)}{r.stage_key ? ` · ${stageName(r.stage_key)}` : ''}</span>
                        <span className="task-foot">
                          <Status value={r.stage_state ?? r.lifecycle_state} />
                          {showAssignee && (r.assignee_name ? <NamePlate name={r.assignee_name} /> : <span className="small muted">Unassigned</span>)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Today's date on the demo clock, so the header agrees with the deadlines shown elsewhere. Display only. */
function todayLabel(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

// "Today" panel: the latest notifications as small slips. Real data only; reading here marks nothing as read.
function TodayPanel() {
  const list = useQuery({ queryKey: ['notifications', 'all'], queryFn: () => api.get<any>(`/notifications${qs({ filter: 'all' })}`), refetchInterval: 30_000 });
  const unread: number | undefined = list.data?.unreadCount;
  const latest: any[] = list.data?.items.slice(0, 3) ?? [];
  return (
    <aside className="today ink-panel" aria-labelledby="today-title">
      <header className="today-head">
        <h2 id="today-title">Today</h2>
        <Link to="/notifications" className="today-all">All<Icon name="arrow" /></Link>
      </header>
      {list.isLoading ? <Loading rows={3} /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : (
        <>
          <div className="today-count">
            <b className={`num ${unread ? '' : 'none'}`}>{unread ?? 0}</b>
            <span>{unread === 1 ? 'unread notification' : 'unread notifications'}</span>
          </div>
          {latest.length === 0 ? <p className="small muted">No notifications yet.</p> : (
            <ul className="today-slips">
              {latest.map((n) => (
                <li key={n.id} className={n.readAt ? 'read' : 'unread'}>
                  <Link to={n.applicationId ? `/applications/${n.applicationId}` : '/notifications'}>
                    <span className="today-slip-top">
                      <Status value={SEVERITY_TONE[n.severity]} label={SEVERITY_LABEL[n.severity]} />
                      <time className="mono" dateTime={n.createdAt}>{slipTime(n.createdAt)}</time>
                    </span>
                    <strong>{n.title}</strong>
                    {n.appNo && !n.title.includes(n.appNo) && <span className="mono small muted">{n.appNo}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link className="btn secondary today-open" to="/notifications">Open notifications<Icon name="arrow" /></Link>
        </>
      )}
    </aside>
  );
}

export function HomePage() {
  const { me, can } = useSession();
  const meta = useMeta();
  const [view, setView] = useState<'board' | 'list'>('board');
  const isInstitution = me.activeGrant.role === 'INSTITUTION_REP';
  const canSeeCases = can('APPLICATION_VIEW_SCOPE') || can('APPLICATION_VIEW_ASSIGNED');
  const mine = useApplications(isInstitution ? {} : { assignedToMe: 'true' });

  if (!canSeeCases) {
    return (
      <div className="card stack">
        <h1>Welcome, {me.user.name}</h1>
        <p className="muted">
          Your active role ({me.activeGrant.roleLabel}) manages configuration or administration and has no access to case records.
          Administrative access does not confer regulatory decision powers.
        </p>
        {can('POLICY_VIEW') && <div><Link className="btn primary" to="/policy">Open policy versions</Link></div>}
      </div>
    );
  }

  const total = mine.data?.total;
  return (
    <div className="work">
      <div className="work-main">
        <header className="work-head">
          <div className="work-title">
            <h1>{isInstitution ? 'Your workspace' : 'Your work'}</h1>
            <p className="work-date">{todayLabel(meta.data?.demoClockOffsetMs ?? 0)}</p>
            <NamePlate name={me.user.name} role={`${me.activeGrant.roleLabel} · ${me.activeGrant.scope}`} />
          </div>
          {isInstitution && can('APPLICATION_CREATE')
            ? <Link className="btn primary" to="/applications/new"><Icon name="plus" />New application</Link>
            : <Link className="btn secondary" to="/applications">Browse applications<Icon name="arrow" /></Link>}
        </header>
        <div className="section-head work-list-heading">
          <h2>{isInstitution ? 'Your applications' : 'Cases assigned to you'}{total !== undefined && <span className="board-count num">{total}</span>}</h2>
          <div className="seg" role="group" aria-label="Layout">
            <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}>Board</button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
          </div>
        </div>
        {mine.isLoading ? <div className="card"><Loading /></div>
          : mine.error ? <ErrorState error={mine.error} onRetry={() => mine.refetch()} />
          : mine.data!.rows.length === 0 ? (
            <div className="card">
              <Empty>{isInstitution ? 'No applications yet. Start one with "New application".' : 'Nothing is assigned to you right now.'}</Empty>
            </div>
          ) : view === 'board' ? <TaskBoard rows={mine.data!.rows} showAssignee={!isInstitution} />
          : <ApplicationTable rows={mine.data!.rows} showAssignee={!isInstitution} />}
      </div>
      <TodayPanel />
    </div>
  );
}
