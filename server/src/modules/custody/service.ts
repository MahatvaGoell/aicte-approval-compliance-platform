import type { Db } from '../../db.js';
import { maybe, q } from '../../db.js';
import type { ActionContext } from '../audit/audit.js';
import { recordAudit } from '../audit/audit.js';
import { localDate } from '../deadlines/calendar.js';
export type Holder='OFFICE'|'INSTITUTION'|'AUTHORITY';
export interface Segment {holder:Holder;started_at:Date|string;ended_at:Date|string|null;opened_by_transition:string}
const day=(at:Date|string)=>Date.parse(localDate(new Date(at),'Asia/Kolkata')+'T00:00:00Z')/86400000;
/** DEMO_ASSUMPTION: calendar midnights crossed per recorded interval; gaps excluded and disclosed.
 * Splitting an interval at a transfer preserves the sum. Same-day transfers add zero days. */
export function accountability(segments:Segment[],at:Date) {
 const days={OFFICE:0,INSTITUTION:0,AUTHORITY:0};let returns=0;
 for(const s of segments) {
  if(new Date(s.started_at)>at)continue;
  const end=s.ended_at&&new Date(s.ended_at)<at?new Date(s.ended_at):at;
  days[s.holder]+=Math.max(0,day(end)-day(s.started_at));
  if(s.holder==='INSTITUTION'&&s.opened_by_transition==='RETURN_TO_INSTITUTION')returns++;
 }
 return {totalDays:days.OFFICE+days.INSTITUTION+days.AUTHORITY,institutionDays:days.INSTITUTION,officeDays:days.OFFICE,authorityDays:days.AUTHORITY,returns};
}
/** Caller holds the case lock. State and audit changes use the caller's transaction. */
export async function moveCustody(db:Db,ctx:ActionContext,app:{id:string;institution_id:string},holder:Holder|null,stageKey:string|null,transition:string,reason:string) {
 const current=await maybe(db,'SELECT * FROM custody_segments WHERE application_id=$1 AND ended_at IS NULL FOR UPDATE',[app.id]);
 if(current?.holder===holder&&current?.stage_key===stageKey)return;
 if(current) {
  await db.query('UPDATE custody_segments SET ended_at=$2 WHERE id=$1',[current.id,ctx.at]);
  await recordAudit(db,ctx,{entityType:'custody',entityId:current.id,action:'CUSTODY_CLOSED',before:{holder:current.holder,startedAt:current.started_at},after:{endedAt:ctx.at},reason,applicationId:app.id,institutionId:app.institution_id,visibility:'INSTITUTION'});
 }
 if(holder) {
  const next=(await q(db,`INSERT INTO custody_segments(application_id,holder,stage_key,started_at,opened_by_transition,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[app.id,holder,stageKey,ctx.at,transition,reason]))[0];
  await recordAudit(db,ctx,{entityType:'custody',entityId:next.id,action:'CUSTODY_OPENED',after:{holder,stageKey,startedAt:ctx.at,transition,provenance:'DEMO_ASSUMPTION'},reason,applicationId:app.id,institutionId:app.institution_id,visibility:'INSTITUTION'});
 }
}
export async function custodyForCase(db:Db,id:string,at:Date) {
 const rows=await q(db,'SELECT holder,started_at,ended_at,opened_by_transition FROM custody_segments WHERE application_id=$1 ORDER BY started_at,id',[id]);
 const app=await maybe(db,'SELECT custody_history_incomplete,submitted_at FROM applications WHERE id=$1',[id]);
 const dates=await q(db,`SELECT stage_key,original_due_date,current_due_date FROM deadlines WHERE application_id=$1 AND clock_type='STAGE_HANDLING' ORDER BY anchor_at,id`,[id]);
 return {...accountability(rows,at),recorded:rows.length>0,historyIncomplete:app?.custody_history_incomplete|| (!!app?.submitted_at&&!rows.length),provenance:'DEMO_ASSUMPTION',stageDueDates:dates.map(d=>({stageKey:d.stage_key,originalDueDate:d.original_due_date,currentDueDate:d.current_due_date}))};
}
export interface CustodyEvent {command:string;at:Date;to_stage?:string|null;stage_kind?:string|null}
/** No submission evidence means no invented start. Unknown transition sequences are omitted. */
export function deriveCustody(events:CustodyEvent[]) {
 const segments:Array<Segment&{stage_key:string|null;reason:string}>=[];let incomplete=false,begun=false;
 for(const e of events) {
  let holder:Holder|null|undefined;
  if(e.command==='CLASSIFY_AUTOMATIC'){if(begun)continue;holder='OFFICE';begun=true;}
  else if(e.command==='ENTER_STAGE'){holder=e.stage_kind==='DECISION'?'AUTHORITY':'OFFICE';if(!begun)incomplete=true;begun=true;}
  else if(e.command==='RETURN_TO_INSTITUTION'){holder='INSTITUTION';if(!begun)incomplete=true;begun=true;}
  else if(e.command==='RECORD_DECISION')holder=null;
  else continue;
  const prev=segments.at(-1),key=e.to_stage??null;
  if(prev&&!prev.ended_at){
   if(prev.holder===holder&&prev.stage_key===key)continue;
   if(prev.holder==='INSTITUTION'&&holder!=='OFFICE'){segments.pop();incomplete=true;}
   else prev.ended_at=e.at;
  }
  if(holder)segments.push({holder,started_at:e.at,ended_at:null,opened_by_transition:e.command,stage_key:key,reason:'Backfilled from stored transition'});
 }
 return {segments,incomplete:incomplete||!begun};
}
export async function backfillCustody(db:Db,ctx:ActionContext) {
 const apps=await q(db,`SELECT a.id,a.institution_id FROM applications a WHERE submitted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM custody_segments s WHERE s.application_id=a.id) ORDER BY a.id FOR UPDATE`);
 for(const app of apps) {
  const events=await q<CustodyEvent>(db,`SELECT t.command,t.at,t.to_stage,(SELECT s.stage_kind FROM stage_instances s WHERE s.application_id=t.application_id AND s.stage_key=t.to_stage LIMIT 1) AS stage_kind FROM transitions t WHERE t.application_id=$1 ORDER BY t.at,t.id`,[app.id]);
  const result=deriveCustody(events);
  // A returned finding without a matching transition makes attribution uncertain: omit it all.
  const missing=await q(db,`SELECT f.id FROM findings f WHERE f.application_id=$1 AND f.returned_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM transitions t WHERE t.application_id=f.application_id AND t.command='RETURN_TO_INSTITUTION' AND t.at=f.returned_at)`,[app.id]);
  if(missing.length){result.segments=[];result.incomplete=true;}
  for(const s of result.segments)await db.query(`INSERT INTO custody_segments(application_id,holder,stage_key,started_at,ended_at,opened_by_transition,reason) VALUES($1,$2,$3,$4,$5,$6,$7)`,[app.id,s.holder,s.stage_key,s.started_at,s.ended_at,s.opened_by_transition,s.reason]);
  await db.query('UPDATE applications SET custody_history_incomplete=$2 WHERE id=$1',[app.id,result.incomplete]);
  await recordAudit(db,ctx,{entityType:'application',entityId:app.id,action:'CUSTODY_BACKFILLED',after:result,reason:'Stored transitions only; unknown periods omitted',applicationId:app.id,institutionId:app.institution_id,visibility:'INSTITUTION'});
 }
 return apps.length;
}
