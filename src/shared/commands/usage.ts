import type { CommandEntry, CommandArgSpec } from './types';

/** `content` / `tags` → `<content> [tags…]` (arrays read as lists). */
export function commandArgSignature(args: CommandArgSpec[]): string {
  return args
    .map((arg) => {
      const name = arg.type === 'array' ? `${arg.name}…` : arg.name;
      return arg.required ? `<${name}>` : `[${name}]`;
    })
    .join(' ');
}

/** Optional argument as an inline flag: `--maxResults 5`, `--tags a,b`. */
function flagUsage(arg: CommandArgSpec): string {
  const sample =
    arg.type === 'number' ? '5' : arg.type === 'boolean' ? 'true' : arg.type === 'enum' ? (arg.enumValues?.[0] ?? 'value') : 'value';
  return `--${arg.name} ${sample}`;
}

/**
 * The exact thing to type. On free-text commands the optional arguments are
 * shown as inline flags (`/web <query> [--maxResults 5]`) because a free-text
 * tail cannot absorb a positional value; positional commands keep `[name]`.
 */
export function commandUsage(entry: CommandEntry): string {
  const alias = entry.slash ?? entry.aliases[0] ?? entry.title;
  const tail = freeTextTailArg(entry);
  const signature = entry.args
    .map((arg) => {
      if (arg.required) {
        const name = arg.type === 'array' ? `${arg.name}…` : arg.name;
        return `<${name}>`;
      }
      return tail !== null ? `[${flagUsage(arg)}]` : `[${arg.type === 'array' ? `${arg.name}…` : arg.name}]`;
    })
    .join(' ');
  return signature.length > 0 ? `/${alias} ${signature}` : `/${alias}`;
}

/**
 * The argument that absorbs the whole free-text remainder, or null when the
 * command keeps positional parsing: exactly one required argument and every
 * other argument non-textual (number/boolean/list). Commands with an optional
 * STRING argument (`/find <pattern> <root>`) are positional by design.
 */
export function freeTextTailArg(entry: CommandEntry): CommandArgSpec | null {
  const required = entry.args.filter((arg) => arg.required);
  if (required.length !== 1) {
    return null;
  }
  const only = required[0];
  return entry.args.every((arg) => arg === only || (arg.type !== 'string' && arg.type !== 'enum')) ? only : null;
}

function coerce(spec: CommandArgSpec, raw: string): { ok: true; value: unknown } | { ok: false } {
  switch (spec.type) {
    case 'number': {
      const value = Number(raw);
      return Number.isFinite(value) ? { ok: true, value } : { ok: false };
    }
    case 'boolean': {
      if (raw === 'true' || raw === '1') return { ok: true, value: true };
      if (raw === 'false' || raw === '0') return { ok: true, value: false };
      return { ok: false };
    }
    case 'enum':
      return spec.enumValues === undefined || spec.enumValues.includes(raw) ? { ok: true, value: raw } : { ok: false };
    case 'array':
      return { ok: true, value: raw.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0) };
    default:
      return { ok: true, value: raw };
  }
}

/**
 * Pulls `--name value` / `--name=value` flags for KNOWN argument names out of
 * the remainder; anything else (unknown flags, malformed values, words) stays
 * in `rest` so a query may safely contain dashes.
 */
export function extractFlagArgs(
  entry: CommandEntry,
  rest: string
): { flags: Record<string, unknown>; rest: string } {
  const tokens = rest.length > 0 ? rest.split(/\s+/) : [];
  const flags: Record<string, unknown> = {};
  const kept: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const match = /^--([A-Za-z][A-Za-z0-9]*)(?:=(.*))?$/.exec(token);
    const spec = match ? entry.args.find((arg) => arg.name === match[1]) : undefined;
    if (!match || !spec) {
      kept.push(token);
      continue;
    }
    const inline = match[2];
    if (inline !== undefined) {
      const parsed = coerce(spec, inline);
      if (parsed.ok) {
        flags[spec.name] = parsed.value;
        continue;
      }
      kept.push(token);
      continue;
    }
    if (spec.type === 'boolean') {
      const next = tokens[index + 1];
      if (next !== undefined && (next === 'true' || next === 'false' || next === '1' || next === '0')) {
        flags[spec.name] = next === 'true' || next === '1';
        index += 1;
      } else {
        flags[spec.name] = true;
      }
      continue;
    }
    const next = tokens[index + 1];
    if (next === undefined) {
      kept.push(token);
      continue;
    }
    const parsed = coerce(spec, next);
    if (!parsed.ok) {
      kept.push(token);
      continue;
    }
    flags[spec.name] = parsed.value;
    index += 1;
  }
  return { flags, rest: kept.join(' ') };
}

function applyDefaults(
  entry: CommandEntry,
  args: Record<string, unknown>,
  defaults?: Record<string, unknown>
): Record<string, unknown> {
  for (const spec of entry.args) {
    const current = args[spec.name];
    if ((current === undefined || current === '') && defaults?.[spec.name] !== undefined) {
      args[spec.name] = defaults[spec.name];
    }
  }
  return args;
}

/**
 * One argv → args mapping for typed and palette commands (the palette guard
 * reads the same result, so "Needs…" can never disagree with what runs).
 * Flags win; a free-text tail takes the remaining words; otherwise tokens map
 * positionally to the un-flagged arguments.
 */
export function parseCommandArgs(
  entry: CommandEntry,
  argv: string[],
  rest: string,
  defaults?: Record<string, unknown>
): Record<string, unknown> {
  const extracted = extractFlagArgs(entry, rest.length > 0 ? rest : argv.join(' '));
  const args: Record<string, unknown> = { ...extracted.flags };
  const tail = freeTextTailArg(entry);
  if (tail !== null) {
    if (args[tail.name] === undefined) {
      args[tail.name] = extracted.rest;
    }
    return applyDefaults(entry, args, defaults);
  }
  const unclaimed = entry.args.filter((spec) => args[spec.name] === undefined);
  const tokens = extracted.rest.length > 0 ? extracted.rest.split(/\s+/) : [];
  tokens.forEach((token, index) => {
    const spec = unclaimed[index];
    if (!spec) {
      return;
    }
    const parsed = coerce(spec, token);
    if (parsed.ok) {
      args[spec.name] = parsed.value;
    }
  });
  return applyDefaults(entry, args, defaults);
}

/**
 * Required args the typed input has not satisfied yet (flags, tail text,
 * position and configured defaults all count). Empty means the command may run.
 */
export function missingRequiredArgs(
  entry: CommandEntry,
  argv: string[],
  defaults?: Record<string, unknown>,
  rest?: string
): string[] {
  const args = parseCommandArgs(entry, argv, rest ?? argv.join(' '), defaults);
  return entry.args
    .filter((spec) => spec.required && (args[spec.name] === undefined || args[spec.name] === ''))
    .map((spec) => spec.name);
}
