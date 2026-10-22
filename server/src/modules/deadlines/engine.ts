import type { Db } from '../../db.js';
import { AppError, ValidationError, maybe, one, q } from '../../db.js';
import type { ActionContext } from '../audit/audit.js';
import { recordAudit } from '../audit/audit.js';
import { ruleRef } from '../policy/engine.js';
import type { PolicyDocument } from '../policy/schema.js';
import type { PolicyVersion } from '../policy/service.js';
import type { CalendarConfig, DurationRule } from './calendar.js';
import {
  addCalendarDays, calendarDaysPaused, computeDue, endOfLocalDateExclusive, extendDueDateByWorkingDays, ladderStepAt, localDate,
  overdueDays, workingDaysPaused,
} from './calendar.js';

// Durable deadlines. Every change happens in the caller's transaction together with its audit event.
// A change of due date starts a new generation; alerts belong to a generation, so stale ones are never sent.

export type LadderStep = NonNullable<PolicyDocument['deadlines']>['ladder'][number];

export interface DeadlineRow {
  id: string;
  application_id: string;
  workflow_id: string | null;
  clock_type: 'STAGE_HANDLING' | 'INSTITUTION_RESPONSE';
  subject_id: string;
  stage_key: string | null;
  label: string;
  anchor_at: Date;
  rule: DurationRule & { pauseOnReturn?: boolean };
  calendar: CalendarConfig;
  original_due_date: string;
  current_due_date: string;
  current_due_at: Date;
  state: 'ACTIVE' | 'PAUSED' | 'MET' | 'CANCELLED';
  generation: number;
  generation_started_at: Date;
  pause_on_return: boolean;
  ladder: LadderStep[];
  next_step_at: Date | null;
  policy_version_id: string;
  rule_ref: string;
  provenance: string;
}

const dateStr = (d: string | Date) => (typeof d === 'string' ? d.slice(0, 10) : localDate(d, 'UTC'));

function calendarOf(doc: PolicyDocument): CalendarConfig {
  return { timezone: doc.calendar.timezone, weekendDays: doc.calendar.weekendDays, holidays: doc.calendar.holidays.map((h) => ({ date: h.date, name: h.name })) };
}

