import { describe, it, expect } from 'vitest';
import {
  computeNextRun,
  describeScheduleSpec,
  isValidScheduleSpec,
  isValidTimezone,
  parseCronExpression,
  wallToUtc,
  zonedWallTime,
} from '@shared/schedules';

const NYC = 'America/New_York';
const UTC = 'UTC';

describe('timezone helpers', () => {
  it('validates IANA zones', () => {
    expect(isValidTimezone(NYC)).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
  });

  it('maps UTC instants to wall clock', () => {
    // 2026-03-08 07:30Z = 03:30 EDT in New York (transition at 07:00Z).
    const wall = zonedWallTime(Date.UTC(2026, 2, 8, 7, 30), NYC);
    expect(wall).toMatchObject({ year: 2026, month: 3, day: 8, hour: 3, minute: 30, weekday: 0 });
  });
});

describe('wallToUtc DST semantics', () => {
  it('resolves ambiguous fall-back times to the FIRST occurrence', () => {
    // 2026-11-01: 01:30 EDT (-4) = 05:30Z, then 01:30 EST (-5) = 06:30Z.
    const utc = wallToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NYC);
    expect(utc).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });

  it('resolves nonexistent spring-forward times to the shifted instant', () => {
    // 2026-03-08: 02:00 EST jumps to 03:00 EDT — 02:30 does not exist.
    const utc = wallToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NYC);
    const wall = zonedWallTime(utc, NYC);
    expect(wall.hour).toBeGreaterThanOrEqual(3);
    expect(wall.minute).toBe(0);
  });

  it('round-trips plain times exactly', () => {
    const utc = wallToUtc({ year: 2026, month: 6, day: 15, hour: 9, minute: 5 }, NYC);
    expect(zonedWallTime(utc, NYC)).toMatchObject({ hour: 9, minute: 5, month: 6, day: 15 });
    expect(utc).toBe(Date.UTC(2026, 5, 15, 13, 5));
  });
});

describe('computeNextRun — drift tolerances', () => {
  it('interval anchors strictly after `from` (no drift accumulation)', () => {
    expect(computeNextRun({ kind: 'interval', minutes: 15 }, UTC, 1_000_000)).toBe(1_000_000 + 900_000);
  });

  it('daily fires later today when the time is still ahead', () => {
    const from = Date.UTC(2026, 5, 15, 12, 0);
    const next = computeNextRun({ kind: 'daily', time: '09:00' }, NYC, from);
    expect(next).toBe(Date.UTC(2026, 5, 15, 13, 0)); // 09:00 EDT
  });

  it('daily rolls to tomorrow after the time passed (wall clock, not drift)', () => {
    const from = Date.UTC(2026, 5, 15, 13, 0, 500); // 09:00:00.500 EDT — half a second past
    const next = computeNextRun({ kind: 'daily', time: '09:00' }, NYC, from);
    expect(next).toBe(Date.UTC(2026, 5, 16, 13, 0));
  });

  it('daily crosses DST and keeps 09:00 wall time (EDT → EST offset shift)', () => {
    const beforeFallBack = Date.UTC(2026, 9, 30, 12, 0); // Fri Oct 30, EDT
    const next = computeNextRun({ kind: 'daily', time: '09:00' }, NYC, beforeFallBack);
    expect(next).toBe(Date.UTC(2026, 9, 30, 13, 0)); // 09:00 EDT = 13:00Z
    // Sun Nov 1 after the fall-back (10:00 EST) → next is Monday Nov 2, 09:00 EST = 14:00Z.
    const afterFallBack = computeNextRun({ kind: 'daily', time: '09:00' }, NYC, Date.UTC(2026, 10, 1, 15, 0));
    expect(afterFallBack).toBe(Date.UTC(2026, 10, 2, 14, 0));
  });

  it('weekly lands on the next matching weekday', () => {
    // Sat Jun 13 2026 → next weekday (Mon Jun 15) at 08:30 EDT.
    const from = Date.UTC(2026, 5, 13, 20, 0);
    const next = computeNextRun({ kind: 'weekly', days: [1, 2, 3, 4, 5], time: '08:30' }, NYC, from);
    expect(next).toBe(Date.UTC(2026, 5, 15, 12, 30));
  });

  it('daily 02:30 on a spring-forward night fires at the shifted instant, once', () => {
    const from = Date.UTC(2026, 2, 7, 12, 0); // Mar 7, before the gap
    const next = computeNextRun({ kind: 'daily', time: '02:30' }, NYC, from);
    const wall = zonedWallTime(next ?? 0, NYC);
    expect(wall).toMatchObject({ month: 3, day: 8 });
    expect(wall.hour).toBeGreaterThanOrEqual(3);
  });
});

