import { describe, it, expect } from 'vitest';
import {
  execDatetime,
  shiftDate,
  isoWeekNumber,
  isLeapYear,
  monthLength,
  relativeString,
  businessDaysBetween,
  formatWithTokens,
  diffBreakdown,
} from '@main/ai/tools/native/datetime';
import { NATIVE_TOOL_CATALOG } from '@main/ai/tools/native';
import { datetimeTool } from '@main/ai/tools/native/datetime';
import { findGeminiUnsupportedKeywords } from '@main/ai/tool-schema-guard';

const fixed = new Date('2026-03-10T12:34:56Z');

describe('datetime tool', () => {
  it('is registered as a read-only system tool in the native catalog', () => {
    expect(datetimeTool).toBe(NATIVE_TOOL_CATALOG.find((def) => def.name === 'datetime'));
    expect(datetimeTool.risk).toBe('read-only');
    expect(datetimeTool.category).toBe('system');
    expect(datetimeTool.schema.def.type).toBe('object');
  });

  it('schema is Gemini-bindable — no type-array unions the converter throws on', () => {
    expect(findGeminiUnsupportedKeywords('datetime', datetimeTool.schema)).toEqual([]);
  });

  it('now reports epoch, ISO fields and leap-year facts', async () => {
    const text = await execDatetime({ action: 'now' }, fixed);
    expect(text).toContain('Epoch: 1773146096');
    expect(text).toContain('ISO 8601: 2026-03-10T12:34:56');
    expect(text).toContain('Quarter: Q1');
    expect(text).toContain('Common year');
    expect(text).toMatch(/Day of year: 69/);
    expect(text).toMatch(/ISO week \d+/);
  });

  it('empty arguments default to the now snapshot', async () => {
    const noArgs = await execDatetime({}, fixed);
    const parsed = await execDatetime({ action: 'now' }, fixed);
    expect(noArgs).toBe(parsed);
    const bypassed = await datetimeTool.exec({}, {});
    expect(typeof bypassed).not.toBe('Error');
  });

  it('format supports named styles and token templates in a given zone', async () => {
    const iso = await execDatetime({ action: 'format', style: 'iso' }, fixed);
    expect(iso).toContain('2026-03-10T12:34:56');
    const tokens = await execDatetime({ action: 'format', date: fixed, style: '%Y/%m/%d %H:%M %Z (%A)', timezone: 'Asia/Tokyo' }, fixed);
    expect(tokens).toMatch(/2026\/03\/10 21:34 GMT\+09:00 \(/);
    const tokyo = await execDatetime({ action: 'format', date: 0, style: '%Y / %Z', timezone: 'Asia/Tokyo' }, fixed);
    expect(tokyo).toContain('GMT+09:00');
  });

  it('convert maps a UTC instant into the target zone', async () => {
    const text = await execDatetime({ action: 'convert', target: 'Asia/Tokyo' }, fixed);
    expect(text).toContain('In Asia/Tokyo:');
    expect(text).toContain('21:34:56');
    expect(text).toContain('GMT+09:00');
  });

  it('shift is calendar-aware and clamps month-end days', async () => {
    const shifted = shiftDate(new Date('2024-01-31T00:00:00Z'), { months: 1 });
    expect(shifted.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    const text = await execDatetime(
      { action: 'shift', date: '2026-01-31T00:00:00Z', months: 1, days: 1, timezone: 'UTC' },
      fixed
    );
    expect(text).toContain('Result:');
    expect(text).toMatch(/2026-03/);
  });

  it('diff reports units, calendar days and business days', async () => {
    const text = await execDatetime(
      { action: 'diff', date: '2026-03-09T12:00:00Z', to: '2026-03-13T12:00:00Z' },
      fixed
    );
    expect(text).toContain('calendar days | 4 business days');
    expect(text).toMatch(/Difference: \d+ days?/);
  });

  it('info exposes weekday, week, quarter, weekend and month length', async () => {
    const text = await execDatetime({ action: 'info', date: '2024-02-29T10:00:00Z', timezone: 'UTC' }, fixed);
    expect(text).toContain('Leap year');
    expect(text).toContain('Month length: 29 days (February)');
    expect(text).toMatch(/Quarter: Q1/);
    expect(text).toMatch(/Weekend: (yes|no)/);
  });

  it('relative renders human wording in both directions', async () => {
    await expect(execDatetime({ action: 'relative', date: 0, to: '2026-01-01T00:03:00Z' }, fixed)).resolves.toBe('in 56 years');
    await expect(execDatetime({ action: 'relative', date: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' }, fixed)).resolves.toBe('in 1 day');
  });

  it('countdown breaks down into d/h/m/s', async () => {
    const text = await execDatetime(
      { action: 'countdown', date: '2026-01-01T00:00:00Z', to: '2026-01-02T05:30:45Z' },
      fixed
    );
    expect(text).toBe('1d 5h 30m 45s until 2026-01-02T05:30:45.000Z');
  });

  it('countdown without a target fails with guidance', async () => {
    await expect(execDatetime({ action: 'countdown' }, fixed)).rejects.toThrow(/needs a target/);
  });

  it('week returns ISO week number', async () => {
    const text = await execDatetime({ action: 'week', date: '2026-01-01T00:00:00Z' }, fixed);
    expect(text).toContain('W01');
  });

  it('business-days handles weekends and negative ranges', async () => {
    expect(businessDaysBetween(new Date('2026-03-09T00:00:00Z'), new Date('2026-03-13T00:00:00Z'))).toBe(4);
    expect(businessDaysBetween(new Date('2026-03-13T00:00:00Z'), new Date('2026-03-09T00:00:00Z'))).toBe(-4);
    expect(businessDaysBetween(new Date('2026-03-09T00:00:00Z'), new Date('2026-03-09T00:00:00Z'))).toBe(0);
  });

  it('rejects unknown timezones and unparseable dates', async () => {
    await expect(execDatetime({ action: 'format', timezone: 'Not/AZone' }, fixed)).rejects.toThrow(/Unknown timezone/);
    await expect(execDatetime({ action: 'format', date: 'garbage' }, fixed)).rejects.toThrow(/Unparseable date/);
  });

  it('schema shape drives settings parameter rows', () => {
    const shape = (datetimeTool.schema as unknown as { shape: Record<string, { description?: string }> }).shape;
    expect(shape.action.description).toContain('Which datetime operation');
    expect(shape.target.description).toContain('IANA timezone');
    expect(datetimeTool.summarize({ action: 'now' })).toBe('Datetime: now');
  });
});

describe('datetime helpers (pure)', () => {
  it('leap years follow Gregorian rules', () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
  });

  it('month lengths handle leap February', () => {
    expect(monthLength(2024, 2)).toBe(29);
    expect(monthLength(2025, 2)).toBe(28);
    expect(monthLength(2026, 12)).toBe(31);
  });

  it('ISO week numbers match known boundaries', () => {
    expect(isoWeekNumber(new Date('2026-01-01T00:00:00Z'))).toBe(1);
    expect(isoWeekNumber(new Date('2024-12-30T00:00:00Z'))).toBe(1);
    expect(isoWeekNumber(new Date('2023-01-01T00:00:00Z'))).toBe(52);
  });

  it('shiftDate composes all field groups', () => {
    expect(shiftDate(new Date('2026-01-01T00:00:00Z'), { days: 1, hours: 2 }).toISOString()).toBe('2026-01-02T02:00:00.000Z');
    expect(shiftDate(new Date('2026-01-01T00:00:00Z'), { weeks: 2, minutes: 90 }).toISOString()).toBe('2026-01-15T01:30:00.000Z');
  });

  it('relative thresholds pick the largest unit', () => {
    const base = new Date('2026-01-10T00:00:00Z');
    expect(relativeString(new Date('2026-01-09T23:00:00Z'), base)).toBe('in 1 hour');
    expect(relativeString(base, new Date('2025-01-08T00:00:00Z'))).toBe('1 year ago');
    expect(relativeString(new Date('2027-01-10T00:00:00Z'), base)).toBe('12 months ago');
  });

  it('diffBreakdown picks the adjective-sized unit', () => {
    const { parts } = diffBreakdown(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-04T00:00:00Z'));
    expect(parts[0]).toEqual({ unit: 'day', value: 3 });
  });

  it('formatWithTokens renders every documented token', () => {
    const text = formatWithTokens(new Date('2026-03-10T12:34:56Z'), '%Y-%m-%d %H:%M:%S %a %A %b %B %p %Z %%', 'UTC');
    expect(text).toMatch(/2026-03-10 12:34:56/);
    expect(text).toMatch(/Tue Tuesday Mar March/);
    expect(text).toMatch(/\+00:00/);
    expect(text.endsWith('%')).toBe(true);
  });
});
