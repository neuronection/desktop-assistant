/**
 * Schedule spec + next-run math (plan 12 §4). Pure functions: the
 * scheduler feeds an injectable clock; DST boundaries are handled by
 * converting wall-clock targets through the IANA zone's real offsets
 * (never "server local time"). Missing wall times (spring-forward gap)
 * fire at the shifted instant; ambiguous times (fall-back overlap) fire
 * on the first occurrence.
 */
export type ScheduleSpec =
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; days: number[]; time: string }
  | { kind: 'cron'; expr: string };

export interface ZonedWallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday (wall clock in the zone). */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = wallFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    wallFormatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function zonedWallTime(utcMs: number, timeZone: string): ZonedWallTime {
  const parts = wallFormatter(timeZone).formatToParts(new Date(utcMs));
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const hour = Number(read('hour'));
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: hour === 24 ? 0 : hour,
    minute: Number(read('minute')),
    weekday: WEEKDAYS[read('weekday')] ?? 0,
  };
}

/** Offset (ms) of `timeZone` at the given instant — truncates sub-minute noise. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const minute = Math.floor(utcMs / 60_000) * 60_000;
  const wall = zonedWallTime(minute, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return asUtc - minute;
}

function wallCompare(
  a: Omit<ZonedWallTime, 'weekday'>,
  b: Omit<ZonedWallTime, 'weekday'>
): number {
  const key = (w: Omit<ZonedWallTime, 'weekday'>): number =>
    ((w.year * 100 + w.month) * 100 + w.day) * 10000 + w.hour * 100 + w.minute;
  return key(a) - key(b);
}

/**
 * Converts a wall-clock moment in `timeZone` to a UTC instant.
 * Ambiguous times (fall-back overlap) resolve to the FIRST occurrence;
 * nonexistent times (spring-forward gap) resolve to the first instant
 * whose wall clock has reached the target — i.e. the shifted firing.
 */
export function wallToUtc(wall: Omit<ZonedWallTime, 'weekday'>, timeZone: string): number {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const firstOffset = tzOffsetMs(naive, timeZone);
  let utc = naive - firstOffset;
  const secondOffset = tzOffsetMs(utc, timeZone);
  if (secondOffset !== firstOffset) {
    utc = naive - secondOffset;
  }
  let cmp = wallCompare(zonedWallTime(utc, timeZone), wall);
  if (cmp === 0) {
    return utc;
  }
  for (let guard = 0; guard < 300 && cmp !== 0; guard += 1) {
    if (cmp < 0) {
      utc += 60_000;
      cmp = wallCompare(zonedWallTime(utc, timeZone), wall);
      if (cmp > 0) {
        return utc;
      }
    } else {
      const previous = utc - 60_000;
      if (wallCompare(zonedWallTime(previous, timeZone), wall) <= 0) {
        return utc;
      }
      utc = previous;
    }
  }
  return utc;
}

function parseHhMm(time: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) {
    return null;
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function isValidScheduleSpec(value: unknown): value is ScheduleSpec {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const spec = value as Partial<ScheduleSpec>;
  switch (spec.kind) {
    case 'interval':
      return typeof spec.minutes === 'number' && Number.isInteger(spec.minutes) && spec.minutes >= 1 && spec.minutes <= 525_600;
    case 'daily':
      return typeof spec.time === 'string' && parseHhMm(spec.time) !== null;
    case 'weekly':
      return (
        Array.isArray(spec.days) &&
        spec.days.length > 0 &&
        spec.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
        new Set(spec.days).size === spec.days.length &&
        typeof spec.time === 'string' &&
        parseHhMm(spec.time) !== null
      );
    case 'cron':
      return typeof spec.expr === 'string' && parseCronExpression(spec.expr) !== null;
    default:
      return false;
  }
}

/** Next UTC instant strictly after `fromMs`, or null for an invalid spec. */
export function computeNextRun(spec: ScheduleSpec, timeZone: string, fromMs: number): number | null {
  if (!isValidTimezone(timeZone)) {
    return null;
  }
  switch (spec.kind) {
    case 'interval':
      return fromMs + spec.minutes * 60_000;
    case 'daily':
    case 'weekly': {
      const time = parseHhMm(spec.time);
      if (!time) {
        return null;
      }
      const days = spec.kind === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : [...spec.days].sort((a, b) => a - b);
      const wall = zonedWallTime(fromMs, timeZone);
      for (let step = 0; step < 8; step += 1) {
        const noon = Date.UTC(wall.year, wall.month - 1, wall.day + step, 12);
        const probe = new Date(noon);
        const weekday = zonedWallTime(noon, timeZone).weekday;
        if (!days.includes(weekday)) {
          continue;
        }
        const utc = wallToUtc(
          {
            year: probe.getUTCFullYear(),
            month: probe.getUTCMonth() + 1,
            day: probe.getUTCDate(),
            hour: time.hour,
            minute: time.minute,
          },
          timeZone
        );
        if (utc > fromMs) {
          return utc;
        }
      }
      return null;
    }
    case 'cron':
      return nextCronRun(spec.expr, timeZone, fromMs);
  }
}

export interface ScheduleView {
  id: string;
  name: string;
  prompt: string;
  spec: ScheduleSpec;
  specLabel: string;
  timezone: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastOutcome: string | null;
  nextRunAt: string | null;
  conversationId: string | null;
}

export interface ScheduleInput {
  name: string;
  prompt: string;
  spec: ScheduleSpec;
  timezone: string;
  enabled?: boolean;
}

interface PrismaScheduleRow {
  id: string;
  name: string;
  prompt: string;
  spec: unknown;
  timezone: string;
  enabled: boolean;
  lastRunAt: Date | null;
  lastOutcome: string | null;
  conversationId: string | null;
  createdAt: Date;
}

export function scheduleRowToView(row: PrismaScheduleRow, nowMs: number): ScheduleView {
  const spec = row.spec as ScheduleSpec;
  const anchor = row.lastRunAt?.getTime() ?? nowMs;
  const next = row.enabled && isValidScheduleSpec(spec) ? computeNextRun(spec, row.timezone, anchor) : null;
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    spec,
    specLabel: isValidScheduleSpec(spec) ? describeScheduleSpec(spec) : 'invalid schedule',
    timezone: row.timezone,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastOutcome: row.lastOutcome,
    nextRunAt: next !== null ? new Date(next).toISOString() : null,
    conversationId: row.conversationId,
  };
}

