import { z } from 'zod';

export interface ProposalItem {
  relPath: string;
  fingerprint: string;
  verdict: string;
  confidence: number | null;
  category: string | null;
  evidence: Record<string, unknown> | null;
}

export interface ProposalPayload {
  v: number;
  items: ProposalItem[];
  minConfidence: number;
  sensitiveGlobs: string[];
}

export interface ProposalOutcomeItem {
  relPath: string;
  outcome: 'moved' | 'changed' | 'failed' | 'skipped' | 'ask';
  detail?: string;
}

const proposalItemSchema: z.ZodType<ProposalItem> = z
  .object({
    relPath: z.string(),
    fingerprint: z.string(),
    verdict: z.string(),
    confidence: z.number().nullable(),
    category: z.string().nullable(),
    evidence: z.record(z.string(), z.unknown()).nullable(),
  })
  .passthrough();

export const miniAppProposalPayloadSchema: z.ZodType<ProposalPayload> = z
  .object({
    v: z.number().int().default(1),
    items: z.array(proposalItemSchema),
    minConfidence: z.number(),
    sensitiveGlobs: z.array(z.string()),
  })
  .passthrough();

export const miniAppProposalOutcomeSchema: z.ZodType<ProposalOutcomeItem[]> = z.array(
  z
    .object({
      relPath: z.string(),
      outcome: z.enum(['moved', 'changed', 'failed', 'skipped', 'ask']),
      detail: z.string().optional(),
    })
    .passthrough()
);

export function parseMiniAppProposalPayload(value: unknown): ProposalPayload | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = miniAppProposalPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function validateMiniAppProposalPayload(value: unknown): ProposalPayload {
  const parsed = miniAppProposalPayloadSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid mini-app proposal payload${issue ? ` at ${issue.path.join('.')}: ${issue.message}` : ''}`);
  }
  return parsed.data;
}

export function parseMiniAppProposalOutcome(value: unknown): ProposalOutcomeItem[] | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = miniAppProposalOutcomeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function validateMiniAppProposalOutcome(value: unknown): ProposalOutcomeItem[] {
  const parsed = miniAppProposalOutcomeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Invalid mini-app proposal outcome');
  }
  return parsed.data;
}
