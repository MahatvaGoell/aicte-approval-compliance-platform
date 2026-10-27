import {Status,formatDate} from '../ui';
export function AuditIntegrityResult({result}:{result:any}) {
 const local=result.local??result,w=result.witness;
 const witnessLabel=!w?'Witness unavailable':w.status==='PASS'?'Witnessed checkpoints match':w.status==='FAIL'?'Witness mismatch':w.status==='NOT_WITNESSED'?'No witnessed checkpoint recorded':'Witness unavailable';
 return <section className="card stack" role="status" aria-label="Audit integrity result"><div className="row"><strong>Local chain</strong><Status value={local.ok?'SATISFIED':'DEFICIENT'} label={local.ok?'Local chain intact':'Local chain mismatch'}/></div>
  {!local.ok&&<p>{local.problem}{local.firstBrokenId!=null?` · Event ${local.firstBrokenId}`:''}</p>}
  {local.checked!==undefined&&<p className="small">{local.checked} local events checked.</p>}
  <div className="row"><strong>Witness</strong><Status value={w?.status==='PASS'?'SATISFIED':w?.status==='FAIL'?'DEFICIENT':'PENDING'} label={witnessLabel}/></div>
  {w?.problem&&<p>{w.problem}{w.firstBrokenCheckpointId!=null?` · Checkpoint event ${w.firstBrokenCheckpointId}`:''}</p>}
  {w?.checked!==undefined&&<p className="small">{w.checked} witnessed checkpoints checked.</p>}
  <p className="small muted">Verified {formatDate(result.verifiedAt)}. {result.limits}</p>
 </section>;
}
