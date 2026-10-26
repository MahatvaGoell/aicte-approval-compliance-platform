import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useSession } from '../session';
import { Empty, ErrorState, formatDate, humanise, Loading, MutationError, Provenance, Status } from '../ui';

const NOTICE='Mock adapter, synthetic data only. Not connected to AICTE or NSWS. Source mirror status is not a local approval decision.';
const REASONS:Record<string,string>={INVALID_IDENTITY:'Missing or invalid source identity',INVALID_RECORD:'Malformed or unsupported source fields',UNKNOWN_CODE:'Unknown source status code',INSTITUTION_UNMAPPED:'Institution code needs reconciliation',IDENTITY_CONFLICT:'Conflicting event ID or revision',INSTITUTION_BINDING_CONFLICT:'Source institution binding conflicts',OUT_OF_ORDER:'Older source revision',SOURCE_TIME_REGRESSION:'Source timestamp moved backward'};
type Counts={accepted:number;duplicate:number;invalid:number;reconciliation:number};
type Cursor={regionId:string;regionName:string;rowVersion:number};
type Run={id:string;regionId:string;mappingVersion:string;state:string;total:number;counts:Counts;startedAt:string;inputKind:string};
type Runs={rows:Run[];total:number;page:number;pageSize:number;syncStates:Cursor[];refreshedAt:string};
type QueueRow={id:string;runId:string;regionId:string;mappingVersion:string;state:string;reasonCode:string;externalId:string|null;eventId:string|null;revision:string|null;rowVersion:number;lastOutcome:string|null;lastReasonCode:string|null};
type Queue={rows:QueueRow[];total:number;page:number;pageSize:number;refreshedAt:string};
type Review={
  item:Omit<QueueRow,'revision'>&{revision:number|null;cursorVersion:number;canResolve:boolean;canCorrect:boolean;canCorrectInstitution:boolean;resolutionReason:string|null};
  raw:{id:string;payload:unknown;sha256:string;receivedAt:string;importOutcome:string;validationDetails:unknown};runCounts:Counts&{total:number};
  currentMirror:null|{sourceTitle:string;sourceStatus:string;revision:number;sourceUpdatedAt:string;institutionCode:string;rowVersion:number;latestResolutionId:string|null};
  statusCodes:Array<{code:string;mirrorStatus:string}>;institutionOptions:Array<{code:string;name:string}>;
  attempts:Array<{id:string;action:string;outcome:string;reason:string;reasonCode:string|null;recordedAt:string;recordedBy:string;corrections:unknown;evaluatedRecord:unknown;mirrorBefore:unknown;mirrorAfter:unknown}>;
};
type Resolution={attempt:{outcome:string;reasonCode:string|null};item:{state:string}};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const reasonLabel=(value:string|null)=>value?REASONS[value]??humanise(value):'—';

function useRefreshIntegration() {
  const qc=useQueryClient();
  return ()=>Promise.all(['integration-catalogue','integration-runs','integration-queue','integration-item','audit'].map(key=>qc.invalidateQueries({queryKey:[key]})));
}
function Pager({page,total,pageSize,busy,onPage,label}:{page:number;total:number;pageSize:number;busy:boolean;onPage:(p:number)=>void;label:string}) {
  const pages=Math.max(1,Math.ceil(total/pageSize));
  return <div className="row" aria-label={`${label} pages`}><button className="secondary" disabled={page<=1||busy} onClick={()=>onPage(page-1)}>Previous {label}</button><span>Page {page} of {pages}</span><button className="secondary" disabled={page>=pages||busy} onClick={()=>onPage(page+1)}>Next {label}</button></div>;
}
function RefreshNote({at,busy}:{at:string;busy:boolean}) {return <p className="small muted">Refreshed {formatDate(at)} · polls every 30 s{busy?' · refreshing…':''}</p>;}
function FailedRefresh({retry}:{retry:()=>void}) {return <div className="alert warn" role="alert">The last refresh failed; this view may be out of date. <button onClick={retry}>Retry now</button></div>;}

