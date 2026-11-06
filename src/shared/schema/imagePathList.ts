import { z } from 'zod';

export const imagePathListSchema = z.array(z.string());

export function parseImagePathList(value: unknown): string[] {
  const parsed = imagePathListSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function validateImagePathList(value: unknown): string[] {
  const parsed = imagePathListSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Invalid image path list');
  }
  return parsed.data;
}
