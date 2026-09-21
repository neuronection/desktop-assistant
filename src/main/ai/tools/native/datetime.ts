import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

export type DatePartsInput = {
  action?:
    | 'now'
    | 'format'
    | 'convert'
    | 'shift'
    | 'diff'
    | 'info'
    | 'relative'
    | 'countdown'
    | 'week'
    | 'business-days';
  date?: string | number | undefined;
  to?: string | number | undefined;
  target?: string | undefined;
  timezone?: string | undefined;
  style?: string | undefined;
  locale?: string | undefined;
  years?: number | undefined;
  months?: number | undefined;
  weeks?: number | undefined;
  days?: number | undefined;
  hours?: number | undefined;
  minutes?: number | undefined;
  seconds?: number | undefined;
};

type ResolvedDateInput = string | number | undefined;

export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function zoneLabel(zone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    throw new Error(`Unknown timezone '${zone}'.`);
  }
}

function zoneOffsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  }).formatToParts(at);
  const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const match = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(name);
  if (!match) return 0;
  if (!match[1]) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

export function partsInZone(at: Date, zone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const result: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) {
    if (part.type !== 'literal') result[part.type] = part.value;
  }
  if (result.hour === '24') result.hour = '00';
  return result;
}

export function isInZone(at: Date, zone: string): Date {
  const p = partsInZone(at, zone);
  const offset = zoneOffsetMinutes(zone, at);
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - offset * 60_000);
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function monthLength(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

export function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((current - start) / 86_400_000) + 1;
}

