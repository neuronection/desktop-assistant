import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { tool as lcTool } from 'langchain';
import { z } from 'zod';
import type { McpServerConfig, McpServerStatus, McpToolInfo, McpToolOverride } from '@shared/mcp';
import type { ToolRiskClass, ToolVerificationSettings } from '@shared/turns';
import { capToolResult, namespaceMcpTool, truncateText, withToolTimeout } from './registry';
import { describeParameters } from './catalog';

export const MCP_DEFAULT_TIMEOUT_MS = 30_000;
export const MCP_DEFAULT_MAX_CONCURRENT = 4;
const MCP_BACKOFF_BASE_MS = 1_000;
const MCP_BACKOFF_CAP_MS = 30_000;
const DEFAULT_RESULT_CAP = 20_000;

export interface McpWrappedTool {
  name: string;
  tool: StructuredToolInterface;
  server: string;
  serverId: string;
  risk: ToolRiskClass;
}

export interface McpSecrets {
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface McpManagerDeps {
  listServers(): McpServerConfig[];
  toolOverrides(toolName: string): McpToolOverride | undefined;
  readSecrets(serverId: string): Promise<McpSecrets>;
  now?(): number;
}

interface ClientRuntime {
  client: MultiServerMCPClient;
  active: number;
  waiters: (() => void)[];
}

interface ServerState {
  status: McpServerStatus;
  runtime: ClientRuntime | null;
  nextAttemptAt: number;
  attempts: number;
  /** Last successful tool listing (settings UI; empty until connected). */
  toolInfos: McpToolInfo[];
  /** Clock reading at the last `toolInfos` write (0 = never fetched). */
  toolInfosFetchedAt: number;
}

/** Connection-failure text including the undici/fetch cause chain (DNS, TLS, refused…). */
export function connectionErrorText(error: unknown, cap = 300): string {
  let text = (error as Error)?.message ?? String(error);
  let cause = (error as { cause?: unknown })?.cause;
  let depth = 0;
  while (cause && depth < 3) {
    const causeError = cause as { message?: string; code?: string };
    const part = causeError.code ?? causeError.message;
    if (part && !text.includes(part)) {
      text += ` — caused by ${part}`;
    }
    cause = (cause as { cause?: unknown }).cause;
    depth += 1;
  }
  return truncateText(text, cap);
}

export function mcpEnvSecretKey(serverId: string): string {
  return `mcp:${serverId}:env`;
}

export function mcpHeaderSecretKey(serverId: string): string {
  return `mcp:${serverId}:headers`;
}

/**
 * Owns the MCP server connections (one isolated client per server):
 * lazy connect, health + reconnect with backoff, per-server timeout and
 * concurrency caps, namespaced tool names, registry-capped outputs.
 * Servers spawn only from user configuration — never model output
 * (ADR-0011 §7).
 */
export class McpManager {
  private readonly states = new Map<string, ServerState>();

