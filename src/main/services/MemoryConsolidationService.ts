import { z } from 'zod';
import type { MainConfigService } from '@main/services/ConfigService';
import type { MemorySettings } from '@shared/config/AppConfig';
import type { LLMProvider } from '@shared/types';
import { AiTask, LLMProviderType } from '@shared/types';
import { resolveInternalModel } from '@shared/ai/tasks';
import { MEMORY_CONTENT_MAX, MEMORY_DEDUPE_SIMILARITY, trigramSimilarity, normalizeMemoryContent, type MemorySource } from '@main/services/MemoryService';
import { SecretService, providerSecretKey } from '@main/services/SecretService';

/** Gray-zone floor: similarity at or above this, but below the dedupe
 *  threshold, is where the model arbitrates (plan 16 D1). */
export const MERGE_ZONE_MIN = 0.6;
/** On-demand pass: max pairs examined per run (plan 16 D8). */
export const CONSOLIDATE_BATCH_MAX = 20;
/** On-demand pass cooldown (plan 16 D8). */
export const CONSOLIDATE_COOLDOWN_MS = 60_000;

const VERDICT_SCHEMA = z.object({
  verdict: z.enum(['keep_new', 'keep_old', 'merge']),
  mergedContent: z.string().min(1).max(MEMORY_CONTENT_MAX).optional(),
}).refine((value) => value.verdict !== 'merge' || Boolean(value.mergedContent?.trim()), {
  message: 'merge verdicts need mergedContent',
});

export type MemoryVerdict = z.infer<typeof VERDICT_SCHEMA>;

export interface ConsolidationCandidate {
  id: string;
  content: string;
  source: MemorySource;
}

export interface ConsolidationOutcome {
  action: 'keep_new' | 'keep_old' | 'merge';
  mergedContent?: string;
}

export interface MemoryConsolidationDeps {
  configService: MainConfigService;
  gateway: AiGatewayLite;
  /** Injectable clock for the pass cooldown (tests). */
  now?(): number;
}

/** The slice of the gateway the consolidator uses (chat only). */
export interface AiGatewayLite {
  chat(request: {
    provider: LLMProvider;
    modelId: string;
    apiKey: string;
    task: AiTask.PLUMBING;
    messages: { role: 'system' | 'user'; content: string }[];
  }): Promise<string>;
}

function isSmartMergeEnabled(configService: MainConfigService): boolean {
  return configService.getConfig().memory?.smartMerge === true;
}

