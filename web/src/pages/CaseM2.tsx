import { useState, type FormEvent } from 'react';
import { useCommand } from '../caseCommand';
import { formatDate, humanise, MutationError, Provenance, Status } from '../ui';

// Case workspace parts added in Milestone 2: findings and returns, manual classification, appeals.

type View = any;
const allowedIn = (v: View) => (c: string) => v.permittedCommands.find((p: any) => p.command === c)?.allowed;

const REASONS = [
  ['MISSING_DOCUMENT', 'Missing document'],
  ['INCOMPLETE_INFORMATION', 'Incomplete information'],
  ['NON_COMPLIANCE', 'Non-compliance'],
  ['CLARIFICATION', 'Clarification needed'],
  ['OTHER', 'Other'],
];

const FINDING_LABEL: Record<string, string> = {
  OPEN: 'Raised, not yet sent',
  RESPONSE_PENDING: 'Awaiting institution response',
  RESPONSE_SUBMITTED: 'Response received',
  RESOLVED: 'Resolved',
  NOT_RESOLVED: 'Not resolved',
};
const FINDING_TONE: Record<string, string> = {
  OPEN: 'PENDING', RESPONSE_PENDING: 'AWAITING_RESPONSE', RESPONSE_SUBMITTED: 'IN_PROGRESS', RESOLVED: 'SATISFIED', NOT_RESOLVED: 'DEFICIENT',
};

export function FindingsPanel({ v }: { v: View }) {
  const allowed = allowedIn(v);
  const canRaise = allowed('RAISE_FINDING');
  const canReturn = allowed('RETURN_TO_INSTITUTION');
  if (v.findings.length === 0 && !canRaise) return null;
  return (
    <section className="card stack" aria-labelledby="findings-title">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h2 id="findings-title">Findings</h2>
        <span className="small muted">{v.findings.length} on record</span>
      </div>
      {v.findings.length === 0 && <p className="small muted">No findings raised on this case.</p>}
      <div className="stack">
        {v.findings.map((f: any) => <FindingItem key={f.id} v={v} f={f} />)}
      </div>
      {canRaise && <RaiseFinding v={v} />}
      {canReturn && <ReturnForm v={v} />}
    </section>
  );
}

function FindingItem({ v, f }: { v: View; f: any }) {
  const allowed = allowedIn(v);
  const cmd = useCommand(v);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const current = v.stages.find((s: any) => s.id === v.currentStageId);
  const sameStage = current && current.stageKey === f.stageKey;
  const canResolve = allowed('RESOLVE_FINDING') && sameStage && ['OPEN', 'RESPONSE_SUBMITTED'].includes(f.state);
  const canReject = allowed('REJECT_FINDING_RESPONSE') && sameStage && f.state === 'RESPONSE_SUBMITTED';
  const canRespond = allowed('RESPOND_TO_FINDING') && f.state === 'RESPONSE_PENDING';
  const canAmend = allowed('REQUEST_AMENDMENT') && f.requestsAmendment && f.state === 'RESPONSE_PENDING';
  return (
    <article className="finding">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <Status value={FINDING_TONE[f.state]} label={FINDING_LABEL[f.state]} />
          <span className="chip neutral">{humanise(f.reasonCode)}</span>
          {f.visibility === 'INTERNAL' && <span className="chip demo">Internal</span>}
          {f.requestsAmendment && <span className="chip info">Amendment requested</span>}
        </div>
        <span className="small muted">{f.stageKey} · attempt {f.attemptNo}{f.checklistCode ? ` · ${f.checklistCode}` : ''}</span>
      </div>
      <p>{f.explanation}</p>
      {f.requestedEvidence && <p className="small"><strong>Requested:</strong> {f.requestedEvidence}</p>}
      <p className="small muted">
        Raised {formatDate(f.raisedAt)}{f.raisedBy ? ` by ${f.raisedBy}` : ''}
        {f.returnedAt && <> · returned {formatDate(f.returnedAt)}{f.responseDueNote ? ` (${f.responseDueNote})` : ''}</>}
      </p>
      {f.responses.map((r: any) => (
        <div key={r.id} className="reply">
          <div className="small muted">Response · {r.submittedBy} · {formatDate(r.submittedAt)}</div>
          <p>{r.text}</p>
        </div>
      ))}
      {f.closureNote && <p className="small"><strong>{f.state === 'RESOLVED' ? 'Resolved' : 'Not resolved'}:</strong> {f.closureNote} <span className="muted">· {formatDate(f.closedAt)}</span></p>}

      {canRespond && (
        <form className="stack" onSubmit={async (e: FormEvent) => { e.preventDefault(); if (await cmd.run('RESPOND_TO_FINDING', { findingId: f.id, text: reply })) setReply(''); }}>
          <label>Your response<textarea value={reply} onChange={(e) => setReply(e.target.value)} required minLength={10} placeholder="Explain what you have done or provided" /></label>
          <div><button className="primary" type="submit" disabled={!!cmd.busy}>{cmd.busy ? 'Sending…' : 'Send response'}</button></div>
        </form>
      )}
      {canAmend && <AmendmentForm v={v} findingId={f.id} />}
      {(canResolve || canReject) && (
        <div className="stack">
          <label>Review note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it is or is not resolved" /></label>
          <div className="row">
            {canResolve && <button disabled={!!cmd.busy || note.trim().length < 5} onClick={() => cmd.run('RESOLVE_FINDING', { findingId: f.id, note })}>Mark resolved</button>}
            {canReject && <button className="danger" disabled={!!cmd.busy || note.trim().length < 5} onClick={() => cmd.run('REJECT_FINDING_RESPONSE', { findingId: f.id, note })}>Not resolved</button>}
          </div>
        </div>
      )}
      <MutationError error={cmd.error} />
    </article>
  );
}

