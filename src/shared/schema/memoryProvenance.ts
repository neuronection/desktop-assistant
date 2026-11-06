import { z } from 'zod';
import type { MemoryMergedFrom } from '../memory';

export const memoryProvenanceItemSchema: z.ZodType<MemoryMergedFrom> = z
  .object({
    id: z.string(),
    content: z.string(),
    source: z.enum(['user', 'assistant']),
    mergedAt: z.string(),
  })
  .passthrough();

export const memoryProvenanceSchema: z.ZodType<MemoryMergedFrom[]> = z.array(memoryProvenanceItemSchema);

export function parseMemoryProvenance(value: unknown): MemoryMergedFrom[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const parsed = memoryProvenanceSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function validateMemoryProvenance(value: unknown): MemoryMergedFrom[] {
  const parsed = memoryProvenanceSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Invalid memory provenance');
  }
  return parsed.data;
}
