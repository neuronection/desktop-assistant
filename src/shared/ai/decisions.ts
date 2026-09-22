/**
 * Decision engines (plan 20): intent routing + tool dispatch as a
 * sibling capability to chat — never a replacement. Shared surface so
 * both processes speak the same shapes; invocation lives in
 * `src/main/ai/decide/`.
 */

import { TEXT } from '@shared/constants/text';

export type DecisionEngineKind = 'llm' | 'needle' | 'jev';

/**
 * Runtime engines plus the `off` setting state. `off` is a resolution
 * state, not an engine (plan 24 D2): the engine enum never carries it.
 */
export type DecisionEngineSetting = 'off' | DecisionEngineKind;

export const DECISION_ENGINE_KINDS: readonly DecisionEngineKind[] = ['llm', 'needle', 'jev'];
export const DECISION_ENGINE_SETTINGS: readonly DecisionEngineSetting[] = ['off', 'llm', 'needle', 'jev'];

/** Engine display names (plan 24 S2) — the single shared source, main and renderer. */
export const DECISION_ENGINE_NAMES: Record<DecisionEngineKind, string> = {
  llm: TEXT.DECISION_ENGINE_NAME_LLM,
  needle: TEXT.DECISION_ENGINE_NAME_NEEDLE,
  jev: TEXT.DECISION_ENGINE_NAME_JEV,
};

/** TypeSafe System One (Jev) pinned model, served via OpenRouter (plan 24 D9). */
export const JEV_MODEL_ID = 'jev-1.13';
/** Named API endpoints for the Jev engine; the TypeSafe SDK appends `/v1/systemone`. */
export const JEV_BASE_URLS: Record<'openrouter' | 'typesafe', string> = {
  openrouter: 'https://openrouter.ai/api',
  typesafe: 'https://api.typesafe.ai',
};
/** Back-compat: the default (OpenRouter) root. */
export const JEV_BASE_URL = JEV_BASE_URLS.openrouter;
export type JevEndpoint = 'openrouter' | 'typesafe' | 'custom';

export interface JevSettings {
  endpoint: JevEndpoint;
  /** Used only when `endpoint === 'custom'`; validated on merge. */
  baseUrl: string;
}

export const JEV_SETTINGS_DEFAULT: JevSettings = { endpoint: 'openrouter', baseUrl: '' };

const JEV_ENDPOINTS: readonly JevEndpoint[] = ['openrouter', 'typesafe', 'custom'];

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    return !url.username && !url.password;
  } catch {
    return false;
  }
}

/** The effective API root for the current endpoint, or null when a custom URL is missing/invalid. */
export function resolveJevBaseUrl(jev: JevSettings | undefined): string | null {
  const settings = mergeJevSettings(jev);
  if (settings.endpoint === 'custom') {
    return isValidHttpUrl(settings.baseUrl) ? settings.baseUrl.replace(/\/+$/, '') : null;
  }
  return JEV_BASE_URLS[settings.endpoint];
}

export function mergeJevSettings(partial: Partial<JevSettings> | undefined): JevSettings {
  const endpoint: JevEndpoint = JEV_ENDPOINTS.includes(partial?.endpoint as JevEndpoint)
    ? (partial?.endpoint as JevEndpoint)
    : 'openrouter';
  const raw = typeof partial?.baseUrl === 'string' ? partial.baseUrl.trim() : '';
  return { endpoint, baseUrl: endpoint === 'custom' && isValidHttpUrl(raw) ? raw.slice(0, 200) : '' };
}

/** Keyring secret id holding the key that backs the Jev engine. */
export const JEV_SECRET_ID = 'openrouter:key';

/**
 * What a decision point can ask an engine to do (plan 24 D3). The matrix
 * is sparse by design: a resolver only routes a request to an engine
 * that declares the capability.
 */
export type DecisionCapability =
  | 'tool-dispatch'
  | 'boolean-gate'
  | 'choice'
  | 'score'
  | 'open-args';

/** Generic engine readiness for the settings surface (plan 24 D7). */
export type EngineReadiness =
  | { state: 'ready' }
  | { state: 'needs-key'; secretId: string }
  | { state: 'needs-download'; resource: string }
  | { state: 'unavailable'; reason: string };

