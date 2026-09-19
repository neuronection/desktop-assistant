import { z } from 'zod';
import type { DecisionToolSchema } from '@shared/ai/decisions';
import type { ToolParameterInfo } from '@shared/turns';
import type { NativeToolDefinition } from '../tools/types';

export interface DecisionMcpToolSnapshot {
  name: string;
  description: string;
  parameterList?: ToolParameterInfo[];
  keywordTags?: string[];
  priority?: boolean;
}

export type DecisionSurfaceTool = DecisionToolSchema & {
  keywordTags?: string[];
  /** App/integration tools: always candidate-worthy for the engine. */
  priority?: boolean;
};

export interface DecisionToolSurfaceInput {
  native: NativeToolDefinition[];
  mcp?: DecisionMcpToolSnapshot[];
}

export const DECISION_TOOL_CAP = 120;
export const DECISION_CANDIDATE_CAP = 8;
const DECISION_DESCRIPTION_CAP = 240;

/**
 * Native tools the fast path must never see: a four-word utterance
 * should not be able to one-tap the power family, a shell, or a
 * process/file kill even with policy approval downstream (policy still
 * gates every execution — this keeps them out of the engine's choice
 * set entirely).
 */
const DECISION_NATIVE_DENYLIST = new Set([
  'run_shell',
  'power_lock',
  'power_sleep',
  'power_restart',
  'power_shutdown',
  'kill_process',
  'file_delete',
  'clipboard_write',
]);

/**
 * Curated dispatch vocabulary for native tools (the D17 pattern: names
 * + authored tags, never prose descriptions). Untagged natives stay out
 * of the engine's choice set entirely.
 */
const DECISION_NATIVE_TAGS: Record<string, string[]> = {
  screen_capture: ['screenshot', 'capture', 'screen'],
  screenshot_recall: ['recall', 'screenshot'],
  datetime: ['time', 'date', 'clock'],
  clipboard_read: ['clipboard'],
  list_apps: ['apps', 'installed'],
  open_url: ['open', 'website', 'url', 'link'],
  open_app: ['open', 'launch', 'app'],
  open_path: ['open', 'file', 'folder'],
  notify: ['notify', 'notification', 'remind'],
  volume_set: ['volume', 'mute'],
  brightness_set: ['brightness', 'display'],
  media_controls: ['music', 'play', 'pause', 'media'],
  web_search: ['search', 'web', 'google'],
  web_fetch: ['fetch', 'website', 'page'],
  download_file: ['download'],
  find_files: ['find', 'file'],
  grep_files: ['grep', 'search', 'inside'],
  docs_search: ['docs', 'documentation'],
  memory_save: ['remember', 'memory'],
  memory_search: ['memory', 'recall'],
  memory_list: ['memory', 'list'],
  memory_forget: ['forget', 'memory'],
  list_dir: ['list', 'folder', 'directory'],
  system_info: ['system', 'computer', 'info'],
  window_list: ['window', 'windows'],
  active_window: ['window', 'active'],
  translate: ['translate', 'translation'],
};

function normalizeTokens(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => (token.length >= 4 && token.endsWith('s') ? token.slice(0, -1) : token));
}

interface CandidateVocabulary {
  name: Set<string>;
  tags: Set<string>;
  multiWord: string[][];
}

function vocabularyOf(tool: DecisionToolSchema & { keywordTags?: string[] }): CandidateVocabulary {
  const name = new Set(normalizeTokens(tool.name));
  const tags = new Set<string>();
  const multiWord: string[][] = [];
  for (const tag of tool.keywordTags ?? []) {
    const tokens = normalizeTokens(tag);
    if (tokens.length > 1) {
      multiWord.push(tokens);
    } else if (tokens.length === 1) {
      tags.add(tokens[0]);
    }
  }
  return { name, tags, multiWord };
}

