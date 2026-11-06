import { z } from 'zod';
import type { ScheduleSpec } from '../schedules';

export const scheduleSpecSchema: z.ZodType<ScheduleSpec> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interval'), minutes: z.number().int().min(1).max(525_600) }).passthrough(),
  z.object({ kind: z.literal('daily'), time: z.string() }).passthrough(),
  z.object({ kind: z.literal('weekly'), days: z.array(z.number().int().min(0).max(6)).min(1), time: z.string() }).passthrough(),
  z.object({ kind: z.literal('cron'), expr: z.string() }).passthrough(),
]);

export function parseScheduleSpec(value: unknown): ScheduleSpec | null {
  const parsed = scheduleSpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function validateScheduleSpec(value: unknown): ScheduleSpec {
  const parsed = scheduleSpecSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid schedule spec${issue ? ` at ${issue.path.join('.')}: ${issue.message}` : ''}`);
  }
  return parsed.data;
}
