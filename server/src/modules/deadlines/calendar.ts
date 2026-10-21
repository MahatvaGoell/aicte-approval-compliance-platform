// Pure deadline arithmetic. No database access, so the deadline engine, policy preview and tests share it.
//
// Conventions:
// - Dates without a time are local calendar dates ('YYYY-MM-DD') in the policy's time zone.
// - A deadline "due on" a date is met until the end of that local day, so its exclusive instant (`dueAt`)
//   is the next local midnight. A document "valid through" a date expires at the same instant.
// - Counting starts on the day after the anchor event; the anchor day itself never counts.

export interface CalendarConfig {
  timezone: string;
  weekendDays: number[]; // 0 = Sunday ... 6 = Saturday
  holidays: Array<{ date: string; name: string }>;
}

export type DurationUnit = 'CALENDAR_DAYS' | 'WORKING_DAYS' | 'CALENDAR_MONTHS';

export interface DurationRule {
  amount: number;
  unit: DurationUnit;
  /** For calendar units: move a due date that lands on a non-working day to the next working day. */
  rollForwardToWorkingDay?: boolean;
}

export interface DueCalculation {
  anchorInstant: string;
  anchorLocalDate: string;
  timezone: string;
  amount: number;
  unit: DurationUnit;
  dueDate: string;
  dueAt: string;
  skippedWeekendDates: string[];
  skippedHolidays: Array<{ date: string; name: string }>;
  rolledForwardFrom: string | null;
  text: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function assertDate(d: string) {
  if (!DATE_RE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new Error(`Invalid date ${d}`);
}

/** Offset of `tz` from UTC at `instant`, in milliseconds (positive east of UTC). */
export function tzOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Local calendar date of an instant in a time zone. */
export function localDate(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The instant at which a local date begins (local midnight) in a time zone. Handles DST shifts. */
export function startOfLocalDay(date: string, tz: string): Date {
  assertDate(date);
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let instant = guess - tzOffsetMs(new Date(guess), tz);
  // Re-evaluate once in case the offset differs at the corrected instant (DST transition days).
  instant = guess - tzOffsetMs(new Date(instant), tz);
  return new Date(instant);
}

export function addCalendarDays(date: string, n: number): string {
  assertDate(date);
  const t = Date.parse(`${date}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Adds calendar months, clamping to the last day of the target month (31 Jan + 1 month = 28/29 Feb). */
export function addCalendarMonths(date: string, n: number): string {
  assertDate(date);
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function holidayOn(date: string, cal: CalendarConfig) {
  return cal.holidays.find((h) => h.date === date) ?? null;
}

export function isWorkingDay(date: string, cal: CalendarConfig): boolean {
  return !cal.weekendDays.includes(dayOfWeek(date)) && !holidayOn(date, cal);
}

export function nextWorkingDay(date: string, cal: CalendarConfig): string {
  let d = date;
  while (!isWorkingDay(d, cal)) d = addCalendarDays(d, 1);
  return d;
}

/** Exclusive instant for something due on, or valid through, a local date: the next local midnight. */
export function endOfLocalDateExclusive(date: string, tz: string): Date {
  return startOfLocalDay(addCalendarDays(date, 1), tz);
}

/** When a document valid through `validThrough` stops being valid. */
export function validityExpiresAt(validThrough: string, tz: string): Date {
  return endOfLocalDateExclusive(validThrough, tz);
}

/** Computes a due date from an anchor instant and a duration rule, with a full explanation. */
export function computeDue(anchor: Date, rule: DurationRule, cal: CalendarConfig): DueCalculation {
  if (!Number.isInteger(rule.amount) || rule.amount < 0) throw new Error('Duration amount must be a non-negative integer');
  const anchorDate = localDate(anchor, cal.timezone);
  const skippedWeekendDates: string[] = [];
  const skippedHolidays: Array<{ date: string; name: string }> = [];
  let due: string;
  let rolledForwardFrom: string | null = null;

  if (rule.unit === 'WORKING_DAYS') {
    due = anchorDate;
    let counted = 0;
    while (counted < rule.amount) {
      due = addCalendarDays(due, 1);
      if (cal.weekendDays.includes(dayOfWeek(due))) skippedWeekendDates.push(due);
      else if (holidayOn(due, cal)) skippedHolidays.push(holidayOn(due, cal)!);
      else counted++;
    }
  } else {
    due = rule.unit === 'CALENDAR_DAYS' ? addCalendarDays(anchorDate, rule.amount) : addCalendarMonths(anchorDate, rule.amount);
    if (rule.rollForwardToWorkingDay && !isWorkingDay(due, cal)) {
      rolledForwardFrom = due;
      let d = due;
      while (!isWorkingDay(d, cal)) {
        if (cal.weekendDays.includes(dayOfWeek(d))) skippedWeekendDates.push(d);
        else skippedHolidays.push(holidayOn(d, cal)!);
        d = addCalendarDays(d, 1);
      }
      due = d;
    }
  }

  const dueAt = endOfLocalDateExclusive(due, cal.timezone);
  const unitText = { WORKING_DAYS: 'working day', CALENDAR_DAYS: 'calendar day', CALENDAR_MONTHS: 'calendar month' }[rule.unit];
  const parts = [
    `Anchor ${anchorDate} (${cal.timezone}); counting starts the next day.`,
    `${rule.amount} ${unitText}${rule.amount === 1 ? '' : 's'}`,
  ];
  if (skippedWeekendDates.length) parts.push(`skipping ${skippedWeekendDates.length} weekend day(s)`);
  if (skippedHolidays.length) parts.push(`skipping holiday(s): ${skippedHolidays.map((h) => `${h.name} (${h.date})`).join(', ')}`);
  if (rolledForwardFrom) parts.push(`${rolledForwardFrom} is not a working day, so the due date moves forward`);
  parts.push(`→ due by end of ${DAY_NAMES[dayOfWeek(due)]} ${due}.`);

  return {
    anchorInstant: anchor.toISOString(),
    anchorLocalDate: anchorDate,
    timezone: cal.timezone,
    amount: rule.amount,
    unit: rule.unit,
    dueDate: due,
    dueAt: dueAt.toISOString(),
    skippedWeekendDates,
    skippedHolidays,
    rolledForwardFrom,
    text: parts.join(' '),
  };
}

/**
 * Working days lost to a pause, counting each working date from the local date the pause started up to,
 * but not including, the local date it ended. A pause that starts and ends on the same day costs nothing.
 */
export function workingDaysPaused(pausedAt: Date, resumedAt: Date, cal: CalendarConfig): number {
  if (resumedAt <= pausedAt) return 0;
  const end = localDate(resumedAt, cal.timezone);
  let d = localDate(pausedAt, cal.timezone);
  let n = 0;
  while (d < end) {
    if (isWorkingDay(d, cal)) n++;
    d = addCalendarDays(d, 1);
  }
  return n;
}

/** Calendar days lost to a pause, measured on local dates in the same way as workingDaysPaused. */
export function calendarDaysPaused(pausedAt: Date, resumedAt: Date, cal: CalendarConfig): number {
  if (resumedAt <= pausedAt) return 0;
  const a = Date.parse(`${localDate(pausedAt, cal.timezone)}T00:00:00Z`);
  const b = Date.parse(`${localDate(resumedAt, cal.timezone)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Moves a due date forward by working days (used when resuming a paused working-day clock). */
export function extendDueDateByWorkingDays(dueDate: string, n: number, cal: CalendarConfig): string {
  let d = dueDate;
  let counted = 0;
  while (counted < n) {
    d = addCalendarDays(d, 1);
    if (isWorkingDay(d, cal)) counted++;
  }
  return d;
}

/**
 * Ageing: whole local days elapsed since `from`, optionally excluding paused segments
 * (for example time spent waiting for the institution).
 */
export function elapsedDays(
  from: Date,
  to: Date,
  cal: CalendarConfig,
  unit: 'CALENDAR_DAYS' | 'WORKING_DAYS',
  pauses: Array<{ from: Date; to: Date | null }> = [],
): number {
  const total = unit === 'WORKING_DAYS' ? workingDaysPaused(from, to, cal) : calendarDaysPaused(from, to, cal);
  const paused = pauses.reduce((sum, p) => {
    const end = p.to ?? to;
    return sum + (unit === 'WORKING_DAYS' ? workingDaysPaused(p.from, end, cal) : calendarDaysPaused(p.from, end, cal));
  }, 0);
  return Math.max(0, total - paused);
}

/** Whole days overdue at `at` for something whose exclusive due instant is `dueAt` (0 if not overdue). */
export function overdueDays(dueAt: Date, at: Date): number {
  if (at < dueAt) return 0;
  return Math.floor((at.getTime() - dueAt.getTime()) / 86_400_000) + 1;
}

/**
 * Instant at which an escalation-ladder step fires: `offsetDays` calendar days relative to the local due date
 * (negative = before), at local start of day. Offset 0 means the moment the deadline passes.
 */
export function ladderStepAt(dueDate: string, offsetDays: number, tz: string): Date {
  if (offsetDays >= 0) return startOfLocalDay(addCalendarDays(dueDate, offsetDays + 1), tz);
  return startOfLocalDay(addCalendarDays(dueDate, offsetDays), tz);
}
