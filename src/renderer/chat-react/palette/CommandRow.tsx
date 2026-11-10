import { useEffect, useState, type JSX, type Ref } from 'react';
import type { CommandEntry } from '@shared/commands';
import { commandUsage } from '@shared/commands';
import { TEXT } from '@shared/constants/text';
import { commandIcon } from '@renderer/shared/commandIcons';
import { entryAppId, getAppIconDataUrl, monogramStyle } from '../appIconCache';

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

export interface CommandRowProps {
  entry: CommandEntry;
  index: number;
  selected: boolean;
  pinned: boolean;
  /** The per-row action menu (`⋯` via right-click) is open for this row. */
  menuOpen: boolean;
  optionRef?: Ref<HTMLDivElement>;
  onSelect: () => void;
  onRun: () => void;
  onMenuToggle: () => void;
  onRowAction?: (entry: CommandEntry, action: 'pin' | 'configure' | 'disable') => void;
  onOpenApp?: (entry: CommandEntry) => void;
  /** Mini-app capable rows offer "Open" (plan 14 §9). */
  canOpenApp: boolean;
}

/** One palette result: tile, title/badges, subtitle, usage + the right-click action row. */
export function CommandRow({
  entry,
  index,
  selected,
  pinned,
  menuOpen,
  optionRef,
  onSelect,
  onRun,
  onMenuToggle,
  onRowAction,
  onOpenApp,
  canOpenApp,
}: CommandRowProps): JSX.Element {
  return (
    <div
      id={`command-option-${index}`}
      ref={optionRef}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      className={`border-l-2 ${selected ? 'border-l-[var(--as-primary)]' : 'border-l-transparent'}`}
      style={selected ? { backgroundColor: 'color-mix(in srgb, var(--as-primary) 12%, transparent)' } : undefined}
    >
      <div
        className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${selected ? '' : 'hover:bg-[var(--as-secondary)]/70'}`}
        onClick={onSelect}
        onDoubleClick={onRun}
        onContextMenu={(event) => {
          event.preventDefault();
          onSelect();
          onMenuToggle();
        }}
      >
        <CommandTile entry={entry} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-[13px] leading-4 ${selected ? 'font-medium' : ''}`}>{entry.title}</span>
            {entry.beta && (
              <span
                data-testid="palette-beta"
                title={TEXT.BETA_TAG_HINT}
                className="shrink-0 rounded-full border border-[var(--as-warning)]/50 px-1.5 text-[9px] uppercase tracking-wide text-[var(--as-warning)]"
              >
                {TEXT.BETA_TAG}
              </span>
            )}
            <span className="shrink-0 rounded-full border border-[var(--as-border)] px-1.5 text-[9px] uppercase tracking-wide opacity-70">
              {entry.category}
            </span>
          </span>
          {entry.subtitle && (
            <span className={`block truncate text-[11px] leading-4 ${selected ? 'opacity-85' : 'opacity-60'}`}>
              {entry.subtitle}
            </span>
          )}
        </span>
        {entry.slash && (
          <kbd
            className="max-w-[46%] shrink-0 truncate rounded border border-[var(--as-border)] px-1 py-0.5 font-mono text-[10px] opacity-70"
            title={commandUsage(entry)}
          >
            {commandUsage(entry)}
          </kbd>
        )}
      </div>
      {menuOpen && (
        <div className="flex gap-1 border-t border-[var(--as-border)] bg-[var(--as-surface)] px-2 py-1">
          {canOpenApp && onOpenApp && (
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[11px] opacity-80 hover:bg-[var(--as-secondary)] hover:opacity-100"
              onClick={() => {
                onOpenApp(entry);
                onMenuToggle();
              }}
            >
              {TEXT.COMMAND_OPEN_APP}
            </button>
          )}
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[11px] opacity-80 hover:bg-[var(--as-secondary)] hover:opacity-100"
            onClick={() => {
              onRowAction?.(entry, 'pin');
              onMenuToggle();
            }}
          >
            {pinned ? TEXT.COMMAND_UNPIN : TEXT.COMMAND_PIN}
          </button>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[11px] opacity-80 hover:bg-[var(--as-secondary)] hover:opacity-100"
            onClick={() => {
              onRowAction?.(entry, 'configure');
              onMenuToggle();
            }}
          >
            {TEXT.COMMAND_CONFIGURE}
          </button>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[11px] opacity-80 hover:bg-[var(--as-secondary)] hover:opacity-100"
            onClick={() => {
              onRowAction?.(entry, 'disable');
              onMenuToggle();
            }}
          >
            {TEXT.COMMAND_DISABLE}
          </button>
        </div>
      )}
    </div>
  );
}
