import { validateCommandArgs } from '@shared/schema/commandArgs';
import type {
  BuiltinAction,
  CommandEntry,
  CommandInvocationSource,
  CommandOutcome,
  CommandRecord,
} from '@shared/commands';
import { isSecretRef, secretRefKey, substituteTemplate } from '@shared/commands';
import { evaluateExpression, formatCalcResult } from '@packs/mini-calc/evaluate';
import { interpolate, TEXT } from '@shared/constants/text';
import type { IntegrationCommandDef } from '@shared/config/AppConfig';
import { globToRegex, newBudget, walkRoot } from '@main/ai/tools/native/file-search';
import { buildCommandTools, type WrappedCommandTool } from '@main/ai/tools/command-tools';
import type { CommandServiceDeps } from '../CommandService';
import { commandList, findTool } from './catalog';

const FILE_SEARCH_LIMIT = 50;

export async function executeCommand(
  deps: CommandServiceDeps,
  pendingWrites: Set<Promise<unknown>>,
  commandId: string,
  argv: string[],
  source: CommandInvocationSource
): Promise<CommandOutcome> {
  const config = deps.config();
  if (!config.enabled) {
    return { status: 'error', error: 'Commands are disabled.' };
  }
  const entry = commandList(deps).find((candidate) => candidate.id === commandId);
  if (!entry) {
    return { status: 'error', error: `Unknown command '${commandId}'.` };
  }
  let outcome: CommandOutcome;
  if (entry.kind === 'tool') {
    outcome = { status: 'turn' };
  } else if (entry.kind === 'builtin' && entry.id.startsWith('miniapp:run:')) {
    if (!deps.startMiniAppRun) {
      outcome = { status: 'error', error: 'Mini-app runs are not available.' };
    } else {
      const started = await deps.startMiniAppRun(entry.id.slice('miniapp:run:'.length));
      outcome = started.ok
        ? { status: 'done', text: started.text, conversationId: started.conversationId ?? undefined }
        : { status: 'error', error: started.error };
    }
  } else if (entry.kind === 'builtin' && entry.id.startsWith('miniapp:cmd:')) {
    const rest = entry.id.slice('miniapp:cmd:'.length);
    const separator = rest.indexOf(':');
    if (!deps.executeMiniAppCommand || separator <= 0) {
      outcome = { status: 'error', error: 'Mini-app commands are not available.' };
    } else {
      const executed = await deps.executeMiniAppCommand(rest.slice(0, separator), rest.slice(separator + 1), argv);
      outcome = executed.ok ? { status: 'done', text: executed.text } : { status: 'error', error: executed.error };
    }
  } else if (entry.kind === 'builtin') {
    outcome = await dispatchBuiltin(deps, entry.action as BuiltinAction, argv);
  } else if (entry.kind === 'app') {
    if (!deps.launchApp) {
      outcome = { status: 'error', error: 'App launching is not available.' };
    } else {
      await deps.launchApp(entry.id.slice('app:'.length));
      outcome = { status: 'done', text: entry.title };
    }
  } else if (entry.kind === 'custom') {
    outcome = entry.id.startsWith('integration:')
      ? await dispatchIntegration(deps, entry.id, argv)
      : await dispatchTemplated(deps, entry.id.slice('custom:'.length), argv);
    if (source === 'agent' && outcome.status === 'turn' && outcome.direct) {
      if (!deps.executeDirectTool) {
        outcome = { status: 'error', error: 'Direct tool execution is unavailable.' };
      } else {
        const result = await deps.executeDirectTool(outcome.direct.name, outcome.direct.args);
        const note = result.images?.length ? '\n(The image was captured and shown to the user.)' : '';
        outcome = result.ok
          ? { status: 'done', text: `${result.text}${note}` }
          : { status: 'error', error: result.text };
      }
    }
  } else if (entry.kind === 'prompt') {
    if (!deps.expandPrompt || !entry.appId || !entry.promptName) {
      outcome = { status: 'error', error: 'Prompt templates are not available.' };
    } else {
      const args = Object.fromEntries(entry.args.map((arg, index) => [arg.name, argv[index] ?? '']));
      const expanded = await deps.expandPrompt(entry.appId, entry.promptName, args);
      outcome = expanded.ok ? { status: 'turn', prompt: expanded.text } : { status: 'error', error: expanded.error };
    }
  } else {
    outcome = { status: 'error', error: `Command kind '${entry.kind}' is not available yet.` };
  }
  const storesArgs =
    entry.kind === 'builtin' && (entry.action === 'calc:evaluate' || entry.action === 'files:search');
  const deferredToTurn = outcome.status === 'turn' && !outcome.prompt && source !== 'agent';
  if (!deferredToTurn) {
    void recordCommand(deps, pendingWrites, {
      commandId: entry.id,
      kind: entry.kind,
      // A prompt-template invocation is attributed to the prompt source
      // (plan 43 D3), regardless of which surface triggered it.
      source: entry.kind === 'prompt' ? 'prompt' : source,
      ok: outcome.status !== 'error',
      ...(storesArgs ? { args: { argv } } : {}),
    });
  }
  return outcome;
}

