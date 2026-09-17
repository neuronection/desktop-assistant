import { createMiddleware } from 'langchain';
import { ToolMessage } from '@langchain/core/messages';
import type { AppExposure, EntityScopeRule, ToolAppToolState } from '@shared/apps';

/** Full post-curation toolset budget (plan 15 §2 — plan 14's ~25 guidance generalized). */
export const APP_TOOL_BUDGET = 25;
/** D15: a matched app stays bound for this many subsequent turns (thread-scoped). */
export const APP_STICKY_TURNS = 2;
/** D16: availability-hint hard cap (chars) — enforced at build time. */
export const APP_HINT_CAP = 400;
const APP_HINT_MARKER = '[Apps available — mention one by name to use it this conversation]';
const APP_HINT_ENTRY_CAP = 160;

export interface SelectionTool {
  /** Tool name as it appears in the agent toolset (namespaced for MCP). */
  name: string;
  description: string;
  enabled: boolean;
  keywordTags: string[];
  /** Authored (preset) entity handling — drives D18 scope enforcement. */
  entityRole?: 'action' | 'discovery';
  entityArg?: string;
}

export interface SelectionApp {
  id: string;
  name: string;
  description?: string;
  exposure: AppExposure;
  /** Position in `config.toolApps` — the tie-break drop key. */
  order: number;
  tools: SelectionTool[];
  /** Preset-authored guidance — injected while bound (§4), main-owned. */
  promptNotes?: string;
}

export type BindReason = 'always' | 'match' | 'sticky' | 'deferred' | 'no-match' | 'budget-drop';

export interface SelectionDecision {
  appId: string;
  appName: string;
  reason: BindReason;
  toolNames: string[];
}

export interface StickyWindow {
  entries: Map<string, number>;
}

export interface SelectionResult {
  decisions: SelectionDecision[];
  /** Every tool that survives selection — non-app tools always included. */
  keptToolNames: string[];
  hintAppIds: string[];
  /** Budget floor reached: only `always` apps remain and the set is still over budget. */
  overBudget: boolean;
  /** Tools bound behind provider-side search (flat context — outside the budget). */
  deferredToolCount: number;
}

/**
 * D17 matcher normalization: NFKD, combining marks stripped, case-folded,
 * split on non-alphanumerics, then a naive plural stem (trailing `s`
 * dropped from tokens of 4+ chars) so `lights` matches a `light` tool.
 * Both query and vocabulary normalize identically, so equality is
 * preserved; matching itself is whole-token equality — `light` never
 * hits `flight`.
 */
export function normalizeTokens(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => (token.length >= 4 && token.endsWith('s') ? token.slice(0, -1) : token));
}

interface AppVocabulary {
  singles: Set<string>;
  multiWordSets: string[][];
}

function vocabularyOf(app: SelectionApp): AppVocabulary {
  const singles = new Set<string>();
  const multiWordSets: string[][] = [];
  for (const token of normalizeTokens(app.name)) {
    singles.add(token);
  }
  for (const tool of app.tools) {
    for (const token of normalizeTokens(tool.name)) {
      singles.add(token);
    }
    for (const tag of tool.keywordTags) {
      const tokens = normalizeTokens(tag);
      if (tokens.length === 0) {
        continue;
      }
      if (tokens.length === 1) {
        singles.add(tokens[0]);
      } else {
        multiWordSets.push(tokens);
      }
    }
  }
  return { singles, multiWordSets };
}

export function appMatchesQuery(query: string, app: SelectionApp, vocabulary?: AppVocabulary): boolean {
  const queryTokens = normalizeTokens(query);
  if (queryTokens.length === 0) {
    return false;
  }
  const vocab = vocabulary ?? vocabularyOf(app);
  if (queryTokens.some((token) => vocab.singles.has(token))) {
    return true;
  }
  return vocab.multiWordSets.some((set) => set.every((token) => queryTokens.includes(token)));
}

/** D15: decay every window by one turn; expired entries drop (new turns only — never on resume). */
export function advanceStickyWindow(sticky: StickyWindow): StickyWindow {
  const entries = new Map<string, number>();
  for (const [appId, remaining] of sticky.entries) {
    if (remaining - 1 > 0) {
      entries.set(appId, remaining - 1);
    }
  }
  return { entries };
}

export function bindSticky(sticky: StickyWindow, appIds: string[]): StickyWindow {
  const entries = new Map(sticky.entries);
  for (const appId of appIds) {
    entries.set(appId, APP_STICKY_TURNS);
  }
  return { entries };
}

function classRank(reason: BindReason): number {
  if (reason === 'always') {
    return Number.MAX_SAFE_INTEGER;
  }
  return reason === 'sticky' ? 1 : 0;
}

