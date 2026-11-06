import { z } from 'zod';

export const automationActionSchema = z.record(z.string(), z.unknown());

export function parseAutomationAction(value: unknown): Record<string, unknown> {
  const parsed = automationActionSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function validateAutomationAction(value: unknown): Record<string, unknown> {
  const parsed = automationActionSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Invalid automation action');
  }
  return parsed.data;
}
