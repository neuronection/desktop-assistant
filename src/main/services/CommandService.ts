import type {
  CommandCatalogSnapshot,
  CommandEntry,
  CommandInvocationSource,
  CommandOutcome,
  CommandRecord,
  DiscoveredApp,
} from '@shared/commands';
import type { CommandsSettings, CustomCommandDef } from '@shared/config/AppConfig';
import type { NativeToolDefinition } from '@main/ai/tools/types';
import type { WrappedCommandTool } from '@main/ai/tools/command-tools';
import type { ToolRiskClass } from '@shared/turns';
import {
  buildAgentCommandTools,
  clearCommandHistory,
  commandAgentBridgeEntries,
  executeCommand,
  flushCommandHistory,
  pruneCommandHistory,
  recentCommandIds,
  recordCommand,
} from './commands/execution';
import { commandList } from './commands/catalog';
import { deleteCustomCommand, importIntegrationPack, removeIntegrationPack, saveCustomCommand, validateStoredIntegrations } from './commands/parser';

export interface CommandHistoryClient {
  commandInvocation: {
    create(args: {
      data: { commandId: string; kind: string; source: string; args?: unknown; outcome: string };
    }): Promise<unknown>;
    findMany(args: {
      orderBy: { createdAt: 'desc' };
      take: number;
      select: { commandId: true };
    }): Promise<Array<{ commandId: string }>>;
    deleteMany(args?: { where?: { createdAt?: { lt: Date } } }): Promise<{ count: number }>;
  };
}

export interface BuiltinActionHandlers {
  newConversation(): void;
  toggleExpand(): void;
  openDesktop(): void;
  openSettings(): void;
  hideLauncher(): void;
  quit(): void;
}

export interface CommandServiceDeps {
  client: CommandHistoryClient | null;
  config(): CommandsSettings;
  updateCommands?(patch: Partial<CommandsSettings>): Promise<void>;
  toolCatalog(): NativeToolDefinition[];
  isToolDisabled(name: string): boolean;
  grantedRoots(): string[];
  actions: BuiltinActionHandlers;
  /** Cached discovered apps (AppDiscoveryService.getApps) — plan 14 §3. */
  apps?(): DiscoveredApp[];
  launchApp?(id: string): Promise<void>;
  /** Direct execution for agent-invoked custom wrappers (post-approval, plan 14 §7). */
  executeDirectTool?(name: string, args: unknown): Promise<{ ok: boolean; text: string; images?: string[]; durationMs: number }>;
  /** Enabled app tools for the palette catalog (plan 15 S6 — source `mcp`, grouped per app). */
  appTools?(): { name: string; title: string; subtitle: string; risk: ToolRiskClass; slash: string; available: boolean }[];
  /** Keyring access for `${secret:…}` integration header refs (plan 14 §5). */
  storeSecret?(key: string, value: string): Promise<void>;
  resolveSecret?(key: string): Promise<string | null>;
  deleteSecret?(key: string): Promise<void>;
  httpFetch?(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; text: string }>;
  /** Runnable assessment packs + bundled surface packs for the palette (plan 26 S8 — launcher run starts; surface gating). */
  miniAppPacks?(): { id: string; kind: 'assessment' | 'surface'; title: string; description: string; enabled: boolean; commands?: string[]; sandboxed?: boolean }[];
  /** Picks a root (main-side dialog) and starts the run; resolves with the run's conversation (plan 26 S8). */
  startMiniAppRun?(packId: string): Promise<{ ok: true; text: string; conversationId: string | null } | { ok: false; error: string }>;
  /** Executes a Tier-2 sandboxed pack's declared command through the capability RPC (plan 32 S3 / ADR-0030). */
  executeMiniAppCommand?(packId: string, commandId: string, args: string[]): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  /** MCP prompt templates as palette rows (plan 43 S3). */
  promptEntries?(): {
    appId: string;
    appName: string;
    name: string;
    title: string;
    description: string;
    arguments: { name: string; description?: string; required: boolean }[];
  }[];
  /** Expand a prompt template into a turn prompt (plan 43 S3). */
  expandPrompt?(
    appId: string,
    name: string,
    args: Record<string, string>
  ): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
}

/**
 * Public command facade (plan 45 S3): the call surface is unchanged;
 * catalog assembly lives in `commands/catalog.ts`, definition
 * intake/validation in `commands/parser.ts`, invocation + history +
 * the agent bridge in `commands/execution.ts`.
 */
export class CommandService {
  private readonly pendingWrites = new Set<Promise<unknown>>();

  constructor(private readonly deps: CommandServiceDeps) {}

  /** Assembled catalog (hidden entries and the kill switch applied). */
  list(): CommandEntry[] {
    return commandList(this.deps);
  }

  async snapshot(): Promise<CommandCatalogSnapshot> {
    const config = this.deps.config();
    return {
      entries: this.list(),
      recentIds: config.history.enabled ? await this.recentIds() : [],
      pins: [...config.pins],
    };
  }

  async execute(commandId: string, argv: string[], source: CommandInvocationSource): Promise<CommandOutcome> {
    return executeCommand(this.deps, this.pendingWrites, commandId, argv, source);
  }

  /** History hook for the turn path (tool-backed commands ride `ai:turn-start`). */
  record(record: CommandRecord): void {
    recordCommand(this.deps, this.pendingWrites, record);
  }

  /** Resolves when all in-flight history writes settle (boot/test sync point). */
  async flushHistory(): Promise<void> {
    return flushCommandHistory(this.pendingWrites);
  }

  async recentIds(limit = 5): Promise<string[]> {
    return recentCommandIds(this.deps, limit);
  }

  async clearHistory(): Promise<void> {
    return clearCommandHistory(this.deps);
  }

  async pruneHistory(): Promise<number> {
    return pruneCommandHistory(this.deps);
  }

  /** Saves a user-authored custom command after main-side validation (plan 14 §5). */
  async saveCustom(def: CustomCommandDef): Promise<{ ok: boolean; error?: string }> {
    return saveCustomCommand(this.deps, def);
  }

  async deleteCustom(id: string): Promise<boolean> {
    return deleteCustomCommand(this.deps, id);
  }

  async importPack(json: string, secrets: Record<string, string>): Promise<{ ok: boolean; error?: string; packId?: string }> {
    return importIntegrationPack(this.deps, json, secrets);
  }

  async removePack(packId: string): Promise<boolean> {
    return removeIntegrationPack(this.deps, packId);
  }

  /** Boot-time revalidation (D10): invalid stored packs self-disable with a surfaced reason. */
  async validateStoredIntegrations(): Promise<string[]> {
    return validateStoredIntegrations(this.deps);
  }

  /** Agent-scoped, bridgeable entries (plan 14 D9) — native tools/prompt-kind never bridge. */
  agentBridgeEntries(): CommandEntry[] {
    return commandAgentBridgeEntries(this.deps);
  }

  /** LangChain tools for the agent bridge (plan 14 §7). */
  buildAgentTools(): WrappedCommandTool[] {
    return buildAgentCommandTools(this.deps, this.pendingWrites);
  }
}
