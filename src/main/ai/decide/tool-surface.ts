import { z } from 'zod';
import type { DecisionRouteTool, DecisionScope, DecisionToolSchema } from '@shared/ai/decisions';
import { DECISION_ROUTE_TOOL_NAME_PATTERN } from '@shared/ai/decisions';
import type { ToolParameterInfo } from '@shared/turns';
import type { NativeToolDefinition } from '../tools/types';

export interface DecisionMcpToolSnapshot {
  name: string;
  description: string;
  /** Owning tool-app id — scope filtering (plan 20 S7 D8) keys on this. */
  appId?: string;
  parameterList?: ToolParameterInfo[];
  keywordTags?: string[];
  priority?: boolean;
}

export type DecisionSurfaceTool = DecisionToolSchema & {
  keywordTags?: string[];
  /** App/integration tools: always candidate-worthy for the engine. */
  priority?: boolean;
  /** Owning tool-app id (plan 24 S4b). */
  appId?: string;
  /** Known catalog ids (entity/area/name) grounding a Choice projection. */
  catalogArgNames?: string[];
};

/** Catalog ids an app exposes to the decision engine (empty when none cached). */
export function decisionCatalogEntities(tool: DecisionSurfaceTool): readonly string[] | undefined {
  return tool.catalogArgNames;
}

/** True when an argument names a catalog entity the engine must ground. */
export function isCatalogArgName(arg: string): boolean {
  return CATALOG_ARG_PATTERN.test(arg);
}

export interface DecisionToolSurfaceInput {
  native: NativeToolDefinition[];
  mcp?: DecisionMcpToolSnapshot[];
  /** When present, scope filters the surface (D8): natives gate + app allowlist. */
  scope?: DecisionScope;
  /** Custom route tools appended as priority entries (D9); validated here (D10). */
  routeTools?: DecisionRouteTool[];
  /** Configured model ids — a route tool whose modelId misses is skipped (D10). */
  knownModelIds?: ReadonlySet<string>;
  /** Catalog ids per app (plan 24 S4b): entity args become a grounded Choice. */
  catalogEntities?: ReadonlyMap<string, readonly string[]>;
}

/** Argument names that name a catalog entity (vs a free-text/number open arg). */
const CATALOG_ARG_PATTERN = /^(area|entity|entity_id|device|room|name)$/i;

function catalogEntitiesFor(tool: DecisionSurfaceTool, input: DecisionToolSurfaceInput): readonly string[] | undefined {
  if (!tool.appId) {
    return undefined;
  }
  return input.catalogEntities?.get(tool.appId);
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
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0)
    .map((token) =>
      token.length >= 4 && (token.endsWith('s') || token.endsWith('ς')) ? token.slice(0, -1) : token
    );
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
 * 100-tool registry cannot blow the engine prompt. S7 (D8/D10): when a
 * scope is present it filters the surface — natives only when
 * `includeNatives`, app tools only for scoped app ids — and validated
 * route tools are appended as priority entries.
 */
export function decisionToolSurface(input: DecisionToolSurfaceInput): DecisionSurfaceTool[] {
  const scope = input.scope;
  const surface: DecisionSurfaceTool[] = [];
  if (!scope || scope.includeNatives) {
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
  }
  for (const tool of input.mcp ?? []) {
    if (scope && (!tool.appId || !scope.apps.includes(tool.appId))) {
      continue;
    }
    if (surface.length >= DECISION_TOOL_CAP) {
      break;
    }
    const description = capDescription(tool.description);
    const parameters = mcpParameterSchema(tool.parameterList);
    const catalogEntities = catalogEntitiesFor({ name: tool.name, description, appId: tool.appId }, input);
    surface.push({
      name: tool.name,
      description,
      ...(tool.appId ? { appId: tool.appId } : {}),
      ...(tool.priority ? { priority: true } : {}),
      ...(tool.keywordTags?.length ? { keywordTags: tool.keywordTags } : {}),
      ...(parameters ? { parameters } : {}),
      ...(catalogEntities?.length ? { catalogArgNames: [...catalogEntities] } : {}),
    });
  }
  for (const route of projectRouteTools(input.routeTools, surface, input.knownModelIds)) {
    if (surface.length >= DECISION_TOOL_CAP) {
      break;
    }
    surface.push(route);
  }
  return surface;
}

const ROUTE_TOOL_TAG_CAP = 12;

/**
 * Route tools become engine-visible entries (D9): no parameters — a
 * pick is a hand-off, never an execution — priority candidate status,
 * and keyword tags mined from the example lines so lexical
 * preselection can match them. Invalid entries (bad/duplicate name,
 * missing model resolution, name colliding with a real tool) are
 * skipped (D10) — never half-projected.
 */
function projectRouteTools(
  routeTools: DecisionRouteTool[] | undefined,
  surface: DecisionSurfaceTool[],
  knownModelIds?: ReadonlySet<string>
): DecisionSurfaceTool[] {
  if (!routeTools || routeTools.length === 0) {
    return [];
  }
  const taken = new Set(surface.map((tool) => tool.name));
  const projected: DecisionSurfaceTool[] = [];
  for (const route of routeTools) {
    if (!DECISION_ROUTE_TOOL_NAME_PATTERN.test(route.name) || taken.has(route.name)) {
      continue;
    }
    if (projected.some((tool) => tool.name === route.name)) {
      continue;
    }
    if (knownModelIds && !knownModelIds.has(route.modelId)) {
      console.warn(`[decision] route tool '${route.name}' skipped — model '${route.modelId}' is not configured`);
      continue;
    }
    const tags = new Set<string>();
    for (const example of route.examples ?? []) {
      for (const token of normalizeTokens(example)) {
        tags.add(token);
        if (tags.size >= ROUTE_TOOL_TAG_CAP) {
          break;
        }
      }
      if (tags.size >= ROUTE_TOOL_TAG_CAP) {
        break;
      }
    }
    taken.add(route.name);
    projected.push({
      name: route.name,
      description: capDescription(route.description),
      priority: true,
      ...(tags.size > 0 ? { keywordTags: [...tags] } : {}),
    });
  }
  return projected;
}
