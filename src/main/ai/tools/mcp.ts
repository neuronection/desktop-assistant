import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { tool as lcTool } from 'langchain';
import { z } from 'zod';
import type {
  McpContentErrorCode,
  McpPromptArgument,
  McpPromptContent,
  McpPromptInfo,
  McpResourceContent,
  McpResourceInfo,
  McpServerConfig,
  McpServerStatus,
  McpToolInfo,
  McpToolOverride,
} from '@shared/mcp';
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
  /** Completed invocation of a non-read-only tool (plan 23 D13 stale-guard). */
  onToolResult?(serverId: string, risk: ToolRiskClass): void;
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
  /** Last successful resource/prompt listing (plan 43 S2). */
  resourceInfos: McpResourceInfo[];
  promptInfos: McpPromptInfo[];
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

/** Per-read resource budget (plan 43 D2): 8 KB default, configurable. */
export const MCP_CONTENT_DEFAULT_MAX_BYTES = 8_192;
const MCP_CONTENT_NAME_CAP = 200;
const MCP_CONTENT_DESCRIPTION_CAP = 500;
const MCP_CONTENT_MESSAGE_CAP = 20_000;

/** Typed content error over the MCP JSON-RPC taxonomy (plan 43 S1). */
export class McpContentError extends Error {
  readonly code: McpContentErrorCode;

  constructor(code: McpContentErrorCode, message: string) {
    super(message);
    this.name = 'McpContentError';
    this.code = code;
  }
}

/** Map an SDK `McpError` (JSON-RPC `code`) or schema rejection onto the vocabulary. */
export function classifyMcpContentError(error: unknown): McpContentErrorCode {
  const candidate = error as { code?: unknown; name?: unknown; issues?: unknown };
  if (candidate?.name === 'ZodError' || Array.isArray(candidate?.issues)) {
    return 'invalid-params';
  }
  switch (candidate?.code) {
    case -32601:
      return 'method-not-found';
    case -32602:
      return 'invalid-params';
    case -32600:
      return 'invalid-request';
    case -32000:
      return 'connection-closed';
    case -32001:
      return 'request-timeout';
    case -32700:
      return 'parse';
    case -32603:
      return 'internal';
    default:
      return 'unknown';
  }
}

function truncateBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }
  let out = '';
  let bytes = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > maxBytes) {
      break;
    }
    out += char;
    bytes += size;
  }
  return out;
}

/** Drop malformed resource entries; cap names/descriptions (hostile-fixture posture). */
function normalizeResource(entry: unknown): McpResourceInfo[] {
  if (!entry || typeof entry !== 'object') {
    return [];
  }
  const record = entry as Record<string, unknown>;
  const uri = typeof record.uri === 'string' ? record.uri.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!uri || !name) {
    return [];
  }
  return [
    {
      uri: truncateText(uri, MCP_CONTENT_NAME_CAP),
      name: truncateText(name, MCP_CONTENT_NAME_CAP),
      ...(typeof record.description === 'string'
        ? { description: truncateText(record.description, MCP_CONTENT_DESCRIPTION_CAP) }
        : {}),
      ...(typeof record.mimeType === 'string' ? { mimeType: record.mimeType } : {}),
      ...(typeof record.size === 'number' && Number.isFinite(record.size) ? { size: record.size } : {}),
    },
  ];
}

/** Drop malformed prompt entries; coerce arguments (hostile-fixture posture). */
function normalizePrompt(entry: unknown): McpPromptInfo[] {
  if (!entry || typeof entry !== 'object') {
    return [];
  }
  const record = entry as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) {
    return [];
  }
  const rawArguments = Array.isArray(record.arguments) ? record.arguments : [];
  const args: McpPromptArgument[] = [];
  for (const candidate of rawArguments) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    const arg = candidate as Record<string, unknown>;
    const argName = typeof arg.name === 'string' ? arg.name.trim() : '';
    if (!argName) {
      continue;
    }
    args.push({
      name: truncateText(argName, MCP_CONTENT_NAME_CAP),
      required: arg.required === true,
      ...(typeof arg.description === 'string'
        ? { description: truncateText(arg.description, MCP_CONTENT_DESCRIPTION_CAP) }
        : {}),
    });
  }
  return [
    {
      name: truncateText(name, MCP_CONTENT_NAME_CAP),
      arguments: args,
      ...(typeof record.title === 'string' ? { title: truncateText(record.title, MCP_CONTENT_NAME_CAP) } : {}),
      ...(typeof record.description === 'string'
        ? { description: truncateText(record.description, MCP_CONTENT_DESCRIPTION_CAP) }
        : {}),
    },
  ];
}

