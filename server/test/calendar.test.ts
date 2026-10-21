import { describe, expect, it } from 'vitest';
import {
  addCalendarMonths, calendarDaysPaused, computeDue, elapsedDays, extendDueDateByWorkingDays, ladderStepAt, localDate,
  overdueDays, startOfLocalDay, validityExpiresAt, workingDaysPaused, type CalendarConfig,
} from '../src/modules/deadlines/calendar.js';

// Demo calendar: Saturday/Sunday off, one invented mid-week holiday so skips are visible.
const IST: CalendarConfig = {
  timezone: 'Asia/Kolkata',
  weekendDays: [0, 6],
  holidays: [{ date: '2026-11-04', name: 'Demo holiday' }],
};
const at = (s: string) => new Date(s);

describe('computeDue', () => {
  it('counts working days from the day after the anchor, skipping weekends and holidays (D03)', () => {
    const r = computeDue(at('2026-11-02T10:00:00+05:30'), { amount: 5, unit: 'WORKING_DAYS' }, IST);
    expect(r.anchorLocalDate).toBe('2026-11-02');
    expect(r.dueDate).toBe('2026-11-10');
    expect(r.skippedHolidays).toEqual([{ date: '2026-11-04', name: 'Demo holiday' }]);
    expect(r.skippedWeekendDates).toEqual(['2026-11-07', '2026-11-08']);
    // Due by the end of the local day: the exclusive instant is the next IST midnight.
    expect(r.dueAt).toBe('2026-11-10T18:30:00.000Z');
    expect(r.text).toContain('Demo holiday (2026-11-04)');
  });

  it('uses the local date of the anchor in the policy time zone (D01)', () => {
    // 20:00 UTC on 2 Nov is 01:30 on 3 Nov in India.
    const r = computeDue(at('2026-11-02T20:00:00Z'), { amount: 1, unit: 'WORKING_DAYS' }, IST);
    expect(r.anchorLocalDate).toBe('2026-11-03');
    expect(r.dueDate).toBe('2026-11-05');
  });

  it('adds calendar days and can roll a non-working due date forward', () => {
    const plain = computeDue(at('2026-11-02T10:00:00+05:30'), { amount: 5, unit: 'CALENDAR_DAYS' }, IST);
    expect(plain.dueDate).toBe('2026-11-07');
    const rolled = computeDue(at('2026-11-02T10:00:00+05:30'), { amount: 5, unit: 'CALENDAR_DAYS', rollForwardToWorkingDay: true }, IST);
    expect(rolled.dueDate).toBe('2026-11-09');
    expect(rolled.rolledForwardFrom).toBe('2026-11-07');
  });

  it('treats months as calendar operations, clamping to month end and handling leap years (D03)', () => {
    expect(addCalendarMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addCalendarMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addCalendarMonths('2026-12-15', 2)).toBe('2027-02-15');
    const r = computeDue(at('2028-02-28T12:00:00+05:30'), { amount: 1, unit: 'CALENDAR_DAYS' }, IST);
    expect(r.dueDate).toBe('2028-02-29');
  });

  it('a zero-day rule is due at the end of the anchor day', () => {
    const r = computeDue(at('2026-11-02T10:00:00+05:30'), { amount: 0, unit: 'WORKING_DAYS' }, IST);
    expect(r.dueDate).toBe('2026-11-02');
  });

  it('rejects invalid amounts', () => {
    expect(() => computeDue(at('2026-11-02T10:00:00Z'), { amount: -1, unit: 'WORKING_DAYS' }, IST)).toThrow();
    expect(() => computeDue(at('2026-11-02T10:00:00Z'), { amount: 1.5, unit: 'CALENDAR_DAYS' }, IST)).toThrow();
  });
});

describe('time zones and validity', () => {
  it('a document valid through a date expires at the next local midnight (D02)', () => {
    expect(validityExpiresAt('2026-11-30', 'Asia/Kolkata').toISOString()).toBe('2026-11-30T18:30:00.000Z');
  });

  it('finds local midnight across a daylight-saving change', () => {
    // US daylight saving starts on 8 March 2026: midnight that day is still standard time (UTC-5).
    expect(startOfLocalDay('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(startOfLocalDay('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('reads the local date of an instant', () => {
    expect(localDate(at('2026-11-02T18:29:59Z'), 'Asia/Kolkata')).toBe('2026-11-02');
    expect(localDate(at('2026-11-02T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-11-03');
  });
});

describe('pauses, extensions and ageing', () => {
  it('counts working days lost to a pause (holiday and weekend excluded)', () => {
    const lost = workingDaysPaused(at('2026-11-03T15:00:00+05:30'), at('2026-11-09T11:00:00+05:30'), IST);
    expect(lost).toBe(3); // 3, 5, 6 November
    expect(calendarDaysPaused(at('2026-11-03T15:00:00+05:30'), at('2026-11-09T11:00:00+05:30'), IST)).toBe(6);
    expect(workingDaysPaused(at('2026-11-03T09:00:00+05:30'), at('2026-11-03T17:00:00+05:30'), IST)).toBe(0);
  });

  it('extends a due date by working days after a resume', () => {
    expect(extendDueDateByWorkingDays('2026-11-10', 3, IST)).toBe('2026-11-13');
    expect(extendDueDateByWorkingDays('2026-11-06', 1, IST)).toBe('2026-11-09');
  });

  it('measures ageing with institution-response time excluded', () => {
    const from = at('2026-11-02T10:00:00+05:30');
    const to = at('2026-11-16T10:00:00+05:30');
    const pauses = [{ from: at('2026-11-05T10:00:00+05:30'), to: at('2026-11-10T10:00:00+05:30') }];
    expect(elapsedDays(from, to, IST, 'CALENDAR_DAYS')).toBe(14);
    expect(elapsedDays(from, to, IST, 'CALENDAR_DAYS', pauses)).toBe(9);
    // Working days 2–13 Nov: 9 (holiday on 4th, two weekends). Paused 5, 6, 9 Nov → 6.
    expect(elapsedDays(from, to, IST, 'WORKING_DAYS', pauses)).toBe(6);
  });

  it('reports overdue days from the exclusive due instant', () => {
    const dueAt = at('2026-11-10T18:30:00Z');
    expect(overdueDays(dueAt, at('2026-11-10T18:29:59Z'))).toBe(0);
    expect(overdueDays(dueAt, at('2026-11-10T18:30:00Z'))).toBe(1);
    expect(overdueDays(dueAt, at('2026-11-13T12:00:00Z'))).toBe(3);
  });
});

describe('escalation ladder timing', () => {
  it('places reminders before and escalations after the local due date', () => {
    expect(ladderStepAt('2026-11-10', -7, 'Asia/Kolkata').toISOString()).toBe('2026-11-02T18:30:00.000Z'); // start of 3 Nov IST
    expect(ladderStepAt('2026-11-10', 0, 'Asia/Kolkata').toISOString()).toBe('2026-11-10T18:30:00.000Z'); // the moment it is overdue
    expect(ladderStepAt('2026-11-10', 3, 'Asia/Kolkata').toISOString()).toBe('2026-11-13T18:30:00.000Z');
  });
});
