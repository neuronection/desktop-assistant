import { z } from 'zod';
import type { ConversationMetadata } from '../types';

export const conversationMetadataSchema: z.ZodType<ConversationMetadata> = z
  .object({
    modelId: z.string().optional(),
    systemPrompt: z.string().optional(),
    decisionTag: z.string().optional(),
    speakReplies: z.boolean().optional(),
  })
  .passthrough();

export function parseConversationMetadata(value: unknown): ConversationMetadata | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = conversationMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function validateConversationMetadata(value: unknown): ConversationMetadata {
  const parsed = conversationMetadataSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid conversation metadata${issue ? ` at ${issue.path.join('.')}: ${issue.message}` : ''}`);
  }
  return parsed.data;
}
