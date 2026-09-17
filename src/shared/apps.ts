import { z } from 'zod';
import type { McpServerConfig, McpServerState, McpToolOverride } from './mcp';
import type { ToolRiskClass } from './turns';
import { PROMPT_NOTES_CAP } from './app-presets';

/** How an app's tools reach the model (plan 15 D3 layer per app). */
export type AppExposure = 'always' | 'relevance' | 'deferred';

/** Per-tool curation inside an app (D3 layer 1 / D13 denylist posture). */
export interface ToolAppToolState {
  enabled: boolean;
  keywordTags: string[];
  /** User override — may only tighten relative to `baseRisk` (D4). */
  riskOverride?: ToolRiskClass;
  /** Authored baseline (preset risk map); MCP default `state-changing`. */
  baseRisk?: ToolRiskClass;
  /** Authored (preset) entity handling — drives D18 scope enforcement. */
  entityRole?: 'action' | 'discovery';
  /** Arg key carrying the entity id for `action` tools. */
  entityArg?: string;
}

/** Ordered entity-scope rule (D18) — last match wins, no rules = unscoped. */
export interface EntityScopeRule {
  effect: 'allow' | 'deny';
  pattern: string;
}

export interface EntityScope {
  rules: EntityScopeRule[];
}

/** v1 enforces exactly one source (zod `maxItems(1)` — plan 15 B2). */
export type ToolAppSource =
  | { kind: 'mcp'; server: McpServerConfig }
  | { kind: 'native-group'; tools: string[] };

export interface ToolAppSpec {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  enabled: boolean;
  sources: ToolAppSource[];
  /** Keyed by raw (server-side) tool name; absent = default enabled (D13). */
  toolState: Record<string, ToolAppToolState>;
  entityScope?: EntityScope;
  exposure: AppExposure;
  /** Bundled preset this app was created from (authored metadata owner). */
  presetId?: string;
  /** Preset-authored capability guidance — injected while bound (§4). */
  promptNotes?: string;
  /** User-authored standing directives — injected every turn while enabled. */
  directives?: string;
  /** Set at boot when the stored app no longer validates (self-disable). */
  error?: string;
}

export interface ToolAppsSettings {
  /** Family kill switch: false unbinds every app tool everywhere (D3). */
  masterEnabled: boolean;
  apps: ToolAppSpec[];
  /** Full post-curation agent-toolset budget (plan 15 §5 budget card). */
  toolBudget: number;
}

/** Per-app runtime snapshot (mirrors `McpServerStatus`). */
export interface ToolAppStatus {
  appId: string;
  state: McpServerState;
  toolCount: number;
  latencyMs?: number | null;
  lastError?: string | null;
}

/** Wire shape for the settings UI — secrets never cross back (masked). */
export interface ToolAppView {
  app: ToolAppSpec;
  status: ToolAppStatus | null;
  envKeys: string[];
  headerKeys: string[];
  /** Tools known from the last successful listing (D13 view; `state: null` = new). */
  knownTools: { name: string; description: string; state: ToolAppToolState | null }[];
}

/** Renderer → main save payload: the only path secret values may travel. */
export interface ToolAppSaveInput extends ToolAppSpec {
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export function appEnvSecretKey(appId: string): string {
  return `app:${appId}:env`;
}

export function appHeaderSecretKey(appId: string): string {
  return `app:${appId}:headers`;
}

const RISK_RANK: Record<ToolRiskClass, number> = {
  'read-only': 0,
  'state-changing': 1,
  destructive: 2,
};

/** Tighten-only rule (D4): an override may never loosen the baseline. */
export function riskTightensOnly(base: ToolRiskClass, override: ToolRiskClass): boolean {
  return RISK_RANK[override] >= RISK_RANK[base];
}

export function baseRiskOf(state: ToolAppToolState | undefined | null): ToolRiskClass {
  return state?.baseRisk ?? 'state-changing';
}

export function effectiveRiskOf(state: ToolAppToolState | undefined | null): ToolRiskClass {
  if (!state) {
    return 'state-changing';
  }
  return state.riskOverride ?? state.baseRisk ?? 'state-changing';
}

const riskSchema = z.enum(['read-only', 'state-changing', 'destructive']);

const toolStateSchema = z.object({
  enabled: z.boolean(),
  keywordTags: z.array(z.string().min(1).max(64)).max(20),
  riskOverride: riskSchema.optional(),
  baseRisk: riskSchema.optional(),
  entityRole: z.enum(['action', 'discovery']).optional(),
  entityArg: z.string().min(1).max(64).optional(),
});

const scopeRuleSchema = z.object({
  effect: z.enum(['allow', 'deny']),
  pattern: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[\w.*:-]+$/, 'entity patterns allow only word chars, ".", "*", ":", "-"'),
});

const transportSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stdio'), command: z.string().min(1), args: z.array(z.string()).optional() }),
  z.object({ type: z.literal('http'), url: z.string().min(1) }),
  z.object({ type: z.literal('sse'), url: z.string().min(1) }),
]);

const mcpServerSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  transport: transportSchema,
  enabled: z.boolean(),
  allowlist: z.array(z.string().min(1)).optional(),
  defaultAction: z.enum(['allow', 'deny']).default('allow'),
  timeoutMs: z.number().int().positive().optional(),
  maxConcurrent: z.number().int().positive().optional(),
});

const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mcp'), server: mcpServerSchema }),
  z.object({ kind: z.literal('native-group'), tools: z.array(z.string().min(1)).min(1).max(50) }),
]);

export const toolAppSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(64),
    icon: z.string().max(64).optional(),
    description: z.string().max(500).optional(),
    enabled: z.boolean(),
    sources: z.array(sourceSchema).min(1).max(1),
    toolState: z.record(z.string().min(1), toolStateSchema),
    entityScope: z.object({ rules: z.array(scopeRuleSchema).max(100) }).optional(),
    exposure: z.enum(['always', 'relevance', 'deferred']).default('relevance'),
    presetId: z.string().min(1).max(64).optional(),
    promptNotes: z.string().max(PROMPT_NOTES_CAP).optional(),
    directives: z.string().max(PROMPT_NOTES_CAP).optional(),
  })
  .superRefine((app, ctx) => {
    for (const [toolName, state] of Object.entries(app.toolState)) {
      const base = state.baseRisk ?? 'state-changing';
      if (state.riskOverride && !riskTightensOnly(base, state.riskOverride)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['toolState', toolName, 'riskOverride'],
          message: `risk override for '${toolName}' may only tighten (base: ${base})`,
        });
      }
    }
    if (app.entityScope && app.sources.some((source) => source.kind === 'native-group')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entityScope'],
        message: 'entityScope applies to MCP-backed apps only',
      });
    }
  });

export const toolAppsSettingsSchema = z.object({
  masterEnabled: z.boolean(),
  apps: z.array(toolAppSchema),
  toolBudget: z.number().int().min(1).max(200).default(25),
});

export function parseToolApp(value: unknown): { ok: true; app: ToolAppSpec } | { ok: false; error: string } {
  const result = toolAppSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length > 0 ? ` (${issue.path.join('.')})` : '';
    return { ok: false, error: `${issue.message}${where}` };
  }
  return { ok: true, app: result.data };
}

/**
 * One-time D11 migration: standalone `tools.mcpServers` entries become
 * custom apps. Legacy per-tool overrides (namespaced keys) move into the
 * app's `toolState` as authored baselines — behavior is preserved
 * exactly (`baseRisk` carries the legacy risk; user overrides start
 * clean and may only tighten).
 */
export function migrateMcpServersToToolApps(
  servers: McpServerConfig[],
  overrides: Record<string, McpToolOverride>,
  existingApps: ToolAppSpec[]
): ToolAppSpec[] {
  const takenIds = new Set(existingApps.map((app) => app.id));
  const migrated: ToolAppSpec[] = [];
  for (const server of servers) {
    if (takenIds.has(server.id)) {
      continue;
    }
    takenIds.add(server.id);
    const prefix = `mcp__${server.name}__`;
    const toolState: Record<string, ToolAppToolState> = {};
    for (const [namespaced, override] of Object.entries(overrides)) {
      if (!namespaced.startsWith(prefix)) {
        continue;
      }
      const raw = namespaced.slice(prefix.length);
      if (raw.length === 0) {
        continue;
      }
      toolState[raw] = {
        enabled: override.enabled !== false,
        keywordTags: [],
        ...(override.risk ? { baseRisk: override.risk } : {}),
      };
    }
    migrated.push({
      id: server.id,
      name: server.name,
      description: undefined,
      enabled: server.enabled,
      sources: [{ kind: 'mcp', server: { ...server, enabled: true } }],
      toolState,
      exposure: 'relevance',
    });
  }
  return migrated;
}