function SyncForm({states,region,onDone}:{states:Cursor[];region:string;onDone:(region:string,run:Run)=>void}) {
  const refresh=useRefreshIntegration(),[selected,setSelected]=useState(region||(states.length===1?states[0].regionId:'')),[reason,setReason]=useState('');
  const sync=useMutation({mutationFn:()=>api.post<{run:Run}>('/integration/sync',{regionId:selected,expectedVersion:states.find(s=>s.regionId===selected)?.rowVersion,fixture:'portal-export',reason}),
    onSuccess:async result=>{await refresh();onDone(selected,result.run);},onError:()=>refresh()});
  return <section className="card stack" aria-label="Run mock import"><h2>Run synthetic portal fixture</h2><p className="small muted">Loads the checked-in fixture for one region. Retrying identical source records counts duplicates; it does not overwrite a newer mirror or reopen closed queue items.</p>
    <form className="stack" onSubmit={e=>{e.preventDefault();sync.mutate();}}><div className="form-grid"><label>Import region<select value={selected} onChange={e=>setSelected(e.target.value)} required disabled={sync.isPending}><option value="">Choose a region</option>{states.map(s=><option key={s.regionId} value={s.regionId}>{s.regionName}</option>)}</select></label><label>Import reason<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={10} maxLength={2000} required/></label></div><MutationError error={sync.error}/><div><button disabled={sync.isPending||reason.trim().length<10||!selected}>{sync.isPending?'Importing…':'Run mock sync'}</button></div></form>
  </section>;
}

function RunHistory({region,page,onPage,onReview}:{region:string;page:string;onPage:(p:number)=>void;onReview:(run:Run)=>void}) {
  const query=useQuery({queryKey:['integration-runs',region,page],queryFn:()=>api.get<Runs>(`/integration/runs${qs({regionId:region,page,pageSize:10})}`),refetchInterval:30_000});
  const data=query.data;
  return <section className="card stack" aria-label="Import runs"><h2>Import runs</h2><p className="small muted">Historical import counts stay fixed. Invalid and reconciliation outcomes both create review items; resolving those items does not rewrite these counts.</p>
    {query.isLoading?<Loading/>:query.error&&!data?<ErrorState error={query.error} onRetry={()=>query.refetch()}/>:data&&<>{query.isError&&<FailedRefresh retry={()=>query.refetch()}/>}<p>{data.total} runs in your active scope.</p><RefreshNote at={data.refreshedAt} busy={query.isFetching}/>
      {!data.rows.length?<Empty>No mock imports yet. A regional operator can run the synthetic fixture.</Empty>:<div className="table-wrap"><table><thead><tr><th>Run / mapping</th><th>Region / time</th><th>Historical outcome counts</th><th>Review</th></tr></thead><tbody>{data.rows.map(run=><tr key={run.id}><td><span className="mono" title={run.id}>{run.id.slice(0,8)}</span><div className="small">{run.mappingVersion} · {run.inputKind}</div><Status value={run.state}/></td><td>{run.regionId}<div className="small">{formatDate(run.startedAt)}</div></td><td>{run.total} total<div className="small">{run.counts.accepted} accepted · {run.counts.duplicate} duplicate · {run.counts.invalid} invalid · {run.counts.reconciliation} reconciliation</div></td><td><button className="secondary" aria-label={`Review queue for run ${run.id}`} onClick={()=>onReview(run)}>Review queue</button></td></tr>)}</tbody></table></div>}
      <Pager page={data.page} pageSize={data.pageSize} total={data.total} busy={query.isFetching} onPage={onPage} label="runs"/>
    </>}
  </section>;
}

