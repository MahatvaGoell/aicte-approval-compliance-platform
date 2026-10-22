import type { Db } from '../../db.js';
import { maybe, q, withTx } from '../../db.js';
import { newCorrelationId } from '../../lib/crypto.js';
import type { ActionContext } from '../audit/audit.js';
import { recordAudit } from '../audit/audit.js';
import { institutionUsers, notify, usersCoveringRegion } from '../notifications/service.js';
import { overdueDays } from './calendar.js';
import type { DeadlineRow, LadderStep } from './engine.js';
import { nextStepAfter, stepTimes } from './engine.js';

// Scans active deadlines whose next ladder step has been reached. Each deadline is processed in its own
// transaction under a SKIP LOCKED row lock, so parallel schedulers never double-process one (N01), and the
// unique key on alert_events makes a duplicate alert impossible even if they did.
//
// After downtime, only the latest reached step is sent; earlier reached steps are recorded as MISSED (D06).

export interface ScanResult {
  deadlines: number;
  alerts: number;
  missed: number;
  unresolved: number;
}

const RECIPIENT_TEXT: Record<string, string> = { OWNER: 'the responsible person', CASE_OFFICER: 'the case officer', SUPERVISOR: 'the supervising bureau' };

async function recipientsFor(db: Db, d: DeadlineRow & { region_id: string; institution_id: string }, rule: string, at: Date) {
  if (rule === 'OWNER') {
    if (d.clock_type === 'INSTITUTION_RESPONSE') return institutionUsers(db, d.institution_id, at);
    const s = await maybe<{ id: string; name: string }>(db,
      `SELECT u.id, u.name FROM stage_instances si JOIN users u ON u.id = si.assignee_user_id WHERE si.id = $1 AND u.is_active`, [d.subject_id]);
    return s ? [s] : [];
  }
  if (rule === 'CASE_OFFICER') return usersCoveringRegion(db, 'REGIONAL_OFFICER', d.region_id, at);
  return usersCoveringRegion(db, 'BUREAU_OFFICER', d.region_id, at);
}

function message(d: DeadlineRow & { app_no: string }, step: LadderStep, at: Date) {
  const due = String(d.current_due_date).slice(0, 10);
  if (step.kind === 'REMINDER') {
    const days = -step.offsetDays;
    return { title: `Reminder: ${d.label} for ${d.app_no} is due in ${days} day${days === 1 ? '' : 's'}`, body: `${d.label} for ${d.app_no} is due by end of ${due}.` };
  }
  const late = overdueDays(new Date(d.current_due_at), at);
  if (step.kind === 'OVERDUE') return { title: `Overdue: ${d.label} for ${d.app_no}`, body: `${d.label} for ${d.app_no} was due by end of ${due} and is not complete.` };
  return {
    title: `Escalation: ${d.label} for ${d.app_no} is overdue by ${late} day${late === 1 ? '' : 's'}`,
    body: `${d.label} for ${d.app_no} was due by end of ${due}. This escalation asks for attention; it does not change the case.`,
  };
}

