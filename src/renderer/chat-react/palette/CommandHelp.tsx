import type { JSX } from 'react';
import type { CommandEntry } from '@shared/commands';
import { commandUsage, freeTextTailArg } from '@shared/commands';
import { TEXT, interpolate } from '@shared/constants/text';

function argTypeLabel(spec: CommandEntry['args'][number]): string {
  switch (spec.type) {
    case 'number':
      return TEXT.COMMAND_ARG_TYPE_NUMBER;
    case 'boolean':
      return TEXT.COMMAND_ARG_TYPE_BOOLEAN;
    case 'array':
      return TEXT.COMMAND_ARG_TYPE_ARRAY;
    case 'enum':
      return interpolate(TEXT.COMMAND_ARG_TYPE_ENUM, { values: (spec.enumValues ?? []).join(', ') });
    default:
      return TEXT.COMMAND_ARG_TYPE_TEXT;
  }
}

export function riskLabel(risk: CommandEntry['risk']): string | null {
  switch (risk) {
    case 'read-only':
      return TEXT.TOOLS_FILTER_READ_ONLY;
    case 'state-changing':
      return TEXT.APPROVAL_RISK_STATE_CHANGING;
    case 'destructive':
      return TEXT.APPROVAL_RISK_DESTRUCTIVE;
    default:
      return null;
  }
}

/** Pinned help for the highlighted row (plan 77): full description, exact syntax, argument table. */
export function CommandHelp({
  entry,
  missing,
  preview,
  argDefaults,
  onConfigure,
}: {
  entry: CommandEntry;
  missing: string[];
  preview: string | null;
  argDefaults?: Record<string, unknown>;
  onConfigure?: () => void;
}): JSX.Element {
  const risk = riskLabel(entry.risk);
  const tail = freeTextTailArg(entry);
  const defaultFor = (name: string, fallback: unknown): unknown =>
    argDefaults?.[name] !== undefined && argDefaults?.[name] !== null ? argDefaults[name] : fallback;
  return (
    <div
      data-testid="command-help"
      role="region"
      aria-label={TEXT.COMMAND_HELP_TITLE}
      className="flex h-36 shrink-0 flex-col border-t border-[var(--as-border)] bg-[var(--as-surface)]/60 px-3 py-2"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold">{entry.title}</span>
          <span className="shrink-0 rounded-full border border-[var(--as-border)] px-1.5 text-[9px] uppercase tracking-wide opacity-70">
            {entry.category}
          </span>
          {risk && (
            <span className="shrink-0 rounded-full border border-[var(--as-border)] px-1.5 text-[9px] uppercase tracking-wide opacity-70">
              {risk}
            </span>
          )}
        </div>
        {entry.subtitle && <p className="mt-1 text-[11px] leading-snug opacity-80">{entry.subtitle}</p>}
        {(entry.risk === 'state-changing' || entry.risk === 'destructive') && (
          <p className="mt-0.5 text-[10px] text-[var(--as-warning)] opacity-80">{TEXT.COMMAND_HELP_APPROVAL}</p>
        )}
        <p className="mt-1 font-mono text-[11px] text-[var(--as-primary)]" data-testid="command-help-usage">
          {commandUsage(entry)}
        </p>
        {entry.args.length > 0 && (
          <div className="mt-1.5 space-y-0.5" data-testid="command-help-args">
            <p className="text-[9px] font-semibold uppercase tracking-wide opacity-60">{TEXT.COMMAND_HELP_ARGS}</p>
            {entry.args.map((spec) => (
              <div key={spec.name} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] leading-snug">
                <span className="font-mono">{spec.name}</span>
                <span className={spec.required ? 'text-[var(--as-warning)]' : 'opacity-50'}>
                  {spec.required ? TEXT.COMMAND_ARG_REQUIRED : TEXT.COMMAND_ARG_OPTIONAL}
                </span>
                <span className="opacity-60">{argTypeLabel(spec)}</span>
                {defaultFor(spec.name, spec.defaultValue) !== undefined && (
                  <span className="opacity-50">
                    {interpolate(TEXT.COMMAND_ARG_DEFAULT, { value: String(defaultFor(spec.name, spec.defaultValue)) })}
                  </span>
                )}
                {spec.description && <span className="basis-full opacity-70">{spec.description}</span>}
              </div>
            ))}
            {tail !== null && entry.args.some((arg) => arg !== tail) && (
              <p className="text-[10px] opacity-60">
                {TEXT.COMMAND_ARG_TAIL_HINT}
                {onConfigure && (
                  <button
                    type="button"
                    data-testid="command-help-defaults"
                    className="ml-1 underline opacity-80 hover:opacity-100"
                    onClick={onConfigure}
                  >
                    {TEXT.COMMAND_ARG_SET_DEFAULTS}
                  </button>
                )}
              </p>
            )}
          </div>
        )}
        {preview && <p className="mt-1 text-[11px] opacity-80">{preview}</p>}
      </div>
      <p role="status" className="shrink-0 pt-1 text-[10px] opacity-60" data-testid="command-help-footer">
        {missing.length > 0
          ? interpolate(TEXT.COMMAND_ARG_NEEDS, { args: missing.map((name) => `<${name}>`).join(' ') })
          : TEXT.COMMAND_ARG_READY}
      </p>
    </div>
  );
}
