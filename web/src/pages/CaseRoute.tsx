import { useMeta } from '../session';
import { formatDate, humanise, NamePlate, Postmark, Provenance, stampDate, Urgency } from '../ui';
import { AccountabilityClockSlot } from './CaseSlots';

type View = any;

const DAY = 86_400_000;
const short = (t: number) => new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
const ms = (v: string | null | undefined) => (v ? new Date(v).getTime() : null);
/** Deadlines are stored as a date; they fall due at the end of that day, India time. */
const dueMs = (d: string) => new Date(`${d}T23:59:59+05:30`).getTime();

/** The demo clock decides what "today" is, so the marker agrees with the deadlines. */
function useNow() {
  const meta = useMeta();
  return Date.now() + (meta.data?.demoClockOffsetMs ?? 0);
}

interface Bar { id: string; start: number | null; end: number | null; done: boolean; live: boolean; attempt: number }

/**
 * Route timeline: one row per stage, one bar per attempt, drawn only from stored stage dates and deadlines.
 * A stage with no stored date shows "Date not recorded" instead of a guessed bar.
 */
export function RouteTimeline({ v }: { v: View }) {
  const now = useNow();
  const w = v.workflow;
  if (!w) return null;
  const due = v.actionPanel.due;
  const current = v.stages.find((s: any) => s.id === v.currentStageId);
  const dueAt = due?.dueDate ? dueMs(due.dueDate) : null;
  const late = !!due && due.overdueDays > 0;

  const rows = w.routeProgress.map((s: any) => {
    const attempts = v.stages.filter((x: any) => x.stageKey === s.stageKey);
    const bars: Bar[] = attempts.map((a: any) => {
      const done = a.state === 'COMPLETED';
      const live = a.id === v.currentStageId && !done;
      const start = ms(a.enteredAt);
      return { id: a.id, start, end: done || a.completedAt ? ms(a.completedAt) : live ? now : null, done, live, attempt: a.attemptNo };
    });
    return { s, bars, live: !!current && current.stageKey === s.stageKey && !current.completedAt };
  });

  const points = [now, ...(dueAt ? [dueAt] : []), ...(ms(v.application.submittedAt) ? [ms(v.application.submittedAt)!] : [])];
  for (const r of rows) for (const b of r.bars) { if (b.start) points.push(b.start); if (b.end) points.push(b.end); }
  let lo = Math.min(...points), hi = Math.max(...points);
  const span = Math.max(hi - lo, 7 * DAY);
  lo -= span * 0.04; hi = lo + span * 1.08;
  const pct = (t: number) => ((t - lo) / (hi - lo)) * 100;
  const ticks = [0, 1, 2, 3, 4].map((i) => lo + ((hi - lo) * i) / 4);

  return (
    <section className="card route-panel" aria-labelledby="route-title">
      <div className="track-head">
        <h2 id="route-title">Route · {w.routeName ?? 'Not yet classified'}</h2>
        <span className="small muted">Bars run from the date a stage started to the date it finished. Nothing is estimated.</span>
      </div>
      {rows.length > 0 && (
        <div className="rt">
          <div className="rt-axis" aria-hidden="true">
            <span className="rt-axis-gap" />
            <div className="rt-axis-line">
              {ticks.slice(0, -1).map((t, i) => <span key={i} className="rt-tick num" style={{ left: `${pct(t)}%` }}>{short(t)}</span>)}
              <span className="rt-now" style={{ left: `${pct(now)}%` }}><i />{short(now)}</span>
            </div>
          </div>
          <ol className="rt-rows" aria-labelledby="route-title">
            {rows.map(({ s, bars, live }: any) => {
              const dated = bars.filter((b: Bar) => b.start && b.end);
              const finished = s.state === 'COMPLETED';
              const record = [...v.stages].reverse().find((x: any) => x.stageKey === s.stageKey);
              return (
                <li key={s.position} className={`rt-row ${finished ? 'done' : ''} ${live ? 'live' : ''}`}>
                  <div className="rt-label">
                    <span className="n">Stage {s.position + 1}{s.attempts > 1 ? ` · ${s.attempts} attempts` : ''}</span>
                    <strong>{s.name}</strong>
                    <span className="state">{finished ? `Completed${record?.completedAt ? ` ${formatDate(record.completedAt, false)}` : ''}` : live ? `${humanise(s.state)} · here now` : humanise(s.state)}</span>
                    {finished && record?.assignee?.name && <span className="ack" title="Acknowledgement of completion"><b>AD</b>Signed off by {record.assignee.name}</span>}
                  </div>
                  <div className="rt-track">
                    <span className="rt-today" style={{ left: `${pct(now)}%` }} aria-hidden="true" />
                    {s.attempts === 0 && <span className="rt-note">Not started</span>}
                    {s.attempts > 0 && dated.length === 0 && <span className="rt-note">Date not recorded</span>}
                    {dated.map((b: Bar) => {
                      const left = pct(b.start!), width = Math.max(pct(b.end!) - left, 0.8);
                      const isLate = b.live && late;
                      return (
                        <span key={b.id} className={`rt-bar-wrap ${b.done ? 'done' : ''}`} style={{ left: `${left}%`, width: `${width}%` }}>
                          <span className={`rt-bar ${b.done ? 'done' : ''} ${b.live ? 'live' : ''} ${isLate ? 'late hatched' : ''}`} title={`Attempt ${b.attempt}: ${short(b.start!)} to ${short(b.end!)}`} />
                          <span className="rt-dates num">{short(b.start!)}{b.done ? ` → ${short(b.end!)}` : ''}</span>
                          {b.done && (
                            <span className="rt-stamp">
                              <Postmark top={s.name} date={stampDate(new Date(b.end!).toISOString()) || 'DONE'} bottom={`Stage ${s.position + 1}`} size={52} land label={`${s.name} completed ${short(b.end!)}`} />
                            </span>
                          )}
                        </span>
                      );
                    })}
                    {live && dueAt && (
                      <span className={`rt-due ${late ? 'late' : ''}`} style={{ left: `${pct(dueAt)}%` }}>
                        <i aria-hidden="true" /><span className="num">{late ? 'Was due' : 'Due'} {short(dueAt)}</span>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <details className="route-explanation"><summary>Why this route?</summary><div className="small">
        {w.classification.explanation}
        {w.classification.ruleRef && <> <span className="mono">({w.classification.ruleRef})</span></>}
        {w.classification.provenance && <> <Provenance value={w.classification.provenance} /></>}
      </div></details>
    </section>
  );
}

/** At a glance: the clock, the stage and who holds it. Everything here comes from the case record. */
export function CaseSummary({ v }: { v: View }) {
  const now = useNow();
  const due = v.actionPanel.due;
  const late = !!due && due.overdueDays > 0;
  const stage = v.stages.find((s: any) => s.id === v.currentStageId);
  const entered = ms(stage?.enteredAt);
  const days = entered ? Math.max(0, Math.floor((now - entered) / DAY)) : null;
  const holder = stage?.assignee?.name ?? v.actionPanel.responsible?.person;
  return (
    <section className="card summary" aria-labelledby="sum-title">
      <h2 id="sum-title">At a glance</h2>
      {due ? (
        <div className={`sum-clock ${late ? 'late hatched' : ''}`}>
          <Urgency due={due} />
          <span className="due-date">{formatDate(due.dueDate, false)}</span>
          {due.originalDueDate !== due.dueDate && <span className="due-rule">Originally {formatDate(due.originalDueDate, false)}</span>}
          <span className="due-rule" title={due.ruleRef}>{due.label}</span>
        </div>
      ) : <p className="small muted sum-none">No clock is configured for this step.</p>}
      <dl className="kv small">
        <dt>Stage</dt><dd>{stage ? `${stage.name} · ${stage.stateLabel ?? humanise(stage.state)}` : v.application.lifecycleLabel ?? humanise(v.application.lifecycleState)}</dd>
        {stage && !stage.completedAt && <><dt>In stage</dt><dd className="num">{days === null ? 'Not recorded' : `${days} ${days === 1 ? 'day' : 'days'}`}</dd></>}
        {stage && <><dt>Held by</dt><dd>{holder ? <NamePlate name={holder} role={stage?.ownerRoleLabel} /> : 'Not assigned'}</dd></>}
        {v.workflow && <><dt>Policy</dt><dd className="mono">{v.workflow.policyVersion.label}</dd></>}
      </dl>
      <AccountabilityClockSlot v={v} />
    </section>
  );
}
