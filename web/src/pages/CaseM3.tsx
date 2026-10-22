import { useState, type FormEvent } from 'react';
import { useCommand } from '../caseCommand';
import { formatDate, humanise, MutationError, Provenance, Status } from '../ui';

// Case workspace parts added in Milestone 3: clocks with their calculation, pauses, extensions and alerts.

type View = any;

const CLOCK_TONE: Record<string, string> = { ACTIVE: 'IN_PROGRESS', PAUSED: 'AWAITING_RESPONSE', MET: 'SATISFIED', CANCELLED: 'NOT_APPLICABLE' };

export function dueText(d: { state: string; overdueDays: number; daysLeft: number }) {
  if (d.state === 'PAUSED') return 'Paused';
  if (d.overdueDays > 0) return `Overdue by ${d.overdueDays} day${d.overdueDays === 1 ? '' : 's'}`;
  if (d.daysLeft <= 1) return 'Due today';
  return `${d.daysLeft} days left`;
}

export function DueLine({ due }: { due: any }) {
  if (!due) return <span className="muted">No clock configured for this step</span>;
  return (
    <span className="due">
      <strong className="num">{formatDate(due.dueDate, false)}</strong>
      <Status value={due.overdueDays > 0 ? 'OVERDUE' : due.state === 'PAUSED' ? 'AWAITING_RESPONSE' : 'IN_PROGRESS'} label={dueText(due)} />
      {due.originalDueDate !== due.dueDate && <span className="small muted">originally {formatDate(due.originalDueDate, false)}</span>}
      <span className="small muted" title={due.ruleRef}>{due.label}</span>
    </span>
  );
}

export function DeadlinesCard({ v }: { v: View }) {
  const allowed = (c: string) => v.permittedCommands.find((p: any) => p.command === c)?.allowed;
  if (!v.deadlines?.length) return null;
  const open = v.deadlines.filter((d: any) => d.state === 'ACTIVE' || d.state === 'PAUSED');
  const closed = v.deadlines.filter((d: any) => d.state !== 'ACTIVE' && d.state !== 'PAUSED');
  return (
    <section className="card stack" aria-labelledby="clocks-title">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h2 id="clocks-title">Deadlines</h2>
        <span className="small muted">{open.length} running · times in the policy's time zone</span>
      </div>
      {open.map((d: any) => <Clock key={d.id} d={d} />)}
      {closed.length > 0 && (
        <details className="pw">
          <summary>{closed.length} closed clock(s)</summary>
          <div className="stack" style={{ marginTop: 12 }}>{closed.map((d: any) => <Clock key={d.id} d={d} />)}</div>
        </details>
      )}
      {allowed('EXTEND_DEADLINE') && <ExtendForm v={v} open={open.filter((d: any) => d.state === 'ACTIVE')} />}
    </section>
  );
}

function Clock({ d }: { d: any }) {
  const open = d.state === 'ACTIVE' || d.state === 'PAUSED';
  return (
    <article className={`clock ${d.overdueDays > 0 ? 'late' : ''}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <strong>{d.label}</strong>
          <Status value={CLOCK_TONE[d.state]} label={d.state === 'MET' ? (d.metLate ? 'Met late' : 'Met on time') : humanise(d.state)} />
          {open && <Status value={d.overdueDays > 0 ? 'OVERDUE' : 'IN_PROGRESS'} label={dueText(d)} />}
          <Provenance value={d.provenance} />
        </div>
        <span className="small muted mono">gen {d.generation}</span>
      </div>
      <dl className="kv small">
        <dt>Due</dt>
        <dd><strong>{formatDate(d.currentDueDate, false)}</strong>{d.originalDueDate !== d.currentDueDate && <span className="muted"> · originally {formatDate(d.originalDueDate, false)}</span>}</dd>
        <dt>Rule</dt>
        <dd>{d.rule.amount} {humanise(d.rule.unit).toLowerCase()}{d.pauseOnReturn ? ' · pauses while returned' : ' · keeps running while returned'} <span className="muted mono">{d.ruleRef}</span></dd>
        <dt>Calculation</dt>
        <dd>{d.explanation}</dd>
        {d.closeReason && <><dt>Closed</dt><dd>{formatDate(d.closedAt)} · {d.closeReason}</dd></>}
      </dl>
      {(d.pauses.length > 0 || d.adjustments.length > 0 || d.alerts.length > 0) && (
        <ol className="clock-log">
          {d.pauses.map((p: any, i: number) => (
            <li key={`p${i}`} className="small"><span className="tag-pause">Paused</span> {formatDate(p.pausedAt)} → {p.resumedAt ? formatDate(p.resumedAt) : 'still paused'}{p.daysLost != null && ` · ${p.daysLost} day(s) added`} · {p.reason}</li>
          ))}
          {d.adjustments.map((a: any, i: number) => (
            <li key={`a${i}`} className="small"><span className="tag-adjust">{a.kind === 'EXTENSION' ? 'Extended' : 'Resumed'}</span> {formatDate(a.from, false)} → {formatDate(a.to, false)} · {a.reason}{a.by && ` · ${a.by}`}</li>
          ))}
          {d.alerts.map((a: any, i: number) => (
            <li key={`al${i}`} className="small">
              <span className={`tag-alert ${a.state.toLowerCase()}`}>{a.state === 'CREATED' ? humanise(a.kind) : a.state === 'MISSED' ? 'Missed' : 'No recipient'}</span>
              {' '}{a.stepId.replace(/_/g, ' ').toLowerCase()} · {formatDate(a.stepAt)}{a.recipient ? ` · to ${a.recipient}` : ''}{a.generation !== d.generation && <span className="muted"> · earlier generation</span>}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function ExtendForm({ v, open }: { v: View; open: any[] }) {
  const cmd = useCommand(v);
  const [deadlineId, setDeadlineId] = useState(open[0]?.id ?? '');
  const [newDueDate, setNewDueDate] = useState('');
  const [reason, setReason] = useState('');
  if (!open.length) return null;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await cmd.run('EXTEND_DEADLINE', { deadlineId, newDueDate, reason })) { setNewDueDate(''); setReason(''); }
  }
  return (
    <details className="pw">
      <summary>Extend a deadline</summary>
      <form className="stack" onSubmit={submit}>
        <p className="small muted">The original due date stays on record. Reminders already queued for the old date are cancelled.</p>
        <div className="form-grid">
          <label>Clock<select value={deadlineId} onChange={(e) => setDeadlineId(e.target.value)}>{open.map((d) => <option key={d.id} value={d.id}>{d.label} (due {d.currentDueDate})</option>)}</select></label>
          <label>New due date<input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} required /></label>
        </div>
        <label>Reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={10} /></label>
        <MutationError error={cmd.error} />
        <div><button type="submit" disabled={!!cmd.busy}>{cmd.busy ? 'Extending…' : 'Extend'}</button></div>
      </form>
    </details>
  );
}
