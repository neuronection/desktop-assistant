/**
 * Decision models (plan 20/24, plan 26 since 2026-10-12): intent routing +
 * tool dispatch as a sibling capability to chat — never a replacement.
 * Shared surface so both processes speak the same shapes; invocation lives
 * in `src/main/ai/decide/`.
 *
 * A decision model is an ordinary provider model (ADR-0032): key + base URL
 * on the provider row, model name on the model row, `decisionTransport`
 * (`systemone` today) as the transport seam. Assignment replaces the old
 * engine enum: `decision:<cap>` slots in the task-assignment mirror map.
 */

import { TEXT } from '@shared/constants/text';
import { ALL_PROVIDER_PRESETS } from '@shared/ai/providerPresets';

/**
 * TypeSafe System One (Jev) rolling model alias — never a version pin:
 * Jev ships new versions often, so a row may follow the provider's current
 * default until the user pins an observed version (plan 26 D10). §15
 * single-source: the alias is read from the synced canonical preset data
 * (typesafe decisionDefault → first decision model), never a code literal —
 * a canonical curation change flows through without a code edit.
 */
export const JEV_MODEL_ID =
  ALL_PROVIDER_PRESETS.typesafe.decisionDefault ??
  ALL_PROVIDER_PRESETS.typesafe.decisionModels?.[0]?.modelId ??
  '';

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

/**
 * What a decision point can ask a decision model to do (plan 24 D3). The
 * matrix is sparse by design: the resolver only routes a request to a
 * transport that declares the capability.
 */
export type DecisionCapability =
  | 'tool-dispatch'
  | 'boolean-gate'
  | 'choice'
  | 'score'
  | 'open-args';

/** The one shipping decision transport (ADR-0032 D9: SDK admission rule). */
export type DecisionTransport = 'systemone';

export const DECISION_TRANSPORTS: readonly DecisionTransport[] = ['systemone'];

export const DECISION_TRANSPORT_NAMES: Record<DecisionTransport, string> = {
  systemone: TEXT.DECISION_TRANSPORT_NAME_SYSTEMONE,
};

/**
 * The sparse decision-capability matrix lives on the transport (D2b):
 * `systemone` serves everything except `open-args`.
 */
export const SYSTEMONE_DECISION_CAPS: readonly DecisionCapability[] = [
  'tool-dispatch',
  'boolean-gate',
  'choice',
  'score',
];

/** Caps a transport declares, or an empty set for an unknown transport. */
export function transportDecisionCaps(transport: string | undefined): ReadonlySet<DecisionCapability> {
  return transport === 'systemone' ? new Set<DecisionCapability>(SYSTEMONE_DECISION_CAPS) : new Set();
}

/**
 * Assignable family slots (D3): `decision:<capability>` keys in the
 * task-assignment mirror map. `open-args` is vocabulary-reserved — no
 * shipping transport declares it, so no surface offers it.
 */
export const DECISION_SLOT_PREFIX = 'decision:';

export function decisionSlot(capability: DecisionCapability): string {
  return `${DECISION_SLOT_PREFIX}${capability}`;
}

/**
 * The `decision` default slot (ADR-0036 §1): the family's
 * default+override pattern — one decision default beside the four kind
 * overrides in the task-assignment mirror map. Resolution order is law
 * (§2): kind override → decision default → unassigned; the default is
 * single-slot per ADR-0037 (no fallback leg of its own).
 */
export const DECISION_DEFAULT_SLOT = 'decision';

export const DECISION_SLOTS: readonly string[] = SYSTEMONE_DECISION_CAPS.map((capability) =>
  decisionSlot(capability)
);

export function isDecisionSlot(value: string): value is `decision:${DecisionCapability}` {
  return DECISION_SLOTS.includes(value);
}

/** The capability a slot key routes to; null for non-slot keys (incl. reserved `open-args`). */
export function decisionSlotCapability(slot: string): DecisionCapability | null {
  if (!slot.startsWith(DECISION_SLOT_PREFIX)) {
    return null;
  }
  const capability = slot.slice(DECISION_SLOT_PREFIX.length) as DecisionCapability;
  return (SYSTEMONE_DECISION_CAPS as readonly string[]).includes(capability) ? capability : null;
}

/** The slot a typed-question set needs: choice → score → boolean-gate (plan 26 S1). */
export function capabilityForQuestions(
  questions: readonly { type: 'noul' | 'choice' | 'score' }[]
): DecisionCapability {
  if (questions.some((question) => question.type === 'choice')) {
    return 'choice';
  }
  if (questions.some((question) => question.type === 'score')) {
    return 'score';
  }
  return 'boolean-gate';
}