export function selectApps(input: {
  apps: SelectionApp[];
  query: string;
  totalToolCount: number;
  nonAppToolCount: number;
  sticky: StickyWindow;
  budget?: number;
  /** S3: provider tool search supported — `deferred` apps bind behind server-side search. */
  deferredCapable?: boolean;
}): SelectionResult {
  const budget = input.budget ?? APP_TOOL_BUDGET;
  const decisions: SelectionDecision[] = [];
  const hintAppIds: string[] = [];
  const kept = new Set<string>();
  let boundCount = 0;
  let deferredCount = 0;

  for (const app of input.apps) {
    const enabledTools = app.tools.filter((tool) => tool.enabled);
    if (enabledTools.length === 0) {
      continue;
    }
    const toolNames = enabledTools.map((tool) => tool.name);
    let reason: BindReason;
    if (app.exposure === 'deferred' && input.deferredCapable) {
      reason = 'deferred';
    } else if (app.exposure === 'always') {
      reason = 'always';
    } else if (appMatchesQuery(input.query, app)) {
      reason = 'match';
    } else if ((input.sticky.entries.get(app.id) ?? 0) > 0) {
      reason = 'sticky';
    } else {
      reason = 'no-match';
      hintAppIds.push(app.id);
    }
    decisions.push({ appId: app.id, appName: app.name, reason, toolNames });
    if (reason === 'deferred') {
      deferredCount += toolNames.length;
    } else if (reason !== 'no-match') {
      boundCount += toolNames.length;
    }
  }

  let overBudget = false;
  if (input.nonAppToolCount + boundCount > budget) {
    const droppable = decisions
      .filter((decision) => decision.reason === 'match' || decision.reason === 'sticky')
      .sort((a, b) => {
        const byClass = classRank(a.reason) - classRank(b.reason);
        if (byClass !== 0) {
          return byClass;
        }
        const orderOf = (decision: SelectionDecision): number =>
          input.apps.find((app) => app.id === decision.appId)?.order ?? Number.MAX_SAFE_INTEGER;
        return orderOf(a) - orderOf(b);
      });
    let count = input.nonAppToolCount + boundCount;
    for (const decision of droppable) {
      if (count <= budget) {
        break;
      }
      decision.reason = 'budget-drop';
      count -= decision.toolNames.length;
    }
    overBudget = count > budget;
  }

  for (const decision of decisions) {
    if (decision.reason !== 'no-match' && decision.reason !== 'budget-drop') {
      for (const name of decision.toolNames) {
        kept.add(name);
      }
    }
  }

  return {
    decisions,
    keptToolNames: [...kept],
    hintAppIds,
    overBudget,
    deferredToolCount: deferredCount,
  };
}

