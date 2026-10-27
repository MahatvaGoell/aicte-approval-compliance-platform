import {Provenance,formatDate} from '../ui';
export function AccountabilityStrip({v}:{v:any}){
 const a=v.accountability;
 if(!a?.recorded)return v.application.submittedAt?<p className="alert warn">Custody history incomplete · Not recorded</p>:null;
 return <section className="finale-custody" aria-label="Accountability clock">
  <p>Total <b className="mono">{a.totalDays}</b> days · With institution <b className="mono">{a.institutionDays}</b> · With office <b className="mono">{a.officeDays}</b> · With authority <b className="mono">{a.authorityDays}</b> · Returned <b className="mono">{a.returns}</b> times</p>
  {a.historyIncomplete&&<p>Custody history incomplete; totals cover recorded periods only.</p>}
  {a.stageDueDates.map((d:any,i:number)=><p className="small muted" key={i}>{d.stageKey}: first due {formatDate(d.originalDueDate,false)} · current due {formatDate(d.currentDueDate,false)}</p>)}
  <p className="small muted">Calendar days in Asia/Kolkata; same-day transfers add zero days. <Provenance value={a.provenance}/></p>
 </section>;
}
