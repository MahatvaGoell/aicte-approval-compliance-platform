import { useQuery } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { Empty, ErrorState, formatDate, humanise, Loading, MutationError } from '../ui';

interface AuditEvent {
  id:number;at:string;recorded_at:string;actor_name:string|null;actor_role:string;
  entity_type:string;entity_id:string;action:string;application_id:string|null;app_no:string|null;
  reason:string|null;rule_ref:string|null;correlation_id:string;visibility:string;
}
interface Facets {actions:string[];actors:Array<{id:string;name:string}>;entityTypes:string[]}
interface AuditList {total:number;page:number;pageSize:number;rows:AuditEvent[];refreshedAt:string;facets:Facets;timezone:string}
interface Integrity {ok:boolean;checked?:number;firstBrokenId?:number|null;problem:string|null;verifiedAt:string;limits:string}
const FILTERS = ['applicationId','appNo','action','entityType','actorUserId','from','to'] as const;
const EMPTY_FACETS:Facets = {actions:[],actors:[],entityTypes:[]};

function Filters({params,facets,onApply}:{params:URLSearchParams;facets:Facets;onApply:(p:URLSearchParams)=>void}) {
  const [actorId,setActorId]=useState(params.get('actorUserId')??'');
  function apply(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();const values=new FormData(e.currentTarget),next=new URLSearchParams();
    for(const key of [...FILTERS,'pageSize']) {const value=String(values.get(key)??'').trim();if(value)next.set(key,value);}
    onApply(next);
  }
  const choices=(values:string[],current:string|null)=>current&&!values.includes(current)?[current,...values]:values;
  return <form className="card stack" aria-label="Audit filters" onSubmit={apply}>
    <div className="form-grid">
      <label>Case number<input name="appNo" defaultValue={params.get('appNo')??''} placeholder="APP-2027-28-01001" maxLength={80}/></label>
      <label>Case ID<input name="applicationId" defaultValue={params.get('applicationId')??''} placeholder="Application UUID"/></label>
      <label>Action<select name="action" defaultValue={params.get('action')??''}><option value="">All visible actions</option>{choices(facets.actions,params.get('action')).map(action=><option key={action} value={action}>{humanise(action)}</option>)}</select></label>
      <label>Entity type<select name="entityType" defaultValue={params.get('entityType')??''}><option value="">All visible entity types</option>{choices(facets.entityTypes,params.get('entityType')).map(type=><option key={type} value={type}>{humanise(type)}</option>)}</select></label>
      <label>Actor<select name="actorUserId" value={actorId} onChange={e=>setActorId(e.target.value)}><option value="">All visible actors</option>{actorId&&!facets.actors.some(a=>a.id===actorId)&&<option value={actorId}>Selected actor</option>}{facets.actors.map(actor=><option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
      <label>From date (Asia/Kolkata)<input type="date" name="from" defaultValue={params.get('from')??''}/></label>
      <label>To date (Asia/Kolkata)<input type="date" name="to" defaultValue={params.get('to')??''}/></label>
      <label>Events per page<select name="pageSize" defaultValue={params.get('pageSize')??'25'}>{choices(['10','25','50','100'],params.get('pageSize')).map(size=><option key={size} value={size}>{size}</option>)}</select></label>
    </div>
    <p className="small muted">Dates include the whole local day. Dropdowns list only actors and actions in your visible audit scope.</p>
    <div className="row"><button>Apply filters</button><button type="button" className="secondary" onClick={()=>onApply(new URLSearchParams())}>Clear filters</button></div>
  </form>;
}

function Detail({id}:{id:number}) {
  const detail=useQuery({queryKey:['audit-detail',id],queryFn:()=>api.get<AuditEvent & {before_state:unknown;after_state:unknown;hash:string;prev_hash:string}>(`/audit/${id}`)});
  if(detail.isLoading)return <Loading/>;
  if(detail.error)return <ErrorState error={detail.error} onRetry={()=>detail.refetch()}/>;
  const event=detail.data!;
  return <div className="stack">
    <h3>Event #{event.id} details</h3>
    <p className="small">{humanise(event.visibility)} · entity {event.entity_type}: {event.entity_id}</p>
    <div className="form-grid"><div><h4>Before state</h4><pre className="small pre">{JSON.stringify(event.before_state,null,2)}</pre></div><div><h4>After state</h4><pre className="small pre">{JSON.stringify(event.after_state,null,2)}</pre></div></div>
    <dl className="kv small"><dt>Correlation ID</dt><dd className="mono">{event.correlation_id}</dd><dt>Recorded</dt><dd>{formatDate(event.recorded_at)}</dd><dt>Hash</dt><dd className="mono">{event.hash}</dd><dt>Previous hash</dt><dd className="mono">{event.prev_hash}</dd></dl>
  </div>;
}

function EventRow({event:e}:{event:AuditEvent}) {
  const [expanded,setExpanded]=useState(false);
  return <Fragment><tr>
    <td className="num">{e.id}<div><button className="secondary" aria-expanded={expanded} aria-controls={`audit-detail-${e.id}`} aria-label={`${expanded?'Hide':'Show'} event ${e.id} details`} onClick={()=>setExpanded(v=>!v)}>{expanded?'Hide':'Details'}</button></div></td>
    <td className="small">{formatDate(e.at)}</td><td className="small">{e.actor_name??'System'}<div className="muted">{humanise(e.actor_role)}</div></td>
    <td>{humanise(e.action)}<div className="small muted">{e.entity_type}</div></td><td>{e.app_no?<Link className="mono" to={`/applications/${e.application_id}`}>{e.app_no}</Link>:'System-level event'}</td>
    <td className="small">{e.reason??'—'}</td><td className="small mono">{e.rule_ref??'—'}</td>
  </tr>{expanded&&<tr id={`audit-detail-${e.id}`}><td colSpan={7}><Detail id={e.id}/></td></tr>}</Fragment>;
}

export function AuditPage() {
  const [params,setParams]=useSearchParams();
  const query=Object.fromEntries([...FILTERS,'page','pageSize'].map(k=>[k,params.get(k)??undefined]));
  const list=useQuery({queryKey:['audit',query],queryFn:()=>api.get<AuditList>(`/audit${qs(query)}`),refetchInterval:30_000});
  const [result,setResult]=useState<Integrity|null>(null),[error,setError]=useState<unknown>(null),[busy,setBusy]=useState(false);
  async function verify() {setBusy(true);setError(null);setResult(null);try{setResult(await api.post<Integrity>('/audit/verify'));}catch(e){setError(e);}finally{setBusy(false);}}
  const data=list.data,pages=data?Math.max(1,Math.ceil(data.total/data.pageSize)):1;
  function goPage(page:number) {const next=new URLSearchParams(params);next.set('page',String(page));setParams(next);}
  return <>
    <div className="section-head"><h1>Audit log</h1><button onClick={verify} disabled={busy}>{busy?'Checking…':'Verify integrity'}</button></div>
    <p className="small muted">The application cannot change or delete audit rows. Hash-chain verification makes tampering detectable; it does not make the log impossible to alter. Integrity checks cover the global chain, even when your event list is scoped.</p>
    <MutationError error={error}/>
    {result&&<div className={`alert ${result.ok?'ok':'bad'}`} role="status">
      <strong>{result.ok?'Global chain intact.':`Global chain integrity problem${result.firstBrokenId!=null?` at event #${result.firstBrokenId}`:''}: ${result.problem??'Verification failed'}.`}</strong>
      {result.checked!==undefined&&<p>{result.checked} events checked.</p>}<p>Verified {formatDate(result.verifiedAt)}.</p><p className="small">{result.limits}</p>
    </div>}
    <Filters key={params.toString()} params={params} facets={data?.facets??EMPTY_FACETS} onApply={setParams}/>
    {list.isLoading?<div className="card"><Loading rows={5}/></div>:list.error&&!data?<ErrorState error={list.error} onRetry={()=>list.refetch()}/>:data&&<section className="card stack">
      {list.isError&&<div className="alert warn" role="alert">The last refresh failed; these events may be out of date. <button onClick={()=>list.refetch()}>Retry now</button></div>}
      <p className="small muted" aria-live="polite">{data.total} {data.total===1?'event':'events'} in your scope matching these filters · refreshed {formatDate(data.refreshedAt)} · polls every 30 s{list.isFetching?' · refreshing…':''}</p>
      {!data.rows.length?<Empty>No events match these filters in your active scope.</Empty>:<div className="table-wrap"><table><thead><tr><th className="num">#</th><th>Time (Asia/Kolkata)</th><th>Actor</th><th>Action</th><th>Case</th><th>Reason</th><th>Rule</th></tr></thead><tbody>{data.rows.map(event=><EventRow key={event.id} event={event}/>)}</tbody></table></div>}
      <div className="row"><button className="secondary" disabled={data.page<=1||list.isFetching} onClick={()=>goPage(data.page-1)}>Previous</button><span>Page {data.page} of {pages}</span><button className="secondary" disabled={data.page>=pages||list.isFetching} onClick={()=>goPage(data.page+1)}>Next</button></div>
    </section>}
  </>;
}
