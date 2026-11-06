import { z } from 'zod';

export const miniAppItemEvidenceSchema = z.record(z.string(), z.unknown());

export function parseMiniAppItemEvidence(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = miniAppItemEvidenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function validateMiniAppItemEvidence(value: unknown): Record<string, unknown> {
  const parsed = miniAppItemEvidenceSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Invalid mini-app item evidence');
  }
  return parsed.data;
}