/** History hook for the turn path (tool-backed commands ride `ai:turn-start`). */
export function recordCommand(deps: CommandServiceDeps, pendingWrites: Set<Promise<unknown>>, record: CommandRecord): void {
  const config = deps.config();
  if (!config.enabled || !config.history.enabled || !deps.client) {
    return;
  }
  const write = deps.client.commandInvocation
    .create({
      data: {
        commandId: record.commandId,
        kind: record.kind,
        source: record.source,
        ...(record.args ? { args: validateCommandArgs(record.args) } : {}),
        outcome: record.ok ? 'ok' : 'error',
      },
    })
    .catch(() => undefined);
  pendingWrites.add(write);
  void write.finally(() => pendingWrites.delete(write));
}

/** Resolves when all in-flight history writes settle (boot/test sync point). */
export async function flushCommandHistory(pendingWrites: Set<Promise<unknown>>): Promise<void> {
  await Promise.all([...pendingWrites]);
}

export async function recentCommandIds(deps: CommandServiceDeps, limit = 5): Promise<string[]> {
  if (!deps.client) {
    return [];
  }
  const rows = await deps.client.commandInvocation.findMany({
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

export async function clearCommandHistory(deps: CommandServiceDeps): Promise<void> {
  if (!deps.client) {
    return;
  }
  await deps.client.commandInvocation.deleteMany({});
}

export async function pruneCommandHistory(deps: CommandServiceDeps): Promise<number> {
  if (!deps.client) {
    return 0;
  }
  const retentionDays = deps.config().history.retentionDays;
  const cutoff = new Date(Date.now() - Math.max(1, retentionDays) * 86_400_000);
  const result = await deps.client.commandInvocation.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

async function dispatchBuiltin(deps: CommandServiceDeps, action: BuiltinAction, argv: string[]): Promise<CommandOutcome> {
  switch (action) {
    case 'nav:new-conversation':
      deps.actions.newConversation();
      return { status: 'done' };
    case 'nav:toggle-expand':
      deps.actions.toggleExpand();
      return { status: 'done' };
    case 'nav:open-desktop':
      deps.actions.openDesktop();
      return { status: 'done' };
    case 'nav:open-settings':
      deps.actions.openSettings();
      return { status: 'done' };
    case 'nav:hide-launcher':
      deps.actions.hideLauncher();
      return { status: 'done' };
    case 'nav:quit':
      deps.actions.quit();
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
      const roots = deps.grantedRoots();
      if (roots.length === 0) {
        return { status: 'error', error: TEXT.COMMAND_FILES_NO_ROOTS };
      }
      return searchGrantedFiles(roots, pattern);
    }
    case 'research:start': {
      const topic = argv.join(' ').trim();
      if (!topic) {
        return { status: 'error', error: TEXT.COMMAND_RESEARCH_USAGE };
      }
      return { status: 'turn', prompt: topic, flow: 'research' };
    }
    default:
      return { status: 'error', error: `Unknown builtin '${action}'.` };
  }
}

/** Custom + pack tool wrappers: substitute placeholders, zod-validate in main (D1/D3). */
function dispatchTemplated(deps: CommandServiceDeps, defId: string, argv: string[]): Promise<CommandOutcome> {
  const def = deps.config().custom.find((candidate) => candidate.id === defId);
  return runTemplated(deps, def, argv);
}

async function dispatchIntegration(deps: CommandServiceDeps, entryId: string, argv: string[]): Promise<CommandOutcome> {
  const withoutPrefix = entryId.slice('integration:'.length);
  const separator = withoutPrefix.indexOf(':');
  if (separator <= 0) {
    return { status: 'error', error: `Unknown command '${entryId}'.` };
  }
  const packId = withoutPrefix.slice(0, separator);
  const commandName = withoutPrefix.slice(separator + 1);
  const pack = deps.config().integrations.find((candidate) => candidate.id === packId);
  if (!pack || !pack.enabled || pack.error) {
    return { status: 'error', error: `Integration '${packId}' is unavailable.` };
  }
  const def = pack.commands.find((candidate) => candidate.id === commandName);
  if (!def) {
    return { status: 'error', error: `Unknown command '${entryId}'.` };
  }
  if (def.kind === 'http') {
    return await runHttp(deps, packId, def, argv);
  }
  return await runTemplated(deps, def, argv);
}

async function runTemplated(
  deps: CommandServiceDeps,
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
  const tool = def.toolName ? findTool(deps, def.toolName) : undefined;
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

async function runHttp(deps: CommandServiceDeps, packId: string, def: IntegrationCommandDef, argv: string[]): Promise<CommandOutcome> {
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
      const secret = (await deps.resolveSecret?.(key)) ?? null;
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
    const response = await (deps.httpFetch
      ? deps.httpFetch(url.value, { method, headers, body })
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

/** Agent-scoped, bridgeable entries (plan 14 D9) — native tools/prompt-kind never bridge. */
export function commandAgentBridgeEntries(deps: CommandServiceDeps): CommandEntry[] {
  const config = deps.config();
  if (!config.enabled) {
    return [];
  }
  return commandList(deps).filter((entry) => {
    if (!entry.scopes.agent) {
      return false;
    }
    return entry.kind === 'app' || entry.kind === 'custom' || entry.kind === 'http';
  });
}

/** LangChain tools for the agent bridge (plan 14 §7). */
export function buildAgentCommandTools(deps: CommandServiceDeps, pendingWrites: Set<Promise<unknown>>): WrappedCommandTool[] {
  return buildCommandTools({
    getAgentEntries: () =>
      commandAgentBridgeEntries(deps).map((entry) => {
        if (entry.kind !== 'custom') {
          return { ...entry, risk: 'state-changing' as const };
        }
        const withoutPrefix = entry.id.startsWith('integration:')
          ? entry.id.slice('integration:'.length)
          : entry.id.slice('custom:'.length);
        const separator = withoutPrefix.indexOf(':');
        const defId = entry.id.startsWith('integration:') ? withoutPrefix.slice(separator + 1) : withoutPrefix;
        const def = entry.id.startsWith('integration:')
          ? deps.config().integrations.find((pack) => pack.id === withoutPrefix.slice(0, separator))?.commands.find((cmd) => cmd.id === defId)
          : deps.config().custom.find((candidate) => candidate.id === defId);
        const boundTool = def?.toolName ? deps.toolCatalog().find((candidate) => candidate.name === def.toolName) : undefined;
        return { ...entry, risk: boundTool?.risk ?? 'state-changing' };
      }),
    executeAgent: async (entryId, argv) => {
      const outcome = await executeCommand(deps, pendingWrites, entryId, argv, 'agent');
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