/**
 * Lexical preselection (the D17 pattern applied to decisions): the
 * engine only sees tools whose name or keyword tags share tokens with
 * the query, ranked by match strength, capped small. Needle 3 is
 * excellent on a focused catalog (spike) and unreliable on a 40-tool
 * one (measured) — and an empty candidate set skips the engine call
 * entirely, so off-topic inputs pay nothing.
 */
export function selectDecisionCandidates(
  surface: DecisionSurfaceTool[],
  query: string,
  limit = DECISION_CANDIDATE_CAP
): DecisionSurfaceTool[] {
  const queryTokens = normalizeTokens(query);
  if (queryTokens.length === 0) {
    return [];
  }
  const scored: { tool: DecisionSurfaceTool; score: number }[] = [];
  for (const tool of surface) {
    const vocab = vocabularyOf(tool);
    let score = 0;
    for (const token of queryTokens) {
      if (vocab.name.has(token)) {
        score += 2;
      } else if (vocab.tags.has(token)) {
        score += 1;
      }
    }
    for (const set of vocab.multiWord) {
      if (set.every((token) => queryTokens.includes(token))) {
        score += 3;
      }
    }
    if (score > 0 || tool.priority) {
      scored.push({ tool, score });
    }
  }
  return scored
    .sort((a, b) => {
      // Lexical matches rank first; app tools that scored 0 (their
      // authored names/tags missed the query) still fill the remaining
      // slots ahead of nothing — the engine gets the final say.
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.tool.priority !== b.tool.priority) {
        return a.tool.priority ? -1 : 1;
      }
      return a.tool.name.localeCompare(b.tool.name);
    })
    .slice(0, limit)
    .map((entry) => entry.tool);
}

function capDescription(text: string | undefined): string {
  const clean = (text ?? '').trim();
  if (!clean) {
    return '';
  }
  return clean.length > DECISION_DESCRIPTION_CAP ? `${clean.slice(0, DECISION_DESCRIPTION_CAP - 1)}…` : clean;
}

function nativeParameters(def: NativeToolDefinition): Record<string, unknown> | undefined {
  try {
    return z.toJSONSchema(def.schema) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** MCP tools carry a flat parameter list — shape a minimal JSON schema from it. */
export function mcpParameterSchema(list: ToolParameterInfo[] | undefined): Record<string, unknown> | undefined {
  if (!list || list.length === 0) {
    return undefined;
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const param of list) {
    properties[param.name] = {
      type: param.type,
      ...(param.description ? { description: param.description } : {}),
      ...(param.enumValues?.length ? { enum: param.enumValues } : {}),
    };
    if (param.required) {
      required.push(param.name);
    }
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
}

/**
 * Projects the executable tool surface (native + app MCP) into the
 * engine-neutral schema (plan 20 S3). Native zod schemas convert via
 * `z.toJSONSchema` (fail-soft: a tool with an unconvertible schema keeps
 * its name/description and loses parameters); the list is capped so a
 * 100-tool registry cannot blow the engine prompt.
 */
export function decisionToolSurface(input: DecisionToolSurfaceInput): DecisionSurfaceTool[] {
  const surface: DecisionSurfaceTool[] = [];
  for (const def of input.native) {
    if (DECISION_NATIVE_DENYLIST.has(def.name)) {
      continue;
    }
    const tags = DECISION_NATIVE_TAGS[def.name];
    if (!tags) {
      continue;
    }
    if (surface.length >= DECISION_TOOL_CAP) {
      return surface;
    }
    const description = capDescription(def.description);
    const parameters = nativeParameters(def);
    surface.push({ name: def.name, description, keywordTags: tags, ...(parameters ? { parameters } : {}) });
  }
  for (const tool of input.mcp ?? []) {
    if (surface.length >= DECISION_TOOL_CAP) {
      break;
    }
    const description = capDescription(tool.description);
    const parameters = mcpParameterSchema(tool.parameterList);
    surface.push({
      name: tool.name,
      description,
      ...(tool.priority ? { priority: true } : {}),
      ...(tool.keywordTags?.length ? { keywordTags: tool.keywordTags } : {}),
      ...(parameters ? { parameters } : {}),
    });
  }
  return surface;
}