  constructor(private readonly deps: McpManagerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  listServerConfigs(): McpServerConfig[] {
    return this.deps.listServers();
  }

  statusFor(serverId: string): McpServerStatus {
    const state = this.states.get(serverId);
    return state ? { ...state.status } : newStatus(serverId);
  }

  /** Last known tool listing for a server (empty until a connect succeeded). */
  cachedToolsFor(serverId: string): McpToolInfo[] {
    return this.states.get(serverId)?.toolInfos ?? [];
  }

  allStatuses(): McpServerStatus[] {
    return this.listServerConfigs().map((server) => this.statusFor(server.id));
  }

  async testConnection(server: McpServerConfig): Promise<{ ok: boolean; latencyMs?: number; toolCount?: number; error?: string }> {
    await this.dropRuntime(server.id);
    const startedAt = this.now();
    try {
      const tools = await this.connectAndGetTools(server);
      return { ok: true, latencyMs: this.now() - startedAt, toolCount: tools.length };
    } catch (error) {
      return { ok: false, error: connectionErrorText(error) };
    }
  }

  /**
   * Settings path: connect (or reuse the live runtime) and describe every
   * tool the server exposes — regardless of allowlist, so the UI can show
   * what a changed allowlist would hide. Caches the result.
   */
  async listServerTools(
    server: McpServerConfig,
    settings: {
      isDisabled(name: string): boolean;
      toolOverrides(name: string): McpToolOverride | undefined;
      toolVerification(name: string): ToolVerificationSettings;
    }
  ): Promise<McpToolInfo[]> {
    const rawTools = await this.connectAndGetTools(server);
    const infos = rawTools.map((raw) => {
      const namespaced = namespaceMcpTool(server.name, raw.name);
      const override = settings.toolOverrides(namespaced);
      const inAllowlist = !server.allowlist || server.allowlist.length === 0 || server.allowlist.includes(raw.name);
      let parameters: McpToolInfo['parameters'] = [];
      try {
        parameters = describeParameters(raw.schema as Parameters<typeof describeParameters>[0]);
      } catch {
        parameters = [];
      }
      return {
        rawName: raw.name,
        namespaced,
        description: raw.description ?? `MCP tool from ${server.name}`,
        parameters,
        risk: override?.risk ?? 'state-changing',
        enabled: override?.enabled !== false && inAllowlist && !settings.isDisabled(namespaced),
        verification: settings.toolVerification(namespaced),
      };
    });
    this.stateFor(server.id).toolInfos = infos;
    this.stateFor(server.id).toolInfosFetchedAt = this.now();
    return infos;
  }

  /** Age of the cached tool listing, or `null` when nothing was ever fetched. */
  cacheAgeMs(serverId: string): number | null {
    const fetchedAt = this.states.get(serverId)?.toolInfosFetchedAt ?? 0;
    return fetchedAt === 0 ? null : this.now() - fetchedAt;
  }

  /** Tools from every enabled server; a failing server degrades alone. */
  async getAllTools(policy: { isDisabled(name: string): boolean }): Promise<McpWrappedTool[]> {
    const results = await Promise.all(
      this.listServerConfigs()
        .filter((server) => server.enabled)
        .map(async (server) => {
          try {
            return await this.getToolsForServer(server, policy);
          } catch (error) {
            console.error(`MCP server '${server.name}' unavailable:`, (error as Error).message);
            return [];
          }
        })
    );
    return results.flat();
  }

  async getToolsForServer(
    server: McpServerConfig,
    policy: { isDisabled(name: string): boolean }
  ): Promise<McpWrappedTool[]> {
    if (!server.enabled) {
      return [];
    }
    const state = this.stateFor(server.id);
    if (policy.isDisabled(`mcp__${server.name}`)) {
      return [];
    }
    if (state.nextAttemptAt > this.now()) {
      const stale = this.staleTools(server);
      if (stale.length > 0) {
        return stale;
      }
      throw new Error(`MCP server '${server.name}' is reconnecting (backoff).`);
    }
    state.status.state = 'connecting';
    const startedAt = this.now();
    let rawTools: StructuredToolInterface[];
    try {
      rawTools = await this.connectAndGetTools(server);
    } catch (error) {
      const stale = this.staleTools(server);
      if (stale.length > 0) {
        return stale;
      }
      throw error;
    }
    state.status.state = 'connected';
    state.status.latencyMs = this.now() - startedAt;
    state.status.lastError = null;
    state.status.lastConnectedAt = this.now();
    state.attempts = 0;

    const wrapped: McpWrappedTool[] = [];
    for (const raw of rawTools) {
      const namespaced = namespaceMcpTool(server.name, raw.name);
      const override = this.deps.toolOverrides(namespaced);
      if (override?.enabled === false) {
        continue;
      }
      if (!this.allowedByPolicy(server, raw.name)) {
        continue;
      }
      if (policy.isDisabled(namespaced)) {
        continue;
      }
      wrapped.push({
        name: namespaced,
        server: server.name,
        serverId: server.id,
        risk: override?.risk ?? 'state-changing',
        tool: this.wrapTool(server, state, namespaced, raw),
      });
    }
    state.status.toolCount = wrapped.length;
    return wrapped;
  }

  async close(): Promise<void> {
    await Promise.all([...this.states.keys()].map((id) => this.dropRuntime(id)));
  }

  /**
   * Last-known tools as unreachable placeholders (plan 15 resilience): when
   * a reconnect fails but a previous listing succeeded, the app stays
   * bound with its cached tool names and every invocation returns an
   * honest error — the model sees the capability and reports the outage
   * instead of improvising with unrelated tools.
   */
  private staleTools(server: McpServerConfig): McpWrappedTool[] {
    const state = this.stateFor(server.id);
    if (state.toolInfos.length === 0) {
      return [];
    }
    const lastError = state.status.lastError ?? 'unknown';
    return state.toolInfos.map((info) => ({
      name: info.namespaced,
      server: server.name,
      serverId: server.id,
      risk: info.risk,
      tool: lcTool(
        async () =>
          `Error (${info.namespaced}): server '${server.name}' is unreachable right now (${lastError}). It may recover on a later try.`,
        {
          name: info.namespaced,
          description: `[unreachable] ${info.description}`,
          schema: z.looseObject({}),
        }
      ),
    }));
  }

  private allowedByPolicy(server: McpServerConfig, toolName: string): boolean {
    if (!server.allowlist || server.allowlist.length === 0) {
      return server.defaultAction !== 'deny';
    }
    return server.allowlist.includes(toolName);
  }

  private async connectAndGetTools(server: McpServerConfig): Promise<StructuredToolInterface[]> {
    const state = this.stateFor(server.id);
    try {
      if (!state.runtime) {
        const secrets = await this.deps.readSecrets(server.id);
        const client = await this.createClient(server, secrets);
        state.runtime = { client, active: 0, waiters: [] };
      }
      const tools = await state.runtime.client.getTools();
      state.status.state = 'connected';
      state.status.toolCount = tools.length;
      state.status.lastConnectedAt = this.now();
      state.status.lastError = null;
      state.attempts = 0;
      state.nextAttemptAt = 0;
      return tools;
    } catch (error) {
      state.status.state = 'error';
      state.status.lastError = connectionErrorText(error);
      state.attempts += 1;
      state.nextAttemptAt = this.now() + Math.min(MCP_BACKOFF_CAP_MS, MCP_BACKOFF_BASE_MS * 2 ** state.attempts);
      await this.dropRuntime(server.id);
      throw error;
    }
  }

  private async createClient(server: McpServerConfig, secrets: McpSecrets): Promise<MultiServerMCPClient> {
    if (server.transport.type === 'stdio') {
      return new MultiServerMCPClient({
        [server.name]: {
          transport: 'stdio',
          command: server.transport.command,
          args: server.transport.args ?? [],
          env: secrets.env ?? {},
        },
      });
    }
    if (server.transport.type === 'http') {
      return new MultiServerMCPClient({
        [server.name]: {
          transport: 'http',
          url: server.transport.url,
          headers: secrets.headers ?? {},
        },
      });
    }
    return new MultiServerMCPClient({
      [server.name]: {
        transport: 'sse',
        url: server.transport.url,
        headers: secrets.headers ?? {},
      },
    });
  }

  private wrapTool(
    server: McpServerConfig,
    state: ServerState,
    namespacedName: string,
    raw: StructuredToolInterface
  ): StructuredToolInterface {
    const timeoutMs = server.timeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;
    const maxConcurrent = server.maxConcurrent ?? MCP_DEFAULT_MAX_CONCURRENT;
    return lcTool(
      async (args) => {
        const runtime = state.runtime;
        if (!runtime) {
          return `Error (${namespacedName}): server is disconnected.`;
        }
        if (runtime.active >= maxConcurrent) {
          await new Promise<void>((resolve) => runtime.waiters.push(resolve));
        }
        runtime.active += 1;
        try {
          let result: unknown;
          try {
            result = await withToolTimeout(Promise.resolve(raw.invoke(args)), timeoutMs, namespacedName);
          } catch (error) {
            return `Error (${namespacedName}): ${truncateText((error as Error).message ?? String(error), 500)}`;
          }
          const text = typeof result === 'string' ? result : JSON.stringify(result);
          return capToolResult(text ?? '', DEFAULT_RESULT_CAP);
        } finally {
          runtime.active -= 1;
          runtime.waiters.shift()?.();
        }
      },
      {
        name: namespacedName,
        description: raw.description ?? `MCP tool from ${server.name}`,
        schema: raw.schema,
      }
    );
  }

  private stateFor(serverId: string): ServerState {
    let state = this.states.get(serverId);
    if (!state) {
      state = {
        status: newStatus(serverId),
        runtime: null,
        nextAttemptAt: 0,
        attempts: 0,
        toolInfos: [],
        toolInfosFetchedAt: 0,
      };
      this.states.set(serverId, state);
    }
    return state;
  }

  private async dropRuntime(serverId: string): Promise<void> {
    const state = this.states.get(serverId);
    if (!state?.runtime) {
      return;
    }
    const { client } = state.runtime;
    state.runtime = null;
    await client.close().catch(() => undefined);
  }
}

function newStatus(serverId: string): McpServerStatus {
  return { serverId, state: 'disconnected', toolCount: 0, latencyMs: null, lastError: null, lastConnectedAt: null };
}
