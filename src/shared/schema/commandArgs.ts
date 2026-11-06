import { z } from 'zod';

export interface CommandArgs {
  argv: string[];
}

export const commandArgsSchema: z.ZodType<CommandArgs> = z
  .object({ argv: z.array(z.string()) })
  .passthrough();

export function parseCommandArgs(value: unknown): CommandArgs | undefined {
  if (typeof value === 'string') {
    try {
      return parseCommandArgs(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  const parsed = commandArgsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function validateCommandArgs(value: unknown): CommandArgs {
  const parsed = commandArgsSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Invalid command args envelope');
  }
  return parsed.data;
}