function extractJsonBlock(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const VERDICT_PROMPT = [
  'You maintain a small long-term memory store. Two stored memories look near-duplicate.',
  'Decide how to handle the NEW memory:',
  '- "merge": return {"verdict":"merge","mergedContent":"<one self-contained sentence carrying the durable facts of both>"}',
  '- "keep_old": return {"verdict":"keep_old"} when the existing memory already covers everything new',
  '- "keep_new": return {"verdict":"keep_new"} when the two are genuinely different facts',
  'Never invent facts. Reply with the JSON object only.',
].join('\n');

/**
 * Model arbitration for near-duplicate memories (plan 16 S2): a single
 * `plumbing`-task gateway call, zod-validated, deterministic-fallback
 * on any failure (D1/D2). Merging is opt-in via `memory.smartMerge`
 * (D3) and never deletes user-sourced memories (D4).
 */
export class MemoryConsolidationService {
  private lastPassAt = 0;

  constructor(private readonly deps: MemoryConsolidationDeps) {}

  private async settings(): Promise<MemorySettings | undefined> {
    return this.deps.configService.getConfig().memory;
  }

  private async resolveModel(): Promise<{
    provider: LLMProvider;
    providerId: string;
    modelId: string;
    apiKey: string;
  } | null> {
    const config = this.deps.configService.getConfig();
    const resolution = resolveInternalModel(config);
    if (!resolution) {
      return null;
    }
    const apiKey =
      (await SecretService.getInstance().getSecret(providerSecretKey(resolution.providerId))) ??
      resolution.provider.apiKey ??
      '';
    if (!apiKey && resolution.provider.type !== LLMProviderType.OLLAMA) {
      return null;
    }
    return {
      provider: resolution.provider,
      providerId: resolution.providerId,
      modelId: resolution.modelId,
      apiKey: apiKey || 'local-server',
    };
  }

  /** Gray-zone membership for a candidate vs the new content (D1). */
  isInMergeZone(existingContent: string, newContent: string): boolean {
    const similarity = trigramSimilarity(normalizeMemoryContent(existingContent), normalizeMemoryContent(newContent));
    return similarity >= MERGE_ZONE_MIN && similarity < MEMORY_DEDUPE_SIMILARITY;
  }

  /**
   * The save-time hook: null = follow the deterministic path (keep_new),
   * otherwise apply the returned action against the candidate row.
   */
  async arbitrateSave(
    newContent: string,
    candidate: ConsolidationCandidate
  ): Promise<ConsolidationOutcome | null> {
    if (!(await this.settings())?.smartMerge) {
      return null;
    }
    const model = await this.resolveModel();
    if (!model) {
      return null;
    }
    const raw = await this.deps.gateway.chat({
      provider: model.provider,
      modelId: model.modelId,
      apiKey: model.apiKey,
      task: AiTask.PLUMBING,
      messages: [
        { role: 'system', content: VERDICT_PROMPT },
        {
          role: 'user',
          content: `Existing memory: ${candidate.content}\nNew memory: ${newContent}\nExisting memory source: ${candidate.source}`,
        },
      ],
    });
    const parsed = VERDICT_SCHEMA.safeParse(extractJsonBlock(raw));
    if (!parsed.success) {
      return null;
    }
    const verdict = parsed.data;
    if (verdict.verdict === 'merge') {
      return { action: 'merge', mergedContent: verdict.mergedContent?.trim() };
    }
    return { action: verdict.verdict };
  }

  /**
   * On-demand pass over gray-zone pairs (D8: ≤ 20 pairs, cooldown).
   * Merge verdicts replace the older row's content and record the other
   * side as provenance. Returns the counters for the status line.
   */
  async consolidatePass(
    allMemories: ConsolidationCandidate[],
    applyMerge: (targetId: string, mergedContent: string, absorbed: ConsolidationCandidate) => Promise<void>
  ): Promise<{ checked: number; merged: number; kept: number; skipped: boolean }> {
    const now = this.deps.now?.() ?? Date.now();
    if (now - this.lastPassAt < CONSOLIDATE_COOLDOWN_MS) {
      return { checked: 0, merged: 0, kept: 0, skipped: true };
    }
    this.lastPassAt = now;
    if (!(await this.settings())?.smartMerge) {
      return { checked: 0, merged: 0, kept: 0, skipped: true };
    }
    let checked = 0;
    let merged = 0;
    let kept = 0;
    const consumed = new Set<string>();
    for (let i = 0; i < allMemories.length && checked < CONSOLIDATE_BATCH_MAX; i += 1) {
      const older = allMemories[i];
      if (consumed.has(older.id)) {
        continue;
      }
      for (let j = i + 1; j < allMemories.length && checked < CONSOLIDATE_BATCH_MAX; j += 1) {
        const newer = allMemories[j];
        if (consumed.has(newer.id)) {
          continue;
        }
        if (!this.isInMergeZone(older.content, newer.content)) {
          continue;
        }
        checked += 1;
        const outcome = await this.arbitrateSave(newer.content, older);
        if (outcome?.action === 'merge' && outcome.mergedContent) {
          consumed.add(newer.id);
          consumed.add(older.id);
          await applyMerge(older.id, outcome.mergedContent, newer);
          merged += 1;
          break;
        }
        kept += 1;
      }
    }
    return { checked, merged, kept, skipped: false };
  }
}