function RaiseFinding({ v }: { v: View }) {
  const cmd = useCommand(v);
  const stage = v.stages.find((s: any) => s.id === v.currentStageId);
  const empty = { checklistCode: '', reasonCode: 'MISSING_DOCUMENT', explanation: '', requestedEvidence: '', visibility: 'INSTITUTION', requestsAmendment: false };
  const [f, setF] = useState(empty);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await cmd.run('RAISE_FINDING', {
      reasonCode: f.reasonCode, explanation: f.explanation, visibility: f.visibility, requestsAmendment: f.requestsAmendment,
      ...(f.checklistCode ? { checklistCode: f.checklistCode } : {}), ...(f.requestedEvidence ? { requestedEvidence: f.requestedEvidence } : {}),
    });
    if (ok) setF(empty);
  }
  return (
    <details className="pw">
      <summary>Raise a finding</summary>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <label>Reason<select value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Checklist item <span className="hint">optional</span>
            <select value={f.checklistCode} onChange={(e) => setF({ ...f, checklistCode: e.target.value })}>
              <option value="">Not linked</option>
              {stage?.checklist.map((i: any) => <option key={i.code} value={i.code}>{i.code}</option>)}
            </select>
          </label>
          <label>Visible to<select value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value, requestsAmendment: e.target.value === 'INSTITUTION' && f.requestsAmendment })}>
            <option value="INSTITUTION">Institution (will be returned)</option>
            <option value="INTERNAL">Internal only</option>
          </select></label>
        </div>
        <label>Explanation<textarea value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} required minLength={10} /></label>
        <label>Requested evidence <span className="hint">optional</span><input value={f.requestedEvidence} onChange={(e) => setF({ ...f, requestedEvidence: e.target.value })} /></label>
        {f.visibility === 'INSTITUTION' && (
          <label className="row" style={{ fontWeight: 500 }}>
            <input type="checkbox" checked={f.requestsAmendment} onChange={(e) => setF({ ...f, requestsAmendment: e.target.checked })} />
            The institution may amend application details in reply
          </label>
        )}
        <MutationError error={cmd.error} />
        <div><button type="submit" disabled={!!cmd.busy}>{cmd.busy ? 'Saving…' : 'Raise finding'}</button></div>
      </form>
    </details>
  );
}

function ReturnForm({ v }: { v: View }) {
  const cmd = useCommand(v);
  const [reason, setReason] = useState('');
  const [due, setDue] = useState('Demo: respond within 15 days');
  const count = v.findings.filter((f: any) => f.visibility === 'INSTITUTION' && ['OPEN', 'NOT_RESOLVED'].includes(f.state) && f.stageKey === v.stages.find((s: any) => s.id === v.currentStageId)?.stageKey).length;
  return (
    <form className="stack return-box" onSubmit={async (e) => { e.preventDefault(); if (await cmd.run('RETURN_TO_INSTITUTION', { reason, responseDueNote: due })) setReason(''); }}>
      <h3>Return to the institution</h3>
      <p className="small muted">{count} finding(s) will be sent. The stage waits; when every finding is answered, a new attempt of this stage opens for you.</p>
      <label>Reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={10} /></label>
      <label>Response due <span className="hint">Basis for the response time. Deadlines are calculated from Milestone 3.</span><input value={due} onChange={(e) => setDue(e.target.value)} required minLength={3} /></label>
      <MutationError error={cmd.error} />
      <div><button className="primary" type="submit" disabled={!!cmd.busy}>{cmd.busy ? 'Returning…' : 'Return case'}</button></div>
    </form>
  );
}

