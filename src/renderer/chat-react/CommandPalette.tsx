import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { CommandEntry } from '@shared/commands';
import { missingRequiredArgs, parsePalettePrefix } from '@shared/commands';
import { evaluateCalculator } from '@packs/mini-calc/calculator';
import { TEXT, interpolate } from '@shared/constants/text';
import type { PaletteModel } from './commandSource';
import { miniAppForEntry } from './miniApps';
import { CommandHelp } from './palette/CommandHelp';
import { CommandRow } from './palette/CommandRow';

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
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const selectedRef = useRef<HTMLDivElement | null>(null);

  const flat: FlatItem[] = useMemo(
    () =>
      model.sections.flatMap((section) =>
        section.items.map((item) => ({ entry: item.entry, sectionKey: section.key }))
      ),
    [model]
  );

  useLayoutEffect(() => {
    setSelectedIndex(0);
    setMenuFor(null);
  }, [model.query]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);


  const missingFor = (entry: CommandEntry): string[] =>
    missingRequiredArgs(entry, model.argv, props.argDefaults?.[entry.id]);

  const executeAt = (index: number): void => {
    const item = flat[index];
    if (!item) {
      return;
    }
    if (props.onOpenApp && miniAppForEntry(item.entry) && model.argv.length === 0) {
      props.onOpenApp(item.entry);
      return;
    }
    // An incomplete command is never dispatched: Enter completes it into the
    // composer so the user can type the arguments it explains (plan 77).
    if (missingFor(item.entry).length > 0) {
      props.onTabComplete(item.entry);
      return;
    }
    props.onExecute(item.entry, model.argv);
  };

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.isComposing) {
        return;
      }
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
        if (parsePalettePrefix(props.model.query).kind !== 'none') {
          event.preventDefault();
          event.stopPropagation();
        }
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
      ? evaluateCalculator(model.argv.join(' '))
      : null;

  const missing = selectedItem ? missingFor(selectedItem) : [];
  const preview = calcPreview?.ok ? interpolate(TEXT.COMMAND_CALC_RESULT, { value: calcPreview.display }) : null;

  return (
    <div
      data-no-drag
      className="da-rise mb-1 overflow-hidden rounded-lg border border-[var(--as-border)] bg-[var(--as-surface-raised)] text-sm shadow-xl"
      style={{ borderColor: 'color-mix(in srgb, var(--as-fg) 18%, transparent)' }}
    >
      <div
        role="listbox"
        aria-label={TEXT.COMMAND_PALETTE_LABEL}
        data-testid="command-list"
        className="max-h-64 overflow-y-auto"
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
            return (
              <CommandRow
                key={item.entry.id}
                entry={item.entry}
                index={index}
                selected={selected}
                pinned={props.pinnedIds?.includes(item.entry.id) ?? false}
                menuOpen={menuFor === item.entry.id}
                optionRef={selected ? selectedRef : undefined}
                onSelect={() => setSelectedIndex(index)}
                onRun={() => executeAt(index)}
                onMenuToggle={() => setMenuFor(menuFor === item.entry.id ? null : item.entry.id)}
                {...(props.onRowAction !== undefined ? { onRowAction: props.onRowAction } : {})}
                {...(props.onOpenApp !== undefined ? { onOpenApp: props.onOpenApp } : {})}
                canOpenApp={miniAppForEntry(item.entry) !== null}
              />
            );
          })}
        </div>
      ))}
      </div>
      {model.query === '' && (
        <p className="border-t border-[var(--as-border)] px-3 py-1 text-[10px] opacity-60" data-testid="palette-prefix-hint">
          {TEXT.COMMAND_PREFIX_HINT}
        </p>
      )}
      {model.browseHidden !== undefined && (
        <p role="status" className="border-t border-[var(--as-border)] px-3 py-1 text-[10px] opacity-60" data-testid="palette-browse-more">
          {interpolate(TEXT.COMMAND_BROWSE_MORE, { count: model.browseHidden })}
        </p>
      )}
      {selectedItem && (
        <CommandHelp
          entry={selectedItem}
          missing={missing}
          preview={preview}
          {...(props.argDefaults?.[selectedItem.id] !== undefined ? { argDefaults: props.argDefaults[selectedItem.id] } : {})}
          {...(props.onRowAction !== undefined ? { onConfigure: () => props.onRowAction?.(selectedItem, 'configure') } : {})}
        />
      )}
    </div>
  );
}