function QueueList({region,runId,state,page,onPage,onPick}:{region:string;runId:string;state:string;page:string;onPage:(p:number)=>void;onPick:(id:string)=>void}) {
  const query=useQuery({queryKey:['integration-queue',region,runId,state,page],queryFn:()=>api.get<Queue>(`/integration/reconciliation${qs({regionId:region,runId,state,page,pageSize:10})}`),refetchInterval:30_000}),data=query.data;
  return <section className="card stack" aria-label="Reconciliation queue"><h2>Reconciliation queue</h2>
    {query.isLoading?<Loading/>:query.error&&!data?<ErrorState error={query.error} onRetry={()=>query.refetch()}/>:data&&<>{query.isError&&<FailedRefresh retry={()=>query.refetch()}/>}<p aria-live="polite">{data.total} matching queue items · {state==='ALL'?'all states':humanise(state)}.</p><RefreshNote at={data.refreshedAt} busy={query.isFetching}/>
      {!data.rows.length?<Empty>No reconciliation items match your scope and filters.</Empty>:<div className="table-wrap"><table><thead><tr><th>Source identity</th><th>Reason / mapping</th><th>State</th><th>Review</th></tr></thead><tbody>{data.rows.map(item=><tr key={item.id}><td>{item.externalId??'Identity unavailable'}<div className="small">{item.eventId??'Event unavailable'} · revision {item.revision??'unavailable'}</div><div className="small muted">{item.regionId} · run {item.runId.slice(0,8)}</div></td><td>{reasonLabel(item.reasonCode)}<div className="small">{item.mappingVersion}</div>{item.lastOutcome&&<div className="small">Last check: {humanise(item.lastOutcome)} · {reasonLabel(item.lastReasonCode)}</div>}</td><td><Status value={item.state}/></td><td><button className="secondary" aria-label={`Review source ${item.externalId??item.id}`} onClick={()=>onPick(item.id)}>Open review</button></td></tr>)}</tbody></table></div>}
      <Pager page={data.page} pageSize={data.pageSize} total={data.total} busy={query.isFetching} onPage={onPage} label="queue"/>
    </>}
  </section>;
}

function ReviewActions({data,onResult}:{data:Review;onResult:(result:Resolution)=>void}) {
  const refresh=useRefreshIntegration(),payload=object(data.raw.payload),fields=object(payload.fields);
  const [reason,setReason]=useState(''),[title,setTitle]=useState(typeof fields.title==='string'?fields.title:''),[status,setStatus]=useState(data.statusCodes.some(c=>c.code===fields.statusCode)?String(fields.statusCode):''),
    [timestamp,setTimestamp]=useState(typeof payload.sourceUpdatedAt==='string'?payload.sourceUpdatedAt:''),[institution,setInstitution]=useState('');
  const mutation=useMutation({mutationFn:({action,corrections}:{action:string;corrections?:Record<string,string>})=>api.post<Resolution>(`/integration/reconciliation/${data.item.id}/resolve`,{
    action,expectedVersion:data.item.rowVersion,expectedCursorVersion:data.item.cursorVersion,reason,...(corrections?{corrections}:{})}),onSuccess:async result=>{setReason('');onResult(result);await refresh();},onError:()=>refresh()});
  const ready=reason.trim().length>=10&&!mutation.isPending;
  return <div className="stack"><h3>Reasoned human review</h3><p className="small muted">Source ID, event ID and revision cannot be edited. Reviewed fields affect only the mock mirror. Old revisions, conflicting identities and unsupported source fields may require dismissal and a corrected source export.</p>
    <label>Review reason<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={10} maxLength={2000} required/></label>
    <div className="row"><button className="secondary" disabled={!ready} onClick={()=>mutation.mutate({action:'RETRY'})}>Retry original record</button><button className="secondary" disabled={!ready} onClick={()=>mutation.mutate({action:'DISMISS'})}>Dismiss item with reason</button></div>
    {data.item.canCorrect&&<form className="stack" onSubmit={e=>{e.preventDefault();mutation.mutate({action:'CORRECT_AND_RETRY',corrections:{title,statusCode:status,sourceUpdatedAt:timestamp,...(data.item.canCorrectInstitution?{institutionCode:institution}:{})}});}}>
      <h4>Explicitly reviewed correction</h4><div className="form-grid"><label>Reviewed source title<input value={title} onChange={e=>setTitle(e.target.value)} minLength={3} maxLength={200} required/></label>
      <label>Reviewed source status<select value={status} onChange={e=>setStatus(e.target.value)} required><option value="">Choose a confirmed source code</option>{data.statusCodes.map(code=><option key={code.code} value={code.code}>{code.code} → {humanise(code.mirrorStatus)}</option>)}</select></label>
      <label>Reviewed source timestamp (ISO with timezone)<input value={timestamp} onChange={e=>setTimestamp(e.target.value)} placeholder="2026-10-01T10:00:00+05:30" required/></label>
      {data.item.canCorrectInstitution?<label>Reviewed institution<select value={institution} onChange={e=>setInstitution(e.target.value)} required><option value="">Choose a visible institution</option>{data.institutionOptions.map(inst=><option key={inst.code} value={inst.code}>{inst.name} · {inst.code}</option>)}</select></label>:<p className="small">Source institution is fixed: {String(payload.institutionCode??'unavailable')}</p>}</div>
      <div><button disabled={!ready}>Apply reviewed correction to mirror</button></div>
    </form>}
    <MutationError error={mutation.error}/>
  </div>;
}

