import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { CommandEntry } from '@shared/commands';
import { evaluateExpression, formatCalcResult } from '@shared/commands';
import { TEXT, interpolate } from '@shared/constants/text';
import { commandIcon } from '@renderer/shared/commandIcons';
import type { PaletteModel } from './commandSource';
import { miniAppForEntry } from './miniApps';
import { entryAppId, getAppIconDataUrl, monogramStyle } from './appIconCache';

function CommandIcon({ name }: { name?: string }): JSX.Element {
  const Icon = commandIcon(name);
  return <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />;
}

function CommandTile({ entry }: { entry: CommandEntry }): JSX.Element {
  const appId = entryAppId(entry);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!appId) {
      return;
    }
    let cancelled = false;
    void getAppIconDataUrl(appId).then((url) => {
      if (!cancelled) {
        setIconUrl(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  if (appId) {
    if (iconUrl) {
      return (
        <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--as-border)] bg-[var(--as-surface)]">
          <img src={iconUrl} alt="" className="size-4" />
        </span>
      );
    }
    return (
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white"
        style={monogramStyle(appId)}
      >
        {(entry.title.charAt(0) || '?').toUpperCase()}
      </span>
    );
  }
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--as-border)] bg-[var(--as-surface)]">
      <CommandIcon name={entry.icon} />
    </span>
  );
}

export interface CommandPaletteProps {
  model: PaletteModel;
  /** True while a turn is in flight — tool executions surface the pending notice instead. */
  pending: boolean;
  onExecute: (entry: CommandEntry, argv: string[]) => void;
  onTabComplete: (entry: CommandEntry) => void;
  onClose: () => void;
  /** Row actions (plan 14 §6): pin toggles, disable hides, configure deep-links settings. */
  onRowAction?: (entry: CommandEntry, action: 'pin' | 'configure' | 'disable') => void;
  pinnedIds?: string[];
  /** Configured argument defaults satisfy required args on execution (settings → Commands → detail). */
  argDefaults?: Record<string, Record<string, unknown>>;
  /** Mini-app capable rows offer "Open" — enters focused mode (plan 14 §9). */
  onOpenApp?: (entry: CommandEntry) => void;
}

interface FlatItem {
  entry: CommandEntry;
  sectionKey: string;
}

