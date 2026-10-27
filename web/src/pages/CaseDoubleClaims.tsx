import {useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {useCommand} from '../caseCommand';
import {Disclosure,MutationError,Provenance,Status,formatDate,humanise} from '../ui';
export function DoubleClaimSummary({claims}:{claims:any[]}) {
 return <>{claims.map(c=><div className="finale-claim" key={c.id+c.ownClaimId}>
  <p><strong>{c.resource}</strong> · {humanise(c.kind)} · <Status value={c.state} label={c.state==='OPEN'?'Needs officer review':`Officer view: ${humanise(c.state)}`}/></p>
  <p className="small mono">{c.identityKey}{c.programmeCode?` · ${c.programmeCode}`:''}</p>
  <p className="small">{formatDate(c.periodFrom,false)} – {c.periodTo?formatDate(c.periodTo,false):'Open-ended claim'}</p>
  {c.otherClaims.map((a:any)=><p key={a.applicationId}><Link to={`/applications/${a.applicationId}`}>{a.appNo}</Link></p>)}
  {c.outsideScope&&<p>Also claimed by another institution outside your scope</p>}
  {c.sameCase&&<p>Also claimed by a different programme on this case</p>}
  {c.note&&<p><strong>Officer note:</strong> {c.note}</p>}
  <p className="small muted">Exact identity and overlapping dates. <Provenance value={c.provenance}/></p>
 </div>)}</>;
}
function Review({v,flagId,flagVersion}:{v:any;flagId:string;flagVersion:number}) {
 const cmd=useCommand(v);const [note,setNote]=useState(''),[outcome,setOutcome]=useState('EXPLAINED'),[visible,setVisible]=useState(false);
 async function submit(e:FormEvent){e.preventDefault();if(await cmd.run('REVIEW_DOUBLE_CLAIM',{flagId,expectedFlagVersion:flagVersion,outcome,note,visibleToInstitution:visible}))setNote('');}
 return <form className="stack" onSubmit={submit}>
  <label>Officer view<select value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="EXPLAINED">Explained</option><option value="CONFIRMED">Confirmed by officer</option></select></label>
  <label>Review note<textarea required minLength={20} maxLength={4000} value={note} onChange={e=>setNote(e.target.value)}/></label>
  <label className="check"><input type="checkbox" checked={visible} onChange={e=>setVisible(e.target.checked)}/>Share this note with this case's institution</label>
  <p className="small muted">This records your view only. Raise any finding through the existing findings action.</p>
  <button disabled={!!cmd.busy}>{cmd.busy?'Saving…':'Record claim review'}</button><MutationError error={cmd.error}/>
 </form>;
}
export function DoubleClaimsPanel({v}:{v:any}) {
 const flags=v.doubleClaims??[],unique=[...new Set<string>(flags.map((x:any)=>x.id))];
 const can=v.permittedCommands.some((x:any)=>x.command==='REVIEW_DOUBLE_CLAIM'&&x.allowed);
 return <Disclosure title="Double claims" subtitle="Exact resource identities and overlapping periods; flags only" icon="users" count={unique.length}>
  {!flags.length?<p>No overlapping resource claims recorded on this case.</p>:unique.map(id=><section className="stack" key={id}><DoubleClaimSummary claims={flags.filter((x:any)=>x.id===id)}/>{can&&<Review v={v} flagId={id} flagVersion={flags.find((x:any)=>x.id===id).rowVersion}/>}</section>)}
 </Disclosure>;
}