function ItemReview({id,onClose}:{id:string;onClose:()=>void}) {
  const [lastResult,setLastResult]=useState<Resolution|null>(null);
  const query=useQuery({queryKey:['integration-item',id],queryFn:()=>api.get<Review>('/integration/reconciliation/'+id),refetchInterval:30_000}),data=query.data;
  return <section className="card stack" aria-label="Source record review"><div className="section-head"><h2>Source record review</h2><button className="secondary" onClick={onClose}>Close review</button></div>
    {query.isLoading?<Loading/>:query.error&&!data?<ErrorState error={query.error} onRetry={()=>query.refetch()}/>:data&&<>{query.isError&&<FailedRefresh retry={()=>query.refetch()}/>}<div className="row"><Status value={data.item.state}/><Provenance value="DEMO_ASSUMPTION"/></div>
      <p>{reasonLabel(data.item.reasonCode)}</p><dl className="kv small"><dt>Source</dt><dd>{data.item.externalId??'Identity unavailable'} · {data.item.eventId??'Event unavailable'} · revision {data.item.revision??'unavailable'}</dd><dt>Run</dt><dd className="mono">{data.item.runId}</dd><dt>Mapping</dt><dd>{data.item.mappingVersion}</dd><dt>Received</dt><dd>{formatDate(data.raw.receivedAt)}</dd><dt>Source hash</dt><dd className="mono">{data.raw.sha256}</dd></dl>
      <details><summary>Original raw source and validation</summary><pre className="small pre integration-raw">{JSON.stringify(data.raw.payload,null,2)}</pre><p>Import outcome: {humanise(data.raw.importOutcome)}.</p><pre className="small pre">{JSON.stringify(data.raw.validationDetails,null,2)}</pre></details>
      <h3>Current mock mirror</h3>{data.currentMirror?<div className="stack"><p>{data.currentMirror.sourceTitle}</p><Status value={data.currentMirror.sourceStatus}/><p className="small">Revision {data.currentMirror.revision} · {data.currentMirror.institutionCode} · source time {formatDate(data.currentMirror.sourceUpdatedAt)}</p>{data.currentMirror.latestResolutionId&&<p className="small">Current values include an explicitly reviewed correction.</p>}</div>:<p className="muted">No accepted mirror for this source identity.</p>}
      {lastResult&&<div className={`alert ${lastResult.attempt.outcome==='STILL_BLOCKED'?'warn':'ok'}`} role="status">Review result: {humanise(lastResult.attempt.outcome)} · {reasonLabel(lastResult.attempt.reasonCode)}. Queue state: {humanise(lastResult.item.state)}.</div>}
      {data.item.canResolve?<ReviewActions key={data.item.id} data={data} onResult={setLastResult}/>:<p className="small muted">{data.item.state==='OPEN'?'Your current grant is read-only.':'This queue item is closed.'} {data.item.resolutionReason}</p>}
      <h3>Review attempts</h3>{!data.attempts.length?<Empty>No human review attempts recorded.</Empty>:data.attempts.map(attempt=><article className="evidence-record stack" key={attempt.id}><div className="row"><Status value={attempt.outcome}/><strong>{humanise(attempt.action)}</strong></div><p>{attempt.reason}</p><p className="small muted">{attempt.recordedBy} · {formatDate(attempt.recordedAt)} · {reasonLabel(attempt.reasonCode)}</p><details><summary>Reviewed fields and mirror before / after</summary><pre className="small pre integration-raw">{JSON.stringify({corrections:attempt.corrections,evaluatedRecord:attempt.evaluatedRecord,mirrorBefore:attempt.mirrorBefore,mirrorAfter:attempt.mirrorAfter},null,2)}</pre></details></article>)}
    </>}
  </section>;
}

