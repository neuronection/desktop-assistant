import { z } from 'zod';
import type { MiniAppRunExecutionView, MiniAppRunModelRef } from '@shared/app-pack';

export const miniAppRunModelRefSchema: z.ZodType<MiniAppRunModelRef> = z.object({
  providerId: z.string(),
  providerName: z.string(),
  model: z.string(),
});

export const miniAppRunExecutionSchema: z.ZodType<MiniAppRunExecutionView> = z
  .object({
    decision: miniAppRunModelRefSchema.optional(),
    llm: miniAppRunModelRefSchema.optional(),
  })
  .passthrough();

export function parseMiniAppRunExecution(value: unknown): MiniAppRunExecutionView | null {
  if (value === null || value === undefined) {
    return null;
  }
  let candidate: unknown = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = miniAppRunExecutionSchema.safeParse(candidate);
  if (!parsed.success) {
    return null;
  }
  const { decision, llm } = parsed.data;
  return decision || llm ? { ...(decision ? { decision } : {}), ...(llm ? { llm } : {}) } : null;
}