/** Glob-ish scope match: every non-`*` char is literal; `*` is a wildcard. */
export function scopePatternMatches(pattern: string, entityId: string): boolean {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`).test(entityId);
}

/** D18: ordered allow/deny rules, last match wins; no rules (or no match) = allowed. */
export function entityAllowedByScope(entityId: string, rules: EntityScopeRule[]): boolean {
  let verdict = true;
  for (const rule of rules) {
    if (scopePatternMatches(rule.pattern, entityId)) {
      verdict = rule.effect === 'allow';
    }
  }
  return verdict;
}

const ENTITY_ID_PATTERN = /^[\w-]+\.[\w.-]+$/;

function isEntityId(value: string): boolean {
  return ENTITY_ID_PATTERN.test(value);
}

function filterEntityArray(parsed: unknown, allow: (entityId: string) => boolean): unknown {
  if (Array.isArray(parsed)) {
    return parsed.filter((entry) => {
      if (typeof entry === 'string') {
        return !isEntityId(entry) || allow(entry);
      }
      if (typeof entry === 'object' && entry !== null && typeof (entry as { entity_id?: unknown }).entity_id === 'string') {
        return allow((entry as { entity_id: string }).entity_id);
      }
      return true;
    });
  }
  return parsed;
}

/** Collects entity-id-shaped strings from a (JSON) tool result. */
export function extractEntityIds(text: string): string[] {
  const out: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 4) {
      return;
    }
    if (typeof value === 'string') {
      if (isEntityId(value)) {
        out.push(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry, depth + 1);
      }
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const entry of Object.values(value)) {
        visit(entry, depth + 1);
      }
    }
  };
  try {
    visit(JSON.parse(text), 0);
  } catch {
    return out;
  }
  return [...new Set(out)];
}

/**
 * D18 discovery-side filtering: best-effort parse of a tool result as JSON
 * and removal of out-of-scope entities from entity-bearing arrays. Shapes
 * the bridge cannot parse pass through unchanged (action-side rejection
 * still protects every state change); denied entities are absent, not
 * redacted.
 */
export function filterEntityListText(text: string, allow: (entityId: string) => boolean): string {
  try {
    const parsed = JSON.parse(text);
    const filtered = filterEntityArray(parsed, allow);
    if (Array.isArray(parsed) && filtered !== parsed) {
      return JSON.stringify(filtered);
    }
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      let changed = false;
      const next: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          const filteredValue = filterEntityArray(value, allow);
          if (filteredValue !== value) {
            changed = true;
          }
          next[key] = filteredValue;
        } else {
          next[key] = value;
        }
      }
      if (changed) {
        return JSON.stringify(next);
      }
    }
    return text;
  } catch {
    return text;
  }
}

/**
 * D16: a minimal, config-sourced hint for enabled-but-unbound apps so the
 * model can offer them by name (the name is an implicit matcher tag — the
 * offer itself teaches the phrase that re-binds next turn). Fenced as
 * reference data; never server- or model-provided text.
 */
export function buildAvailabilityHint(dropped: { appName: string; description?: string }[]): string | null {
  if (dropped.length === 0) {
    return null;
  }
  const lines = [APP_HINT_MARKER];
  let total = APP_HINT_MARKER.length;
  for (const entry of dropped) {
    const description = (entry.description ?? '').trim();
    const line = `- ${entry.appName}${description ? ` — ${description}` : ''}`;
    const capped = line.slice(0, APP_HINT_ENTRY_CAP);
    if (total + capped.length > APP_HINT_CAP) {
      break;
    }
    lines.push(capped);
    total += capped.length;
  }
  return lines.length > 1 ? lines.join('\n') : null;
}

/**
 * Per-turn toolset shaping (plan 15 §2): `wrapModelCall` filters
 * `request.tools` to the precomputed binding and appends the D16 hint;
 * `wrapToolCall` is defense in depth — a call targeting an app tool that
 * was filtered out for the turn is rejected with an honest error instead
 * of executing (and per D14 it can never fire for a tool bound at turn
 * start, which includes the tool the user just approved on resume).
 */
export interface ScopedToolSpec {
  toolName: string;
  entityArg?: string;
  entityRole?: 'action' | 'discovery';
  scopeRules: EntityScopeRule[];
}

/**
 * Per-turn toolset shaping (plan 15 §2 + D18): `wrapModelCall` filters
 * `request.tools` to the precomputed binding and appends the composed
 * guidance (D16 hint + bound apps' preset `promptNotes`, fenced);
 * `wrapToolCall` rejects calls to unbound app tools and enforces entity
 * scopes on bound ones — action tools validate the entity argument before
 * dispatch, discovery tools have entity-bearing results filtered before
 * the model ever sees them.
 */
export function createAppSelectionMiddleware(deps: {
  keptToolNames: string[];
  droppedToolNames: string[];
  guidance: string | null;
  scopedTools?: ScopedToolSpec[];
}) {
  const kept = new Set(deps.keptToolNames);
  const dropped = new Set(deps.droppedToolNames);
  const scoped = new Map(deps.scopedTools?.map((spec) => [spec.toolName, spec]) ?? []);
  return createMiddleware({
    name: 'AppSelectionMiddleware',
    wrapModelCall: (request, handler) => {
      const filtered = request.tools.filter((tool) => kept.has((tool as { name: string }).name));
      const withGuidance = deps.guidance
        ? request.systemMessage.concat(`\n\n${deps.guidance}`)
        : request.systemMessage;
      return handler({ ...request, tools: filtered, systemMessage: withGuidance });
    },
    wrapToolCall: async (request, handler) => {
      const toolName = request.toolCall.name;
      if (dropped.has(toolName)) {
        return new ToolMessage({
          content: `Error (${toolName}): this tool's app was not selected for this turn. Mention the app by name in your next message to use it.`,
          tool_call_id: request.toolCall.id ?? '',
        });
      }
      const scope = scoped.get(toolName);
      if (scope) {
        const allow = (entityId: string): boolean => entityAllowedByScope(entityId, scope.scopeRules);
        if (scope.entityArg) {
          const args = (request.toolCall.args ?? {}) as Record<string, unknown>;
          const entityId = args[scope.entityArg];
          if (typeof entityId === 'string' && entityId.length > 0 && !allow(entityId)) {
            return new ToolMessage({
              content: `Error (${toolName}): '${entityId}' is outside this app's allowed device scope.`,
              tool_call_id: request.toolCall.id ?? '',
            });
          }
        }
        const result = await handler(request);
        if (
          scope.entityRole === 'discovery' &&
          ToolMessage.isInstance(result) &&
          typeof (result as ToolMessage).content === 'string'
        ) {
          const content = (result as ToolMessage).content as string;
          return new ToolMessage({
            content: filterEntityListText(content, allow),
            tool_call_id: (result as ToolMessage).tool_call_id ?? request.toolCall.id ?? '',
          });
        }
        return result;
      }
      return handler(request);
    },
  });
}

export function ownedToolStateOf(spec: {
  toolState: Record<string, ToolAppToolState>;
}, rawToolName: string): ToolAppToolState | undefined {
  return spec.toolState[rawToolName];
}