export function IntegrationPage() {
  const {can}=useSession(),[params,setParams]=useSearchParams();
  const [lastRun,setLastRun]=useState<Run|null>(null);
  const catalogue=useQuery({queryKey:['integration-catalogue'],queryFn:()=>api.get<Runs>('/integration/runs?pageSize=1'),refetchInterval:30_000});
  const region=params.get('regionId')??'',runId=params.get('runId')??'',state=params.get('state')??'OPEN',itemId=params.get('itemId')??'';
  const set=(updates:Record<string,string|null>)=>{const next=new URLSearchParams(params);for(const[k,v]of Object.entries(updates)){if(v)next.set(k,v);else next.delete(k);}setParams(next);};
  return <><header className="stack"><h1>Mock integration & reconciliation</h1><p className="alert warn">{NOTICE}</p><div><Provenance value="DEMO_ASSUMPTION"/></div></header>
    {catalogue.isLoading?<div className="card"><Loading/></div>:catalogue.error&&!catalogue.data?<ErrorState error={catalogue.error} onRetry={()=>catalogue.refetch()}/>:catalogue.data&&<>
      {catalogue.isError&&<FailedRefresh retry={()=>catalogue.refetch()}/>}<section className="card stack" aria-label="Integration filters"><div className="row"><label>Region filter<select value={region} onChange={e=>set({regionId:e.target.value,runId:null,itemId:null,page:null,runsPage:null})}><option value="">All visible regions</option>{catalogue.data.syncStates.map(s=><option key={s.regionId} value={s.regionId}>{s.regionName}</option>)}</select></label>
      <label>Queue state<select value={state} onChange={e=>set({state:e.target.value,page:null})}>{['OPEN','RESOLVED','DISMISSED','ALL'].map(value=><option key={value} value={value}>{humanise(value)}</option>)}</select></label><button className="secondary" onClick={()=>setParams(new URLSearchParams())}>Clear integration filters</button></div>{runId&&<p className="small">Queue filtered to run <span className="mono">{runId}</span>. <button className="secondary" onClick={()=>set({runId:null,page:null})}>All runs</button></p>}</section>
      {can('INTEGRATION_RESOLVE')&&<SyncForm key={region} states={catalogue.data.syncStates} region={region} onDone={(regionId,run)=>{setLastRun(run);set({regionId,runId:run.id,itemId:null,page:null,runsPage:null,state:'OPEN'});}}/>}
      {lastRun&&<div className="alert ok" role="status">Run completed: {lastRun.counts.accepted} accepted · {lastRun.counts.duplicate} duplicate · {lastRun.counts.invalid} invalid · {lastRun.counts.reconciliation} reconciliation.</div>}
      <RunHistory region={region} page={params.get('runsPage')??'1'} onPage={p=>set({runsPage:String(p)})} onReview={run=>set({regionId:run.regionId,runId:run.id,state:'ALL',page:null,itemId:null})}/>
      <QueueList region={region} runId={runId} state={state} page={params.get('page')??'1'} onPage={p=>set({page:String(p)})} onPick={id=>set({itemId:id})}/>
      {itemId&&<ItemReview key={itemId} id={itemId} onClose={()=>set({itemId:null})}/>}
    </>}
  </>;
}