/** Engine-neutral typed question (plan 24 D4) — the shared decision vocabulary. */
export type DecisionQuestion =
  | { id: string; type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { id: string; type: 'choice'; instructions: string; options: Record<string, string | null> }
  | { id: string; type: 'score'; instructions: string; levels: string[] };

/** Engine-neutral typed answer (plan 24 D4). */
export type DecisionAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | {
      type: 'score';
      score: number;
      legend: Record<string, string>;
      probabilities: Record<string, number>;
      confidence: number;
    };

/** Model page for the local Needle engine (credits link; weights pin lives main-side). */
export const NEEDLE_MODEL_PAGE_URL = 'https://huggingface.co/Cactus-Compute/needle3';

export const DECISION_ACT_THRESHOLD_DEFAULT = 0.85;
export const DECISION_CONFIRM_THRESHOLD_DEFAULT = 0.5;

/** Inputs longer than this are chat, not tool dispatch — skip the engine (D4). */
export const DECISION_MAX_INPUT_CHARS = 200;

/** Route-tool names are palette-safe identifiers (D10). */
export const DECISION_ROUTE_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{2,31}$/;
export const DECISION_ROUTE_TOOL_DESCRIPTION_MAX = 240;
export const DECISION_ROUTE_TOOL_EXAMPLES_MAX = 6;
export const DECISION_ROUTE_TOOL_EXAMPLE_MAX = 120;
/** Extra user prompt steer, capped so the engine prompt stays small (D11). */
export const DECISION_PROMPT_MAX_CHARS = 1000;

/**
 * A decision-only hand-off tool (plan 20 S7 D9): picking it routes the
 * input to a normal chat/agent turn pinned to `modelId` — never an
 * execution. Validated config data (D10), not a runtime tool.
 */
export interface DecisionRouteTool {
  name: string;
  description: string;
  modelId: string;
  examples?: string[];
}

/**
 * Opt-in decision scope (plan 20 S7 D8): precision-first — nothing is
 * in scope by default (no app tools, no built-in vocabulary); the
 * engine dispatches only what the user opted in (2026-09-19: user
 * approved flipping the built-in default from included to excluded —
 * "checked nothing" must mean "nothing dispatches").
 */
export interface DecisionScope {
  apps: string[];
  includeNatives: boolean;
}

export const DECISION_SCOPE_DEFAULT: DecisionScope = { apps: [], includeNatives: false };

export const DECISION_RULES_MAX = 32;
export const DECISION_RULE_MAX_CHARS = 400;
export const DECISION_RULE_TEXT_MAX = 120;

/**
 * Custom decision rules (plan 24 S7, D12): validated config data, never
 * code. A rule matches the model-free `tool-dispatch` decision; its action
 * is restricted to the safe set — route, a scoped dispatch (still through
 * policy/approval), notify, speak, or tag. No shell/fs/http.
 */
export type DecisionRuleAction = 'route' | 'dispatch' | 'notify' | 'speak' | 'tag';

export const DECISION_RULE_ACTIONS: readonly DecisionRuleAction[] = [
  'route',
  'dispatch',
  'notify',
  'speak',
  'tag',
];

export interface DecisionRule {
  id: string;
  enabled: boolean;
  /** Exact catalog tool name the rule matches (a real or route tool). */
  matchTool: string;
  action: DecisionRuleAction;
  /** Route target model (required for `route`). */
  modelId?: string;
  /** Message text for `notify`/`speak`/`tag`. */
  text?: string;
}

function sanitizeRuleText(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, DECISION_RULE_TEXT_MAX) : undefined;
}