/** Processes one deadline whose next step is due. Returns what happened. */
async function processDeadline(tx: Db, id: string, at: Date, result: ScanResult) {
  const d = await maybe<DeadlineRow & { region_id: string; institution_id: string; app_no: string }>(
    tx,
    `SELECT d.*, a.region_id, a.institution_id, a.app_no FROM deadlines d JOIN applications a ON a.id = d.application_id
      WHERE d.id = $1 AND d.state = 'ACTIVE' AND d.next_step_at <= $2 FOR UPDATE OF d SKIP LOCKED`,
    [id, at],
  );
  if (!d) return; // taken by another scheduler, closed, or already moved on
  result.deadlines++;
  const genStart = new Date(d.generation_started_at);
  const reached = stepTimes(d).filter((s) => s.at >= genStart && s.at <= at);
  const processed = new Set((await q(tx, 'SELECT DISTINCT step_id FROM alert_events WHERE deadline_id = $1 AND generation = $2', [d.id, d.generation])).map((r) => r.step_id));
  const pending = reached.filter((s) => !processed.has(s.step.id));
  const ctx: ActionContext = { actor: null, correlationId: newCorrelationId(), at };

  pending.forEach((p, i) => { (p as any).current = i === pending.length - 1; });
  for (const p of pending) {
    if (!(p as any).current) {
      await tx.query(
        `INSERT INTO alert_events (deadline_id, generation, step_id, step_kind, recipient_user_id, recipient_rule, channel, state, step_at, created_at)
         VALUES ($1,$2,$3,$4,NULL,$5,'NONE','MISSED',$6,$7) ON CONFLICT DO NOTHING`,
        [d.id, d.generation, p.step.id, p.step.kind, p.step.recipients.join(','), p.at, at],
      );
      result.missed++;
      continue;
    }
    const msg = message(d, p.step, at);
    let anyone = false;
    for (const rule of p.step.recipients) {
      const users = await recipientsFor(tx, d, rule, at);
      if (users.length === 0) {
        await tx.query(
          `INSERT INTO alert_events (deadline_id, generation, step_id, step_kind, recipient_user_id, recipient_rule, channel, state, step_at, created_at)
           VALUES ($1,$2,$3,$4,NULL,$5,'NONE','UNRESOLVED',$6,$7) ON CONFLICT DO NOTHING`,
          [d.id, d.generation, p.step.id, p.step.kind, rule, p.at, at],
        );
        result.unresolved++;
        continue;
      }
      for (const u of users) {
        const ev = await maybe<{ id: string }>(
          tx,
          `INSERT INTO alert_events (deadline_id, generation, step_id, step_kind, recipient_user_id, recipient_rule, channel, state, step_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'IN_APP','CREATED',$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
          [d.id, d.generation, p.step.id, p.step.kind, u.id, rule, p.at, at],
        );
        if (!ev) continue; // already alerted: the unique key prevents a duplicate
        await tx.query(
          `INSERT INTO alert_events (deadline_id, generation, step_id, step_kind, recipient_user_id, recipient_rule, channel, state, step_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'EMAIL','CREATED',$7,$8) ON CONFLICT DO NOTHING`,
          [d.id, d.generation, p.step.id, p.step.kind, u.id, rule, p.at, at],
        );
        await notify(tx, at, {
          userId: u.id, kind: `DEADLINE_${p.step.kind}`, severity: p.step.kind, title: msg.title, body: msg.body,
          applicationId: d.application_id, alertEventId: ev.id, email: { alertEventId: ev.id },
        });
        anyone = true;
        result.alerts++;
      }
    }
    if (p.step.kind !== 'REMINDER') {
      await recordAudit(tx, ctx, {
        entityType: 'deadline', entityId: d.id, action: p.step.kind === 'OVERDUE' ? 'DEADLINE_OVERDUE' : 'ESCALATION_RAISED',
        after: { step: p.step.id, generation: d.generation, recipients: p.step.recipients, resolved: anyone, missedEarlierSteps: pending.length - 1 },
        reason: `${msg.title}. Sent to ${p.step.recipients.map((r) => RECIPIENT_TEXT[r]).join(' and ')}. Escalation only notifies.`,
        applicationId: d.application_id, institutionId: d.institution_id, policyVersionId: d.policy_version_id, ruleRef: `${d.rule_ref} · ladder/${p.step.id}`,
      });
    }
  }
  await tx.query('UPDATE deadlines SET next_step_at = $2 WHERE id = $1', [d.id, nextStepAfter(d, at, false)]);
}

export async function scanDeadlines(at: Date, batch = 50): Promise<ScanResult> {
  const result: ScanResult = { deadlines: 0, alerts: 0, missed: 0, unresolved: 0 };
  const due = await withTx((tx) => q<{ id: string }>(tx,
    `SELECT id FROM deadlines WHERE state = 'ACTIVE' AND next_step_at <= $1 ORDER BY next_step_at LIMIT $2`, [at, batch]));
  for (const { id } of due) {
    await withTx((tx) => processDeadline(tx, id, at, result));
  }
  return result;
}

/** Repairs scheduling gaps: active deadlines with a missing or stale next step (reconciliation). */
export async function reconcileDeadlines(at: Date) {
  return withTx(async (tx) => {
    const rows = await q<DeadlineRow>(tx,
      `SELECT * FROM deadlines WHERE state = 'ACTIVE' AND (next_step_at IS NULL OR next_step_at < generation_started_at) FOR UPDATE SKIP LOCKED`);
    let repaired = 0;
    for (const d of rows) {
      const genStart = new Date(d.generation_started_at);
      const reachedUnprocessed = stepTimes(d).filter((s) => s.at >= genStart && s.at <= at);
      const processed = new Set((await q(tx, 'SELECT DISTINCT step_id FROM alert_events WHERE deadline_id = $1 AND generation = $2', [d.id, d.generation])).map((r) => r.step_id));
      const first = reachedUnprocessed.find((s) => !processed.has(s.step.id));
      const next = first ? first.at : nextStepAfter(d, at, false);
      if (String(next) !== String(d.next_step_at)) {
        await tx.query('UPDATE deadlines SET next_step_at = $2 WHERE id = $1', [d.id, next]);
        if (next) repaired++;
      }
    }
    return { checked: rows.length, repaired };
  });
}