export function quarterOf(date: Date): number {
  return Math.floor(date.getUTCMonth() / 3) + 1;
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function resolveInput(value: ResolvedDateInput, fallback: Date): Date {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  const trimmed = String(value).trim();
  if (/^-?\d{10,13}$/.test(trimmed)) {
    const n = Number(trimmed);
    return new Date(trimmed.length >= 13 ? n : n * 1000);
  }
  if (/^now$/i.test(trimmed)) return fallback;
  if (/^today$/i.test(trimmed)) {
    const zone = localZone();
    const p = partsInZone(fallback, zone);
    return new Date(`${p.year}-${p.month}-${p.day}T00:00:00`);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Unparseable date '${trimmed}'. Use ISO 8601, epoch seconds/millis, or 'now'/'today'.`);
  }
  return parsed;
}

export function shiftDate(
  date: Date,
  fields: { years?: number; months?: number; weeks?: number; days?: number; hours?: number; minutes?: number; seconds?: number }
): Date {
  const base = isInZone(date, 'UTC');
  const years = fields.years ?? 0;
  const months = fields.months ?? 0;
  let result = base;
  if (years !== 0 || months !== 0) {
    const total = base.getUTCFullYear() * 12 + base.getUTCMonth() + years * 12 + months;
    const year = Math.floor(total / 12);
    const month = total - year * 12;
    const day = Math.min(base.getUTCDate(), monthLength(year, month + 1));
    result = new Date(
      Date.UTC(year, month, day, base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds(), base.getUTCMilliseconds())
    );
  }
  return new Date(
    result.getTime() +
      (fields.weeks ?? 0) * 7 * 86_400_000 +
      (fields.days ?? 0) * 86_400_000 +
      (fields.hours ?? 0) * 3_600_000 +
      (fields.minutes ?? 0) * 60_000 +
      (fields.seconds ?? 0) * 1000
  );
}

export function diffBreakdown(from: Date, to: Date): { ms: number; magnitude: number; parts: { unit: string; value: number }[] } {
  const ms = to.getTime() - from.getTime();
  const magnitude = Math.abs(ms);
  const units: [string, number][] = [
    ['year', 365.25 * 86_400_000],
    ['week', 7 * 86_400_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
    ['second', 1000],
  ];
  const found = units.find(([, size]) => magnitude >= size) ?? ['second', 1000];
  return {
    ms,
    magnitude,
    parts: [{ unit: found[0], value: Math.round(ms / found[1]) }],
  };
}

export function relativeString(from: Date, to: Date): string {
  const { ms } = diffBreakdown(from, to);
  const future = ms > 0;
  const magnitude = Math.abs(ms);
  const units: [string, number][] = [
    ['year', 365.25 * 86_400_000],
    ['month', 30.44 * 86_400_000],
    ['week', 7 * 86_400_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
    ['second', 1000],
  ];
  const found = units.find(([, size]) => magnitude >= size) ?? ['second', 1000];
  const value = Math.round(magnitude / found[1]);
  const plural = value === 1 ? '' : 's';
  const span = `${value} ${found[0]}${plural}`;
  return future ? `in ${span}` : `${span} ago`;
}

export function countdownString(from: Date, to: Date): string {
  const ms = Math.abs(to.getTime() - from.getTime());
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60_000) % 60;
  const hours = Math.floor(ms / 3_600_000) % 24;
  const days = Math.floor(ms / 86_400_000);
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

export function businessDaysBetween(from: Date, to: Date): number {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  const direction = end.getTime() >= start.getTime() ? 1 : -1;
  let count = 0;
  let cursor = start;
  while (cursor.getTime() !== end.getTime()) {
    cursor = new Date(cursor.getTime() + direction * 86_400_000);
    if (!isWeekend(cursor)) count += 1;
    if (count > 200_000) throw new Error('Range too large for business-day counting.');
  }
  if (isWeekend(start) && count > 0) {
    count -= 0;
  }
  return count * direction;
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatWithTokens(at: Date, template: string, zone: string): string {
  const p = partsInZone(at, zone);
  const offset = zoneOffsetMinutes(zone, at);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const offsetText = `${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
  return template
    .replace(/%Y/g, p.year)
    .replace(/%m/g, p.month)
    .replace(/%d/g, p.day)
    .replace(/%H/g, p.hour)
    .replace(/%M/g, p.minute)
    .replace(/%S/g, p.second)
    .replace(/%e/g, String(Number(p.day)))
    .replace(/%j/g, two(dayOfYear(new Date(`${p.year}-${p.month}-${p.day}T00:00:00`))))
    .replace(/%a/g, p.weekday.slice(0, 3))
    .replace(/%A/g, p.weekday)
    .replace(/%b/g, MONTHS[Number(p.month) - 1].slice(0, 3))
    .replace(/%B/g, MONTHS[Number(p.month) - 1])
    .replace(/%p/g, Number(p.hour) < 12 ? 'AM' : 'PM')
    .replace(/%Z/g, `GMT${offsetText}`)
    .replace(/%%/g, '%');
}

const formatSchema = z.object({
  action: z.enum([
    'now',
    'format',
    'convert',
    'shift',
    'diff',
    'info',
    'relative',
    'countdown',
    'week',
    'business-days',
  ]).default('now').describe("Which datetime operation to run; omit for a full 'now' snapshot."),
  date: z.string().optional().describe("Date to operate on: ISO 8601 string, epoch seconds/millis (digits as a string), 'now', or 'today'. Defaults to now where a date is needed."),
  to: z.string().optional().describe("Second date for diff/relative (defaults to now) — same formats as 'date'."),
  target: z.string().optional().describe("IANA timezone name for convert (e.g. 'Asia/Tokyo') or 'local'."),
  timezone: z.string().optional().describe("IANA timezone to interpret/display the date in ('local' for system zone). Defaults to local."),
  style: z.string().optional().describe("Output style for format: 'iso', 'rfc2822', 'unix', 'unix_ms', 'full', 'long', 'medium', 'short', or a token template like '%Y-%m-%d %H:%M'."),
  locale: z.string().optional().describe("BCP-47 locale for human-readable styles (e.g. 'de-DE'). Defaults to system locale."),
  years: z.number().optional().describe('Years to shift by (shift).'),
  months: z.number().optional().describe('Months to shift by (shift), calendar-aware with day clamping.'),
  weeks: z.number().optional().describe('Weeks to shift by (shift).'),
  days: z.number().optional().describe('Days to shift by (shift).'),
  hours: z.number().optional().describe('Hours to shift by (shift).'),
  minutes: z.number().optional().describe('Minutes to shift by (shift).'),
  seconds: z.number().optional().describe('Seconds to shift by (shift).'),
});

export async function execDatetime(args: DatePartsInput, nowInput: Date = new Date()): Promise<string> {
  const action = args.action ?? 'now';
  const zone = !args.timezone || args.timezone === 'local' ? localZone() : zoneLabel(args.timezone);
  const now = nowInput;
  const at = resolveInput(args.date, action === 'now' ? now : now);
  const inZone = isInZone(at, zone);
  const epochSec = Math.floor(at.getTime() / 1000);

  const stamp = (extra: string = ''): string => {
    const p = partsInZone(at, zone);
    const offset = zoneOffsetMinutes(zone, at);
    const sign = offset < 0 ? '-' : '+';
    const abs = Math.abs(offset);
    return `Date: ${p.year}-${p.month}-${p.day} (${p.weekday}) · Time: ${p.hour}:${p.minute}:${p.second} · Zone: ${zone} GMT${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}${extra}`;
  };

  switch (action) {
    case 'now': {
      const iso = isInZone(at, 'UTC').toISOString();
      const p = partsInZone(at, zone);
      const year = Number(p.year);
      const week = isoWeekNumber(isInZone(at, 'UTC'));
      const q = quarterOf(isInZone(at, 'UTC'));
      const doy = dayOfYear(isInZone(at, 'UTC'));
      return [
        stamp(),
        `Epoch: ${epochSec} (ms: ${at.getTime()})`,
        `ISO 8601: ${iso} | RFC 2822: ${formatWithTokens(at, '%a, %e %b %Y %H:%M:%S %Z', zone)}`,
        `Week: ISO week ${week} | Day of year: ${doy}/(${isLeapYear(year) ? 366 : 365}) | Quarter: Q${q} | ${isLeapYear(year) ? 'Leap year' : 'Common year'}`,
      ].join('\n');
    }
    case 'format': {
      const style = args.style;
      const locale = args.locale ?? undefined;
      if (!style || style === 'iso') {
        return stamp(`\nISO 8601: ${isInZone(at, 'UTC').toISOString()}`);
      }
      if (style === 'rfc2822') return formatWithTokens(at, '%a, %e %b %Y %H:%M:%S %Z', zone);
      if (style === 'unix') return String(epochSec);
      if (style === 'unix_ms') return String(at.getTime());
      if (['full', 'long', 'medium', 'short'].includes(style)) {
        const preset = style as 'full' | 'long' | 'medium' | 'short';
        return new Intl.DateTimeFormat(locale, { dateStyle: preset, timeStyle: preset, timeZone: zone }).format(at);
      }
      return formatWithTokens(at, style, zone);
    }
    case 'convert': {
      const target = !args.target || args.target === 'local' ? localZone() : zoneLabel(args.target);
      const pTarget = partsInZone(at, target);
      const stampLine = stamp();
      const pt = partsInZone(at, zone);
      const same = pt.year === pTarget.year && pt.month === pTarget.month && pt.day === pTarget.day;
      return [
        stampLine,
        `In ${target}: ${pTarget.weekday}, ${pTarget.year}-${pTarget.month}-${pTarget.day} ${pTarget.hour}:${pTarget.minute}:${pTarget.second} GMT${zoneOffsetMinutes(target, at) < 0 ? '-' : '+'}${two(Math.floor(Math.abs(zoneOffsetMinutes(target, at)) / 60))}:${two(Math.abs(zoneOffsetMinutes(target, at)) % 60)}`,
        `Same calendar day: ${same ? 'yes' : 'no'}`,
      ].join('\n');
    }
    case 'shift': {
      const shifted = shiftDate(isInZone(at, 'UTC'), args);
      const p = partsInZone(shifted, zone);
      const fields = (['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'] as const)
        .filter((key) => args[key])
        .map((key) => `${args[key]} ${key}`)
        .join(', ');
      return [
        stamp(),
        `Shifted by ${fields || 'nothing'}`,
        `Result: ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} (${p.weekday}) · ${zone}`,
      ].join('\n');
    }
    case 'diff': {
      const to = resolveInput(args.to, now);
      const { ms, parts } = diffBreakdown(inZone, isInZone(to, 'UTC'));
      const direction = ms === 0 ? 'same instant' : ms > 0 ? `'${String(args.date)}' is before the second date` : `'${String(args.date)}' is after the second date`;
      const business = businessDaysBetween(inZone, isInZone(to, 'UTC'));
      return [
        stamp(),
        `Difference: ${parts[0].value} ${parts[0].unit}${parts[0].value === 1 ? '' : 's'} (${direction})`,
        `Total: ${Math.abs(Math.round(ms / 1000))} seconds | ${Math.abs(Math.round(ms / 86_400_000))} calendar days | ${business} business days`,
      ].join('\n');
    }
    case 'info': {
      const p = partsInZone(at, zone);
      const year = Number(p.year);
      const month = Number(p.month);
      const week = isoWeekNumber(isInZone(at, 'UTC'));
      return [
        stamp(),
        `ISO week: ${week} | Day of year: ${dayOfYear(isInZone(at, 'UTC'))} | Quarter: Q${quarterOf(isInZone(at, 'UTC'))}`,
        `Weekend: ${isWeekend(isInZone(at, 'UTC')) ? 'yes' : 'no'} · ${isLeapYear(year) ? 'Leap year' : 'Common year'}`,
        `Month length: ${monthLength(year, month)} days (${MONTHS[month - 1]})`,
      ].join('\n');
    }
    case 'relative': {
      const to = resolveInput(args.to, now);
      return `${relativeString(inZone, isInZone(to, 'UTC'))}`;
    }
    case 'countdown': {
      if (args.to === undefined && args.date === undefined) {
        throw new Error("countdown needs a target date via 'to' (or 'date').");
      }
      const targetDate = resolveInput(args.to, now);
      return `${countdownString(inZone, isInZone(targetDate, 'UTC'))} until ${isInZone(targetDate, 'UTC').toISOString()}`;
    }
    case 'week': {
      const week = isoWeekNumber(isInZone(at, 'UTC'));
      const padded = String(week).padStart(2, '0');
      return stamp(` · ISO week: ${week}`).replace('Date:', 'Date:') + `\nWeek value: ${week} (W${padded})`;
    }
    case 'business-days': {
      const to = resolveInput(args.to, now);
      const business = businessDaysBetween(inZone, isInZone(to, 'UTC'));
      return stamp(`\nBusiness days between the two dates: ${business}`);
    }
  }
}

export const datetimeTool: NativeToolDefinition<DatePartsInput> = {
  name: 'datetime',
  description:
    "Work with dates, times, and timezones. With NO arguments (or action 'now') returns a full snapshot of the current date/time: local zone, epoch, ISO 8601/RFC 2822, ISO week, quarter, leap-year. Actions: 'now' (date/time snapshot with epoch, ISO week, quarter, leap-year), 'format' (ISO/RFC 2822/unix/full/long/medium/short or token template like '%Y-%m-%d %H:%M' using %Y %m %d %e %H %M %S %a %A %b %B %p %Z %%), 'convert' (timezone conversion to 'target', DST-aware), 'shift' (calendar-aware add/subtract via years/months/weeks/days/hours/minutes/seconds, month-end clamped), 'diff' (difference between 'date' and 'to' with calendar and business days), 'info' (calendar facts: weekday, ISO week, day of year, quarter, weekend, leap year, month length), 'relative' (human wording like 'in 3 days' / '2 hours ago'), 'countdown' (d/h/m/s breakdown to 'to'), 'week' (ISO week number), 'business-days' (weekdays-only count between 'date' and 'to'). Always use this tool instead of guessing the current date/time.",
  schema: formatSchema,
  risk: 'read-only',
  category: 'system',
  timeoutMs: 5_000,
  summarize: (args) => `Datetime: ${args.action}${args.date !== undefined ? ` (${String(args.date)})` : ''}`,
  async exec(args) {
    return execDatetime(args);
  },
};
