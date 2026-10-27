import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../motion';
import { Barcode, Disclosure, NamePlate, Postmark, readable, stampDate, Urgency } from '../ui';
import { useCommand } from '../caseCommand';
import { Empty, ErrorState, formatDate, humanise, Loading, MutationError, Provenance, Status } from '../ui';
import { Amendments, AppealForm, ClassifyForm, FindingsPanel, WorkflowHistory } from './CaseM2';
import { DeadlinesCard } from './CaseM3';
import { EvcCaseCard } from './CaseM4';
import {AccountabilityStrip} from './CaseAccountability';
import { DocumentsCard,ObligationsCard } from './CaseM5';

type View = any;

function useCase(id: string) {
  return useQuery({ queryKey: ['case', id], queryFn: () => api.get<View>(`/applications/${id}`) });
}

export function CasePage() {
  const { id = '' } = useParams();
  const q = useCase(id);
  if (q.isLoading) return <div className="card"><Loading rows={5} /></div>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const v = q.data;
  const allowed = (c: string) => v.permittedCommands.find((p: any) => p.command === c)?.allowed;

  return (
    <>
      <section className="slip" aria-labelledby="case-no">
        <div className="slip-head">
          <Link className="back-link" to="/applications"><Icon name="arrow" />Applications</Link>
          <div className="slip-no">
            <h1 id="case-no">{v.application.appNo}</h1>
            <div className="row">
              <Status value={v.application.lifecycleState} label={v.application.lifecycleLabel} />
              {v.application.decisionOutcome && <Status value={v.application.decisionOutcome} />}
              {v.application.complianceStatus !== 'NONE' && <Status value={v.application.complianceStatus} label={`Compliance: ${humanise(v.application.complianceStatus)}`} />}
              {v.workflow?.kind === 'APPEAL' && <span className="chip info">Appeal in progress</span>}
              {v.application.isSynthetic && <span className="chip demo">Synthetic record</span>}
            </div>
          </div>
          <div className="slip-side">
            <Barcode value={v.application.appNo} />
            {v.workflow && <span className="small">Policy {v.workflow.policyVersion.label}</span>}
          </div>
          <div className="slip-meta">
            <span><i>Institution</i>{v.institution.name}</span>
            <span><i>Category</i>{v.proposal.categoryName}</span>
            <span><i>Cycle</i>{v.application.cycleCode}</span>
            <span><i>Region</i>{v.institution.region_id}</span>
            {v.application.submittedAt && <span><i>Submitted</i>{formatDate(v.application.submittedAt)}</span>}
          </div>
        </div>
        {v.workflow && <><div className="perf" aria-hidden="true" /><RouteCard v={v} /></>}
      </section>

      <AccountabilityStrip v={v}/>
      <ActionPanel panel={v.actionPanel} jump={jumpFor(allowed)} />
      <div className="grid-2 case-workspace">
        <div className="stack case-main">
          {allowed('CLASSIFY') && <ClassifyForm v={v} />}
          <FindingsPanel v={v} />
          {v.canEditDraft && <DraftActions v={v} />}
          {(allowed('SAVE_CHECKLIST') || allowed('RECORD_RECOMMENDATION') || allowed('COMPLETE_STAGE')) && <StageWork key={v.currentStageId} v={v} />}
          {allowed('RECORD_DECISION') && <DecisionForm v={v} />}
          {v.decision && <DecisionCard decision={v.decision} />}
          {allowed('FILE_APPEAL') && <AppealForm v={v} />}
          <EvcCaseCard v={v} />
          <Disclosure title="Documents" subtitle="Upload, exact versions and human verification" icon="document" count={v.documents.length} id="case-documents" open={window.location.hash.startsWith('#document-')}>
            <DocumentsCard v={v}/>
          </Disclosure>
          <Disclosure title="Obligations" subtitle="Conditions, evidence receipts and closure" icon="layers" count={v.obligations.length} id="case-obligations" open={window.location.hash.startsWith('#obligation-')}>
            <ObligationsCard v={v}/>
          </Disclosure>
          {v.deadlines?.length > 0 && <Disclosure title="Deadline details" subtitle="Rules, calculations, reminders and extensions" icon="clock"><DeadlinesCard v={v} /></Disclosure>}
          <Disclosure title="Case history" subtitle="Stage attempts and the complete event record" icon="inbox">
            <WorkflowHistory v={v} />
            <StageHistory v={v} />
            <Timeline id={v.application.id} />
          </Disclosure>
        </div>
        <aside className="stack case-context" aria-label="Case tools and details">
          {allowed('ASSIGN_STAGE') && <Disclosure title="Assignment" subtitle="View owner or reassign this stage" icon="users"><AssignForm v={v} /></Disclosure>}
          <PermittedActions list={v.permittedCommands} />
          {v.recommendations.length > 0 && <Recommendations list={v.recommendations} />}
          <Disclosure title="Application details" subtitle="Submitted data and snapshot record" icon="building"><Submission v={v} /></Disclosure>
        </aside>
      </div>
    </>
  );
}

