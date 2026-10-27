import { useQueryClient } from '@tanstack/react-query';
import { useRef,useState,type FormEvent } from 'react';
import { api } from '../api';
import { useCommand } from '../caseCommand';
import { useSession } from '../session';
import { DocStamp,formatDate,humanise,MutationError,Provenance,stampDate,Status } from '../ui';

const allowed=(v:any,c:string)=>!!v.permittedCommands.find((p:any)=>p.command===c)?.allowed;
const downloads=(version:any)=><a className="btn secondary" href={`/api/v1/documents/versions/${version.id}/download`}>Download v{version.version_no}</a>;
export function DocumentsCard({v}:{v:any}) {
 return <section className="card stack" aria-labelledby="documents-title"><h2 id="documents-title">Private documents & versions</h2>
  <p className="small muted">Upload, metadata confirmation and verification are separate. Files remain private; a hash identifies the bytes, not their authenticity.</p>
  {v.canUploadDocuments&&<details><summary>Upload a document or replacement</summary><UploadDocument v={v}/></details>}
  {!v.documents.length&&<p className="muted">No documents in your current scope.</p>}
  {v.documents.map((d:any)=><article className="evidence-record stack" key={d.id} id={`document-${d.id}`}>
   <div className="doc-head"><div className="stack" style={{gap:4}}><h3>{d.title}</h3><span className="doc-type">{humanise(d.document_type)}</span></div><DocStamp state={d.validity} top={d.verifiedValidThrough?'Valid through':'Verified'} date={d.verifiedValidThrough?stampDate(d.verifiedValidThrough):undefined} bottom="Verified copy" size={78}/></div>
   <div className="row"><Status value={d.validity}/><Status value={d.visibility}/>{d.replacementPending&&<Status value="EVIDENCE_SUBMITTED" label="Replacement awaiting verification"/>}</div>
   <p className="small">{humanise(d.document_type)} · current verified: {d.current_verified_version_id?`v${d.versions.find((x:any)=>x.id===d.current_verified_version_id)?.version_no}`:'None'}{d.verifiedValidThrough&&` · valid through ${d.verifiedValidThrough}`}</p>
   {d.versions.map((version:any)=><details key={version.id} open={version.id===d.latest_version_id}><summary>Version {version.version_no} · {version.verification_outcome?humanise(version.verification_outcome):'Pending verification'} · {formatDate(version.received_at)}</summary>
    <p className="small mono">{version.filename} · {version.size_bytes} bytes · SHA-256 {version.sha256}</p>{downloads(version)}
    {Object.keys(version.declared_metadata).length>0&&<p className="small pre">Uploader-suggested metadata (unconfirmed): {JSON.stringify(version.declared_metadata)}</p>}
    {version.confirmed_values&&<p className="small pre">Reviewer-confirmed metadata: {JSON.stringify(version.confirmed_values)}</p>}
    {version.verification_reason&&<p>Verification reason: {version.verification_reason}</p>}
    {!version.verification_outcome&&allowed(v,'REVIEW_DOCUMENT_METADATA')&&<DocumentReview key={version.id} v={v} version={version}/>}
   </details>)}
  </article>)}
  {allowed(v,'ATTACH_DOCUMENT')&&<AttachmentForm v={v}/>}
  {v.attachments.length>0&&<details><summary>Response / visit evidence attachments</summary><ul>{v.attachments.map((a:any)=><li key={a.id}>{a.target_kind} · {a.title} · <a href={`/api/v1/documents/versions/${a.version_id}/download`}>{a.filename}</a></li>)}</ul></details>}
 </section>;
}
function UploadDocument({v}:{v:any}) {
 const qc=useQueryClient(),{can}=useSession(),fileInput=useRef<HTMLInputElement>(null);
 const [file,setFile]=useState<File|null>(null),[documentId,setDocumentId]=useState(''),[title,setTitle]=useState(''),[type,setType]=useState(v.documentTypes[0]?.code??''),[visibility,setVisibility]=useState('INSTITUTION');
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
 const previous=v.documents.find((d:any)=>d.id===documentId);
 async function submit(e:FormEvent){e.preventDefault();if(!file)return;setBusy(true);setError(null);try{
  const data=new FormData();data.append('metadata',JSON.stringify({expectedVersion:v.application.rowVersion,title:previous?.title??title,documentType:previous?.document_type??type,visibility:previous?.visibility??visibility,
   ...(previous?{documentId:previous.id,documentExpectedVersion:previous.row_version}:{})}));data.append('file',file);
  await api.upload(`/applications/${v.application.id}/documents/uploads`,data);await qc.invalidateQueries({queryKey:['case',v.application.id]});qc.invalidateQueries({queryKey:['documents']});qc.invalidateQueries({queryKey:['timeline',v.application.id]});setFile(null);if(fileInput.current)fileInput.current.value='';
 }catch(e){setError(e);qc.invalidateQueries({queryKey:['case',v.application.id]});}finally{setBusy(false);}}
 return <form className="stack" onSubmit={submit}>
  <label>Document<select value={documentId} onChange={e=>setDocumentId(e.target.value)}><option value="">New document</option>{v.documents.map((d:any)=><option key={d.id} value={d.id}>Replacement for {d.title}</option>)}</select></label>
  {!previous&&<><label>Document title<input value={title} onChange={e=>setTitle(e.target.value)} minLength={3} maxLength={200} required/></label><label>Document type<select value={type} onChange={e=>setType(e.target.value)}>{v.documentTypes.map((t:any)=><option value={t.code} key={t.code}>{t.name}</option>)}</select></label>
   {can('INTERNAL_NOTES_VIEW')&&<label>Document visibility<select value={visibility} onChange={e=>setVisibility(e.target.value)}><option value="INSTITUTION">Institution visible</option><option value="INTERNAL">Internal only</option></select></label>}</>}
  <label className="upload-zone">Evidence file (PDF, PNG or JPEG)<input ref={fileInput} type="file" accept=".pdf,.png,.jpg,.jpeg" required onChange={e=>setFile(e.target.files?.[0]??null)}/><span className="hint">{file ? `${file.name} · ${file.size.toLocaleString('en-IN')} bytes selected` : 'Choose a synthetic file to upload'}</span></label>
  <p className="small muted">Synthetic files only. Maximum 10 MB under the default configuration. Byte checks are not malware scanning or authenticity verification.</p>
  <MutationError error={error}/><div><button disabled={busy||!file}>{busy?'Uploading…':'Upload pending verification'}</button></div>
 </form>;
}
function DocumentReview({v,version}:{v:any;version:any}) {
 const cmd=useCommand(v),base=version.confirmed_values??{};
 const [fields,setFields]=useState<Record<string,string>>({institutionName:base.institutionName??'',campusAddress:base.campusAddress??'',landAreaAcres:base.landAreaAcres?.toString()??'',issuedOn:base.issuedOn??'',validThrough:base.validThrough??'',page:base.page?.toString()??'',excerpt:base.excerpt??''});
 const [reason,setReason]=useState('');
 const payload={versionId:version.id,reason};
 async function metadata(e:FormEvent){e.preventDefault();const values:Record<string,unknown>={};for(const[k,val]of Object.entries(fields))if(val.trim())values[k]=['landAreaAcres','page'].includes(k)?Number(val):val;await cmd.run('REVIEW_DOCUMENT_METADATA',{...payload,values});}
 return <div className="stack"><form className="stack" onSubmit={metadata}>
  <h4>Human metadata review</h4><p className="small muted">Enter only values you confirmed from this exact version. Leave unavailable values blank.</p>
  <div className="form-grid">{[['institutionName','Institution name','text'],['campusAddress','Campus address','text'],['landAreaAcres','Land area (acres)','number'],['issuedOn','Issue date','date'],['validThrough','Valid through','date'],['page','Evidence page','number']].map(([key,label,type])=><label key={key}>{label}<input type={type} step={key==='landAreaAcres'?'any':undefined} value={fields[key]} onChange={e=>setFields(old=>({...old,[key]:e.target.value}))}/></label>)}</div>
  <label>Evidence excerpt<textarea value={fields.excerpt} maxLength={2000} onChange={e=>setFields(old=>({...old,excerpt:e.target.value}))}/></label>
  <label>Metadata / verification reason<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={10} required/></label><div><button className="secondary" disabled={!!cmd.busy}>Confirm metadata</button></div>
 </form><div className="row"><button disabled={!!cmd.busy||reason.trim().length<10||!version.metadata_review_id} onClick={()=>cmd.run('VERIFY_DOCUMENT',{...payload,outcome:'ACCEPT',metadataReviewId:version.metadata_review_id})}>Accept document version</button><button className="secondary" disabled={!!cmd.busy||reason.trim().length<10} onClick={()=>cmd.run('VERIFY_DOCUMENT',{...payload,outcome:'REJECT'})}>Reject document version</button></div><MutationError error={cmd.error}/></div>;
}
export function ObligationsCard({v}:{v:any}) {
 return <section className="card stack" aria-labelledby="obligations-title"><h2 id="obligations-title">Condition → evidence → verification</h2>
  <p className="small muted">Approval outcome: {v.application.decisionOutcome??'Pending'} · Compliance: {v.application.complianceStatus}. A receipt preserves submission timeliness independently of officer review.</p>
  {allowed(v,'CREATE_OBLIGATION')&&<CreateObligation v={v}/>}
  {!v.obligations.length&&<p className="muted">No tracked obligations yet. Recorded conditions remain open until explicitly tracked and fulfilled or closed by an authority.</p>}
  {v.obligations.map((o:any)=><Obligation key={o.id} v={v} o={o}/>)}
 </section>;
}
function CreateObligation({v}:{v:any}) {
 const cmd=useCommand(v),{me}=useSession();
 const available=(v.decision?.conditions??[]).map((c:any,i:number)=>({...c,index:i})).filter((c:any)=>!v.obligations.some((o:any)=>o.decision_id===v.decision.id&&o.condition_index===c.index));
 const [index,setIndex]=useState(''),[type,setType]=useState(v.documentTypes[0]?.code??''),[verifier,setVerifier]=useState(v.verifierCandidates.find((u:any)=>u.id===me.user.id)?.id??v.verifierCandidates[0]?.id??''),[due,setDue]=useState(''),[reason,setReason]=useState('');
 const selected=available.find((c:any)=>String(c.index)===index);
 if(!available.length)return null;
 return <details><summary>Track a recorded approval condition</summary><form className="stack" onSubmit={async e=>{e.preventDefault();if(await cmd.run('CREATE_OBLIGATION',{conditionIndex:Number(index),requiredDocumentType:type,verifierUserId:verifier,reason,...(!selected?.dueInDays?{dueDate:due}:{})}))setIndex('');}}>
  <label>Recorded condition<select value={index} onChange={e=>setIndex(e.target.value)} required><option value="">Choose a condition</option>{available.map((c:any)=><option value={c.index} key={c.index}>{c.index+1}. {c.text}</option>)}</select></label>
  <label>Required document type<select value={type} onChange={e=>setType(e.target.value)}>{v.documentTypes.map((t:any)=><option value={t.code} key={t.code}>{t.name}</option>)}</select></label>
  <label>Assigned verifier<select value={verifier} onChange={e=>setVerifier(e.target.value)}>{v.verifierCandidates.map((u:any)=><option value={u.id} key={u.id}>{u.name}</option>)}</select></label>
  {selected?.dueInDays?<p>{selected.dueInDays} calendar days from the recorded decision (demo condition).</p>:<label>Explicit due date<input type="date" value={due} onChange={e=>setDue(e.target.value)} required/></label>}
  <label>Condition / due-basis reason<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={10} required/></label><MutationError error={cmd.error}/><div><button disabled={!!cmd.busy||!selected}>Create obligation</button></div>
 </form></details>;
}
function Obligation({v,o}:{v:any;o:any}) {
 const cmd=useCommand(v),{me}=useSession();const [reason,setReason]=useState(''),[versions,setVersions]=useState<string[]>([]);
 const current=o.submissions.find((s:any)=>s.id===o.current_submission_id),assigned=o.verifier_user_id===me.user.id;
 const payload={obligationId:o.id,obligationExpectedVersion:o.row_version,reason};
 return <article className="evidence-record stack ad-card" id={`obligation-${o.id}`}>
  <div className="row"><h3>Approval condition {o.condition_index+1}</h3><Status value={o.state}/>{o.overdue&&<Status value="OVERDUE"/>}<Provenance value={o.provenance}/></div><p>{o.condition_text}</p>
  <dl className="kv small"><dt>Decision</dt><dd className="mono">{o.decision_id}</dd><dt>Required evidence</dt><dd>{o.required_document_type}</dd><dt>Due</dt><dd>{formatDate(o.current_due_date,false)} · original {formatDate(o.original_due_date,false)}</dd><dt>Rule</dt><dd>{o.rule_ref}</dd><dt>Verifier</dt><dd>{o.verifier_name}</dd><dt>Verification due</dt><dd>{formatDate(o.verificationClock?.current_due_at)}</dd></dl>
  {o.submissions.map((s:any)=><details key={s.id} open={s.id===o.current_submission_id}><summary>Receipt #{s.receipt_no} · {s.on_time?'On time':'Late'} · {s.outcome??'Awaiting verification'}</summary><p className="small">Received {formatDate(s.received_at)} · effective due at receipt {formatDate(s.effective_due_at)} · generation {s.deadline_generation}</p><ul>{s.documents.map((d:any)=><li key={d.id}><a href={`#document-${d.document_id}`}>{d.title} v{d.version_no}</a> · <a href={`/api/v1/documents/versions/${d.id}/download`}>Download exact evidence</a><span className="small mono"> · {d.sha256}</span></li>)}</ul>{s.verification_reason&&<p>Result: {s.verification_reason}</p>}</details>)}
  {o.closed_reason&&<p>Closure reason: {o.closed_reason}</p>}
  {o.state==='OPEN'&&allowed(v,'SUBMIT_EVIDENCE')&&<fieldset className="stack"><legend>Choose exact evidence versions</legend>{v.documents.filter((d:any)=>d.visibility==='INSTITUTION').flatMap((d:any)=>d.versions.map((version:any)=><label className="row" key={version.id}><input type="checkbox" checked={versions.includes(version.id)} onChange={e=>setVersions(old=>e.target.checked?[...old,version.id]:old.filter(x=>x!==version.id))}/>{d.title} v{version.version_no} · {version.verification_outcome??'Unverified'}</label>))}</fieldset>}
  {!['FULFILLED','CLOSED_WITH_AUTHORISED_REASON'].includes(o.state)&&<label>Evidence / review reason<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={10}/></label>}
  <div className="row">
   {o.state==='OPEN'&&allowed(v,'SUBMIT_EVIDENCE')&&<button disabled={!!cmd.busy||reason.trim().length<10||!versions.length} onClick={()=>cmd.run('SUBMIT_EVIDENCE',{...payload,versionIds:versions})}>Submit evidence & issue receipt</button>}
   {o.state==='EVIDENCE_SUBMITTED'&&assigned&&allowed(v,'BEGIN_VERIFICATION')&&<button disabled={!!cmd.busy||reason.trim().length<10} onClick={()=>cmd.run('BEGIN_VERIFICATION',payload)}>Start evidence verification</button>}
   {o.state==='UNDER_VERIFICATION'&&assigned&&allowed(v,'VERIFY_EVIDENCE')&&<><button disabled={!!cmd.busy||reason.trim().length<10} onClick={()=>cmd.run('VERIFY_EVIDENCE',{...payload,submissionId:current.id,outcome:'ACCEPT'})}>Accept evidence & fulfil this obligation</button><button className="secondary" disabled={!!cmd.busy||reason.trim().length<10} onClick={()=>cmd.run('VERIFY_EVIDENCE',{...payload,submissionId:current.id,outcome:'REJECT'})}>Reject evidence & reopen</button></>}
   {!['FULFILLED','CLOSED_WITH_AUTHORISED_REASON'].includes(o.state)&&allowed(v,'CLOSE_OBLIGATION')&&<button className="secondary" disabled={!!cmd.busy||reason.trim().length<10} onClick={()=>cmd.run('CLOSE_OBLIGATION',payload)}>Authorised closure with reason</button>}
  </div><MutationError error={cmd.error}/>
 </article>;
}
function AttachmentForm({v}:{v:any}) {
 const cmd=useCommand(v),[target,setTarget]=useState(''),[version,setVersion]=useState(''),[reason,setReason]=useState('');
 const targets=[...v.findings.filter((f:any)=>f.state==='RESPONSE_SUBMITTED').flatMap((f:any)=>f.responses.slice(-1).map((r:any)=>({key:`FINDING_RESPONSE:${r.id}`,name:`Finding response: ${f.reasonCode}`}))),
  ...v.evc.visits.filter((x:any)=>x.state==='REPORT_SUBMITTED').flatMap((x:any)=>x.reports.slice(-1).flatMap((r:any)=>[{key:`VISIT_REPORT:${r.id}`,name:`Visit report revision ${r.revision}`},...r.findings.map((f:any)=>({key:`VISIT_FINDING:${f.id}`,name:`Visit finding: ${f.requirement}`}))]))];
 return <details><summary>Attach evidence to a submitted response / report</summary><form className="stack" onSubmit={e=>{e.preventDefault();const[targetKind,targetId]=target.split(':');void cmd.run('ATTACH_DOCUMENT',{versionId:version,targetKind,targetId,reason});}}>
  <label>Attachment target<select value={target} onChange={e=>setTarget(e.target.value)} required><option value="">Choose a response or report</option>{targets.map(t=><option key={t.key} value={t.key}>{t.name}</option>)}</select></label>
  <label>Exact document version<select value={version} onChange={e=>setVersion(e.target.value)} required><option value="">Choose a version</option>{v.documents.flatMap((d:any)=>d.versions.map((x:any)=><option key={x.id} value={x.id}>{d.title} v{x.version_no}</option>))}</select></label>
  <label>Attachment reason<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={10} required/></label><MutationError error={cmd.error}/><div><button disabled={!!cmd.busy}>Link immutable version</button></div>
 </form></details>;
}