function messageTextOf(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content.flatMap((part) => {
      const text = messageTextOf(part);
      return text === null ? [] : [text];
    });
    return parts.join('');
  }
  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;
    if (typeof record.text === 'string') {
      return record.text;
    }
  }
  return null;
}

function normalizePromptMessage(entry: unknown): { role: 'user' | 'assistant'; text: string } | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : null;
  if (!role) {
    return null;
  }
  const text = messageTextOf(record.content);
  if (text === null) {
    return null;
  }
  return { role, text: truncateText(text, MCP_CONTENT_MESSAGE_CAP) };
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
        tool: this.wrapTool(server, state, namespaced, raw, override?.risk ?? 'state-changing'),
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

  private async ensureRuntime(server: McpServerConfig): Promise<ClientRuntime> {
    const state = this.stateFor(server.id);
    if (!state.runtime) {
      const secrets = await this.deps.readSecrets(server.id);
      const client = await this.createClient(server, secrets);
      state.runtime = { client, active: 0, waiters: [] };
    }
    return state.runtime;
  }

  private async connectAndGetTools(server: McpServerConfig): Promise<StructuredToolInterface[]> {
    const state = this.stateFor(server.id);
    try {
      const runtime = await this.ensureRuntime(server);
      const tools = await runtime.client.getTools();
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

  /**
   * Resource/prompt access shares the tool path's health/backoff/caps
   * discipline: the runtime is reused (one client per server), a backoff
   * window short-circuits, and every failure updates the server status and
   * throws a typed `McpContentError`.
   */
  private async withContentClient<T>(
    server: McpServerConfig,
    fn: (client: NonNullable<Awaited<ReturnType<MultiServerMCPClient['getClient']>>>) => Promise<T>
  ): Promise<T> {
    const state = this.stateFor(server.id);
    if (state.nextAttemptAt > this.now()) {
      throw new McpContentError('connection-closed', `MCP server '${server.name}' is reconnecting (backoff).`);
    }
    try {
      const runtime = await this.ensureRuntime(server);
      const client = await runtime.client.getClient(server.name);
      if (!client) {
        throw new McpContentError('connection-closed', `MCP server '${server.name}' has no live client.`);
      }
      const result = await fn(client);
      state.status.state = 'connected';
      state.status.lastConnectedAt = this.now();
      state.status.lastError = null;
      state.attempts = 0;
      state.nextAttemptAt = 0;
      return result;
    } catch (error) {
      if (error instanceof McpContentError) {
        throw error;
      }
      const code = classifyMcpContentError(error);
      // Protocol errors (a server answered with an error or a schema
      // mismatch) are not connection failures — keep the runtime and
      // surface the typed error. Only transport-level failures drop the
      // runtime and open a backoff window.
      const connectionFatal = code === 'connection-closed' || code === 'request-timeout' || code === 'unknown';
      if (!connectionFatal) {
        throw new McpContentError(code, connectionErrorText(error));
      }
      state.status.state = 'error';
      state.status.lastError = connectionErrorText(error);
      state.attempts += 1;
      state.nextAttemptAt = this.now() + Math.min(MCP_BACKOFF_CAP_MS, MCP_BACKOFF_BASE_MS * 2 ** state.attempts);
      await this.dropRuntime(server.id);
      throw new McpContentError(code, connectionErrorText(error));
    }
  }

  /** List a server's resources; malformed entries are dropped, not surfaced. */
  async listResources(server: McpServerConfig): Promise<McpResourceInfo[]> {
    const result = await this.withContentClient(server, (client) => client.listResources());
    const raw = (result as { resources?: unknown }).resources;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.flatMap((entry) => normalizeResource(entry));
  }

  /** Read one resource, capped to `maxBytes` (the per-read budget). */
  async readResource(
    server: McpServerConfig,
    uri: string,
    maxBytes: number = MCP_CONTENT_DEFAULT_MAX_BYTES
  ): Promise<McpResourceContent> {
    const result = await this.withContentClient(server, (client) => client.readResource({ uri }));
    const contents = (result as { contents?: unknown }).contents;
    if (!Array.isArray(contents) || contents.length === 0) {
      throw new McpContentError('invalid-params', `Resource '${uri}' returned no content.`);
    }
    const textEntry = contents.find(
      (entry) => entry && typeof entry === 'object' && typeof (entry as { text?: unknown }).text === 'string'
    ) as { text: string; mimeType?: unknown } | undefined;
    if (!textEntry) {
      throw new McpContentError('invalid-params', `Resource '${uri}' has no text content.`);
    }
    const full = textEntry.text;
    const truncated = Buffer.byteLength(full, 'utf8') > maxBytes;
    return {
      uri,
      text: truncated ? truncateBytes(full, maxBytes) : full,
      truncated,
      ...(typeof textEntry.mimeType === 'string' ? { mimeType: textEntry.mimeType } : {}),
    };
  }

  /** List a server's prompt templates; malformed entries are dropped. */
  async listPrompts(server: McpServerConfig): Promise<McpPromptInfo[]> {
    const result = await this.withContentClient(server, (client) => client.listPrompts());
    const raw = (result as { prompts?: unknown }).prompts;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.flatMap((entry) => normalizePrompt(entry));
  }

  /** Expand one prompt template with its arguments (text only). */
  async getPrompt(
    server: McpServerConfig,
    name: string,
    args: Record<string, string> = {}
  ): Promise<McpPromptContent> {
    const result = await this.withContentClient(server, (client) => client.getPrompt({ name, arguments: args }));
    const messages = (result as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) {
      throw new McpContentError('invalid-params', `Prompt '${name}' returned no messages.`);
    }
    const mapped = messages.flatMap((entry) => {
      const message = normalizePromptMessage(entry);
      return message ? [message] : [];
    });
    if (mapped.length === 0) {
      throw new McpContentError('invalid-params', `Prompt '${name}' returned no usable messages.`);
    }
    return {
      messages: mapped,
      ...(typeof (result as { description?: unknown }).description === 'string'
        ? { description: truncateText((result as { description: string }).description, MCP_CONTENT_DESCRIPTION_CAP) }
        : {}),
    };
  }

  /**
   * Settings path (plan 43 S2): list a server's resources + prompts and cache
   * them for the Apps-tab counts. A server that lacks the capability returns
   * empty lists (not an error).
   */
  async listServerContent(server: McpServerConfig): Promise<{ resources: McpResourceInfo[]; prompts: McpPromptInfo[] }> {
    const [resources, prompts] = await Promise.all([
      this.listResources(server).catch(() => [] as McpResourceInfo[]),
      this.listPrompts(server).catch(() => [] as McpPromptInfo[]),
    ]);
    const state = this.stateFor(server.id);
    state.resourceInfos = resources;
    state.promptInfos = prompts;
    return { resources, prompts };
  }

  /** Last known resource/prompt listing for a server (empty until fetched). */
  cachedContentFor(serverId: string): { resources: McpResourceInfo[]; prompts: McpPromptInfo[] } {
    const state = this.states.get(serverId);
    return { resources: state?.resourceInfos ?? [], prompts: state?.promptInfos ?? [] };
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
    raw: StructuredToolInterface,
    risk: ToolRiskClass
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
            this.deps.onToolResult?.(server.id, risk);
            return `Error (${namespacedName}): ${truncateText((error as Error).message ?? String(error), 500)}`;
          }
          if (risk !== 'read-only') {
            this.deps.onToolResult?.(server.id, risk);
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
        resourceInfos: [],
        promptInfos: [],
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
