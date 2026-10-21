import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Empty, ErrorState, formatDate, humanise, Loading, MutationError } from '../ui';

export function AuditPage() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api.get<any[]>('/audit?limit=100') });
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true); setError(null);
    try { setResult(await api.post('/audit/verify')); } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="section-head">
        <h1>Audit log</h1>
        <button onClick={verify} disabled={busy}>{busy ? 'Checking…' : 'Verify integrity'}</button>
      </div>
      <p className="small muted">
        Audit rows cannot be changed or deleted by the application. Each row stores a hash of the previous one, so an edit made by anyone
        who bypasses that protection is detected here. This makes tampering detectable; it does not make the log impossible to alter.
      </p>
      <MutationError error={error} />
      {result && (
        <div className={`alert ${result.ok ? 'ok' : 'bad'}`} role="status">
          {result.ok
            ? `Chain intact: ${result.checked} events checked.`
            : `Chain broken at event #${result.firstBrokenId}: ${result.problem}. ${result.checked} events checked.`}
        </div>
      )}
      {q.isLoading ? <div className="card"><Loading /></div> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data!.length === 0 ? <div className="card"><Empty>No events.</Empty></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th className="num">#</th><th>Time</th><th>Actor</th><th>Action</th><th>Case</th><th>Reason</th><th>Rule</th></tr></thead>
            <tbody>
              {q.data!.map((e) => (
                <tr key={e.id}>
                  <td className="num">{e.id}</td>
                  <td className="small">{formatDate(e.at)}</td>
                  <td className="small">{e.actor_name ?? 'System'}<div className="muted">{humanise(e.actor_role)}</div></td>
                  <td>{humanise(e.action)}<div className="small muted">{e.entity_type}</div></td>
                  <td>{e.app_no ? <Link className="mono" to={`/applications/${e.application_id}`}>{e.app_no}</Link> : '—'}</td>
                  <td className="small">{e.reason ?? '—'}</td>
                  <td className="small mono">{e.rule_ref ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
