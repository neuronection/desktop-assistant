import type { ToolParameterInfo, ToolRiskClass, ToolVerificationSettings } from './turns';

/** Agent-side prefix of every namespaced MCP tool (`mcp__<server>__<tool>`). */
export const MCP_TOOL_PREFIX = 'mcp__';

export type McpTransportConfig =
  | { type: 'stdio'; command: string; args?: string[] }
  | { type: 'http'; url: string }
  | { type: 'sse'; url: string };

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransportConfig;
  enabled: boolean;
  /** When set, only these tool names load from the server. */
  allowlist?: string[];
  /** 'deny' → tools load only when allowlisted (default 'allow'). */
  defaultAction: 'allow' | 'deny';
  /** Per-server tool-call timeout (default 30s). */
  timeoutMs?: number;
  /** Max in-flight calls to this server (default 4). */
  maxConcurrent?: number;
}

/** Per-tool settings keyed by the namespaced tool name. */
export interface McpToolOverride {
  enabled?: boolean;
  /** Defaults to 'state-changing' — remote tools never auto-run. */
  risk?: ToolRiskClass;
}

export type McpServerState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpServerStatus {
  serverId: string;
  state: McpServerState;
  toolCount: number;
  latencyMs?: number | null;
  lastError?: string | null;
  lastConnectedAt?: number | null;
}

/** Wire shape for the settings UI — secrets never cross back (masked pattern). */
export interface McpServerView {
  config: McpServerConfig;
  envKeys: string[];
  headerKeys: string[];
  status: McpServerStatus;
}

/** Renderer → main save payload: the only path secret values may travel. */
export interface McpServerSaveInput extends McpServerConfig {
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface McpTestResult {
  ok: boolean;
  latencyMs?: number;
  toolCount?: number;
  error?: string;
}

/** One live tool of a server, as shown in the Tools settings. */
export interface McpToolInfo {
  /** Server-side tool name. */
  rawName: string;
  /** Namespaced agent-side name (`mcp__<server>__<tool>`). */
  namespaced: string;
  description: string;
  parameters: ToolParameterInfo[];
  /** Effective risk (override or the 'state-changing' default). */
  risk: ToolRiskClass;
  /** Effective run state: tool override enabled + allowlist + kill switch. */
  enabled: boolean;
  verification: ToolVerificationSettings;
}