describe('cron', () => {
  it('parses fields, lists, ranges and steps; rejects garbage', () => {
    expect(parseCronExpression('*/15 9-17 * * 1-5')?.minute.has(30)).toBe(true);
    expect(parseCronExpression('0 9 * * 1-5')?.dayOfWeek.has(6)).toBe(false);
    expect(parseCronExpression('0 9 * *')).toBeNull();
    expect(parseCronExpression('61 * * * *')).toBeNull();
    expect(parseCronExpression('a b c d e')).toBeNull();
    expect(isValidScheduleSpec({ kind: 'cron', expr: '*/15 9-17 * * 1-5' })).toBe(true);
  });

  it('treats 7 as Sunday', () => {
    expect(parseCronExpression('0 9 * * 7')?.dayOfWeek.has(0)).toBe(true);
  });

  it('computes the next cron run in the target timezone', () => {
    // 0 9 * * 1-5 in NYC: Sat Jun 13 20:00Z → Mon Jun 15 09:00 EDT = 13:00Z.
    const from = Date.UTC(2026, 5, 13, 20, 0);
    expect(computeNextRun({ kind: 'cron', expr: '0 9 * * 1-5' }, NYC, from)).toBe(Date.UTC(2026, 5, 15, 13, 0));
  });

  it('honours restricted dom/dow with the standard OR rule', () => {
    // 0 0 1 * 1 (first of month OR Mondays): Tue Jun 16 → next is Mon Jun 22? No — Jul 1 OR Mondays; Jun 22 is Monday.
    const from = Date.UTC(2026, 5, 16, 12, 0);
    const next = computeNextRun({ kind: 'cron', expr: '0 0 1 * 1' }, UTC, from);
    expect(next).toBe(Date.UTC(2026, 5, 22, 0, 0)); // Monday Jun 22
  });

  it('matches vixie star semantics when both dom and dow are restricted', () => {
    // Jul 1 2026 is a Wednesday — matches BOTH via the OR rule; a single hit returns that day.
    const from = Date.UTC(2026, 5, 28, 12, 0);
    expect(computeNextRun({ kind: 'cron', expr: '0 0 1 * 3' }, UTC, from)).toBe(Date.UTC(2026, 6, 1, 0, 0));
  });
});

describe('spec validation + labels', () => {
  it('validates every kind', () => {
    expect(isValidScheduleSpec({ kind: 'interval', minutes: 0 })).toBe(false);
    expect(isValidScheduleSpec({ kind: 'interval', minutes: 30 })).toBe(true);
    expect(isValidScheduleSpec({ kind: 'daily', time: '9:00' })).toBe(false);
    expect(isValidScheduleSpec({ kind: 'daily', time: '09:00' })).toBe(true);
    expect(isValidScheduleSpec({ kind: 'weekly', days: [], time: '09:00' })).toBe(false);
    expect(isValidScheduleSpec({ kind: 'weekly', days: [1, 1], time: '09:00' })).toBe(false);
    expect(isValidScheduleSpec({ kind: 'bogus' })).toBe(false);
  });

  it('describes specs for the UI', () => {
    expect(describeScheduleSpec({ kind: 'interval', minutes: 30 })).toBe('every 30 min');
    expect(describeScheduleSpec({ kind: 'daily', time: '09:00' })).toBe('daily at 09:00');
    expect(describeScheduleSpec({ kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' })).toBe('weekdays at 09:00');
    expect(describeScheduleSpec({ kind: 'weekly', days: [0, 6], time: '10:00' })).toBe('Sun, Sat at 10:00');
  });

  it('refuses invalid zones instead of guessing', () => {
    expect(computeNextRun({ kind: 'daily', time: '09:00' }, 'Not/AZone', Date.now())).toBeNull();
  });
});
