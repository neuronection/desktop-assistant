import { z } from 'zod';
import type {
  BuiltinAction,
  CommandArgSpec,
  CommandCatalogSnapshot,
  CommandEntry,
  CommandInvocationSource,
  CommandOutcome,
  CommandRecord,
  DiscoveredApp,
} from '@shared/commands';
import {
  evaluateExpression,
  formatCalcResult,
  isSecretRef,
  manifestCommandArity,
  manifestSecretRefs,
  secretRefKey,
  substituteTemplate,
} from '@shared/commands';
import { interpolate, TEXT } from '@shared/constants/text';
import type { CommandsSettings, CustomCommandDef, IntegrationCommandDef, IntegrationPackConfig } from '@shared/config/AppConfig';
import type { NativeToolDefinition } from '@main/ai/tools/types';
import { globToRegex, newBudget, walkRoot } from '@main/ai/tools/native/file-search';
import { TOOL_SLASH_ALIASES } from '@shared/commands/toolAliases';
import { buildCommandTools, type WrappedCommandTool } from '@main/ai/tools/command-tools';

export interface CommandHistoryClient {
  commandInvocation: {
    create(args: {
      data: { commandId: string; kind: string; source: string; args?: string; outcome: string };
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
  /** Keyring access for `${secret:…}` integration header refs (plan 14 §5). */
  storeSecret?(key: string, value: string): Promise<void>;
  resolveSecret?(key: string): Promise<string | null>;
  deleteSecret?(key: string): Promise<void>;
  httpFetch?(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; text: string }>;
}

const FILE_SEARCH_LIMIT = 50;

function normalizeAliasWord(alias: string): string {
  return alias.replace(/^\//, '').toLowerCase();
}

function wordTokens(text: string | undefined): string[] {
  if (!text) {
    return [];
  }
  return text.split(/[^a-zA-Z0-9]+/).filter((token) => token.length > 1);
}

const TOOL_ALIASES = TOOL_SLASH_ALIASES;

const TOOL_ICONS: Record<string, string> = {
  screen_capture: 'camera',
  run_shell: 'terminal',
  open_url: 'globe',
  open_path: 'folder-open',
  open_app: 'app-window',
  web_search: 'search',
  web_fetch: 'download',
  find_files: 'file-search',
  grep_files: 'text-search',
  list_apps: 'layout-list',
  list_dir: 'folder',
  read_file: 'file-text',
  file_create: 'file-plus',
  file_write: 'pencil',
  file_delete: 'file-x',
  file_move: 'folder-input',
  clipboard_read: 'clipboard-copy',
  clipboard_write: 'clipboard-check',
  memory_save: 'brain',
  memory_search: 'brain',
  memory_list: 'list',
  memory_forget: 'eraser',
  system_info: 'cpu',
  process_list: 'activity',
  kill_process: 'skull',
  media_controls: 'play',
  volume_set: 'volume-2',
  notify: 'bell',
};

const TOOL_CATEGORY_OVERRIDES: Partial<Record<NativeToolDefinition['category'], CommandEntry['category']>> & Record<string, CommandEntry['category']> = {
  web_search: 'web',
  web_fetch: 'web',
  open_url: 'web',
};

function prettifyToolName(name: string): string {
  const words = name.split('_').filter(Boolean);
  const first = words[0] ?? name;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join(' ');
}

function unwrapZod(schema: z.ZodTypeAny): { schema: z.ZodTypeAny; optional: boolean; defaultValue?: string } {
  let current = schema;
  let optional = false;
  let defaultValue: string | undefined;
  for (let depth = 0; depth < 8; depth += 1) {
    const def = current._def as { typeName: string; innerType?: z.ZodTypeAny; defaultValue?: () => unknown };
    if (def.typeName === 'ZodOptional' || def.typeName === 'ZodNullable') {
      optional = true;
      current = def.innerType as z.ZodTypeAny;
      continue;
    }
    if (def.typeName === 'ZodDefault') {
      optional = true;
      try {
        defaultValue = JSON.stringify(def.defaultValue?.()) ?? undefined;
      } catch {
        defaultValue = undefined;
      }
      current = def.innerType as z.ZodTypeAny;
      continue;
    }
    break;
  }
  return { schema: current, optional, defaultValue: defaultValue?.slice(0, 120) };
}

function describeArg(schema: z.ZodTypeAny): Omit<CommandArgSpec, 'name'> {
  const { schema: inner, optional, defaultValue } = unwrapZod(schema);
  const def = inner._def as { typeName: string; values?: unknown[] };
  const base = {
    description: inner.description,
    required: !optional,
    defaultValue,
  };
  switch (def.typeName) {
    case 'ZodNumber':
      return { ...base, type: 'number' };
    case 'ZodBoolean':
      return { ...base, type: 'boolean' };
    case 'ZodEnum':
      return { ...base, type: 'enum', enumValues: (def.values ?? []).map((value) => String(value)) };
    default:
      return { ...base, type: 'string' };
  }
}

export function argsFromSchema(schema: z.ZodTypeAny): CommandArgSpec[] {
  const { schema: inner } = unwrapZod(schema);
  if (!(inner instanceof z.ZodObject)) {
    return [];
  }
  return Object.entries(inner.shape).map(([name, value]) => ({
    name,
    ...describeArg(value as z.ZodTypeAny),
  }));
}

export class CommandService {
  private readonly pendingWrites = new Set<Promise<unknown>>();

  constructor(private readonly deps: CommandServiceDeps) {}

  /** Assembled catalog (hidden entries and the kill switch applied). */
  list(): CommandEntry[] {
    const config = this.deps.config();
    if (!config.enabled) {
      return [];
    }
    const hidden = new Set(config.hidden);
    return [...this.builtinEntries(), ...this.customEntries(), ...this.packEntries(), ...this.appEntries(), ...this.toolEntries()]
      .filter((entry) => !hidden.has(entry.id))
      .map((entry) => this.withExtraAliases(entry, config));
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
    const config = this.deps.config();
    if (!config.enabled) {
      return { status: 'error', error: 'Commands are disabled.' };
    }
    const entry = this.list().find((candidate) => candidate.id === commandId);
    if (!entry) {
      return { status: 'error', error: `Unknown command '${commandId}'.` };
    }
    let outcome: CommandOutcome;
    if (entry.kind === 'tool') {
      outcome = { status: 'turn' };
    } else if (entry.kind === 'builtin') {
      outcome = await this.dispatchBuiltin(entry.action as BuiltinAction, argv);
    } else if (entry.kind === 'app') {
      if (!this.deps.launchApp) {
        outcome = { status: 'error', error: 'App launching is not available.' };
      } else {
        await this.deps.launchApp(entry.id.slice('app:'.length));
        outcome = { status: 'done', text: entry.title };
      }
    } else if (entry.kind === 'custom') {
      outcome = entry.id.startsWith('integration:')
        ? await this.dispatchIntegration(entry.id, argv)
        : await this.dispatchTemplated(entry.id.slice('custom:'.length), argv);
      if (source === 'agent' && outcome.status === 'turn' && outcome.direct) {
        if (!this.deps.executeDirectTool) {
          outcome = { status: 'error', error: 'Direct tool execution is unavailable.' };
        } else {
          const result = await this.deps.executeDirectTool(outcome.direct.name, outcome.direct.args);
          const note = result.images?.length ? '\n(The image was captured and shown to the user.)' : '';
          outcome = result.ok
            ? { status: 'done', text: `${result.text}${note}` }
            : { status: 'error', error: result.text };
        }
      }
    } else {
      outcome = { status: 'error', error: `Command kind '${entry.kind}' is not available yet.` };
    }
    const storesArgs =
      entry.kind === 'builtin' && (entry.action === 'calc:evaluate' || entry.action === 'files:search');
    const deferredToTurn = outcome.status === 'turn' && !outcome.prompt && source !== 'agent';
    if (!deferredToTurn) {
      void this.record({
        commandId: entry.id,
        kind: entry.kind,
        source,
        ok: outcome.status !== 'error',
        ...(storesArgs ? { args: { argv } } : {}),
      });
    }
    return outcome;
  }

  /** History hook for the turn path (tool-backed commands ride `ai:turn-start`). */
  record(record: CommandRecord): void {
    const config = this.deps.config();
    if (!config.enabled || !config.history.enabled || !this.deps.client) {
      return;
    }
    const write = this.deps.client.commandInvocation
      .create({
        data: {
          commandId: record.commandId,
          kind: record.kind,
          source: record.source,
          ...(record.args ? { args: JSON.stringify(record.args) } : {}),
          outcome: record.ok ? 'ok' : 'error',
        },
      })
      .catch(() => undefined);
    this.pendingWrites.add(write);
    void write.finally(() => this.pendingWrites.delete(write));
  }

  /** Resolves when all in-flight history writes settle (boot/test sync point). */
  async flushHistory(): Promise<void> {
    await Promise.all([...this.pendingWrites]);
  }

  async recentIds(limit = 5): Promise<string[]> {
    if (!this.deps.client) {
      return [];
    }
    const rows = await this.deps.client.commandInvocation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { commandId: true },
    });
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.commandId);
      if (seen.size >= limit) {
        break;
      }
    }
    return [...seen];
  }

