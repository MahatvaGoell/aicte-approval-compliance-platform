import { formatDate, Postmark, stampDate, Status } from '../ui';

// The integrity result keeps the seal layout from the audit ledger: a postmark when the local chain is intact,
// a rubber stamp when it is not, with the witness check reported next to it.
export function AuditIntegrityResult({ result }: { result: any }) {
  const local = result.local ?? result, w = result.witness;
  const witnessLabel = !w ? 'Witness unavailable' : w.status === 'PASS' ? 'Witnessed checkpoints match' : w.status === 'FAIL' ? 'Witness mismatch' : w.status === 'NOT_WITNESSED' ? 'No witnessed checkpoint recorded' : 'Witness unavailable';
  return (
    <div className={`seal ${local.ok ? 'ok' : 'bad'}`} role="status" aria-label="Audit integrity result">
      {local.ok
        ? <Postmark top="Chain intact" date={stampDate(result.verifiedAt)} bottom={local.checked !== undefined ? `${local.checked} entries` : 'Audit register'} size={84} land label={`Chain intact, verified ${formatDate(result.verifiedAt)}`} />
        : <span className="rubber bad">Chain broken</span>}
      <div className="seal-text">
        <div className="row"><strong>Local chain</strong><Status value={local.ok ? 'SATISFIED' : 'DEFICIENT'} label={local.ok ? 'Local chain intact' : 'Local chain mismatch'} /></div>
        {!local.ok && <p>{local.problem}{local.firstBrokenId != null ? ` · Event ${local.firstBrokenId}` : ''}</p>}
        {local.checked !== undefined && <p className="small">{local.checked} local events checked.</p>}
        <div className="row"><strong>Witness</strong><Status value={w?.status === 'PASS' ? 'SATISFIED' : w?.status === 'FAIL' ? 'DEFICIENT' : 'PENDING'} label={witnessLabel} /></div>
        {w?.problem && <p>{w.problem}{w.firstBrokenCheckpointId != null ? ` · Checkpoint event ${w.firstBrokenCheckpointId}` : ''}</p>}
        {w?.checked !== undefined && <p className="small">{w.checked} witnessed checkpoints checked.</p>}
        <p className="small muted">Verified {formatDate(result.verifiedAt)}. {result.limits}</p>
      </div>
    </div>
  );
}
