import type { ToolRiskClass } from '@shared/turns';

export type CommandKind = 'tool' | 'app' | 'web' | 'builtin' | 'custom' | 'http' | 'prompt';

export type CommandCategory = 'apps' | 'tools' | 'web' | 'navigation' | 'custom' | 'integrations';

export type CommandSource = 'native' | 'mcp' | 'app' | 'system' | 'user' | 'integration' | 'prompt';

/** Who triggered an invocation — palette (user), the agent (D9), a hotkey, or an MCP prompt. */
export type CommandInvocationSource = 'palette' | 'agent' | 'hotkey' | 'prompt';

export interface CommandScopes {
  palette: boolean;
  agent: boolean;
}

export interface CommandArgSpec {
  name: string;
  description?: string;
  required: boolean;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array';
  enumValues?: string[];
  defaultValue?: string;
}

export const BUILTIN_ACTIONS = [
  'nav:new-conversation',
  'nav:toggle-expand',
  'nav:open-desktop',
  'nav:open-settings',
  'nav:hide-launcher',
  'nav:quit',
  'nav:clear-conversation',
  'nav:delete-conversation',
  'nav:export-conversation',
  'nav:duplicate-conversation',
  'miniapp:command',
  'calc:evaluate',
  'files:search',
  'research:start',
  'miniapp:run-start',
] as const;

export type BuiltinAction = (typeof BUILTIN_ACTIONS)[number];

export function isBuiltinAction(value: unknown): value is BuiltinAction {
  return typeof value === 'string' && (BUILTIN_ACTIONS as readonly string[]).includes(value);
}

export interface CommandEntry {
  id: string;
  kind: CommandKind;
  title: string;
  /** The use case, shown under the title in the palette. */
  subtitle?: string;
  category: CommandCategory;
  /** Lucide icon name; the renderer maps it. Absent → category default. */
  icon?: string;
  aliases: string[];
  slash?: string;
  keywords?: string[];
  risk?: ToolRiskClass;
  source: CommandSource;
  scopes: CommandScopes;
  args: CommandArgSpec[];
  /** Present when kind === 'builtin'. */
  action?: BuiltinAction;
  /** Present when kind === 'tool'. */
  toolName?: string;
  /** Present when kind === 'prompt' (plan 43 S3): the MCP prompt + owning app. */
  promptName?: string;
  appId?: string;
  /** Unavailable right now (e.g. app server down) — grey out / hide in the palette. */
  disabled?: boolean;
  /** Tagged beta (`@shared/beta`) — the palette renders a chip beside the title. */
  beta?: boolean;
}

/** One recorded command use — the newest invocation per command id. */
export interface CommandUse {
  id: string;
  /** Epoch ms of the newest invocation (the palette's recency window reads it). */
  usedAt: number;
  /**
   * Total invocations recorded for this command (frecency). Optional so a
   * snapshot from an older profile or a test fixture stays valid; absent
   * counts as zero.
   */
  count?: number;
}

export interface CommandCatalogSnapshot {
  entries: CommandEntry[];
  /** Newest use per command id (empty when history is off or nothing ran). */
  recent: CommandUse[];
  pins: string[];
}

export type CommandOutcome =
  | { status: 'done'; text?: string; conversationId?: string }
  | { status: 'turn'; direct?: DirectTurnTool; prompt?: string; flow?: 'research' }
  | { status: 'error'; error: string };

/** A validated direct tool request built in main (custom tool wrappers, plan 14 §5). */
export interface DirectTurnTool {
  name: string;
  args: Record<string, unknown>;
}

export interface CommandRecord {
  commandId: string;
  kind: CommandKind;
  source: CommandInvocationSource;
  ok: boolean;
  /** Arg values recorded only for read-only kinds (plan 14 D4). */
  args?: Record<string, unknown>;
}

/** A launchable application found by AppDiscoveryService (plan 14 §3). */
export interface DiscoveredApp {
  /** Stable id (desktop-entry id / bundle name / Start-Menu title). */
  id: string;
  title: string;
  comment?: string;
  categories?: string[];
  /** Icon name or absolute path — resolved lazily via `commands:get-app-icon`. */
  iconRef?: string;
  keywords?: string[];
  launchSpec: AppLaunchSpec;
}

export type AppLaunchSpec =
  | { type: 'gtk-launch'; id: string }
  | { type: 'open-a'; name: string; path: string }
  | { type: 'start'; target: string };
