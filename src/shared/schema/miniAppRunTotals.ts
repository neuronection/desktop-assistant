import { z } from 'zod';

export interface MiniAppRunTotals {
  scanned: number;
  keep: number;
  ask: number;
  candidate: number;
  ruleDecided: number;
  modelDecided: number;
  cacheHits: number;
  pending: number;
  scanTruncated?: boolean;
}

export const miniAppRunTotalsSchema: z.ZodType<MiniAppRunTotals> = z
  .object({
    scanned: z.number(),
    keep: z.number(),
    ask: z.number(),
    candidate: z.number(),
    ruleDecided: z.number(),
    modelDecided: z.number(),
    cacheHits: z.number(),
    pending: z.number(),
    scanTruncated: z.boolean().optional(),
  })
  .passthrough();

export function parseMiniAppRunTotals(value: unknown): MiniAppRunTotals | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = miniAppRunTotalsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function validateMiniAppRunTotals(value: unknown): MiniAppRunTotals {
  const parsed = miniAppRunTotalsSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid mini-app run totals${issue ? ` at ${issue.path.join('.')}: ${issue.message}` : ''}`);
  }
  return parsed.data;
}
