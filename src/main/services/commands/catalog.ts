import { z } from 'zod';
import type {
  BuiltinAction,
  CommandArgSpec,
  CommandEntry,
} from '@shared/commands';
import { manifestCommandArity } from '@shared/commands';
import { interpolate, TEXT } from '@shared/constants/text';
import { SURFACE_COMMAND_BINDINGS } from '@packs';
import type { CommandsSettings } from '@shared/config/AppConfig';
import type { NativeToolDefinition } from '@main/ai/tools/types';
import { TOOL_SLASH_ALIASES } from '@shared/commands/toolAliases';
import type { CommandServiceDeps } from '../CommandService';

export function normalizeAliasWord(alias: string): string {
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
    const def = current.def as { type: string; innerType?: z.ZodTypeAny; defaultValue?: unknown };
    if (def.type === 'optional' || def.type === 'nullable') {
      optional = true;
      current = def.innerType as z.ZodTypeAny;
      continue;
    }
    if (def.type === 'default') {
      optional = true;
      try {
        const value =
          typeof def.defaultValue === 'function' ? (def.defaultValue as () => unknown)() : def.defaultValue;
        defaultValue = value === undefined || value === null ? undefined : JSON.stringify(value) ?? undefined;
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
  const def = inner.def as { type: string; entries?: Record<string, unknown> };
  const base = {
    description: inner.description,
    required: !optional,
    defaultValue,
  };
  switch (def.type) {
    case 'number':
      return { ...base, type: 'number' };
    case 'boolean':
      return { ...base, type: 'boolean' };
    case 'enum':
      return { ...base, type: 'enum', enumValues: Object.values(def.entries ?? {}).map((value) => String(value)) };
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

export function findTool(deps: CommandServiceDeps, name: string): NativeToolDefinition | undefined {
  const tool = deps.toolCatalog().find((candidate) => candidate.name === name);
  if (!tool || tool.risk === 'destructive' || deps.isToolDisabled(tool.name)) {
    return undefined;
  }
  return tool;
}

export function builtinEntries(): CommandEntry[] {
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
    {
      id: 'research:start',
      kind: 'builtin',
      title: TEXT.COMMAND_RESEARCH,
      subtitle: TEXT.COMMAND_RESEARCH_SUBTITLE,
      category: 'tools',
      icon: 'telescope',
      aliases: ['research'],
      slash: 'research',
      keywords: TEXT.COMMAND_RESEARCH_KEYWORDS.split(' '),
      source: 'system',
      scopes: { palette: true, agent: false },
      args: [{ name: 'topic', required: true, type: 'string' }],
      action: 'research:start',
    },
  ];
}

/**
 * Palette entries per installed pack (plan 26 S8). Surface packs emit
 * their declared `commands` through the host binding table
 * (`src/packs` SURFACE_COMMAND_BINDINGS — Tier 1: the host supplies
 * the executor); assessment packs get run-start entries. Enabled
 * state is authoritative in both cases.
 */
export function miniAppEntries(deps: CommandServiceDeps): CommandEntry[] {
  const packs = deps.miniAppPacks?.() ?? [];
  const entries: CommandEntry[] = [];
  for (const pack of packs.filter((candidate) => candidate.kind === 'surface' && candidate.enabled)) {
    for (const commandId of pack.commands ?? []) {
      const binding = SURFACE_COMMAND_BINDINGS[commandId];
      if (binding) {
        entries.push({ ...binding, kind: 'builtin', source: 'system', scopes: { palette: true, agent: false } });
      } else if (pack.sandboxed) {
        entries.push({
          id: `miniapp:cmd:${pack.id}:${commandId}`,
          kind: 'builtin',
          title: interpolate(TEXT.COMMAND_MINIAPP_CMD_TITLE, { title: pack.title, command: commandId }),
          subtitle: pack.description,
          category: 'apps',
          icon: 'app-window',
          aliases: [commandId, pack.id],
          slash: commandId.split(':').pop() ?? commandId,
          keywords: ['mini-app', 'sandbox', ...commandId.split(':'), ...pack.id.split('-')],
          source: 'system',
          scopes: { palette: true, agent: false },
          args: [{ name: 'input', required: false, type: 'string' }],
          action: 'miniapp:command',
        });
      }
    }
  }
  for (const pack of packs.filter((candidate) => candidate.kind === 'assessment' && candidate.enabled)) {
    entries.push({
      id: `miniapp:run:${pack.id}`,
      kind: 'builtin',
      title: interpolate(TEXT.COMMAND_MINIAPP_RUN_TITLE, { title: pack.title }),
      subtitle: pack.description,
      category: 'apps',
      icon: 'folder-search',
      aliases: [pack.id],
      slash: pack.id,
      keywords: ['assess', 'review', 'cleanup', 'delete', 'mini-app', ...pack.id.split('-')],
      source: 'system',
      scopes: { palette: true, agent: false },
      args: [],
      action: 'miniapp:run-start',
    });
  }
  return entries;
}

/** A disabled bundled surface pack hides its palette mode entry (plan 26 S8 — the switch is functional). */
function appEntries(deps: CommandServiceDeps): CommandEntry[] {
  const config = deps.config();
  if (!config.apps.launchEnabled || !config.apps.discovery || !deps.apps) {
    return [];
  }
  const hiddenApps = new Set(config.apps.hiddenApps);
  return deps.apps()
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

function toolEntries(deps: CommandServiceDeps): CommandEntry[] {
  return deps
    .toolCatalog()
    .filter((tool) => tool.risk !== 'destructive' && !deps.isToolDisabled(tool.name))
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

/**
 * Enabled app tools as palette rows (plan 15 S6): source `mcp`,
 * grouped under `integrations`, dispatched through the same turn path
 * as native tool rows — no new execution channel. Destructive and
 * kill-switched tools are excluded; server-down rows keep their cached
 * description and are flagged `disabled`.
 */
function appToolEntries(deps: CommandServiceDeps): CommandEntry[] {
  if (!deps.appTools) {
    return [];
  }
  return deps
    .appTools()
    .filter((tool) => tool.risk !== 'destructive' && !deps.isToolDisabled(tool.name))
    .map((tool) => ({
      id: `apptool:${tool.name}`,
      kind: 'tool' as const,
      title: tool.title,
      subtitle: tool.subtitle,
      category: 'integrations' as const,
      icon: 'plug',
      aliases: [tool.slash],
      slash: tool.slash,
      source: 'mcp' as const,
      scopes: { palette: true, agent: false },
      args: [],
      toolName: tool.name,
      risk: tool.risk,
      disabled: !tool.available,
    }));
}

/**
 * MCP prompt templates as palette rows (plan 43 S3): category
 * `integrations`, source `prompt`, never agent-callable. The row's args
 * carry the template's arguments so the palette can fill them; the
 * expansion happens main-side on execute.
 */
function promptEntries(deps: CommandServiceDeps): CommandEntry[] {
  if (!deps.promptEntries) {
    return [];
  }
  return deps.promptEntries().map((prompt) => ({
    id: `prompt:${prompt.appId}:${prompt.name}`,
    kind: 'prompt' as const,
    title: prompt.title || prompt.name,
    subtitle: prompt.description || prompt.appName,
    category: 'integrations' as const,
    icon: 'sparkles',
    aliases: [prompt.name.toLowerCase()],
    source: 'prompt' as const,
    scopes: { palette: true, agent: false },
    args: prompt.arguments.map((argument) => ({
      name: argument.name,
      required: argument.required,
      type: 'string' as const,
      ...(argument.description ? { description: argument.description } : {}),
    })),
    promptName: prompt.name,
    appId: prompt.appId,
  }));
}

function customEntries(deps: CommandServiceDeps): CommandEntry[] {
  return deps.config().custom.map((def) => templatedEntry(deps, `custom:${def.id}`, def.name, def.description, def.kind, def.aliases, def.icon, def));
}

function packEntries(deps: CommandServiceDeps): CommandEntry[] {
  return deps.config().integrations
    .filter((pack) => pack.enabled && !pack.error)
    .flatMap((pack) =>
      pack.commands.map((def) =>
        templatedEntry(
          deps,
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

function templatedEntry(
  deps: CommandServiceDeps,
  id: string,
  title: string,
  description: string | undefined,
  kind: 'tool' | 'prompt' | 'http',
  aliases: string[],
  icon: string | undefined,
  def: { toolName?: string; argTemplate?: Record<string, string>; promptTemplate?: string; urlTemplate?: string; args?: { name: string; description?: string; required?: boolean; type?: 'string' | 'number' | 'boolean' }[] }
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
  const config = deps.config();
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
    ...(kind === 'tool' && def.toolName ? { toolName: def.toolName } : {}),
  };
}

function withExtraAliases(entry: CommandEntry, config: CommandsSettings): CommandEntry {
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

/** Assembled catalog (hidden entries and the kill switch applied). */
export function commandList(deps: CommandServiceDeps): CommandEntry[] {
  const config = deps.config();
  if (!config.enabled) {
    return [];
  }
  const hidden = new Set(config.hidden);
  const appToolNames = new Set((deps.appTools?.() ?? []).map((tool) => tool.name));
  return [...builtinEntries(), ...miniAppEntries(deps), ...customEntries(deps), ...packEntries(deps), ...appEntries(deps), ...toolEntries(deps), ...appToolEntries(deps), ...promptEntries(deps)]
    .filter((entry) => !hidden.has(entry.id))
    .filter((entry) => !(entry.id.startsWith('integration:') && entry.toolName && appToolNames.has(entry.toolName)))
    .map((entry) => withExtraAliases(entry, config));
}
