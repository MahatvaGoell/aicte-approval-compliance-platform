import { Link } from 'react-router-dom';
import { useSession } from '../session';
import { Empty, ErrorState, Loading } from '../ui';
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

  return (
    <>
      <div className="section-head">
        <h1>{isInstitution ? 'Your applications' : 'Cases assigned to you'}</h1>
        {isInstitution && can('APPLICATION_CREATE') && <Link className="btn primary" to="/applications/new">New application</Link>}
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
