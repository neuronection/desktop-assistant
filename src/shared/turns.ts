import type { Attachment } from './types';

export type TurnPhase =
  | 'queued'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'interrupt'
  | 'streaming'
  | 'finished'
  | 'failed'
  | 'cancelled';

export type ToolRiskClass = 'read-only' | 'state-changing' | 'destructive';

/** Functional grouping shown in the Tools settings (filter + icon). */
export type ToolCategory = 'files' | 'system' | 'desktop' | 'network' | 'power' | 'memory';

/**
 * Class-level default verification (Tools settings). Applies to every
 * tool of that risk class without a per-tool override. Destructive
 * tools are intentionally not configurable — they always confirm.
 */
export interface ToolClassDefaults {
  readOnly?: 'run' | 'always_ask';
  stateChanging?: 'standard' | 'never' | 'always_ask';
}

/** Per-tool verification override (Settings → Tools). */
export type ToolVerificationMode = 'standard' | 'always_ask' | 'conditions' | 'never';

/**
 * One scenario row of a `conditions` verification rule: approval is
 * required only when ANY condition matches the call arguments.
 */
export interface ToolVerificationCondition {
  param: string;
  operator: 'present' | 'absent' | 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt' | 'matches';
  value?: string;
}

export interface ToolVerificationSettings {
  mode: ToolVerificationMode;
  conditions?: ToolVerificationCondition[];
}

export const DEFAULT_VERIFICATION: ToolVerificationSettings = { mode: 'standard' };

/** Flattened parameter metadata for the settings UI (from the zod schema). */
export interface ToolParameterInfo {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enumValues?: string[];
  defaultValue?: string;
}

/** Scope of a user grant for a state-changing/destructive tool. */
export type ToolGrantScope = 'once' | 'session' | 'always';

export type ApprovalDecisionType = 'approve' | 'edit' | 'reject';

export interface ApprovalRequest {
  /** Renderer key; matches the order index of the request in the batch. */
  id: string;
  toolName: string;
  args: unknown;
  summary: string;
  risk: ToolRiskClass;
  allowedDecisions: ApprovalDecisionType[];
}

/** One decision, aligned by index with the `ApprovalRequest` batch. */
export type ApprovalDecision =
  | { type: 'approve' }
  | { type: 'edit'; name: string; args: unknown }
  | { type: 'reject'; message?: string };

export interface ApprovalResolution {
  decisions: ApprovalDecision[];
  /** Grant scope applied to approved tools (session lives in memory, always persists). */
  grant?: ToolGrantScope;
}

export interface TurnInterruptPayload {
  requests: ApprovalRequest[];
  /** Absolute epoch ms when main auto-denies the batch. */
  deadline: number;
}

/** Settings-facing catalog row (native tools; MCP tools live in `McpToolInfo`). */
export interface ToolCatalogEntry {
  name: string;
  description: string;
  risk: ToolRiskClass;
  category: ToolCategory;
  editableArgs: boolean;
  enabled: boolean;
  /** Persistent "always allow" grant is active. */
  granted: boolean;
  source: 'native' | 'mcp';
  parameters: ToolParameterInfo[];
  /** Effective verification settings (override, else class default, else standard). */
  verification: ToolVerificationSettings;
  /** True when `verification` comes from a per-tool override. */
  verificationCustom: boolean;
}

export type TurnStepPhase = 'thinking' | 'tool_call' | 'tool_result';

export interface TurnTraceStep {
  id: string;
  phase: TurnStepPhase;
  label: string;
  toolName?: string;
  startedAt: number;
  endedAt?: number;
  summary?: string;
  detail?: unknown;
  /** Tool execution outcome (tool_result steps). */
  status?: 'ok' | 'error';
  /** Full, untruncated tool response text (tool_result steps). */
  response?: string;
  /** The stored result carries images the renderer can open (tool_result steps). */
  hasImages?: boolean;
  /** Graph node this step belongs to (plan 13 node telemetry). */
  node?: string;
  /** True when this step replays a checkpointed node after resume. */
  resumed?: boolean;
}

export type NodeOutcome = 'done' | 'failed' | 'interrupted';

/** Node-level telemetry payload riding the turn envelope (plan 13 D2). */
export interface TurnNodeEvent {
  node: string;
  label: string;
  /** Present on node_finished; absent on node_started. */
  outcome?: NodeOutcome;
  durationMs?: number;
  resumed: boolean;
}

export interface DirectToolRequest {
  name: string;
  args: Record<string, unknown>;
  /** Palette command id when the direct call originated from the command palette (history attribution). */
  commandId?: string;
}

/** Payload behind the on-demand tool-result viewer (`tools:get-result`). */
export interface ToolResultView {
  /** Trace-step id the result belongs to (`tool_<callId>`). */
  callId: string;
  tool: string;
  status: 'ok' | 'error';
  text: string;
  /** Data URLs (`data:image/…;base64,…`) rendered as images only. */
  images: string[];
}

export interface TurnStartRequest {
  conversationId: string;
  content: string;
  attachments?: Attachment[];
  /** Per-conversation override; empty → main resolves the chat-task model. */
  modelId?: string;
  providerId?: string;
  /** Slash-command direct tool invocation (same policy path, no model call). */
  directTool?: DirectToolRequest;
}

export interface TurnMetadata {
  outcome: 'ok' | 'failed' | 'cancelled';
  model?: string;
  durationMs?: number;
  steps?: TurnTraceStep[];
  /** Total tool calls in the turn, even when `steps` was capped. */
  toolCount?: number;
}

export interface TurnEvent {
  tempMessageId: string;
  conversationId: string;
  seq: number;
  phase: TurnPhase;
  delta?: string;
  step?: TurnTraceStep;
  steps?: TurnTraceStep[];
  error?: string;
  model?: string;
  durationMs?: number;
  interrupt?: TurnInterruptPayload;
  node?: TurnNodeEvent;
}

export type TurnOutcome =
  | { phase: 'finished'; conversationId: string }
  | { phase: 'failed'; conversationId: string; error: string }
  | { phase: 'cancelled'; conversationId: string };
