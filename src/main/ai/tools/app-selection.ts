import { createMiddleware } from 'langchain';
import { ToolMessage } from '@langchain/core/messages';
import type { AppExposure, ToolAppToolState } from '@shared/apps';

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
}

export interface SelectionApp {
  id: string;
  name: string;
  description?: string;
  exposure: AppExposure;
  /** Position in `config.toolApps` — the tie-break drop key. */
  order: number;
  tools: SelectionTool[];
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
 * split on non-alphanumerics. Matching itself is whole-token equality —
 * `light` never hits `flight`.
 */
export function normalizeTokens(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
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
export function createAppSelectionMiddleware(deps: {
  keptToolNames: string[];
  droppedToolNames: string[];
  hint: string | null;
}) {
  const kept = new Set(deps.keptToolNames);
  const dropped = new Set(deps.droppedToolNames);
  return createMiddleware({
    name: 'AppSelectionMiddleware',
    wrapModelCall: (request, handler) => {
      const filtered = request.tools.filter((tool) => kept.has((tool as { name: string }).name));
      const withHint = deps.hint
        ? request.systemMessage.concat(`\n\n${deps.hint}`)
        : request.systemMessage;
      return handler({ ...request, tools: filtered, systemMessage: withHint });
    },
    wrapToolCall: (request, handler) => {
      if (dropped.has(request.toolCall.name)) {
        return new ToolMessage({
          content: `Error (${request.toolCall.name}): this tool's app was not selected for this turn. Mention the app by name in your next message to use it.`,
          tool_call_id: request.toolCall.id ?? '',
        });
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
