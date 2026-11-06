import { z } from 'zod';

export const sandboxStateValueSchema = z.unknown();

export function parseSandboxStateValue(value: unknown): unknown {
  return value;
}

export function validateSandboxStateValue(value: unknown): unknown {
  return sandboxStateValueSchema.parse(value);
}
