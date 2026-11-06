import { z } from 'zod';
import type { LLMProvider } from '@shared/types';
import { AiTask } from '@shared/types';
import type { MiniAppRunTotals } from './store';

export interface PackLlmModel {
  provider: LLMProvider;
  modelId: string;
  apiKey: string;
}

/** The gateway slice the pack LLM conveniences use (chat only, plumbing task). */
export interface PackLlmGateway {
  chat(request: {
    provider: LLMProvider;
    modelId: string;
    apiKey: string;
    task: typeof AiTask.PLUMBING;
    messages: { role: 'system' | 'user'; content: string }[];
  }): Promise<string>;
}

const DIGEST_SCHEMA = z.object({ summary: z.string().min(1).max(600) });
const GLOBS_SCHEMA = z.object({ globs: z.array(z.string().max(200)).max(64) });

const DIGEST_SYSTEM =
  'You summarize the results of a file review run for the user who ran it. ' +
  'Describe only what the run found — clusters, counts, notable categories. ' +
  'Never recommend deleting anything, never address a specific file with advice, never use imperative deletions ("delete X", "remove Y"). ' +
  'Answer as one short paragraph (max 3 sentences). Answer with JSON: {"summary": string}.';

function extractJsonBlock(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function totalsLine(totals: MiniAppRunTotals): string {
  return `scanned ${totals.scanned}: ${totals.keep} keep, ${totals.ask} need review, ${totals.candidate} candidates; ${totals.ruleDecided} decided by rules, ${totals.modelDecided} by the model, ${totals.cacheHits} cache hits`;
}

/**
 * The one-call-per-run digest (plan 51 S6.1): aggregates + bounded
 * sample paths, never content. Descriptive prose only — the system
 * prompt forbids recommendations and per-file advice, and the output is
 * zod-validated with a fail-soft null.
 */
export async function summarizeRunDigest(
  gateway: PackLlmGateway,
  model: PackLlmModel,
  input: { totals: MiniAppRunTotals; samples: string[] }
): Promise<string | null> {
  const raw = await gateway.chat({
    provider: model.provider,
    modelId: model.modelId,
    apiKey: model.apiKey,
    task: AiTask.PLUMBING,
    messages: [
      { role: 'system', content: DIGEST_SYSTEM },
      {
        role: 'user',
        content: `${totalsLine(input.totals)}\nSample paths (up to 50):\n${input.samples.join('\n')}`,
      },
    ],
  });
  const parsed = DIGEST_SCHEMA.safeParse(extractJsonBlock(raw));
  return parsed.success ? parsed.data.summary : null;
}

/** Toggle checks (plan 51 guardrails): a disabled feature makes zero calls. `runDigest` defaults on; the drafting/learning toggles default off. */
export function digestEnabled(configValues: Record<string, unknown> | undefined): boolean {
  return configValues?.runDigest !== false;
}

export function ruleDraftingEnabled(configValues: Record<string, unknown> | undefined): boolean {
  return configValues?.ruleDrafting === true;
}

export function ruleLearningEnabled(configValues: Record<string, unknown> | undefined): boolean {
  return configValues?.learnRules === true;
}

const DRAFT_SYSTEM =
  'You translate the user\'s plain description of files into glob patterns for a deletion-review rule list. ' +
  'Use only the glob idiom: `*`, `?`, `**/`; a pattern without a slash matches file names only. ' +
  'Return at most 12 patterns. Never include prose. Answer with JSON: {"globs": string[]}';

export async function draftRulesFromIntent(
  gateway: PackLlmGateway,
  model: PackLlmModel,
  intent: string
): Promise<string[] | null> {
  const raw = await gateway.chat({
    provider: model.provider,
    modelId: model.modelId,
    apiKey: model.apiKey,
    task: AiTask.PLUMBING,
    messages: [
      { role: 'system', content: DRAFT_SYSTEM },
      { role: 'user', content: intent.slice(0, 500) },
    ],
  });
  const parsed = GLOBS_SCHEMA.safeParse(extractJsonBlock(raw));
  return parsed.success ? parsed.data.globs.filter((glob) => glob.trim().length > 0) : null;
}

export interface OverrideExample {
  relPath: string;
  verdict: 'keep' | 'ask' | 'candidate';
}

/**
 * Deterministic rule inference (plan 51 S6.3, pass one): common name
 * suffixes (`*.afdesign`) and shared directory prefixes among the
 * user's overrides — no model needed for the obvious cases. Null when
 * ambiguous (that is the model call's cue).
 */
export function inferRulePatterns(overrides: OverrideExample[]): string[] | null {
  if (overrides.length < 3) {
    return null;
  }
  const kept = overrides.filter((entry) => entry.verdict === 'keep');
  if (kept.length < 3) {
    return null;
  }
  const globs: string[] = [];
  const suffixCounts = new Map<string, number>();
  for (const entry of kept) {
    const name = entry.relPath.includes('/') ? entry.relPath.slice(entry.relPath.lastIndexOf('/') + 1) : entry.relPath;
    const dot = name.lastIndexOf('.');
    if (dot > 0) {
      const ext = name.slice(dot + 1).toLowerCase();
      if (/^[a-z0-9]{1,8}$/.test(ext)) {
        suffixCounts.set(ext, (suffixCounts.get(ext) ?? 0) + 1);
      }
    }
  }
  for (const [ext, count] of suffixCounts) {
    if (count >= Math.max(3, Math.ceil(kept.length * 0.6))) {
      globs.push(`*.${ext}`);
    }
  }
  if (globs.length > 0) {
    return globs;
  }
  const dirCounts = new Map<string, number>();
  for (const entry of kept) {
    if (entry.relPath.includes('/')) {
      const dir = entry.relPath.slice(0, entry.relPath.lastIndexOf('/'));
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    }
  }
  for (const [dir, count] of dirCounts) {
    if (count >= Math.max(3, Math.ceil(kept.length * 0.6))) {
      globs.push(`${dir}/**`);
    }
  }
  return globs.length > 0 ? globs : null;
}

const LEARN_SYSTEM =
  'You infer glob patterns that explain the user\'s file decisions. ' +
  'The user kept the listed files after a deletion review; propose the glob patterns (the same idiom: `*`, `?`, `**/`) that capture what they consistently keep. ' +
  'Return at most 8 patterns. Answer with JSON: {"globs": string[]}';

export async function learnRulesFromOverrides(
  gateway: PackLlmGateway,
  model: PackLlmModel | null,
  overrides: OverrideExample[]
): Promise<{ globs: string[]; source: 'pattern' | 'model' } | null> {
  const deterministic = inferRulePatterns(overrides);
  if (deterministic !== null) {
    return { globs: deterministic, source: 'pattern' };
  }
  if (!model || overrides.length < 3) {
    return null;
  }
  const raw = await gateway.chat({
    provider: model.provider,
    modelId: model.modelId,
    apiKey: model.apiKey,
    task: AiTask.PLUMBING,
    messages: [
      { role: 'system', content: LEARN_SYSTEM },
      {
        role: 'user',
        content: overrides
          .slice(0, 100)
          .map((entry) => `- ${entry.verdict}: ${entry.relPath}`)
          .join('\n'),
      },
    ],
  });
  const parsed = GLOBS_SCHEMA.safeParse(extractJsonBlock(raw));
  return parsed.success ? { globs: parsed.data.globs, source: 'model' } : null;
}
