import {useQuery} from '@tanstack/react-query';
import {useParams} from 'react-router-dom';
import {api} from '../api';
import {ErrorState,Loading,Postmark,Status,formatDate} from '../ui';
import {LetterFields} from './CaseLetters';
export function VerifyLetterPage() {
 const {token=''}=useParams();
 const q=useQuery({queryKey:['public-letter',token],queryFn:()=>api.get<any>(`/public/verify/${encodeURIComponent(token)}`),retry:false});
 return <main className="finale-verify stack"><header><h1>Verify a demo approval letter</h1><p>Verifies letters issued by this demo system only.</p></header>
  {q.isLoading?<Loading rows={5}/>:q.error?<ErrorState error={q.error} onRetry={()=>q.refetch()}/>:q.data&&<>
   <section className="card stack" aria-live="polite"><div className="row"><Status value={q.data.signatureValid&&q.data.issuedBySystem?'SATISFIED':'DEFICIENT'} label={q.data.message}/><Postmark top="DEMO KEY" date="Ed25519" bottom="DEMO ONLY" label="Demo signing key"/></div>
    {q.data.signedAtIssue&&<><h2>Signed at issue</h2><LetterFields payload={q.data.signedAtIssue}/></>}
   </section>
   {q.data.currentRecord&&<section className="card stack"><h2>Current record (checked now)</h2>
    {q.data.currentRecord.recorded?<><p><Status value={q.data.currentRecord.revoked?'REJECTED':'VALID'} label={q.data.currentRecord.revoked?'Letter revoked':'Letter not revoked'}/></p>{q.data.currentRecord.revokedAt&&<p>Revoked {formatDate(q.data.currentRecord.revokedAt)}</p>}<p>Open conditions: <b className="mono">{q.data.currentRecord.openConditionsCount??'Not recorded'}</b></p></>:<p>Issue record not found. Current status is not recorded.</p>}
    <p className="small muted">Checked {formatDate(q.data.checkedAt)}. Open conditions include recorded conditions not yet tracked as obligations.</p>
   </section>}
   <p className="small muted">The signature verifies the issue snapshot. It does not verify document authenticity or approvals issued by any other system.</p>
  </>}
 </main>;
}
