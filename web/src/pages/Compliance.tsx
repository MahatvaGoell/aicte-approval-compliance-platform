import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api,qs } from '../api';
import { useSession } from '../session';
import { Empty,ErrorState,formatDate,Loading,Status } from '../ui';

export function CompliancePage({kind}:{kind:'documents'|'obligations'}) {
 const {can}=useSession(),[page,setPage]=useState(1),[state,setState]=useState(''),[onlyMine,setMine]=useState(false),[pending,setPending]=useState(false);
 const query=useQuery({queryKey:[kind,page,state,onlyMine,pending],queryFn:()=>api.get<any>(`/${kind}${qs({page,state:kind==='obligations'?state:undefined,assigned:onlyMine?'true':undefined,pending:pending?'true':undefined})}`),refetchInterval:30_000});
 return <><header className="stack"><h1>{kind==='documents'?'Document register':'Obligations & verification'}</h1><p className="muted">Your active scope only · refreshes every 30 seconds. Open a case for exact versions, receipts and authorised actions.</p></header>
  <section className="card stack"><div className="row">
   {kind==='documents'?<label className="row"><input type="checkbox" checked={pending} onChange={e=>{setPending(e.target.checked);setPage(1);}}/>Awaiting document verification only</label>:<><label>Obligation state<select value={state} onChange={e=>{setState(e.target.value);setPage(1);}}><option value="">All states</option>{['OPEN','EVIDENCE_SUBMITTED','UNDER_VERIFICATION','FULFILLED','CLOSED_WITH_AUTHORISED_REASON'].map(s=><option key={s}>{s}</option>)}</select></label>
    {can('EVIDENCE_VERIFY')&&<label className="row"><input type="checkbox" checked={onlyMine} onChange={e=>{setMine(e.target.checked);setPage(1);}}/>Assigned to me</label>}</>}
  </div>{query.isLoading?<Loading/>:query.error?<ErrorState error={query.error} onRetry={()=>query.refetch()}/>:<>
   <p className="small muted">{query.data.total} records · refreshed {formatDate(query.data.refreshedAt)}</p>
   {query.data.rows.length?<div className="table-wrap"><table><thead><tr><th>Case</th><th>{kind==='documents'?'Document / latest version':'Condition / verifier'}</th><th>State</th><th>{kind==='documents'?'Received':'Submission / verification due'}</th></tr></thead><tbody>{query.data.rows.map((r:any)=><tr key={r.id}><td><Link to={`/applications/${r.application_id}#${kind==='documents'?'document':'obligation'}-${r.id}`}>{r.app_no}</Link></td><td>{kind==='documents'?<>{r.title} · v{r.version_no}<div className="small muted">{r.document_type} · {r.visibility}</div></>:<>{r.condition_text}<div className="small muted">{r.verifier} · {r.institution}</div></>}</td><td><Status value={r.state??r.review_state}/></td><td>{kind==='documents'?formatDate(r.received_at):<>Submission: {formatDate(r.submission_due_at)}<br/>Verification: {formatDate(r.verification_due_at)}</>}</td></tr>)}</tbody></table></div>:<Empty>No records match your active scope and filters.</Empty>}
   <div className="row"><button className="secondary" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page}</span><button className="secondary" disabled={page*50>=query.data.total} onClick={()=>setPage(p=>p+1)}>Next</button></div>
  </>}</section>
 </>;
}