function AmendmentForm({ v, findingId }: { v: View; findingId: string }) {
  const cmd = useCommand(v);
  const [address, setAddress] = useState('');
  const [land, setLand] = useState('');
  const [note, setNote] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const changes: Record<string, unknown> = {};
    if (address.trim()) changes.campusAddress = address.trim();
    if (land.trim()) changes.landAreaAcres = Number(land);
    if (await cmd.run('REQUEST_AMENDMENT', { findingId, changes, note })) { setAddress(''); setLand(''); setNote(''); }
  }
  return (
    <details className="pw">
      <summary>Amend application details</summary>
      <form className="stack" onSubmit={submit}>
        <p className="small muted">The submitted application stays as it was. Your changes are stored as a linked amendment.</p>
        <div className="form-grid">
          <label>Corrected campus address<input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
          <label>Corrected land area (acres)<input type="number" step="0.01" value={land} onChange={(e) => setLand(e.target.value)} /></label>
        </div>
        <label>What changed and why<textarea value={note} onChange={(e) => setNote(e.target.value)} required minLength={10} /></label>
        <MutationError error={cmd.error} />
        <div><button type="submit" disabled={!!cmd.busy || (!address.trim() && !land.trim())}>Submit amendment</button></div>
      </form>
    </details>
  );
}

export function Amendments({ list }: { list: any[] }) {
  if (!list.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3>Amendments</h3>
      {list.map((a) => (
        <div key={a.id} className="reply">
          {Object.entries(a.changes).map(([field, c]: any) => (
            <div key={field} className="small"><strong>{humanise(field.replace(/([A-Z])/g, '_$1').toUpperCase())}:</strong> <span className="muted"><s>{String(c.from ?? '—')}</s></span> → {typeof c.to === 'object' ? JSON.stringify(c.to) : String(c.to)}</div>
          ))}
          <p className="small">{a.note}</p>
          <div className="small muted">{a.submittedBy} · {formatDate(a.submittedAt)}</div>
        </div>
      ))}
    </div>
  );
}

export function ClassifyForm({ v }: { v: View }) {
  const cmd = useCommand(v);
  const [routeKey, setRouteKey] = useState('');
  const [reason, setReason] = useState('');
  return (
    <form className="card stack action-panel human" onSubmit={async (e) => { e.preventDefault(); await cmd.run('CLASSIFY', { routeKey, reason }); }} aria-labelledby="cls-title">
      <h2 id="cls-title">Classify this application</h2>
      <p className="small muted">No configured rule chose a route. Pick one from the case's policy version (v{v.workflow?.policyVersion.versionNo}) and record why.</p>
      <div className="route-pick">
        {v.availableRoutes.map((r: any) => (
          <label key={r.key} className={`route-option ${routeKey === r.key ? 'on' : ''}`}>
            <input type="radio" name="route" value={r.key} checked={routeKey === r.key} onChange={() => setRouteKey(r.key)} />
            <span><strong>{r.name}</strong><span className="small muted">{r.stages.join(' → ')}</span></span>
            <Provenance value={r.provenance} />
          </label>
        ))}
      </div>
      <label>Reason for this route<textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={10} /></label>
      <MutationError error={cmd.error} />
      <div><button className="primary" type="submit" disabled={!!cmd.busy || !routeKey}>{cmd.busy ? 'Classifying…' : 'Classify and start'}</button></div>
    </form>
  );
}

export function AppealForm({ v }: { v: View }) {
  const cmd = useCommand(v);
  const [grounds, setGrounds] = useState('');
  return (
    <form className="card stack" onSubmit={async (e) => { e.preventDefault(); await cmd.run('FILE_APPEAL', { grounds }); }} aria-labelledby="appeal-title">
      <h2 id="appeal-title">Appeal this decision</h2>
      <p className="small muted">An appeal opens a separate review. The recorded decision is not changed. The appeal window is a demo rule.</p>
      <label>Grounds of appeal<textarea value={grounds} onChange={(e) => setGrounds(e.target.value)} required minLength={20} /></label>
      <MutationError error={cmd.error} />
      <div><button className="primary" type="submit" disabled={!!cmd.busy}>{cmd.busy ? 'Filing…' : 'File appeal'}</button></div>
    </form>
  );
}

/** Primary workflow and any appeals, each with its decision, linked both ways. */
export function WorkflowHistory({ v }: { v: View }) {
  if (v.workflows.length < 2) return null;
  return (
    <section className="card stack" aria-labelledby="wf-title">
      <h2 id="wf-title">Proceedings</h2>
      <ol className="proceedings">
        {v.workflows.map((w: any, i: number) => {
          const appealedBy = v.workflows.find((x: any) => x.appealOfDecisionId && x.appealOfDecisionId === w.decision?.id);
          return (
            <li key={w.id} className={w.isCurrent ? 'current' : ''}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{w.kind === 'APPEAL' ? `Appeal ${i}` : 'Original application'} · {w.routeName ?? 'Unclassified'}</strong>
                {w.decision ? <Status value={w.decision.outcome} /> : <Status value="IN_PROCESS" label="In progress" />}
              </div>
              {w.kind === 'APPEAL' && <p className="small"><strong>Grounds:</strong> {w.appealGrounds} <span className="muted">· filed {formatDate(w.appealFiledAt)}</span></p>}
              {w.decision && <p className="small muted">Decision {formatDate(w.decision.issuedAt)} by {w.decision.authorityName}: {w.decision.reason}</p>}
              {appealedBy && <p className="small">Appealed on {formatDate(appealedBy.appealFiledAt)}; this decision stays on record unchanged.</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export { allowedIn };