// The note's primary action takes the user straight to the form where their turn happens.
function jumpFor(allowed: (c: string) => boolean): [string, string] | null {
  if (allowed('RECORD_DECISION')) return ['#dec-title', 'Record the decision'];
  if (allowed('CLASSIFY')) return ['#cls-title', 'Classify the application'];
  if (allowed('SAVE_CHECKLIST') || allowed('RECORD_RECOMMENDATION') || allowed('COMPLETE_STAGE')) return ['#work-title', 'Open your checklist'];
  if (allowed('FILE_APPEAL')) return ['#appeal-title', 'File an appeal'];
  return null;
}

function ActionPanel({ panel, jump }: { panel: any; jump: [string, string] | null }) {
  const due = panel.due;
  const late = !!due && due.overdueDays > 0;
  return (
    <section className="note" aria-labelledby="ap-title">
      <div className="note-main">
        <h2 id="ap-title" className="next"><span className="sr-only">Next action: </span>{panel.nextAction}</h2>
        <div className="note-people">
          {panel.responsible
            ? <NamePlate name={panel.responsible.person ?? panel.responsible.role} role={panel.responsible.person ? panel.responsible.role : 'Responsible role'} />
            : <span className="muted">No one is responsible for this step right now.</span>}
          {panel.waitingSince && <span className="small muted">Waiting since {formatDate(panel.waitingSince)}</span>}
        </div>
        <details className="action-explanation">
          <summary>Why this action?</summary>
          <dl className="kv small">
            <dt>Why pending</dt>
            <dd>{panel.reasonPending ?? '—'}</dd>
            <dt>Rule</dt>
            <dd className="mono">{panel.ruleRef ?? '—'}</dd>
          </dl>
        </details>
      </div>
      <div className={`note-due ${late ? 'late hatched' : ''}`}>
        {due ? <>
          <Urgency due={due} />
          <span className="due-date">{formatDate(due.dueDate, false)}</span>
          {due.originalDueDate !== due.dueDate && <span className="due-rule">Originally {formatDate(due.originalDueDate, false)}</span>}
          <span className="due-rule" title={due.ruleRef}>{due.label}</span>
        </> : <span className="small muted">No clock configured for this step</span>}
        {jump && <a className="btn primary note-go" href={jump[0]} onClick={(e) => { const t = document.querySelector(jump[0]); if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }}>{jump[1]}<Icon name="arrow" /></a>}
      </div>
      {panel.blockers.length > 0 && (
        <div className="blockers" role="note">
          <strong>Blocking items</strong>
          <ul>{panel.blockers.map((b: string, i: number) => <li key={i}>{readable(b)}</li>)}</ul>
        </div>
      )}
      {panel.requiresHumanDecision && (
        <p className="human-note"><Icon name="shield" />This step needs an authorised human decision. The system does not decide it.</p>
      )}
    </section>
  );
}

