import type { ToolAppSpec, EntityScopeRule } from '@shared/apps';
import type { ToolRiskClass } from '@shared/turns';
import { entityAllowedByScope } from './app-selection';
import { withToolTimeout, clampText } from './registry';

export const MCP_DIRECT_TIMEOUT_MS = 20_000;

export interface McpDirectTool {
  namespaced: string;
  rawName: string;
  appName: string;
  enabled: boolean;
  risk: ToolRiskClass;
  entityRole?: 'action' | 'discovery';
  entityArg?: string;
  scopeRules?: EntityScopeRule[];
  invoke(args: Record<string, unknown>): Promise<unknown>;
}

export interface McpDirectManager {
  statusFor(serverId: string): { state: string };
  cachedToolsFor(serverId: string): { namespaced: string; rawName: string }[];
  getToolsForServer(
    server: { id: string; name: string; enabled: boolean },
    policy: { isDisabled(name: string): boolean }
  ): Promise<{ name: string; tool: { invoke(args: unknown): Promise<unknown> } }[]>;
}

export interface McpDirectDeps {
  apps(): ToolAppSpec[];
  manager: McpDirectManager;
  policy: { isDisabled(name: string): boolean };
}

function appServer(app: ToolAppSpec): { id: string; name: string; enabled: boolean } | null {
  const source = app.sources[0];
  if (!source || source.kind !== 'mcp') {
    return null;
  }
  return source.server;
}

export function effectiveMcpRisk(app: ToolAppSpec, rawName: string): ToolRiskClass {
  const state = app.toolState[rawName];
  return state?.riskOverride ?? state?.baseRisk ?? 'state-changing';
}

/**
 * Snapshot of directly-dispatchable MCP tools: enabled apps, connected
 * servers, tool-state enabled, destructive excluded (same filters as
 * the palette rows — plan 15 S6).
 */
export async function buildMcpDirectTools(deps: McpDirectDeps): Promise<McpDirectTool[]> {
  const tools: McpDirectTool[] = [];
  for (const app of deps.apps()) {
    const server = appServer(app);
    if (!server || !server.enabled) {
      continue;
    }
    if (deps.manager.statusFor(server.id).state !== 'connected') {
      continue;
    }
    let wrapped;
    try {
      wrapped = await deps.manager.getToolsForServer(server, deps.policy);
    } catch {
      continue;
    }
    const rawByNamespaced = new Map(deps.manager.cachedToolsFor(server.id).map((info) => [info.namespaced, info.rawName]));
    for (const entry of wrapped) {
      const rawName = rawByNamespaced.get(entry.name) ?? entry.name;
      const state = app.toolState[rawName];
      if (state?.enabled === false) {
        continue;
      }
      const effective = effectiveMcpRisk(app, rawName);
      if (effective === 'destructive') {
        continue;
      }
      tools.push({
        namespaced: entry.name,
        rawName,
        appName: app.name,
        enabled: true,
        risk: effective,
        ...(state?.entityRole ? { entityRole: state.entityRole } : {}),
        ...(state?.entityArg ? { entityArg: state.entityArg } : {}),
        ...(app.entityScope?.rules?.length ? { scopeRules: app.entityScope.rules } : {}),
        invoke: (args) => entry.tool.invoke(args),
      });
    }
  }
  return tools;
}

/**
 * D18 entityScope guard for direct dispatch: an action tool whose
 * entity argument lies outside the app's scope is rejected outright —
 * same approval-skip contract as the agent bridge (plan 15 S4).
 */
export function mcpEntityGuard(tool: McpDirectTool, args: Record<string, unknown>): string | null {
  if (!tool.entityArg || !tool.scopeRules) {
    return null;
  }
  const entityId = args[tool.entityArg];
  if (typeof entityId !== 'string' || entityId.length === 0) {
    return null;
  }
  if (!entityAllowedByScope(entityId, tool.scopeRules)) {
    return `'${entityId}' is outside the '${tool.appName}' entity scope configured in Settings → Apps.`;
  }
  return null;
}

export interface McpDirectOutcome {
  ok: boolean;
  text: string;
  images: string[];
  durationMs: number;
}

function resultToOutcome(result: unknown, startedAt: number): McpDirectOutcome {
  if (typeof result === 'string') {
    return { ok: true, text: result, images: [], durationMs: Date.now() - startedAt };
  }
  if (Array.isArray(result)) {
    const images: string[] = [];
    const parts: string[] = [];
    for (const block of result as { type?: string; text?: string; url?: string }[]) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      } else if (block?.type === 'image' && typeof block.url === 'string') {
        images.push(block.url);
      }
    }
    return { ok: true, text: parts.join('\n'), images, durationMs: Date.now() - startedAt };
  }
  return { ok: true, text: clampText(JSON.stringify(result) ?? '', 20_000), images: [], durationMs: Date.now() - startedAt };
}

export async function executeMcpDirect(tool: McpDirectTool, args: Record<string, unknown>): Promise<McpDirectOutcome> {
  const startedAt = Date.now();
  const guardError = mcpEntityGuard(tool, args);
  if (guardError) {
    return { ok: false, text: guardError, images: [], durationMs: 0 };
  }
  try {
    const result = await withToolTimeout(tool.invoke(args), MCP_DIRECT_TIMEOUT_MS, tool.namespaced);
    return resultToOutcome(result, startedAt);
  } catch (error) {
    return {
      ok: false,
      text: clampText(String((error as Error)?.message ?? error), 500),
      images: [],
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Direct-dispatch host over MCP app tools (plan 20 S4): mirrors the
 * native-registry surface TurnManager consumes, so palette app-tool
 * rows and decision-engine dispatches execute through the same policy
 * + approval path as native tools.
 */
export class McpDirectExecutor {
  private toolsPromise: Promise<McpDirectTool[]> | null = null;

  constructor(private readonly deps: McpDirectDeps) {}

  private tools(): Promise<McpDirectTool[]> {
    if (!this.toolsPromise) {
      this.toolsPromise = buildMcpDirectTools(this.deps).catch(() => []);
    }
    return this.toolsPromise;
  }

  invalidate(): void {
    this.toolsPromise = null;
  }

  async riskFor(name: string): Promise<ToolRiskClass | undefined> {
    if (!name.startsWith('mcp__')) {
      return undefined;
    }
    return (await this.tools()).find((tool) => tool.namespaced === name)?.risk;
  }

  async summarizeFor(name: string, args: unknown): Promise<string> {
    const tool = (await this.tools()).find((candidate) => candidate.namespaced === name);
    return clampText(`${tool?.appName ?? name}: ${JSON.stringify(args)}`, 160);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<McpDirectOutcome> {
    if (!name.startsWith('mcp__')) {
      return { ok: false, text: `Unknown tool '${name}'.`, images: [], durationMs: 0 };
    }
    const tool = (await this.tools()).find((candidate) => candidate.namespaced === name);
    if (!tool) {
      return { ok: false, text: `Unknown tool '${name}'.`, images: [], durationMs: 0 };
    }
    return executeMcpDirect(tool, args);
  }
}