export function CommandPalette(props: CommandPaletteProps): JSX.Element {
  const { model } = props;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [usageHint, setUsageHint] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const selectedRef = useRef<HTMLDivElement | null>(null);

  const flat: FlatItem[] = useMemo(
    () =>
      model.sections.flatMap((section) =>
        section.items.map((item) => ({ entry: item.entry, sectionKey: section.key }))
      ),
    [model]
  );

  useEffect(() => {
    setSelectedIndex(0);
    setUsageHint(null);
    setMenuFor(null);
  }, [model.query]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const missingRequired = (entry: CommandEntry): string[] => {
    const defaults = props.argDefaults?.[entry.id];
    const missing: string[] = [];
    entry.args.forEach((spec, index) => {
      const satisfied =
        model.argv[index] !== undefined || (defaults?.[spec.name] !== undefined && defaults?.[spec.name] !== null);
      if (spec.required && !satisfied) {
        missing.push(spec.name);
      }
    });
    return missing;
  };

  const executeAt = (index: number): void => {
    const item = flat[index];
    if (!item) {
      return;
    }
    if (props.onOpenApp && miniAppForEntry(item.entry) && model.argv.length === 0) {
      setUsageHint(null);
      props.onOpenApp(item.entry);
      return;
    }
    const missing = missingRequired(item.entry);
    if (missing.length > 0) {
      const spec = item.entry.args
        .map((arg) => (arg.required ? `<${arg.name}>` : `[${arg.name}]`))
        .join(' ');
      const alias = item.entry.slash ?? item.entry.aliases[0] ?? item.entry.title;
      setUsageHint(interpolate(TEXT.COMMAND_ARG_USAGE, { alias, args: spec }));
      return;
    }
    setUsageHint(null);
    props.onExecute(item.entry, model.argv);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setSelectedIndex((index) => Math.min(index + 1, flat.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setSelectedIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === 'Enter' && flat.length === 0) {
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = flat[selectedIndex];
        if (!item) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Tab') {
          const alias = item.entry.slash ?? item.entry.aliases[0];
          if (alias) {
            props.onTabComplete(item.entry);
          }
          return;
        }
        executeAt(selectedIndex);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  const selectedItem = flat[selectedIndex]?.entry ?? null;
  const calcPreview =
    selectedItem?.action === 'calc:evaluate' && model.argv.length > 0
      ? evaluateExpression(model.argv.join(' '))
      : null;

  return (
    <div
      data-no-drag
      role="listbox"
      aria-label={TEXT.COMMAND_PALETTE_LABEL}
      className="da-rise mb-1 max-h-64 overflow-y-auto rounded-lg border border-[var(--as-border)] bg-[var(--as-surface-raised)] text-sm shadow-xl"
      style={{ borderColor: 'color-mix(in srgb, var(--as-fg) 18%, transparent)' }}
    >
      {flat.length === 0 && (
        <p className="px-3 py-2 text-xs opacity-60" role="status">
          {TEXT.COMMAND_PALETTE_EMPTY}
        </p>
      )}
      {model.sections.map((section) => (
        <div key={section.key} role="group" aria-label={section.label} className="py-1">
          <p className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">{section.label}</p>
          {section.items.map((item) => {
            const index = flat.findIndex((flatItem) => flatItem.entry.id === item.entry.id);
            const selected = index === selectedIndex;
            const pinned = props.pinnedIds?.includes(item.entry.id) ?? false;
            return (
              <div
                key={item.entry.id}
                id={`command-option-${index}`}
                ref={selected ? selectedRef : undefined}
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                className={`border-l-2 ${selected ? 'border-l-[var(--as-primary)]' : 'border-l-transparent'}`}
                style={
                  selected
                    ? { backgroundColor: 'color-mix(in srgb, var(--as-primary) 12%, transparent)' }
                    : undefined
                }
              >
                <div
                  className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${selected ? '' : 'hover:bg-[var(--as-secondary)]'}`}
                  onClick={() => executeAt(index)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelectedIndex(index);
                    setMenuFor(menuFor === item.entry.id ? null : item.entry.id);
                  }}
                >
                  <CommandTile entry={item.entry} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={`truncate text-[13px] leading-4 ${selected ? 'font-medium' : ''}`}>{item.entry.title}</span>
                      <span className="shrink-0 rounded-full border border-[var(--as-border)] px-1.5 text-[9px] uppercase tracking-wide opacity-70">
                        {item.entry.category}
                      </span>
                    </span>
                    {item.entry.subtitle && (
                      <span className={`block truncate text-[11px] leading-4 ${selected ? 'opacity-85' : 'opacity-60'}`}>
                        {item.entry.subtitle}
                      </span>
                    )}
                  </span>
                  {item.entry.slash && (
                    <kbd className="shrink-0 rounded border border-[var(--as-border)] px-1 py-0.5 text-[10px] opacity-70">
                      /{item.entry.slash}
                    </kbd>
                  )}
                </div>
                {menuFor === item.entry.id && (
                  <div className="flex gap-1 border-t border-[var(--as-border)] bg-[var(--as-surface)] px-2 py-1">
                    {miniAppForEntry(item.entry) && props.onOpenApp && (
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-[11px] opacity-80 hover:bg-[var(--as-secondary)] hover:opacity-100"
                        onClick={() => {
                          props.onOpenApp?.(item.entry);
                          setMenuFor(null);
                        }}
                      >
                        {TEXT.COMMAND_OPEN_APP}
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-[11px] opacity-80 hover:bg-[var(--as-secondary)] hover:opacity-100"
                      onClick={() => {
                        props.onRowAction?.(item.entry, 'pin');
                        setMenuFor(null);
                      }}
                    >
                      {pinned ? TEXT.COMMAND_UNPIN : TEXT.COMMAND_PIN}
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-[11px] opacity-80 hover:bg-[var(--as-secondary)] hover:opacity-100"
                      onClick={() => {
                        props.onRowAction?.(item.entry, 'configure');
                        setMenuFor(null);
                      }}
                    >
                      {TEXT.COMMAND_CONFIGURE}
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-[11px] opacity-80 hover:bg-[var(--as-secondary)] hover:opacity-100"
                      onClick={() => {
                        props.onRowAction?.(item.entry, 'disable');
                        setMenuFor(null);
                      }}
                    >
                      {TEXT.COMMAND_DISABLE}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {calcPreview?.ok && selectedItem && (
        <p role="status" className="border-t border-[var(--as-border)] px-3 py-1.5 text-xs opacity-80">
          {interpolate(TEXT.COMMAND_CALC_RESULT, { value: formatCalcResult(calcPreview.value) })}
        </p>
      )}
      {usageHint && (
        <p role="alert" className="border-t border-[var(--as-border)] px-3 py-1.5 text-xs opacity-80">
          {usageHint}
        </p>
      )}
    </div>
  );
}
