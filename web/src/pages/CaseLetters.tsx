import {useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {useCommand} from '../caseCommand';
import {Disclosure,MutationError,NamePlate,Postmark,Status,formatDate,humanise} from '../ui';
export function LetterFields({payload:p}:{payload:any}) {
 return <dl className="kv finale-letter-fields"><dt>Letter number</dt><dd className="mono">{p.letter_no}</dd><dt>Application</dt><dd className="mono">{p.app_no}</dd><dt>Institution</dt><dd>{p.institution_name}</dd><dt>Category</dt><dd>{humanise(p.category)}</dd><dt>Recorded outcome</dt><dd><Status value={p.outcome}/></dd><dt>Decision date</dt><dd>{formatDate(p.decision_date)}</dd><dt>Intake in submitted proposal</dt><dd className="mono">{p.intake??'Not recorded'}</dd><dt>Conditions at issue</dt><dd className="mono">{p.conditions}</dd><dt>Policy version</dt><dd className="mono">{p.policy_version}</dd><dt>Demo signing key</dt><dd className="mono">{p.key_id}</dd></dl>;
}
function Revoke({v,letter}:{v:any;letter:any}) {
 const cmd=useCommand(v),[reason,setReason]=useState('');
 async function submit(e:FormEvent){e.preventDefault();if(await cmd.run('REVOKE_LETTER',{letterId:letter.id,reason}))setReason('');}
 return <form className="stack finale-no-print" onSubmit={submit}><label>Reason for revoking this letter<textarea value={reason} required maxLength={2000} onChange={e=>setReason(e.target.value)}/></label><div><button className="danger" disabled={!!cmd.busy}>{cmd.busy?'Recording…':'Revoke demo letter'}</button></div><MutationError error={cmd.error}/></form>;
}
export function ApprovalLettersPanel({v}:{v:any}) {
 const letters=v.approvalLetters??[];const [selected,setSelected]=useState('');
 if(!letters.length)return null;
 const letter=letters.find((l:any)=>l.id===selected)??letters[letters.length-1];
 const can=v.permittedCommands.some((c:any)=>c.command==='REVOKE_LETTER'&&c.allowed);
 return <Disclosure title="Approval letter" subtitle="Signed demo letter, printable copy and verification QR" icon="document" count={letters.length}>
  {letters.length>1&&<label className="finale-no-print">Issued letter<select value={letter.id} onChange={e=>setSelected(e.target.value)}>{letters.map((l:any)=><option key={l.id} value={l.id}>{l.letterNo}</option>)}</select></label>}
  <LetterDocument letter={letter}/>
  <div className="row finale-no-print"><Link className="btn" to={`/applications/${v.application.id}/letters/${letter.id}/print`} target="_blank" rel="noopener">Print letter</Link><Link className="btn secondary" to={`/verify/${letter.token}`}>Open public verification</Link></div>
  {can&&!letter.revokedAt&&<Revoke v={v} letter={letter}/>}
 </Disclosure>;
}

export function LetterDocument({letter}:{letter:any}) {return (<article className="finale-letter">
   <header className="finale-letter-head"><div><h2>Demo approval letter</h2><NamePlate name={letter.payload.institution_name} role="Institution in signed proposal"/></div><Postmark top="DEMO KEY" date={formatDate(letter.issuedAt,false)} bottom="SIGNED" label="Signed with a demo key"/></header>
   <h3>Signed at issue</h3><LetterFields payload={letter.payload}/>
   {letter.revokedAt&&<p><Status value="REJECTED" label="Letter revoked"/> {formatDate(letter.revokedAt)} · {letter.revokeReason}</p>}
   <div className="finale-qr"><img src={letter.qrDataUrl} width={192} height={192} alt="QR code to verify this demo letter"/><div><p><Link to={`/verify/${letter.token}`}>Verify this letter and check the current record</Link></p><p className="small">DEMO KEY · Verifies letters issued by this demo system only.</p><p className="small muted">The signature covers the issue snapshot. Revocation and open conditions are checked separately when you verify.</p></div></div>
  </article>);}
