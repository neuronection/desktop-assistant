import { isSecretRef, manifestSecretRefs, secretRefKey } from '@shared/commands';
import type {
  CommandsSettings,
  CustomCommandDef,
  IntegrationCommandDef,
  IntegrationPackConfig,
} from '@shared/config/AppConfig';
import type { CommandServiceDeps } from '../CommandService';
import { builtinEntries, findTool, miniAppEntries, normalizeAliasWord } from './catalog';

/** Saves a user-authored custom command after main-side validation (plan 14 §5). */
export async function saveCustomCommand(deps: CommandServiceDeps, def: CustomCommandDef): Promise<{ ok: boolean; error?: string }> {
  if (!deps.updateCommands) {
    return { ok: false, error: 'Config updates are unavailable.' };
  }
  const normalized: CustomCommandDef = {
    ...def,
    id: def.id.trim() || `custom-${Date.now().toString(36)}`,
    aliases: def.aliases.map(normalizeAliasWord),
  };
  const error = validateCustom(deps, normalized);
  if (error) {
    return { ok: false, error };
  }
  const config = deps.config();
  const custom = [...config.custom.filter((candidate) => candidate.id !== normalized.id), normalized];
  await deps.updateCommands({ custom });
  return { ok: true };
}

export async function deleteCustomCommand(deps: CommandServiceDeps, id: string): Promise<boolean> {
  if (!deps.updateCommands) {
    return false;
  }
  const config = deps.config();
  if (!config.custom.some((candidate) => candidate.id === id)) {
    return false;
  }
  await deps.updateCommands({
    custom: config.custom.filter((candidate) => candidate.id !== id),
    ...withoutCommandHotkeys(config.commandHotkeys, [id]),
  });
  return true;
}

/**
 * Drops hotkey bindings for commands that no longer exist (plan 59 D9):
 * a dead binding otherwise keeps registering as a GLOBAL shortcut while
 * being invisible in Settings (the editor only lists live commands).
 */
function withoutCommandHotkeys(
  commandHotkeys: CommandsSettings['commandHotkeys'],
  ids: readonly string[]
): Partial<Pick<CommandsSettings, 'commandHotkeys'>> {
  const present = ids.filter((id) => id in commandHotkeys);
  if (present.length === 0) {
    return {};
  }
  const next = { ...commandHotkeys };
  for (const id of present) {
    delete next[id];
  }
  return { commandHotkeys: next };
}

function validateCustom(deps: CommandServiceDeps, def: CustomCommandDef): string | null {
  if (!def.name.trim()) {
    return 'Name is required.';
  }
  if (def.kind === 'tool') {
    if (!def.toolName || !findTool(deps, def.toolName)) {
      return `Tool '${def.toolName ?? ''}' is unavailable, disabled or destructive.`;
    }
    const tool = deps.toolCatalog().find((candidate) => candidate.name === def.toolName);
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
    [...builtinEntries(), ...miniAppEntries(deps)].flatMap((entry) => entry.aliases.map(normalizeAliasWord)).concat(['open'])
  );
  for (const alias of def.aliases) {
    if (systemAliases.has(normalizeAliasWord(alias))) {
      return `Alias '${alias}' is reserved by a builtin command.`;
    }
  }
  return null;
}

export async function importIntegrationPack(deps: CommandServiceDeps, json: string, secrets: Record<string, string>): Promise<{ ok: boolean; error?: string; packId?: string }> {
  if (!deps.updateCommands) {
    return { ok: false, error: 'Config updates are unavailable.' };
  }
  const { parseIntegrationManifest } = await import('@shared/commands/manifest');
  const parsed = parseIntegrationManifest(json);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const manifest = parsed.manifest;
  const config = deps.config();
  if (config.integrations.some((pack) => pack.id === manifest.id)) {
    return { ok: false, error: `Integration '${manifest.id}' is already installed.` };
  }
  const systemAliases = new Set<string>(
    [...builtinEntries(), ...miniAppEntries(deps)].flatMap((entry) => entry.aliases.map(normalizeAliasWord)).concat(['open'])
  );
  const commands: IntegrationCommandDef[] = [];
  for (const command of manifest.commands) {
    for (const alias of command.aliases ?? []) {
      if (systemAliases.has(normalizeAliasWord(alias))) {
        return { ok: false, error: `Alias '${alias}' is reserved by a builtin command.` };
      }
    }
    if (command.kind === 'tool') {
      if (!findTool(deps, command.toolName ?? '')) {
        return { ok: false, error: `Command '${command.name}' binds unavailable tool '${command.toolName}'.` };
      }
    }
    for (const name of manifestSecretRefs(command)) {
      const value = secrets[name];
      if (value === undefined || value === '') {
        return { ok: false, error: `Missing secret value '${name}'.` };
      }
      const key = `integration:${manifest.id}:${command.name}:${name}`;
      await deps.storeSecret?.(key, value);
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
  await deps.updateCommands({ integrations: [...config.integrations, pack] });
  return { ok: true, packId: manifest.id };
}

export async function removeIntegrationPack(deps: CommandServiceDeps, packId: string): Promise<boolean> {
  if (!deps.updateCommands) {
    return false;
  }
  const config = deps.config();
  const pack = config.integrations.find((candidate) => candidate.id === packId);
  if (!pack) {
    return false;
  }
  for (const command of pack.commands) {
    for (const value of Object.values(command.headers ?? {})) {
      if (isSecretRef(value)) {
        await deps.deleteSecret?.(secretRefKey(value));
      }
    }
  }
  await deps.updateCommands({
    integrations: config.integrations.filter((candidate) => candidate.id !== packId),
    ...withoutCommandHotkeys(
      config.commandHotkeys,
      pack.commands.map((command) => command.id)
    ),
  });
  return true;
}

/** Boot-time revalidation (D10): invalid stored packs self-disable with a surfaced reason. */
export async function validateStoredIntegrations(deps: CommandServiceDeps): Promise<string[]> {
  const config = deps.config();
  const invalid: string[] = [];
  const patched = config.integrations.map((pack) => {
    if (!pack.enabled || pack.error) {
      return pack;
    }
    for (const command of pack.commands) {
      if (command.kind === 'tool' && !findTool(deps, command.toolName ?? '')) {
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
  if (invalid.length > 0 && deps.updateCommands) {
    await deps.updateCommands({ integrations: patched });
  }
  return invalid;
}
