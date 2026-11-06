import { z } from 'zod';

export const automationTriggerSchema = z.record(z.string(), z.unknown());

export function parseAutomationTrigger(value: unknown): Record<string, unknown> {
  const parsed = automationTriggerSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function validateAutomationTrigger(value: unknown): Record<string, unknown> {
  const parsed = automationTriggerSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Invalid automation trigger');
  }
  return parsed.data;
}