export function sanitizeDecisionRules(value: unknown): DecisionRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const rules: DecisionRule[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const record = raw as Record<string, unknown>;
    const matchTool = typeof record.matchTool === 'string' ? record.matchTool.trim() : '';
    const action = DECISION_RULE_ACTIONS.includes(record.action as DecisionRuleAction)
      ? (record.action as DecisionRuleAction)
      : null;
    if (!matchTool || matchTool.length > 80 || !action) {
      continue;
    }
    const modelId = typeof record.modelId === 'string' ? record.modelId.trim() : '';
    if (action === 'route' && !modelId) {
      continue;
    }
    const text = sanitizeRuleText(record.text);
    if ((action === 'notify' || action === 'speak') && !text) {
      continue;
    }
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim().slice(0, 64) : `rule_${rules.length + 1}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    rules.push({
      id,
      enabled: record.enabled !== false,
      matchTool,
      action,
      ...(action === 'route' ? { modelId } : {}),
      ...(text ? { text } : {}),
    });
    if (rules.length >= DECISION_RULES_MAX) {
      break;
    }
  }
  return rules;
}

export function decisionRuleText(rule: DecisionRule): string {
  return (rule.text ?? `matched ${rule.matchTool}`).slice(0, DECISION_RULE_MAX_CHARS);
}

export interface DecisionSettings {
  /** `off` keeps behavior byte-identical to pre-plan-20 (D1). */
  engine: DecisionEngineSetting;
  /** Confidence ≥ actThreshold executes without extra confirmation (D4). */
  actThreshold: number;
  /** Confidence ≥ confirmThreshold routes into the approval card (D4). */
  confirmThreshold: number;
  /** Which tool apps' tools the engine may see (D8). */
  scope: DecisionScope;
  /** Custom decision-only route tools (D9/D10). */
  routeTools: DecisionRouteTool[];
  /** Extra user prompt steer assembled into the engine system prompt (D11). */
  prompt: string;
  /** Jev cloud engine endpoint (plan 24 S4b). */
  jev: JevSettings;
  /** Custom decision rules (plan 24 S7). */
  rules: DecisionRule[];
}

function clampThreshold(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, n));
}

function sanitizeScope(value: unknown): DecisionScope {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const apps = Array.isArray(record.apps)
    ? [
        ...new Set(
          record.apps
            .filter((id): id is string => typeof id === 'string')
            .map((id) => id.trim())
            .filter(Boolean)
        ),
      ]
    : [];
  return { apps, includeNatives: record.includeNatives === true };
}

function sanitizeRouteTools(value: unknown): DecisionRouteTool[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const tools: DecisionRouteTool[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const record = raw as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    const modelId = typeof record.modelId === 'string' ? record.modelId.trim() : '';
    if (!DECISION_ROUTE_TOOL_NAME_PATTERN.test(name) || seen.has(name) || !description || !modelId) {
      continue;
    }
    seen.add(name);
    const examples = (Array.isArray(record.examples) ? record.examples : [])
      .filter((line): line is string => typeof line === 'string')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, DECISION_ROUTE_TOOL_EXAMPLES_MAX)
      .map((line) => line.slice(0, DECISION_ROUTE_TOOL_EXAMPLE_MAX));
    tools.push({
      name,
      description: description.slice(0, DECISION_ROUTE_TOOL_DESCRIPTION_MAX),
      modelId,
      ...(examples.length > 0 ? { examples } : {}),
    });
  }
  return tools;
}

export function mergeDecisionSettings(partial: Partial<DecisionSettings> | undefined): DecisionSettings {
  const act = clampThreshold(partial?.actThreshold, DECISION_ACT_THRESHOLD_DEFAULT);
  const confirm = clampThreshold(partial?.confirmThreshold, DECISION_CONFIRM_THRESHOLD_DEFAULT);
  const engine: DecisionEngineSetting = DECISION_ENGINE_SETTINGS.includes(
    partial?.engine as DecisionEngineSetting
  )
    ? (partial?.engine as DecisionEngineSetting)
    : 'off';
  return {
    engine,
    actThreshold: Math.max(act, confirm),
    confirmThreshold: Math.min(act, confirm),
    scope: sanitizeScope(partial?.scope),
    routeTools: sanitizeRouteTools(partial?.routeTools),
    prompt: (typeof partial?.prompt === 'string' ? partial.prompt : '').trim().slice(0, DECISION_PROMPT_MAX_CHARS),
    jev: mergeJevSettings(partial?.jev),
    rules: sanitizeDecisionRules(partial?.rules),
  };
}

export type DecisionConfidenceBand = 'act' | 'confirm' | 'refuse';

export function decisionBand(confidence: number, settings: DecisionSettings): DecisionConfidenceBand {
  if (confidence >= settings.actThreshold) {
    return 'act';
  }
  if (confidence >= settings.confirmThreshold) {
    return 'confirm';
  }
  return 'refuse';
}

/** Engine-neutral tool projection (JSON-schema-ish parameters). */
export interface DecisionToolSchema {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface DecisionCall {
  tool: string;
  args: Record<string, unknown>;
}

/** Token usage reported by an engine, persisted on the audit row (plan 24 D8). */
export interface DecisionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface DecisionOutcome {
  engine: DecisionEngineKind;
  calls: DecisionCall[];
  confidence: number;
  reasoning?: string;
  /** Present when the engine answered typed questions (plan 24 D4). */
  answers?: Record<string, DecisionAnswer>;
  /** Present when the engine reports token usage. */
  usage?: DecisionUsage;
}

/** Persisted decision provenance (plan 24 S3) — `engine` is a label, never a branch. */
export interface DecisionProvenance {
  engine: DecisionEngineKind;
  confidence: number;
  band: DecisionConfidenceBand;
  reasoning?: string;
  /** Route-tool pick: the model id the turn was routed to. */
  routedTo?: string;
}

export function sanitizeConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(1, Math.max(0, n));
}

export interface DecisionNeedleState {
  runtimePresent: boolean;
  weightsPresent: boolean;
  downloading: boolean;
  receivedBytes: number;
  totalBytes: number;
}

/** Generic per-engine status for the settings surface (plan 24 S2). */
export interface DecisionEngineStatus {
  kind: DecisionEngineKind;
  name: string;
  capabilities: DecisionCapability[];
  readiness: EngineReadiness;
}

/**
 * A fired custom rule (plan 24 S7): what matched and what to do. Applied
 * by the decision point that ran the dispatch decision — the action set is
 * closed and every fire is traced/audited.
 */
export interface DecisionRuleFire {
  rule: DecisionRule;
  /** The tool call the flexible dispatch settled on. */
  call: DecisionCall;
  provenance: DecisionProvenance;
}

export interface DecisionSettingsState {
  engines: DecisionEngineStatus[];
  needle: DecisionNeedleState;
}

export interface DecisionTestRun {
  result: DecisionStatusLite;
  durationMs: number;
  /** The custom rule this decision would fire, if any (plan 24 S7 dry-run). */
  rule?: { id: string; action: DecisionRuleAction; text?: string };
}

export type DecisionStatusLite =
  | { status: 'off' }
  | { status: 'unconfigured'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; reason: string }
  | {
      status: 'decided';
      engine: DecisionEngineKind;
      confidence: number;
      band: DecisionConfidenceBand;
      calls: { tool: string }[];
    };
