import { Link } from 'react-router-dom';
import { useSession } from '../session';
import { Icon } from '../motion';
import { Empty, ErrorState, Loading, NamePlate } from '../ui';
import { ApplicationTable, useApplications } from './Applications';

export function HomePage() {
  const { me, can } = useSession();
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
    <>
      <header className="counter-head">
        <div>
          <h1>{isInstitution ? 'Your workspace.' : 'Your work.'}</h1>
          <p className="lede">{isInstitution ? 'Start an application or continue an existing one. Every step it takes is dated and kept on record.' : 'Open a case to see the next action, who holds it and when it is due.'}</p>
          <NamePlate name={me.user.name} role={`${me.activeGrant.roleLabel} · ${me.activeGrant.scope}`} />
        </div>
        <div className="counter-slip">
          <span className="urgency u-calm"><b>{total ?? '—'}</b><span>{isInstitution ? 'applications in your workspace' : total === 1 ? 'case assigned to you' : 'cases assigned to you'}</span></span>
          <p>{isInstitution ? 'Save a draft and return when you are ready to submit.' : 'The case workspace keeps actions, evidence and history together.'}</p>
          {isInstitution && can('APPLICATION_CREATE') ? <Link className="btn primary" to="/applications/new"><Icon name="plus" />New application</Link> : <Link className="btn primary" to="/applications">Browse applications<Icon name="arrow" /></Link>}
        </div>
      </header>
      <div className="section-head work-list-heading">
        <h2>{isInstitution ? 'Your applications' : 'Cases assigned to you'}</h2>
        {mine.data && <span className="small muted">{mine.data.total} on record</span>}
      </div>
      {mine.isLoading ? <div className="card"><Loading /></div>
        : mine.error ? <ErrorState error={mine.error} onRetry={() => mine.refetch()} />
        : mine.data!.rows.length === 0 ? (
          <div className="card">
            <Empty>{isInstitution ? 'No applications yet. Start one with "New application".' : 'Nothing is assigned to you right now.'}</Empty>
          </div>
        ) : <ApplicationTable rows={mine.data!.rows} showAssignee={!isInstitution} />}
    </>
  );
}