function RouteCard({ v }: { v: View }) {
  const w = v.workflow;
  const current = v.stages.find((s: any) => s.id === v.currentStageId);
  return (
    <div className="track-wrap">
      <div className="track-head">
        <h2 id="route-title">Route · {w.routeName ?? 'Not yet classified'}</h2>
        <span className="small">Finished stages carry the date they were completed</span>
      </div>
      {w.routeProgress.length > 0 && (
        <ol className="track" aria-labelledby="route-title">
          {w.routeProgress.map((s: any, i: number) => {
            const done = s.state === 'COMPLETED';
            const live = !done && current?.stageKey === s.stageKey;
            const record = [...v.stages].reverse().find((x: any) => x.stageKey === s.stageKey);
            const returned = live && s.state === 'AWAITING_RESPONSE';
            return (
              <li key={s.position} className={`hop ${done ? 'done' : ''} ${live ? 'current' : ''} ${returned ? 'returned' : ''}`} style={{ '--i': i } as any}>
                <div className="hop-mark">
                  {done ? <Postmark top={s.name} date={stampDate(record?.completedAt) || 'COMPLETED'} bottom={`Stage ${s.position + 1}`} land delay={i * 110} />
                    : live ? <span className="hop-live"><Icon name={returned ? 'inbox' : 'clock'} /></span>
                    : <span className="hop-empty" />}
                </div>
                <div className="hop-text">
                  <span className="n">Stage {s.position + 1}{s.attempts > 1 ? ` · ${s.attempts} attempts` : ''}</span>
                  <strong>{s.name}</strong>
                  <span className="state">{done ? `Completed${record?.completedAt ? ` ${formatDate(record.completedAt, false)}` : ''}` : live ? `${humanise(s.state)} · here now` : humanise(s.state)}</span>
                  {done && record?.assignee?.name && <span className="ack" title="Acknowledgement of completion"><b>AD</b>Signed off by {record.assignee.name}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <details className="route-explanation"><summary>Why this route?</summary><div className="small">
        {w.classification.explanation}
        {w.classification.ruleRef && <> <span className="mono">({w.classification.ruleRef})</span></>}
        {w.classification.provenance && <> <Provenance value={w.classification.provenance} /></>}
      </div></details>
    </div>
  );
}

function DraftActions({ v }: { v: View }) {
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    try {
      await api.post(`/applications/${v.application.id}/submit`, { expectedVersion: v.application.rowVersion });
      await qc.invalidateQueries({ queryKey: ['case', v.application.id] });
      qc.invalidateQueries({ queryKey: ['applications'] });
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <section className="card stack">
      <h2>Draft</h2>
      <p className="small muted">The application is still a draft. Submitting freezes it and the configured policy chooses its route.</p>
      <MutationError error={error} />
      <div className="row">
        <Link className="btn" to={`/applications/${v.application.id}/edit`}>Edit draft</Link>
        {v.canSubmit && <button className="primary" disabled={busy || v.actionPanel.blockers.length > 0} onClick={submit}>{busy ? 'Submitting…' : 'Submit application'}</button>}
      </div>
    </section>
  );
}

function StageWork({ v }: { v: View }) {
  const cmd = useCommand(v);
  const stage = v.stages.find((s: any) => s.id === v.currentStageId);
  const allowed = (c: string) => v.permittedCommands.find((p: any) => p.command === c)?.allowed;
  const [items, setItems] = useState(() => Object.fromEntries(stage.checklist.map((i: any) => [i.code, { status: i.status, observation: i.observation ?? '' }])));
  const [rec, setRec] = useState({ recommendation: 'RECOMMEND_APPROVAL', text: '', proposedConditions: '' });

  async function saveChecklist(e: FormEvent) {
    e.preventDefault();
    await cmd.run('SAVE_CHECKLIST', {
      items: Object.entries(items).map(([code, x]: any) => ({ code, status: x.status, ...(x.observation ? { observation: x.observation } : {}) })),
    });
  }
  async function saveRec(e: FormEvent) {
    e.preventDefault();
    const ok = await cmd.run('RECORD_RECOMMENDATION', {
      recommendation: rec.recommendation, text: rec.text,
      proposedConditions: rec.proposedConditions.split('\n').map((s) => s.trim()).filter(Boolean),
    });
    if (ok) setRec({ ...rec, text: '', proposedConditions: '' });
  }

  return (
    <section className="card stack work-card" aria-labelledby="work-title">
      <h2 id="work-title">{stage.name} — your work</h2>
      {allowed('SAVE_CHECKLIST') && (
        <form className="stack" onSubmit={saveChecklist}>
          <div className="table-wrap checklist-table">
            <table>
              <thead><tr><th>Requirement</th><th>Result</th><th>Observation</th></tr></thead>
              <tbody>
                {stage.checklist.map((i: any) => (
                  <tr key={i.code}>
                    <td>
                      {i.requirement}
                      <div className="small muted mono">{i.ruleRef}</div>
                      <Provenance value={i.provenance} />
                    </td>
                    <td>
                      <select aria-label={`Result for ${i.code}`} value={items[i.code].status} onChange={(e) => setItems({ ...items, [i.code]: { ...items[i.code], status: e.target.value } })}>
                        <option value="PENDING">Pending</option>
                        <option value="SATISFIED">Satisfied</option>
                        <option value="DEFICIENT">Deficient</option>
                        <option value="NOT_APPLICABLE">Not applicable</option>
                      </select>
                    </td>
                    <td>
                      <textarea aria-label={`Observation for ${i.code}`} rows={2} value={items[i.code].observation} onChange={(e) => setItems({ ...items, [i.code]: { ...items[i.code], observation: e.target.value } })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div><button type="submit" disabled={!!cmd.busy}>{cmd.busy === 'SAVE_CHECKLIST' ? 'Saving…' : 'Save checklist'}</button></div>
        </form>
      )}
      {allowed('RECORD_RECOMMENDATION') && (
        <form className="stack" onSubmit={saveRec}>
          <h3>Recommendation</h3>
          <label>Recommendation
            <select id="rec-kind" value={rec.recommendation} onChange={(e) => setRec({ ...rec, recommendation: e.target.value })}>
              <option value="RECOMMEND_APPROVAL">Recommend approval</option>
              <option value="RECOMMEND_APPROVAL_WITH_CONDITIONS">Recommend approval with conditions</option>
              <option value="RECOMMEND_REJECTION">Recommend rejection</option>
              <option value="RECOMMEND_DEFERRAL">Recommend deferral</option>
            </select>
          </label>
          <label>Basis for the recommendation<textarea id="rec-text" value={rec.text} onChange={(e) => setRec({ ...rec, text: e.target.value })} required minLength={10} /></label>
          {rec.recommendation === 'RECOMMEND_APPROVAL_WITH_CONDITIONS' && (
            <label>Proposed conditions <span className="hint">One per line</span>
              <textarea id="rec-conditions" value={rec.proposedConditions} onChange={(e) => setRec({ ...rec, proposedConditions: e.target.value })} />
            </label>
          )}
          <div><button type="submit" disabled={!!cmd.busy}>{cmd.busy === 'RECORD_RECOMMENDATION' ? 'Recording…' : 'Record recommendation'}</button></div>
        </form>
      )}
      {allowed('COMPLETE_STAGE') && (
        <div className="stack">
          <h3>Completion conditions</h3>
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 4 }}>
            {v.completion.map((c: any) => (
              <li key={c.condition} className="row"><Status value={c.met ? 'SATISFIED' : 'PENDING'} label={c.met ? 'Met' : 'Not met'} /> <span>{c.detail}</span></li>
            ))}
          </ul>
          <div>
            <button className="primary" disabled={!!cmd.busy || v.completion.some((c: any) => !c.met)} onClick={() => cmd.run('COMPLETE_STAGE', { note: `${stage.name} completed` })}>
              {cmd.busy === 'COMPLETE_STAGE' ? 'Completing…' : `Complete ${stage.name}`}
            </button>
          </div>
        </div>
      )}
      <MutationError error={cmd.error} />
    </section>
  );
}

function DecisionForm({ v }: { v: View }) {
  const cmd = useCommand(v);
  const [outcome, setOutcome] = useState('APPROVED');
  const [reason, setReason] = useState('');
  const [conditions, setConditions] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    await cmd.run('RECORD_DECISION', {
      outcome, reason,
      conditions: outcome === 'APPROVED_WITH_CONDITIONS'
        ? conditions.split('\n').map((s) => s.trim()).filter(Boolean).map((text) => ({ text, dueInDays: 90 }))
        : [],
    });
  }
  return (
    <form className="card stack decision-form" onSubmit={submit} aria-labelledby="dec-title">
      <h2 id="dec-title">Record the decision</h2>
      <p className="small muted">You are recording a decision as the competent authority. Recommendations above inform it; they do not make it.</p>
      <label>Outcome
        <select id="dec-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="APPROVED">Approved</option>
          <option value="APPROVED_WITH_CONDITIONS">Approved with conditions</option>
          <option value="REJECTED">Rejected</option>
          <option value="DEFERRED">Deferred</option>
        </select>
      </label>
      <label>Reasons<textarea id="dec-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={10} /></label>
      {outcome === 'APPROVED_WITH_CONDITIONS' && (
        <label>Conditions <span className="hint">One per line. Each becomes a tracked compliance obligation.</span>
          <textarea id="dec-conditions" value={conditions} onChange={(e) => setConditions(e.target.value)} required />
        </label>
      )}
      <MutationError error={cmd.error} />
      <div><button className="primary" type="submit" disabled={!!cmd.busy}>{cmd.busy ? 'Recording…' : 'Record decision'}</button></div>
    </form>
  );
}

function DecisionCard({ decision }: { decision: any }) {
  return (
    <section className="card stack" aria-labelledby="decision-title">
      <div className="row"><h2 id="decision-title">Decision</h2><Status value={decision.outcome} /></div>
      <p>{decision.reason}</p>
      {decision.conditions.length > 0 && (
        <div>
          <h3>Conditions</h3>
          <ol>{decision.conditions.map((c: any, i: number) => <li key={i}>{c.text}{c.dueInDays && <span className="muted"> (due within {c.dueInDays} days)</span>}</li>)}</ol>
        </div>
      )}
      <p className="small muted">Recorded {formatDate(decision.issuedAt)} by {decision.authorityName} · <span className="mono">{decision.ruleRef}</span></p>
    </section>
  );
}

function AssignForm({ v }: { v: View }) {
  const cmd = useCommand(v);
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const stage = v.stages.find((s: any) => s.id === v.currentStageId);
  return (
    <form className="card stack" onSubmit={async (e) => { e.preventDefault(); if (await cmd.run('ASSIGN_STAGE', { userId, reason })) { setUserId(''); setReason(''); } }}>
      <h2>Assignment</h2>
      <p className="small">Current owner: <strong>{stage?.assignee?.name ?? 'Unassigned'}</strong></p>
      <label>Assign to
        <select id="assign-user" value={userId} onChange={(e) => setUserId(e.target.value)} required>
          <option value="">Choose an eligible user</option>
          {v.assignableUsers.map((u: any) => <option key={u.id} value={u.id}>{u.name} · {u.openStages} open</option>)}
        </select>
      </label>
      <label>Reason<input id="assign-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} /></label>
      <MutationError error={cmd.error} />
      <div><button type="submit" disabled={!!cmd.busy}>Reassign</button></div>
    </form>
  );
}

function PermittedActions({ list }: { list: any[] }) {
  const allowed = list.filter((p) => p.allowed);
  const blocked = list.filter((p) => !p.allowed);
  return (
    <section className="card stack" aria-labelledby="perm-title">
      <h2 id="perm-title">What you can do here</h2>
      {allowed.length === 0 ? <p className="small muted">Nothing for your role to do on this case right now.</p> : (
        <ul className="permitted">
          {allowed.map((p) => <li key={p.command}><Icon name="check" /><span>{p.label}</span></li>)}
        </ul>
      )}
      {blocked.length > 0 && (
        <details className="permitted-blocked">
          <summary>{blocked.length} action{blocked.length === 1 ? '' : 's'} not available, and why</summary>
          <ul className="permitted">
            {blocked.map((p) => (
              <li key={p.command} className="off"><Icon name="minus" /><span>{p.label}<span className="sr-only"> (not available)</span></span><span className="why">{p.reason}</span></li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Recommendations({ list }: { list: any[] }) {
  return (
    <section className="card stack" aria-labelledby="rec-title">
      <h2 id="rec-title">Recommendations <span className="chip neutral">Internal</span></h2>
      {list.map((r) => (
        <div key={r.id} className="stack" style={{ gap: 4 }}>
          <div className="row"><strong>{humanise(r.recommendation)}</strong></div>
          <p>{r.text}</p>
          {r.proposed_conditions.length > 0 && <ul className="small">{r.proposed_conditions.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>}
          <p className="small muted">{r.author_name} · {formatDate(r.created_at)}</p>
        </div>
      ))}
    </section>
  );
}

function Submission({ v }: { v: View }) {
  const f = v.form;
  return (
    <section className="card stack" aria-labelledby="sub-title">
      <h2 id="sub-title">{v.application.lifecycleState === 'DRAFT' ? 'Draft contents' : 'Submitted application'}</h2>
      <dl className="kv small">
        <dt>Campus</dt><dd>{f.campusAddress ?? '—'}</dd>
        <dt>Land area</dt><dd>{f.landAreaAcres != null ? `${f.landAreaAcres} acres` : '—'}</dd>
        <dt>Programmes</dt><dd>{f.programmes?.length ? f.programmes.map((p: any) => `${p.name} (${p.level}, ${p.intake})`).join('; ') : '—'}</dd>
        {v.proposal.details.intakeIncreasePercent != null && <><dt>Intake increase</dt><dd>{v.proposal.details.intakeIncreasePercent}%</dd></>}
        {v.proposal.details.proposedSiteAddress && <><dt>Proposed site</dt><dd>{v.proposal.details.proposedSiteAddress}</dd></>}
        {v.application.snapshotSha256 && <><dt>Snapshot</dt><dd className="mono" title={v.application.snapshotSha256}>SHA-256 {v.application.snapshotSha256.slice(0, 16)}…</dd></>}
      </dl>
      <Amendments list={v.amendments ?? []} />
    </section>
  );
}

function StageHistory({ v }: { v: View }) {
  if (v.stages.length === 0) return null;
  return (
    <section className="card stack" aria-labelledby="hist-title">
      <h2 id="hist-title">Stage history</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Stage</th><th>Attempt</th><th>State</th><th>Owner</th><th>Entered</th><th>Completed</th></tr></thead>
          <tbody>
            {v.stages.map((s: any) => (
              <tr key={s.id}>
                <td>{s.name}<div className="small muted mono">{s.ruleRef}</div></td>
                <td className="num">{s.attemptNo}</td>
                <td><Status value={s.state} label={s.stateLabel} /></td>
                <td>{s.assignee?.name ?? s.ownerRoleLabel}</td>
                <td>{formatDate(s.enteredAt)}</td>
                <td>{formatDate(s.completedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Timeline({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['timeline', id], queryFn: () => api.get<any[]>(`/applications/${id}/timeline`) });
  return (
    <section className="card stack" aria-labelledby="tl-title">
      <h2 id="tl-title">History</h2>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data!.length === 0 ? <Empty>No history yet.</Empty> : (
        <ol className="timeline">
          {q.data!.map((e) => (
            <li key={e.id}>
              <span className="small muted num">{formatDate(e.at)}</span>
              <div>
                <strong>{humanise(e.action)}</strong>
                <span className="small muted"> · {e.actorName ?? humanise(e.actorRole)}</span>
                {e.reason && <div className="small">{e.reason}</div>}
                {e.ruleRef && <div className="small muted mono">{e.ruleRef}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
