export interface ParsedCommandInput {
  /** Command word after the slash (lowercased); null when the input has no slash prefix. */
  alias: string | null;
  argv: string[];
  /** The raw remainder after the alias (spacing preserved). */
  rest: string;
  raw: string;
}

/**
 * Quote-aware argv tokenizer (shlex-like): single quotes are fully
 * literal, double quotes allow `\"` and `\\` escapes, a backslash
 * outside quotes escapes the next character. Unterminated quotes close
 * at end of input — graceful for a live typing surface.
 */
export function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let hasToken = false;
  let inSingle = false;
  let inDouble = false;

  const push = (): void => {
    if (hasToken) {
      tokens.push(current);
    }
    current = '';
    hasToken = false;
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inSingle) {
      if (char === "'") {
        inSingle = false;
      } else {
        current += char;
        hasToken = true;
      }
      continue;
    }
    if (inDouble) {
      if (char === '"') {
        inDouble = false;
      } else if (char === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        current += input[i + 1];
        hasToken = true;
        i += 1;
      } else {
        current += char;
        hasToken = true;
      }
      continue;
    }
    if (char === "'") {
      inSingle = true;
      hasToken = true;
      continue;
    }
    if (char === '"') {
      inDouble = true;
      hasToken = true;
      continue;
    }
    if (char === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      hasToken = true;
      i += 1;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      continue;
    }
    current += char;
    hasToken = true;
  }
  push();
  return tokens;
}

export function parseCommandInput(input: string): ParsedCommandInput {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return { alias: null, argv: [], rest: '', raw: input };
  }
  const withoutSlash = trimmed.slice(1);
  const separator = /\s/.exec(withoutSlash);
  const aliasEnd = separator ? separator.index : withoutSlash.length;
  const alias = withoutSlash.slice(0, aliasEnd).toLowerCase();
  const rest = withoutSlash.slice(aliasEnd).trim();
  return {
    alias: alias.length > 0 ? alias : null,
    argv: rest.length > 0 ? tokenizeArgs(rest) : [],
    rest,
    raw: input,
  };
}