/** Ladder steps of a deadline generation with their firing instants, earliest first. */
export function stepTimes(d: Pick<DeadlineRow, 'ladder' | 'current_due_date' | 'calendar'>) {
  return d.ladder
    .map((s) => ({ step: s, at: ladderStepAt(dateStr(d.current_due_date), s.offsetDays, d.calendar.timezone) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** First step at or after `from` (steps before a generation started are not applicable to it). */
export function nextStepAfter(d: Pick<DeadlineRow, 'ladder' | 'current_due_date' | 'calendar'>, from: Date, inclusive = true) {
  return stepTimes(d).find((s) => (inclusive ? s.at >= from : s.at > from))?.at ?? null;
}

async function insertDeadline(
  tx: Db,
  ctx: ActionContext,
  input: {
    applicationId: string; workflowId: string; clockType: DeadlineRow['clock_type']; subjectId: string; stageKey: string; label: string;
    rule: DurationRule & { pauseOnReturn?: boolean; provenance: string }; policy: PolicyVersion; ruleRefPath: string; institutionId: string;
  },
) {
  const cal = calendarOf(input.policy.doc);
  const calc = computeDue(ctx.at, input.rule, cal);
  const ladder = input.policy.doc.deadlines?.ladder ?? [];
  const ref = ruleRef(input.policy.versionNo, input.ruleRefPath);
  const shape = { ladder, current_due_date: calc.dueDate, calendar: cal };
  const row = await one<DeadlineRow>(
    tx,
    `INSERT INTO deadlines (application_id, workflow_id, clock_type, subject_id, stage_key, label, anchor_at, rule, calendar,
       original_due_date, original_due_at, current_due_date, current_due_at, explanation, state, generation, generation_started_at,
       pause_on_return, ladder, next_step_at, policy_version_id, rule_ref, provenance, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$11,$12,'ACTIVE',1,$7,$13,$14,$15,$16,$17,$18,$7) RETURNING *`,
    [input.applicationId, input.workflowId, input.clockType, input.subjectId, input.stageKey, input.label, ctx.at, JSON.stringify(input.rule),
      JSON.stringify(cal), calc.dueDate, calc.dueAt, JSON.stringify(calc), !!input.rule.pauseOnReturn, JSON.stringify(ladder),
      nextStepAfter(shape, ctx.at), input.policy.id, ref, input.rule.provenance],
  );
  await recordAudit(tx, ctx, {
    entityType: 'deadline', entityId: row.id, action: 'DEADLINE_SET',
    after: { clockType: input.clockType, dueDate: calc.dueDate, rule: { amount: input.rule.amount, unit: input.rule.unit } },
    reason: calc.text, applicationId: input.applicationId, institutionId: input.institutionId, policyVersionId: input.policy.id, ruleRef: ref,
    visibility: 'INSTITUTION',
  });
  return row;
}

/** Starts the handling clock of a stage attempt if the case's policy configures one. */
export async function openStageDeadline(
  tx: Db, ctx: ActionContext,
  app: { id: string; institution_id: string }, workflowId: string, policy: PolicyVersion,
  stage: { id: string; stage_key: string }, stageName: string,
) {
  const rule = policy.doc.deadlines?.stages[stage.stage_key];
  if (!rule) return null;
  return insertDeadline(tx, ctx, {
    applicationId: app.id, workflowId, clockType: 'STAGE_HANDLING', subjectId: stage.id, stageKey: stage.stage_key,
    label: `${stageName} handling`, rule, policy, ruleRefPath: `deadlines/stages/${stage.stage_key}`, institutionId: app.institution_id,
  });
}

/** Starts the institution's response clock when a case is returned. */
export async function openResponseDeadline(
  tx: Db, ctx: ActionContext,
  app: { id: string; institution_id: string }, workflowId: string, policy: PolicyVersion,
  stage: { id: string; stage_key: string }, stageName: string,
) {
  const rule = policy.doc.deadlines?.institutionResponse;
  if (!rule) return null;
  return insertDeadline(tx, ctx, {
    applicationId: app.id, workflowId, clockType: 'INSTITUTION_RESPONSE', subjectId: stage.id, stageKey: stage.stage_key,
    label: `Institution response to ${stageName} findings`, rule, policy, ruleRefPath: 'deadlines/institutionResponse', institutionId: app.institution_id,
  });
}

/** Closes the open clocks of a subject: they are met (possibly late) or cancelled. */
export async function closeDeadlines(
  tx: Db, ctx: ActionContext, subjectId: string, how: 'MET' | 'CANCELLED', reason: string,
  clockType?: DeadlineRow['clock_type'],
) {
  const rows = await q<DeadlineRow & { institution_id: string }>(
    tx,
    `SELECT d.*, a.institution_id FROM deadlines d JOIN applications a ON a.id = d.application_id
      WHERE d.subject_id = $1 AND d.state IN ('ACTIVE','PAUSED') ${clockType ? 'AND d.clock_type = $2' : ''} FOR UPDATE OF d`,
    clockType ? [subjectId, clockType] : [subjectId],
  );
  for (const d of rows) {
    const late = how === 'MET' && ctx.at >= new Date(d.current_due_at);
    await tx.query(
      `UPDATE deadlines SET state = $2, closed_at = $3, close_reason = $4, met_late = $5, next_step_at = NULL WHERE id = $1`,
      [d.id, how, ctx.at, reason, how === 'MET' ? late : null],
    );
    if (d.state === 'PAUSED') await tx.query('UPDATE deadline_pause_segments SET resumed_at = $2 WHERE deadline_id = $1 AND resumed_at IS NULL', [d.id, ctx.at]);
    await recordAudit(tx, ctx, {
      entityType: 'deadline', entityId: d.id, action: how === 'MET' ? (late ? 'DEADLINE_MET_LATE' : 'DEADLINE_MET') : 'DEADLINE_CANCELLED',
      before: { state: d.state, dueDate: dateStr(d.current_due_date) }, after: { state: how, overdueDays: late ? overdueDays(new Date(d.current_due_at), ctx.at) : 0 },
      reason, applicationId: d.application_id, institutionId: d.institution_id, policyVersionId: d.policy_version_id, ruleRef: d.rule_ref,
      visibility: 'INSTITUTION',
    });
  }
  return rows.length;
}

/**
 * A return to the institution pauses the stage clock only if its rule allows it (pauseOnReturn).
 * Otherwise the clock keeps running and the audit trail says so (D04).
 */
export async function pauseForReturn(tx: Db, ctx: ActionContext, stageId: string, reason: string) {
  const d = await maybe<DeadlineRow & { institution_id: string }>(
    tx,
    `SELECT d.*, a.institution_id FROM deadlines d JOIN applications a ON a.id = d.application_id
      WHERE d.subject_id = $1 AND d.clock_type = 'STAGE_HANDLING' AND d.state = 'ACTIVE' FOR UPDATE OF d`,
    [stageId],
  );
  if (!d) return null;
  if (!d.pause_on_return) {
    await recordAudit(tx, ctx, {
      entityType: 'deadline', entityId: d.id, action: 'DEADLINE_CONTINUES', after: { dueDate: dateStr(d.current_due_date) },
      reason: 'The rule for this clock does not allow pausing on a return; it keeps running', applicationId: d.application_id,
      institutionId: d.institution_id, policyVersionId: d.policy_version_id, ruleRef: d.rule_ref,
    });
    return d;
  }
  await tx.query(`UPDATE deadlines SET state = 'PAUSED', next_step_at = NULL WHERE id = $1`, [d.id]);
  await tx.query('INSERT INTO deadline_pause_segments (deadline_id, paused_at, reason) VALUES ($1,$2,$3)', [d.id, ctx.at, reason]);
  await recordAudit(tx, ctx, {
    entityType: 'deadline', entityId: d.id, action: 'DEADLINE_PAUSED', before: { state: 'ACTIVE' }, after: { state: 'PAUSED' },
    reason, applicationId: d.application_id, institutionId: d.institution_id, policyVersionId: d.policy_version_id, ruleRef: d.rule_ref,
  });
  return d;
}

async function newGeneration(
  tx: Db, ctx: ActionContext, d: DeadlineRow & { institution_id: string }, toDueDate: string,
  kind: 'EXTENSION' | 'RESUMED_AFTER_PAUSE', reason: string, extra: Record<string, unknown> = {},
) {
  const dueAt = endOfLocalDateExclusive(toDueDate, d.calendar.timezone);
  const gen = d.generation + 1;
  const next = nextStepAfter({ ladder: d.ladder, current_due_date: toDueDate, calendar: d.calendar }, ctx.at);
  await tx.query(
    `UPDATE deadlines SET current_due_date = $2, current_due_at = $3, generation = $4, generation_started_at = $5, state = 'ACTIVE', next_step_at = $6
      WHERE id = $1`,
    [d.id, toDueDate, dueAt, gen, ctx.at, next],
  );
  await tx.query(
    `INSERT INTO deadline_adjustments (deadline_id, kind, from_due_date, to_due_date, from_generation, to_generation, reason, by_user_id, at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [d.id, kind, dateStr(d.current_due_date), toDueDate, d.generation, gen, reason, ctx.actor?.userId ?? null, ctx.at],
  );
  await recordAudit(tx, ctx, {
    entityType: 'deadline', entityId: d.id, action: kind === 'EXTENSION' ? 'DEADLINE_EXTENDED' : 'DEADLINE_RESUMED',
    before: { dueDate: dateStr(d.current_due_date), generation: d.generation }, after: { dueDate: toDueDate, generation: gen, ...extra },
    reason, applicationId: d.application_id, institutionId: d.institution_id, policyVersionId: d.policy_version_id, ruleRef: d.rule_ref,
    visibility: 'INSTITUTION',
  });
}

/**
 * When a returned attempt is replaced by a new attempt, the stage clock carries over: a paused clock resumes
 * with its due date moved by the days lost, and the clock is re-pointed at the new attempt.
 */
export async function carryStageDeadline(tx: Db, ctx: ActionContext, fromStageId: string, toStageId: string) {
  const d = await maybe<DeadlineRow & { institution_id: string }>(
    tx,
    `SELECT d.*, a.institution_id FROM deadlines d JOIN applications a ON a.id = d.application_id
      WHERE d.subject_id = $1 AND d.clock_type = 'STAGE_HANDLING' AND d.state IN ('ACTIVE','PAUSED') FOR UPDATE OF d`,
    [fromStageId],
  );
  if (!d) return false;
  await tx.query('UPDATE deadlines SET subject_id = $2 WHERE id = $1', [d.id, toStageId]);
  if (d.state === 'PAUSED') {
    const seg = await one(tx, 'SELECT * FROM deadline_pause_segments WHERE deadline_id = $1 AND resumed_at IS NULL', [d.id]);
    const lost = d.rule.unit === 'WORKING_DAYS' ? workingDaysPaused(new Date(seg.paused_at), ctx.at, d.calendar) : calendarDaysPaused(new Date(seg.paused_at), ctx.at, d.calendar);
    await tx.query('UPDATE deadline_pause_segments SET resumed_at = $2, days_lost = $3 WHERE id = $1', [seg.id, ctx.at, lost]);
    const to = d.rule.unit === 'WORKING_DAYS' ? extendDueDateByWorkingDays(dateStr(d.current_due_date), lost, d.calendar) : addCalendarDays(dateStr(d.current_due_date), lost);
    await newGeneration(tx, ctx, d, to, 'RESUMED_AFTER_PAUSE', `Resumed after the institution responded; ${lost} ${d.rule.unit === 'WORKING_DAYS' ? 'working' : 'calendar'} day(s) paused are added`, { daysLost: lost });
  }
  return true;
}

/** Authorised extension. The original due date is kept; the old generation's pending alerts become stale. */
export async function extendDeadline(tx: Db, ctx: ActionContext, deadlineId: string, applicationId: string, newDueDate: string, reason: string) {
  const d = await maybe<DeadlineRow & { institution_id: string }>(
    tx,
    `SELECT d.*, a.institution_id FROM deadlines d JOIN applications a ON a.id = d.application_id
      WHERE d.id = $1 AND d.application_id = $2 FOR UPDATE OF d`,
    [deadlineId, applicationId],
  );
  if (!d) throw new ValidationError('That deadline does not belong to this case', [{ field: 'deadlineId', message: 'Unknown deadline' }]);
  if (d.state !== 'ACTIVE') throw new AppError(409, 'DEADLINE_NOT_ACTIVE', `The deadline is ${d.state.toLowerCase()} and cannot be extended`);
  if (newDueDate <= dateStr(d.current_due_date)) {
    throw new ValidationError('The new due date must be later than the current one', [{ field: 'newDueDate', message: `After ${dateStr(d.current_due_date)}` }]);
  }
  await newGeneration(tx, ctx, d, newDueDate, 'EXTENSION', reason);
}

/** Read model for the case page: every clock with its calculation, pauses, adjustments and alerts. */
export async function deadlinesForCase(db: Db, applicationId: string, at: Date, internal: boolean) {
  const rows = await q<DeadlineRow & { explanation: any; original_due_at: Date; created_at: Date; closed_at: Date | null; close_reason: string | null; met_late: boolean | null }>(
    db, 'SELECT * FROM deadlines WHERE application_id = $1 ORDER BY created_at', [applicationId],
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [pauses, adjustments, alerts] = await Promise.all([
    q(db, 'SELECT * FROM deadline_pause_segments WHERE deadline_id = ANY($1::uuid[]) ORDER BY paused_at', [ids]),
    q(db, `SELECT a.*, u.name AS by_name FROM deadline_adjustments a LEFT JOIN users u ON u.id = a.by_user_id WHERE a.deadline_id = ANY($1::uuid[]) ORDER BY a.at`, [ids]),
    internal
      ? q(db, `SELECT e.deadline_id, e.generation, e.step_id, e.step_kind, e.state, e.step_at, e.channel, e.created_at, u.name AS recipient_name, e.recipient_rule
                 FROM alert_events e LEFT JOIN users u ON u.id = e.recipient_user_id
                WHERE e.deadline_id = ANY($1::uuid[]) AND e.channel <> 'EMAIL' ORDER BY e.step_at, e.created_at`, [ids])
      : Promise.resolve([] as any[]),
  ]);
  return rows.map((d) => {
    const dueAt = new Date(d.current_due_at);
    const open = d.state === 'ACTIVE' || d.state === 'PAUSED';
    return {
      id: d.id, clockType: d.clock_type, label: d.label, stageKey: d.stage_key, state: d.state, generation: d.generation,
      originalDueDate: dateStr(d.original_due_date), currentDueDate: dateStr(d.current_due_date), currentDueAt: dueAt,
      explanation: d.explanation.text, rule: { amount: d.rule.amount, unit: d.rule.unit }, pauseOnReturn: d.pause_on_return,
      overdueDays: open ? overdueDays(dueAt, at) : 0,
      daysLeft: open && at < dueAt ? Math.ceil((dueAt.getTime() - at.getTime()) / 86_400_000) : 0,
      metLate: d.met_late, closedAt: d.closed_at, closeReason: d.close_reason, ruleRef: d.rule_ref, provenance: d.provenance,
      nextStepAt: d.next_step_at,
      pauses: pauses.filter((p) => p.deadline_id === d.id).map((p) => ({ pausedAt: p.paused_at, resumedAt: p.resumed_at, reason: p.reason, daysLost: p.days_lost })),
      adjustments: adjustments.filter((a) => a.deadline_id === d.id).map((a) => ({
        kind: a.kind, from: dateStr(a.from_due_date), to: dateStr(a.to_due_date), reason: a.reason, by: internal ? a.by_name : null, at: a.at, toGeneration: a.to_generation,
      })),
      alerts: alerts.filter((a) => a.deadline_id === d.id).map((a) => ({
        generation: a.generation, stepId: a.step_id, kind: a.step_kind, state: a.state, stepAt: a.step_at, recipient: a.recipient_name, recipientRule: a.recipient_rule,
      })),
    };
  });
}