  async clearHistory(): Promise<void> {
    if (!this.deps.client) {
      return;
    }
    await this.deps.client.commandInvocation.deleteMany({});
  }

  async pruneHistory(): Promise<number> {
    if (!this.deps.client) {
      return 0;
    }
    const retentionDays = this.deps.config().history.retentionDays;
    const cutoff = new Date(Date.now() - Math.max(1, retentionDays) * 86_400_000);
    const result = await this.deps.client.commandInvocation.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }

  private withExtraAliases(entry: CommandEntry, config: CommandsSettings): CommandEntry {
    // Raw editor rows — trim, strip the display slash, drop empties/dupes.
    const extra = [...new Set((config.extraAliases[entry.id] ?? [])
      .map((alias) => alias.trim().replace(/^\//, ''))
      .filter(Boolean))];
    if (extra.length === 0) {
      return entry;
    }
    // User aliases make a tool invokable from the palette (typed
    // `/alias …`), so they restore the palette scope alias-less tools
    // lose at catalog build time.
    return {
      ...entry,
      aliases: [...entry.aliases, ...extra],
      scopes: { ...entry.scopes, palette: true },
    };
  }

  private builtinEntries(): CommandEntry[] {
    const nav = (
      id: string,
      action: BuiltinAction,
      title: string,
      subtitle: string,
      icon: string,
      aliases: string[],
      keywords?: string
    ): CommandEntry => ({
      id,
      kind: 'builtin',
      title,
      subtitle,
      category: 'navigation',
      icon,
      aliases,
      keywords: keywords ? keywords.split(' ') : undefined,
      source: 'system',
      scopes: { palette: true, agent: false },
      args: [],
      action,
    });
    return [
      nav(
        'nav:new-conversation',
        'nav:new-conversation',
        TEXT.COMMAND_NEW_CONVERSATION,
        TEXT.COMMAND_NEW_CONVERSATION_SUBTITLE,
        'square-pen',
        ['new'],
        'chat'
      ),
      nav(
        'nav:toggle-expand',
        'nav:toggle-expand',
        TEXT.COMMAND_TOGGLE_EXPAND,
        TEXT.COMMAND_TOGGLE_EXPAND_SUBTITLE,
        'maximize-2',
        ['expand'],
        'size'
      ),
      nav(
        'nav:open-desktop',
        'nav:open-desktop',
        TEXT.COMMAND_OPEN_DESKTOP,
        TEXT.COMMAND_OPEN_DESKTOP_SUBTITLE,
        'monitor',
        ['desktop'],
        'window'
      ),
      nav(
        'nav:open-settings',
        'nav:open-settings',
        TEXT.COMMAND_OPEN_SETTINGS,
        TEXT.COMMAND_OPEN_SETTINGS_SUBTITLE,
        'settings',
        ['settings'],
        'preferences'
      ),
      nav(
        'nav:hide-launcher',
        'nav:hide-launcher',
        TEXT.COMMAND_HIDE,
        TEXT.COMMAND_HIDE_SUBTITLE,
        'eye-off',
        ['hide'],
        'tray'
      ),
      nav(
        'nav:quit',
        'nav:quit',
        TEXT.COMMAND_QUIT,
        TEXT.COMMAND_QUIT_SUBTITLE,
        'log-out',
        ['quit', 'exit'],
        'close'
      ),
      {
        id: 'calc:evaluate',
        kind: 'builtin',
        title: TEXT.COMMAND_CALCULATOR,
        subtitle: TEXT.COMMAND_CALCULATOR_SUBTITLE,
        category: 'tools',
        icon: 'calculator',
        aliases: ['calc'],
        slash: 'calc',
        keywords: TEXT.COMMAND_CALCULATOR_KEYWORDS.split(' '),
        source: 'system',
        scopes: { palette: true, agent: false },
        args: [{ name: 'expression', required: true, type: 'string' }],
        action: 'calc:evaluate',
      },
      {
        id: 'files:search',
        kind: 'builtin',
        title: TEXT.COMMAND_FILE_SEARCH,
        subtitle: TEXT.COMMAND_FILE_SEARCH_SUBTITLE,
        category: 'tools',
        icon: 'file-search',
        aliases: ['files'],
        slash: 'files',
        keywords: TEXT.COMMAND_FILE_SEARCH_KEYWORDS.split(' '),
        source: 'system',
        scopes: { palette: true, agent: false },
        args: [{ name: 'pattern', required: true, type: 'string' }],
        action: 'files:search',
      },
    ];
  }

  private appEntries(): CommandEntry[] {
    const config = this.deps.config();
    if (!config.apps.launchEnabled || !config.apps.discovery || !this.deps.apps) {
      return [];
    }
    const hiddenApps = new Set(config.apps.hiddenApps);
    return this.deps.apps()
      .filter((app) => !hiddenApps.has(app.id))
      .map((app) => {
        const keywords = [
          ...(app.keywords ?? []),
          ...wordTokens(app.comment),
        ];
        const titleAlias = app.title.toLowerCase();
        const firstToken = titleAlias.split(/\s+/)[0] ?? titleAlias;
        const aliases = firstToken && firstToken !== titleAlias ? [titleAlias, firstToken] : [titleAlias];
        const entry: CommandEntry = {
          id: `app:${app.id}`,
          kind: 'app',
          title: app.title,
          subtitle: app.comment ?? TEXT.COMMAND_APP_SUBTITLE,
          category: 'apps',
          icon: app.iconRef ? `app-icon:${app.id}` : undefined,
          aliases,
          source: 'app',
          scopes: { palette: true, agent: Boolean(config.agentCallable[`app:${app.id}`]) },
          args: [],
          keywords: keywords.length > 0 ? keywords : undefined,
        };
        return entry;
      });
  }

  private toolEntries(): CommandEntry[] {
    return this.deps
      .toolCatalog()
      .filter((tool) => tool.risk !== 'destructive' && !this.deps.isToolDisabled(tool.name))
      .map((tool) => {
        const aliases = TOOL_ALIASES[tool.name] ?? [];
        const entry: CommandEntry = {
          id: `tool:${tool.name}`,
          kind: 'tool',
          title: prettifyToolName(tool.name),
          subtitle: tool.description,
          category: TOOL_CATEGORY_OVERRIDES[tool.name] ?? 'tools',
          icon: TOOL_ICONS[tool.name] ?? 'wrench',
          aliases,
          slash: aliases[0],
          source: 'native',
          // Alias-less tools cannot be invoked from the palette (nothing
          // carries the arguments) — settings keeps listing them for
          // agent-scoping and management.
          scopes: { palette: aliases.length > 0, agent: false },
          args: argsFromSchema(tool.schema),
          toolName: tool.name,
        };
        if (tool.risk) {
          entry.risk = tool.risk;
        }
        return entry;
      });
  }

  private async dispatchBuiltin(action: BuiltinAction, argv: string[]): Promise<CommandOutcome> {
    switch (action) {
      case 'nav:new-conversation':
        this.deps.actions.newConversation();
        return { status: 'done' };
      case 'nav:toggle-expand':
        this.deps.actions.toggleExpand();
        return { status: 'done' };
      case 'nav:open-desktop':
        this.deps.actions.openDesktop();
        return { status: 'done' };
      case 'nav:open-settings':
        this.deps.actions.openSettings();
        return { status: 'done' };
      case 'nav:hide-launcher':
        this.deps.actions.hideLauncher();
        return { status: 'done' };
      case 'nav:quit':
        this.deps.actions.quit();
        return { status: 'done' };
      case 'calc:evaluate': {
        const expression = argv.join(' ').trim();
        if (!expression) {
          return { status: 'error', error: TEXT.COMMAND_CALC_USAGE };
        }
        const result = evaluateExpression(expression);
        if (!result.ok) {
          return { status: 'error', error: interpolate(TEXT.COMMAND_CALC_ERROR, { error: result.error }) };
        }
        return {
          status: 'done',
          text: interpolate(TEXT.COMMAND_CALC_RESULT, { value: formatCalcResult(result.value) }),
        };
      }
      case 'files:search': {
        const pattern = argv.join(' ').trim();
        if (!pattern) {
          return { status: 'error', error: TEXT.COMMAND_FILES_USAGE };
        }
        const roots = this.deps.grantedRoots();
        if (roots.length === 0) {
          return { status: 'error', error: TEXT.COMMAND_FILES_NO_ROOTS };
        }
        return searchGrantedFiles(roots, pattern);
      }
      default:
        return { status: 'error', error: `Unknown builtin '${action}'.` };
    }
  }

  private findTool(name: string): NativeToolDefinition | undefined {
    const tool = this.deps.toolCatalog().find((candidate) => candidate.name === name);
    if (!tool || tool.risk === 'destructive' || this.deps.isToolDisabled(tool.name)) {
      return undefined;
    }
    return tool;
  }

  /** Custom + pack tool wrappers: substitute placeholders, zod-validate in main (D1/D3). */
  private dispatchTemplated(defId: string, argv: string[]): Promise<CommandOutcome> {
    const def = this.deps.config().custom.find((candidate) => candidate.id === defId);
    return this.runTemplated(def, argv);
  }

  private async dispatchIntegration(entryId: string, argv: string[]): Promise<CommandOutcome> {
    const withoutPrefix = entryId.slice('integration:'.length);
    const separator = withoutPrefix.indexOf(':');
    if (separator <= 0) {
      return { status: 'error', error: `Unknown command '${entryId}'.` };
    }
    const packId = withoutPrefix.slice(0, separator);
    const commandName = withoutPrefix.slice(separator + 1);
    const pack = this.deps.config().integrations.find((candidate) => candidate.id === packId);
    if (!pack || !pack.enabled || pack.error) {
      return { status: 'error', error: `Integration '${packId}' is unavailable.` };
    }
    const def = pack.commands.find((candidate) => candidate.id === commandName);
    if (!def) {
      return { status: 'error', error: `Unknown command '${entryId}'.` };
    }
    if (def.kind === 'http') {
      return await this.runHttp(packId, def, argv);
    }
    return await this.runTemplated(def, argv);
  }

  private async runTemplated(
    def:
      | {
          kind: string;
          promptTemplate?: string;
          toolName?: string;
          argTemplate?: Record<string, string>;
        }
      | undefined,
    argv: string[]
  ): Promise<CommandOutcome> {
    if (!def) {
      return { status: 'error', error: 'Unknown command.' };
    }
    if (def.kind === 'prompt') {
      const substitution = substituteTemplate(def.promptTemplate ?? '', argv);
      if (!substitution.ok) {
        return { status: 'error', error: `Missing argument(s): ${substitution.missing.join(', ')}` };
      }
      return { status: 'turn', prompt: substitution.value };
    }
    const tool = def.toolName ? this.findTool(def.toolName) : undefined;
    if (!tool) {
      return { status: 'error', error: `Bound tool '${def.toolName ?? ''}' is unavailable.` };
    }
    const args: Record<string, unknown> = {};
    for (const [key, template] of Object.entries(def.argTemplate ?? {})) {
      const substitution = substituteTemplate(template, argv);
      if (!substitution.ok) {
        return { status: 'error', error: `Missing argument(s): ${substitution.missing.join(', ')}` };
      }
      args[key] = substitution.value;
    }
    const parse = tool.schema.safeParse(args);
    if (!parse.success) {
      return { status: 'error', error: 'Invalid arguments for the bound tool.' };
    }
    return { status: 'turn', direct: { name: tool.name, args: parse.data as Record<string, unknown> } };
  }

  private async runHttp(packId: string, def: IntegrationCommandDef, argv: string[]): Promise<CommandOutcome> {
    if (!def.urlTemplate) {
      return { status: 'error', error: 'Integration command has no URL.' };
    }
    const url = substituteTemplate(def.urlTemplate, argv);
    if (!url.ok) {
      return { status: 'error', error: `Missing argument(s): ${url.missing.join(', ')}` };
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(def.headers ?? {})) {
      if (isSecretRef(value)) {
        const key = secretRefKey(value);
        const secret = (await this.deps.resolveSecret?.(key)) ?? null;
        if (secret === null) {
          return { status: 'error', error: `Missing secret '${key}'. Re-import the integration.` };
        }
        headers[name] = secret;
        continue;
      }
      headers[name] = value;
    }
    const method = def.method ?? 'GET';
    let body: string | undefined;
    if (def.bodyTemplate) {
      const substitution = substituteTemplate(def.bodyTemplate, argv);
      if (!substitution.ok) {
        return { status: 'error', error: `Missing argument(s): ${substitution.missing.join(', ')}` };
      }
      body = substitution.value;
    }
    try {
      const response = await (this.deps.httpFetch
        ? this.deps.httpFetch(url.value, { method, headers, body })
        : (async () => {
            const result = await fetch(url.value, {
              method,
              headers,
              body,
              signal: AbortSignal.timeout(10_000),
            });
            return { status: result.status, text: (await result.text()).slice(0, 4000) };
          })());
      if (response.status >= 400) {
        return { status: 'error', error: `HTTP ${response.status}: ${response.text.slice(0, 200)}` };
      }
      return { status: 'done', text: response.text };
    } catch (error) {
      return { status: 'error', error: `Request failed: ${((error as Error).message ?? '').slice(0, 160)}` };
    }
  }

  /** Saves a user-authored custom command after main-side validation (plan 14 §5). */
  async saveCustom(def: CustomCommandDef): Promise<{ ok: boolean; error?: string }> {
    if (!this.deps.updateCommands) {
      return { ok: false, error: 'Config updates are unavailable.' };
    }
    const normalized: CustomCommandDef = {
      ...def,
      id: def.id.trim() || `custom-${Date.now().toString(36)}`,
      aliases: def.aliases.map(normalizeAliasWord),
    };
    const error = this.validateCustom(normalized);
    if (error) {
      return { ok: false, error };
    }
    const config = this.deps.config();
    const custom = [...config.custom.filter((candidate) => candidate.id !== normalized.id), normalized];
    await this.deps.updateCommands({ custom });
    return { ok: true };
  }

  async deleteCustom(id: string): Promise<boolean> {
    if (!this.deps.updateCommands) {
      return false;
    }
    const config = this.deps.config();
    if (!config.custom.some((candidate) => candidate.id === id)) {
      return false;
    }
    await this.deps.updateCommands({ custom: config.custom.filter((candidate) => candidate.id !== id) });
    return true;
  }

  private validateCustom(def: CustomCommandDef): string | null {
    if (!def.name.trim()) {
      return 'Name is required.';
    }
    if (def.kind === 'tool') {
      if (!def.toolName || !this.findTool(def.toolName)) {
        return `Tool '${def.toolName ?? ''}' is unavailable, disabled or destructive.`;
      }
      const tool = this.deps.toolCatalog().find((candidate) => candidate.name === def.toolName);
      const validKeys = new Set(tool ? Object.keys((tool.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {}) : []);
      const keys = Object.keys(def.argTemplate ?? {});
      if (keys.length === 0) {
        return 'Bind at least one tool argument.';
      }
      for (const key of keys) {
        if (!validKeys.has(key)) {
          return `Tool '${def.toolName}' has no argument '${key}'.`;
        }
      }
    } else if (def.kind === 'prompt') {
      if (!def.promptTemplate?.trim()) {
        return 'Prompt text is required.';
      }
    } else {
      return 'Unknown custom command kind.';
    }
    const systemAliases = new Set<string>(
      this.builtinEntries().flatMap((entry) => entry.aliases.map(normalizeAliasWord)).concat(['open'])
    );
    for (const alias of def.aliases) {
      if (systemAliases.has(normalizeAliasWord(alias))) {
        return `Alias '${alias}' is reserved by a builtin command.`;
      }
    }
    return null;
  }

  async importPack(json: string, secrets: Record<string, string>): Promise<{ ok: boolean; error?: string; packId?: string }> {
    if (!this.deps.updateCommands) {
      return { ok: false, error: 'Config updates are unavailable.' };
    }
    const { parseIntegrationManifest } = await import('@shared/commands/manifest');
    const parsed = parseIntegrationManifest(json);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    const manifest = parsed.manifest;
    const config = this.deps.config();
    if (config.integrations.some((pack) => pack.id === manifest.id)) {
      return { ok: false, error: `Integration '${manifest.id}' is already installed.` };
    }
    const systemAliases = new Set<string>(
      this.builtinEntries().flatMap((entry) => entry.aliases.map(normalizeAliasWord)).concat(['open'])
    );
    const commands: IntegrationCommandDef[] = [];
    for (const command of manifest.commands) {
      for (const alias of command.aliases ?? []) {
        if (systemAliases.has(normalizeAliasWord(alias))) {
          return { ok: false, error: `Alias '${alias}' is reserved by a builtin command.` };
        }
      }
      if (command.kind === 'tool') {
        if (!this.findTool(command.toolName ?? '')) {
          return { ok: false, error: `Command '${command.name}' binds unavailable tool '${command.toolName}'.` };
        }
      }
      for (const name of manifestSecretRefs(command)) {
        const value = secrets[name];
        if (value === undefined || value === '') {
          return { ok: false, error: `Missing secret value '${name}'.` };
        }
        const key = `integration:${manifest.id}:${command.name}:${name}`;
        await this.deps.storeSecret?.(key, value);
        command.headers = Object.fromEntries(
          Object.entries(command.headers ?? {}).map(([header, value2]) => [
            header,
            value2 === `\${secret:${name}}` ? `\${secret:${key}}` : value2,
          ])
        );
      }
      commands.push({
        id: command.name,
        kind: command.kind,
        title: command.title,
        description: command.description,
        aliases: command.aliases,
        icon: command.icon,
        args: command.args?.map((arg) => ({ name: arg.name, description: arg.description, required: arg.required ?? true, type: arg.type ?? 'string' })),
        toolName: command.toolName,
        argTemplate: command.argTemplate,
        promptTemplate: command.promptTemplate,
        method: command.method,
        urlTemplate: command.urlTemplate,
        headers: command.headers,
        bodyTemplate: command.bodyTemplate,
      });
    }
    const pack: IntegrationPackConfig = { id: manifest.id, name: manifest.name, enabled: true, commands };
    await this.deps.updateCommands({ integrations: [...config.integrations, pack] });
    return { ok: true, packId: manifest.id };
  }

  async removePack(packId: string): Promise<boolean> {
    if (!this.deps.updateCommands) {
      return false;
    }
    const config = this.deps.config();
    const pack = config.integrations.find((candidate) => candidate.id === packId);
    if (!pack) {
      return false;
    }
    for (const command of pack.commands) {
      for (const value of Object.values(command.headers ?? {})) {
        if (isSecretRef(value)) {
          await this.deps.deleteSecret?.(secretRefKey(value));
        }
      }
    }
    await this.deps.updateCommands({ integrations: config.integrations.filter((candidate) => candidate.id !== packId) });
    return true;
  }

  /** Boot-time revalidation (D10): invalid stored packs self-disable with a surfaced reason. */
  async validateStoredIntegrations(): Promise<string[]> {
    const config = this.deps.config();
    const invalid: string[] = [];
    const patched = config.integrations.map((pack) => {
      if (!pack.enabled || pack.error) {
        return pack;
      }
      for (const command of pack.commands) {
        if (command.kind === 'tool' && !this.findTool(command.toolName ?? '')) {
          invalid.push(pack.id);
          return { ...pack, enabled: false, error: `Bound tool '${command.toolName ?? ''}' is unavailable.` };
        }
        if (command.kind === 'http' && !command.urlTemplate) {
          invalid.push(pack.id);
          return { ...pack, enabled: false, error: 'Command is missing its URL template.' };
        }
        if (command.kind === 'prompt' && !command.promptTemplate) {
          invalid.push(pack.id);
          return { ...pack, enabled: false, error: 'Command is missing its prompt template.' };
        }
      }
      return pack;
    });
    if (invalid.length > 0 && this.deps.updateCommands) {
      await this.deps.updateCommands({ integrations: patched });
    }
    return invalid;
  }

  private customEntries(): CommandEntry[] {
    return this.deps.config().custom.map((def) => this.templatedEntry(`custom:${def.id}`, def.name, def.description, def.kind, def.aliases, def.icon, def));
  }

  private packEntries(): CommandEntry[] {
    return this.deps.config().integrations
      .filter((pack) => pack.enabled && !pack.error)
      .flatMap((pack) =>
        pack.commands.map((def) =>
          this.templatedEntry(
            `integration:${pack.id}:${def.id}`,
            def.title,
            def.description,
            def.kind,
            def.aliases ?? [],
            def.icon,
            def
          )
        )
      );
  }

  private templatedEntry(
    id: string,
    title: string,
    description: string | undefined,
    kind: 'tool' | 'prompt' | 'http',
    aliases: string[],
    icon: string | undefined,
    def: { argTemplate?: Record<string, string>; promptTemplate?: string; urlTemplate?: string; args?: { name: string; description?: string; required?: boolean; type?: 'string' | 'number' | 'boolean' }[] }
  ): CommandEntry {
    const arity = Math.min(8, manifestCommandArity({
      kind: kind === 'http' ? 'http' : kind,
      name: id,
      title,
      argTemplate: def.argTemplate,
      promptTemplate: def.promptTemplate,
      urlTemplate: def.urlTemplate,
      bodyTemplate: undefined,
    } as never));
    const args: CommandArgSpec[] =
      def.args?.map((arg) => ({ name: arg.name, description: arg.description, required: arg.required ?? true, type: arg.type ?? 'string' })) ??
      Array.from({ length: arity }, (_, index) => ({ name: `arg${index + 1}`, required: true, type: 'string' as const }));
    const config = this.deps.config();
    return {
      id,
      kind: 'custom',
      title,
      subtitle: description ?? (kind === 'prompt' ? 'Custom prompt' : kind === 'http' ? 'Web request' : 'Custom tool command'),
      category: 'custom',
      icon: icon ?? (kind === 'http' ? 'globe' : kind === 'prompt' ? 'sparkles' : 'puzzle'),
      aliases: aliases.map(normalizeAliasWord),
      slash: aliases[0] ? normalizeAliasWord(aliases[0]) : undefined,
      source: 'user',
      scopes: {
        palette: true,
        agent: kind !== 'prompt' && Boolean(config.agentCallable[id]),
      },
      args,
    };
  }

  /** Agent-scoped, bridgeable entries (plan 14 D9) — native tools/prompt-kind never bridge. */
  agentBridgeEntries(): CommandEntry[] {
    const config = this.deps.config();
    if (!config.enabled) {
      return [];
    }
    return this.list().filter((entry) => {
      if (!entry.scopes.agent) {
        return false;
      }
      return entry.kind === 'app' || entry.kind === 'custom' || entry.kind === 'http';
    });
  }

  /** LangChain tools for the agent bridge (plan 14 §7). */
  buildAgentTools(): WrappedCommandTool[] {
    return buildCommandTools({
      getAgentEntries: () =>
        this.agentBridgeEntries().map((entry) => {
          if (entry.kind !== 'custom') {
            return { ...entry, risk: 'state-changing' as const };
          }
          const withoutPrefix = entry.id.startsWith('integration:')
            ? entry.id.slice('integration:'.length)
            : entry.id.slice('custom:'.length);
          const separator = withoutPrefix.indexOf(':');
          const defId = entry.id.startsWith('integration:') ? withoutPrefix.slice(separator + 1) : withoutPrefix;
          const def = entry.id.startsWith('integration:')
            ? this.deps.config().integrations.find((pack) => pack.id === withoutPrefix.slice(0, separator))?.commands.find((cmd) => cmd.id === defId)
            : this.deps.config().custom.find((candidate) => candidate.id === defId);
          const boundTool = def?.toolName ? this.deps.toolCatalog().find((candidate) => candidate.name === def.toolName) : undefined;
          return { ...entry, risk: boundTool?.risk ?? 'state-changing' };
        }),
      executeAgent: async (entryId, argv) => {
        const outcome = await this.execute(entryId, argv, 'agent');
        if (outcome.status === 'done') {
          return { ok: true, text: outcome.text ?? 'Done.' };
        }
        if (outcome.status === 'error') {
          return { ok: false, text: outcome.error };
        }
        return { ok: false, text: 'This command cannot be executed by the assistant.' };
      },
    });
  }
}

  /** Name-based file search over the granted roots (find_files traversal rules). */
export async function searchGrantedFiles(roots: string[], pattern: string): Promise<CommandOutcome> {
  const regex = globToRegex(pattern);
  const globHasSlash = pattern.includes('/');
  const budget = newBudget();
  const matches: string[] = [];
  for (const root of roots) {
    await walkRoot(
      root,
      (absolute, relativePath) => {
        if (matches.length >= FILE_SEARCH_LIMIT) {
          return;
        }
        if (regex.test(relativePath) || (!globHasSlash && regex.test(relativePath.split('/').pop() ?? ''))) {
          matches.push(absolute);
        }
      },
      budget
    );
    if (budget.truncated || matches.length >= FILE_SEARCH_LIMIT) {
      break;
    }
  }
  if (matches.length === 0) {
    return { status: 'done', text: budget.truncated ? 'No matches (search stopped early).' : 'No matches.' };
  }
  const lines = matches.map((match) => `${match}`);
  return { status: 'done', text: [`${matches.length} match(es):`, ...lines].join('\n') };
}
