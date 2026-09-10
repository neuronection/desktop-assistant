const PLACEHOLDER = /\{\{\s*(\d+|query)\s*\}\}/g;

export type TemplatePlaceholder = { kind: 'query' } | { kind: 'index'; index: number };

export function templatePlaceholders(template: string): TemplatePlaceholder[] {
  const placeholders: TemplatePlaceholder[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (match[1] === 'query') {
      placeholders.push({ kind: 'query' });
    } else {
      const index = Number(match[1]);
      if (index >= 1) {
        placeholders.push({ kind: 'index', index });
      }
    }
  }
  return placeholders;
}

export interface TemplateSubstitution {
  ok: boolean;
  /** Template with every resolvable placeholder replaced; unresolvable ones stay literal. */
  value: string;
  /** 1-based argv positions referenced beyond the provided argv length. */
  missing: number[];
}

/**
 * Substitutes `{{1}}…{{n}}` (1-based argv positions) and `{{query}}`
 * (argv joined by single spaces) into a custom-command template.
 * Unresolvable placeholders stay literal and are reported via
 * `missing` — callers decide whether that is a validation error.
 */
export function substituteTemplate(template: string, argv: string[]): TemplateSubstitution {
  const missing = new Set<number>();
  const value = template.replace(PLACEHOLDER, (raw, key: string) => {
    if (key === 'query') {
      return argv.join(' ');
    }
    const index = Number(key);
    if (index < 1) {
      return raw;
    }
    const arg = argv[index - 1];
    if (arg === undefined) {
      missing.add(index);
      return raw;
    }
    return arg;
  });
  return { ok: missing.size === 0, value, missing: [...missing].sort((a, b) => a - b) };
}

/** Highest argv position a template can consume (for arity validation on save). */
export function templateArity(template: string): number {
  return templatePlaceholders(template).reduce(
    (max, placeholder) => (placeholder.kind === 'index' ? Math.max(max, placeholder.index) : max),
    0
  );
}
