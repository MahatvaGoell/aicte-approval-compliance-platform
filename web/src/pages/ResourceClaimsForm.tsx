export interface ResourceEntry {registrationId?:string;name?:string;identifier?:string;address?:string;programmeCode?:string;usage?:string;periodFrom:string;periodTo?:string}
export interface ResourceInputs {faculty:ResourceEntry[];labs:ResourceEntry[];buildings:ResourceEntry[]}
export const EMPTY_RESOURCES:ResourceInputs={faculty:[],labs:[],buildings:[]};
export function ResourceClaimsForm({value,onChange}:{value:ResourceInputs;onChange:(value:ResourceInputs)=>void}) {
 const set=(key:keyof ResourceInputs,index:number,patch:Partial<ResourceEntry>)=>onChange({...value,[key]:value[key].map((r,i)=>i===index?{...r,...patch}:r)});
 return <section className="card stack"><h2>Resource claims <span className="small muted">optional</span></h2><p className="small muted">All entries are synthetic. Only exact identities and overlapping declared periods are checked. A flag asks for human review.</p>
  {(['faculty','labs','buildings'] as const).map(key=><div className="stack" key={key}><h3>{key==='faculty'?'Faculty':key==='labs'?'Labs':'Buildings'}</h3>
   {value[key].map((r,i)=><fieldset className="finale-resource" key={i}><legend>{key} claim {i+1}</legend><div className="form-grid">
    {key==='faculty'?<><label>Synthetic registration ID<input required pattern="FAC-DEMO-[0-9]{4,12}" placeholder="FAC-DEMO-0001" value={r.registrationId??''} onChange={e=>set(key,i,{registrationId:e.target.value.toUpperCase()})}/></label><label>Faculty name<input required value={r.name??''} onChange={e=>set(key,i,{name:e.target.value})}/></label></>:<><label>Survey / plot identifier<input required value={r.identifier??''} onChange={e=>set(key,i,{identifier:e.target.value})}/></label><label>Resource address<input required minLength={5} value={r.address??''} onChange={e=>set(key,i,{address:e.target.value})}/></label></>}
    <label>Programme code <span className="hint">optional</span><input value={r.programmeCode??''} onChange={e=>set(key,i,{programmeCode:e.target.value||undefined})}/></label>
    <label>Claim starts<input type="date" required value={r.periodFrom} onChange={e=>set(key,i,{periodFrom:e.target.value})}/></label><label>Claim ends <span className="hint">optional</span><input type="date" min={r.periodFrom} value={r.periodTo??''} onChange={e=>set(key,i,{periodTo:e.target.value||undefined})}/></label>
   </div><button type="button" className="secondary" onClick={()=>onChange({...value,[key]:value[key].filter((_,n)=>n!==i)})}>Remove {key} claim {i+1}</button></fieldset>)}
   <div><button type="button" onClick={()=>onChange({...value,[key]:[...value[key],{periodFrom:''}]})}>Add {key==='faculty'?'faculty':key==='labs'?'lab':'building'} claim</button></div>
  </div>)}
 </section>;
}
