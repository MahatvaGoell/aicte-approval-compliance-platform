import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, qs } from '../api';
import { useCommand } from '../caseCommand';
import { ErrorState, formatDate, humanise, Loading, MutationError, Provenance, Status } from '../ui';

const allowed = (v: any, name: string) => !!v.permittedCommands.find((p: any) => p.command === name)?.allowed;
const indiaInput = (value: string) => new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(' ', 'T').slice(0,16);
export function EvcCaseCard({ v }: { v: any }) {
  const visits = v.evc?.visits ?? [];
  if (!visits.length && !v.stages.some((s: any) => s.id === v.currentStageId && s.kind === 'EVC')) return null;
  const current = visits.find((x: any) => x.stage_instance_id === v.currentStageId && !['CANCELLED','RESCHEDULED'].includes(x.state));
  return <section className="card stack" aria-labelledby="evc-title"><h2 id="evc-title">Expert visit</h2>
    {v.evc.policy ? <p className="small muted"><Provenance value={v.evc.policy.provenance} /> {v.evc.policy.minMembers}–{v.evc.policy.maxMembers} experts · composition, conflicts and timings follow the pinned demo policy.</p> : <p className="alert warn">No EVC rules configured in this case's pinned policy. An authorised policy change is needed for future cases.</p>}
    {allowed(v, 'PROPOSE_VISIT') && <VisitProposal v={v} />}
    {current && <VisitDetail key={current.id} v={v} visit={current} />}
    {visits.filter((x: any) => x.id !== current?.id).map((x: any) => <details key={x.id}><summary>Previous visit · {formatDate(x.starts_at)} · {humanise(x.state)}</summary><VisitDetail v={v} visit={x} historical /></details>)}
  </section>;
}
function VisitProposal({ v, previous }: { v: any; previous?: any }) {
  const cmd = useCommand(v);
  const [from, setFrom] = useState(previous ? indiaInput(previous.starts_at) : ''), [to, setTo] = useState(previous ? indiaInput(previous.ends_at) : '');
  const [mode, setMode] = useState(previous?.mode ?? 'PHYSICAL'), [specialism, setSpecialism] = useState(previous?.specialism ?? 'ENGINEERING');
  const [reason, setReason] = useState(''), [selected, setSelected] = useState<string[]>([]), [search, setSearch] = useState<Record<string,string> | null>(null);
  const suggestions = useQuery({ queryKey: ['evc','suggestions',v.application.id,search], queryFn: () => api.get<any>(`/evc/applications/${v.application.id}/suggestions${qs(search ?? {})}`), enabled: !!search });
  function clear() { setSearch(null); setSelected([]); }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!search) return;
    await cmd.run(previous ? 'RESCHEDULE_VISIT' : 'PROPOSE_VISIT', { ...search, reason, expertIds: selected,
      ...(previous ? { visitId: previous.id, visitExpectedVersion: previous.row_version } : {}) });
  }
  return <form className="stack" onSubmit={submit}>
    <h3>{previous ? 'Replacement schedule' : 'Propose a visit'}</h3><p className="small muted">Enter times in Asia/Kolkata. Expert suggestions are checked again on confirmation.</p>
    <div className="form-grid">
      <label>Visit start (India)<input type="datetime-local" value={from} onChange={(e) => { setFrom(e.target.value); clear(); }} required /></label>
      <label>Visit end (India)<input type="datetime-local" value={to} onChange={(e) => { setTo(e.target.value); clear(); }} required /></label>
      <label>Mode<select value={mode} onChange={(e) => { setMode(e.target.value); clear(); }}>{['PHYSICAL','ONLINE','HYBRID'].map((m) => <option key={m}>{m}</option>)}</select></label>
      <label>Required specialism<select value={specialism} onChange={(e) => { setSpecialism(e.target.value); clear(); }}><option>ENGINEERING</option><option>GENERAL</option></select></label>
    </div>
    <div><button type="button" className="secondary" disabled={!from || !to || !!cmd.busy} onClick={() => { setSelected([]); setSearch({ startsAt: from + ':00+05:30', endsAt: to + ':00+05:30', mode, specialism, timezone: 'Asia/Kolkata', ...(previous ? { ignoreVisitId: previous.id } : {}) }); }}>Find eligible experts</button></div>
    {search && (suggestions.isLoading ? <Loading /> : suggestions.error ? <ErrorState error={suggestions.error} onRetry={() => suggestions.refetch()} /> : <fieldset className="stack"><legend>Choose experts ({selected.length} selected)</legend>
      <p className="small muted">{suggestions.data?.explanation}</p>
      {suggestions.data?.rows.map((e: any) => <label className="evc-expert-option" key={e.userId}>
        <input type="checkbox" checked={selected.includes(e.userId)} disabled={!e.selectable || !!cmd.busy} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids,e.userId] : ids.filter((id) => id !== e.userId))} />
        <span><strong>{e.name}</strong><span className="small muted"> · {e.monthlyVisits}/{e.maxVisits} visits this month</span>
          <span className="evc-factors">{Object.entries(e.factors).map(([k,value]) => <span className="chip neutral" key={k}>{k}: {String(value)}</span>)}</span>
          <span className="small">{e.travelBasis}</span>
          {e.conflicts.length > 0 && <span className="small"> · Conflicts: {e.conflicts.map(humanise).join(', ')}</span>}
          {e.blockers.length > 0 && <span className="small evc-blocker">Unavailable: {e.blockers.map(humanise).join(', ')}</span>}
        </span>
      </label>)}
    </fieldset>)}
    <label>Reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={10} /></label>
    <MutationError error={cmd.error} />
    <div><button disabled={!!cmd.busy || !search || suggestions.isFetching || !suggestions.data || selected.length < v.evc.policy.minMembers || selected.length > v.evc.policy.maxMembers}>{cmd.busy ? 'Saving…' : previous ? 'Reschedule visit' : 'Save visit proposal'}</button></div>
  </form>;
}
function VisitDetail({ v, visit, historical = false }: { v: any; visit: any; historical?: boolean }) {
  const cmd = useCommand(v);
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState('');
  const [findings, setFindings] = useState([{ requirement: '', observation: '', visibility: 'INSTITUTION' }]);
  const can = (c: string) => !historical && allowed(v, c);
  async function action(command: string, extra: Record<string, unknown> = {}) {
    if (await cmd.run(command, { visitId: visit.id, visitExpectedVersion: visit.row_version, reason, ...extra })) { setReason(''); }
  }
  const actions = [
    ['CONFIRM_VISIT','Confirm and reserve experts'], ['ACKNOWLEDGE_VISIT','Acknowledge visit'], ['CONFIRM_VISIT_MEMBER','Confirm my participation'],
    ['RECORD_VISIT_HELD','Record visit held'], ['CANCEL_VISIT','Cancel visit'],
  ].filter(([c]) => can(c) && !(c === 'ACKNOWLEDGE_VISIT' && visit.institution_acknowledged_at));
  const latestReport = visit.reports.at(-1);
  return <article className="stack evc-visit-detail">
    <div className="row"><Status value={visit.state} /><strong>{humanise(visit.mode)}</strong></div>
    <dl className="kv small"><dt>Visit</dt><dd>{new Date(visit.starts_at).toLocaleString('en-IN', { timeZone: visit.timezone })} — {new Date(visit.ends_at).toLocaleString('en-IN', { timeZone: visit.timezone })} ({visit.timezone})</dd>
      <dt>Ready since</dt><dd>{formatDate(visit.ready_at)}</dd><dt>Institution</dt><dd>{visit.institution_acknowledged_at ? `Acknowledged ${formatDate(visit.institution_acknowledged_at)}` : 'Acknowledgement pending'}</dd>
      <dt>Members</dt><dd><ul>{visit.members.map((m: any) => <li key={m.id}>{m.name} · {m.confirmed_at ? `Confirmed ${formatDate(m.confirmed_at)}` : 'Confirmation pending'}</li>)}</ul></dd></dl>
    {visit.reports.map((r: any) => <details key={r.id} open={r.id === latestReport?.id}><summary>Report revision {r.revision} · {formatDate(r.submitted_at)}</summary>
      {r.summary && <p className="pre">{r.summary}</p>}
      {r.findings.map((f: any, i: number) => <div className="evc-finding" key={i}><strong>{f.requirement}</strong> <Status value={f.visibility} /><p className="pre">{f.observation}</p></div>)}
    </details>)}
    {(actions.length > 0 || can('SUBMIT_VISIT_REPORT') || can('ACCEPT_VISIT_REPORT')) && <label>Action / review reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} required /></label>}
    <div className="row">{actions.map(([c,label]) => <button className="secondary" type="button" key={c} disabled={!!cmd.busy || reason.trim().length < 10} onClick={() => action(c)}>{label}</button>)}</div>
    {can('SUBMIT_VISIT_REPORT') && <form className="stack" onSubmit={(e) => { e.preventDefault(); void action('SUBMIT_VISIT_REPORT', { summary, findings }); }}>
      <label>Report summary (internal)<textarea value={summary} onChange={(e) => setSummary(e.target.value)} minLength={20} maxLength={10000} required /></label>
      {findings.map((f, index) => <fieldset className="stack" key={index}><legend>Observation {index + 1}</legend>
        <label>Requirement<input value={f.requirement} onChange={(e) => setFindings((rows) => rows.map((x,i) => i === index ? { ...x, requirement: e.target.value } : x))} minLength={3} maxLength={500} required /></label>
        <label>Observation<textarea value={f.observation} onChange={(e) => setFindings((rows) => rows.map((x,i) => i === index ? { ...x, observation: e.target.value } : x))} minLength={5} maxLength={4000} required /></label>
        <label>Visibility<select value={f.visibility} onChange={(e) => setFindings((rows) => rows.map((x,i) => i === index ? { ...x, visibility: e.target.value } : x))}><option value="INSTITUTION">Visible to institution</option><option value="INTERNAL">Internal committee record</option></select></label>
      </fieldset>)}
      <div className="row"><button type="button" className="secondary" disabled={findings.length >= 100} onClick={() => setFindings((rows) => [...rows,{ requirement: '', observation: '', visibility: 'INSTITUTION' }])}>Add observation</button><button disabled={!!cmd.busy || reason.trim().length < 10}>Submit report revision</button></div>
    </form>}
    {can('ACCEPT_VISIT_REPORT') && latestReport && <div className="row"><button disabled={!!cmd.busy || reason.trim().length < 10} onClick={() => action('ACCEPT_VISIT_REPORT', { reportId: latestReport.id })}>Accept latest report</button><button className="secondary" disabled={!!cmd.busy || reason.trim().length < 10} onClick={() => action('RETURN_VISIT_REPORT', { reportId: latestReport.id })}>Return for correction</button></div>}
    <MutationError error={cmd.error} />
    {can('RESCHEDULE_VISIT') && <details><summary>Reschedule with a recorded reason</summary><VisitProposal v={v} previous={visit} /></details>}
    {visit.history.length > 0 && <details><summary>Visit history</summary><ol>{visit.history.map((e: any, i: number) => <li key={i}>{formatDate(e.at)} · {humanise(e.action)} · {e.reason}</li>)}</ol></details>}
  </article>;
}
