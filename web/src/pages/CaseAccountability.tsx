import { formatDate, Provenance } from '../ui';

// Accountability clock: where the file has spent its calendar days. It sits inside the At a glance panel,
// so it is a compact list rather than a full-width strip.
export function AccountabilityStrip({ v }: { v: any }) {
  const a = v.accountability;
  if (!a?.recorded) return v.application.submittedAt ? <p className="small muted finale-custody">Not recorded · Custody history incomplete</p> : null;
  return (
    <section className="finale-custody" aria-label="Accountability clock">
      <h3>Accountability clock</h3>
      <dl className="kv small">
        <dt>Total</dt><dd className="mono">{a.totalDays} days</dd>
        <dt>With institution</dt><dd className="mono">{a.institutionDays} days</dd>
        <dt>With office</dt><dd className="mono">{a.officeDays} days</dd>
        <dt>With authority</dt><dd className="mono">{a.authorityDays} days</dd>
        <dt>Returned</dt><dd className="mono">{a.returns} {a.returns === 1 ? 'time' : 'times'}</dd>
      </dl>
      {a.historyIncomplete && <p className="small">Custody history incomplete; totals cover recorded periods only.</p>}
      {a.stageDueDates.map((d: any, i: number) => <p className="small muted" key={i}>{d.stageKey}: first due {formatDate(d.originalDueDate, false)} · current due {formatDate(d.currentDueDate, false)}</p>)}
      <p className="small muted">Calendar days in Asia/Kolkata; same-day transfers add zero days. <Provenance value={a.provenance} /></p>
    </section>
  );
}