/** Describes a spec in the UI language ("Daily at 09:00"). */
export function describeScheduleSpec(spec: ScheduleSpec): string {
  switch (spec.kind) {
    case 'interval':
      return spec.minutes % 1440 === 0
        ? `every ${spec.minutes / 1440} day(s)`
        : spec.minutes % 60 === 0
          ? `every ${spec.minutes / 60} h`
          : `every ${spec.minutes} min`;
    case 'daily':
      return `daily at ${spec.time}`;
    case 'weekly': {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const days = [...spec.days].sort((a, b) => a - b).map((day) => names[day]);
      const label = days.length === 5 && [1, 2, 3, 4, 5].every((day) => spec.days.includes(day)) ? 'weekdays' : days.join(', ');
      return `${label} at ${spec.time}`;
    }
    case 'cron':
      return `cron: ${spec.expr}`;
  }
}

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  domStar: boolean;
  dowStar: boolean;
}

function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const [rangePart, , stepPart] = part.split('/');
    const step = stepPart !== undefined ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) {
      return null;
    }
    let start = min;
    let end = max;
    if (rangePart !== '*' && rangePart !== '') {
      const bounds = rangePart.split('-');
      if (bounds.length === 2) {
        start = Number(bounds[0]);
        end = Number(bounds[1]);
      } else {
        start = Number(rangePart);
        end = stepPart !== undefined ? max : start;
      }
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
        return null;
      }
    } else if (rangePart === '' ) {
      return null;
    }
    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }
  return values.size > 0 ? values : null;
}

export function parseCronExpression(expr: string): CronFields | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }
  const minute = parseCronField(fields[0], 0, 59);
  const hour = parseCronField(fields[1], 0, 23);
  const dayOfMonth = parseCronField(fields[2], 1, 31);
  const month = parseCronField(fields[3], 1, 12);
  const dayOfWeekRaw = parseCronField(fields[4], 0, 7);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeekRaw) {
    return null;
  }
  const dayOfWeek = new Set<number>([...dayOfWeekRaw].map((value) => value % 7));
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    domStar: fields[2] === '*',
    dowStar: fields[4] === '*',
  };
}

function nextCronRun(expr: string, timeZone: string, fromMs: number): number | null {
  const fields = parseCronExpression(expr);
  if (!fields) {
    return null;
  }
  const startWall = zonedWallTime(fromMs, timeZone);
  for (let dayStep = 0; dayStep < 366 * 4; dayStep += 1) {
    const noon = Date.UTC(startWall.year, startWall.month - 1, startWall.day + dayStep, 12);
    const probe = new Date(noon);
    const year = probe.getUTCFullYear();
    const month = probe.getUTCMonth() + 1;
    const day = probe.getUTCDate();
    if (!fields.month.has(month)) {
      continue;
    }
    const weekday = zonedWallTime(noon, timeZone).weekday;
    const domOk = fields.dayOfMonth.has(day);
    const dowOk = fields.dayOfWeek.has(weekday);
    const dayOk =
      fields.domStar && fields.dowStar ? true : fields.domStar ? dowOk : fields.dowStar ? domOk : domOk || dowOk;
    if (!dayOk) {
      continue;
    }
    let best: number | null = null;
    for (const hour of fields.hour) {
      for (const minute of fields.minute) {
        const utc = wallToUtc({ year, month, day, hour, minute }, timeZone);
        if (utc > fromMs && (best === null || utc < best)) {
          best = utc;
        }
      }
    }
    if (best !== null) {
      return best;
    }
  }
  return null;
}
