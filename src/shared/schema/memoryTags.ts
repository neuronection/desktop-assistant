import { z } from 'zod';

export const memoryTagsSchema = z.array(z.string());

export function parseMemoryTags(value: unknown): string[] {
  const parsed = memoryTagsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function validateMemoryTags(value: unknown): string[] {
  const parsed = memoryTagsSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Invalid memory tags');
  }
  return parsed.data;
}