/** Generic slot readiness for the settings surface (plan 24 D7). */
export type EngineReadiness =
  | { state: 'ready' }
  | { state: 'needs-key'; secretId: string }
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

/** What a `speak` rule says: the model's reply, or a fixed authored line. */
export type DecisionRuleSpeakTarget = 'reply' | 'text';

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
  /** `speak` target: the reply (default) or a fixed `text` (plan 24 S7 follow-up). */
  speakTarget?: DecisionRuleSpeakTarget;
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
    const speakTarget: DecisionRuleSpeakTarget =
      action === 'speak' && record.speakTarget === 'text' ? 'text' : 'reply';
    if (action === 'notify' && !text) {
      continue;
    }
    if (action === 'speak' && speakTarget === 'text' && !text) {
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
      ...(action === 'speak' ? { speakTarget } : {}),
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
  /** Confidence ≥ actThreshold executes without extra confirmation (D4). */
  actThreshold: number;
  /** Confidence ≥ confirmThreshold routes into the approval card (D4). */
  confirmThreshold: number;
  /** Which tool apps' tools the decision model may see (D8). */
  scope: DecisionScope;
  /** Custom decision-only route tools (D9/D10). */
  routeTools: DecisionRouteTool[];
  /** Extra user prompt steer assembled into the decision system prompt (D11). */
  prompt: string;
  /** Custom decision rules (plan 24 S7). */
  rules: DecisionRule[];
  /**
   * Resolved model versions observed at call time (plan 26 D10): model id →
   * provider-reported version. Backs the settings pin affordance; the audit
   * row carries the same observation per invocation.
   */
  observedVersions: Record<string, string>;
  /**
   * One-time notice flag (plan 26 S2): set by the legacy-config migration
   * (`engine: 'llm' | 'needle'` configs became unassigned slots); cleared
   * when the user acknowledges the deep-link notice.
   */
  legacyEngineNotice?: boolean;
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

function sanitizeObservedVersions(value: unknown): Record<string, string> {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const observed: Record<string, string> = {};
  for (const [modelId, version] of Object.entries(record)) {
    if (!modelId || modelId.length > 200) {
      continue;
    }
    if (typeof version === 'string' && version.trim()) {
      observed[modelId] = version.trim().slice(0, 200);
    }
    if (Object.keys(observed).length >= 64) {
      break;
    }
  }
  return observed;
}

export function mergeDecisionSettings(partial: Partial<DecisionSettings> | undefined): DecisionSettings {
  const act = clampThreshold(partial?.actThreshold, DECISION_ACT_THRESHOLD_DEFAULT);
  const confirm = clampThreshold(partial?.confirmThreshold, DECISION_CONFIRM_THRESHOLD_DEFAULT);
  return {
    actThreshold: Math.max(act, confirm),
    confirmThreshold: Math.min(act, confirm),
    scope: sanitizeScope(partial?.scope),
    routeTools: sanitizeRouteTools(partial?.routeTools),
    prompt: (typeof partial?.prompt === 'string' ? partial.prompt : '').trim().slice(0, DECISION_PROMPT_MAX_CHARS),
    rules: sanitizeDecisionRules(partial?.rules),
    observedVersions: sanitizeObservedVersions(partial?.observedVersions),
    ...(partial?.legacyEngineNotice === true ? { legacyEngineNotice: true } : {}),
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
  /** Provenance label (the decision model id) — never a caller-side branch. */
  engine: string;
  calls: DecisionCall[];
  confidence: number;
  reasoning?: string;
  /** Present when the engine answered typed questions (plan 24 D4). */
  answers?: Record<string, DecisionAnswer>;
  /** Present when the engine reports token usage. */
  usage?: DecisionUsage;
  /** Provider-reported resolved model version, when the transport reports one (D10). */
  resolvedModel?: string;
}

/** Persisted decision provenance (plan 24 S3) — `engine` is a label, never a branch. */
export interface DecisionProvenance {
  engine: string;
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

/** Per-slot status for the settings surface (plan 26 S1). */
export interface DecisionSlotStatus {
  slot: string;
  capability: DecisionCapability;
  transport: DecisionTransport;
  transportName: string;
  assignedModelId: string | null;
  fallbackModelId: string | null;
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
  slots: DecisionSlotStatus[];
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
      engine: string;
      confidence: number;
      band: DecisionConfidenceBand;
      calls: { tool: string }[];
    };
