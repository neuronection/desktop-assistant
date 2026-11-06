import { useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Keyboard, X } from 'lucide-react';
import { Button } from '@neuronection/assistant-ui/button';
import { TEXT } from '@shared/constants/text';
import {
  FIXED_IN_WINDOW_SHORTCUTS,
  SHORTCUT_GROUPS,
  detectMacPlatform,
  displayAccelerator,
  type ShortcutEntry,
  type ShortcutGroupId,
  type ShortcutsView,
} from '@shared/shortcuts';
import type { HotkeyAction } from '@shared/types';
import { useLatestRef } from './useLatestRef';

export interface ShortcutsSheetProps {
  onClose: () => void;
}

interface SheetGroup {
  id: ShortcutGroupId;
  label: string;
  entries: ShortcutEntry[];
}

function groupOf(action: string): Exclude<ShortcutGroupId, 'commands'> {
  return SHORTCUT_GROUPS[action as HotkeyAction] ?? 'general';
}

function groupEntries(view: ShortcutsView | null): SheetGroup[] {
  if (!view) {
    return [];
  }
  const groupFor = (id: Exclude<ShortcutGroupId, 'commands'>): SheetGroup => ({
    id,
    label: id === 'general' ? TEXT.SHORTCUTS_GROUP_GENERAL : TEXT.SHORTCUTS_GROUP_VOICE,
    entries: view.builtIns.filter((entry) => groupOf(entry.action) === id),
  });
  const inWindow: SheetGroup = {
    id: 'in-window',
    label: TEXT.SHORTCUTS_GROUP_IN_WINDOW,
    entries: FIXED_IN_WINDOW_SHORTCUTS.map((shortcut) => ({
      action: `in-window:${shortcut.keys}`,
      label: shortcut.label,
      accelerator: shortcut.keys,
    })),
  };
  const groups: SheetGroup[] = [groupFor('general'), groupFor('voice'), inWindow];
  if (view.commands.length > 0) {
    groups.push({ id: 'commands', label: TEXT.SHORTCUTS_GROUP_COMMANDS, entries: view.commands });
  }
  return groups.filter((group) => group.entries.length > 0);
}

/**
 * Read-only shortcuts cheat sheet (plan 59): every configured accelerator,
 * grouped into a two-column grid so the common case fits without the
 * internal scrollbar (the scroll region stays as the large-list safety
 * net). Groups are grid ITEMS, so a group can never split across columns
 * or rows. An odd last group (the In-window strip on a fresh install)
 * spans both columns instead of leaving an empty cell. It renders IN FLOW
 * so the measured chrome grows (fixed positioning clips at window bounds)
 * and fetches `hotkeys:shortcuts` on every mount — opening the sheet is
 * the cache boundary (D5), never a module-level copy. Escape is
 * capture-phase with a latest-ref so the sheet closes before the
 * launcher's bubble ladder (hide/collapse) reacts.
 */
export function ShortcutsSheet({ onClose }: ShortcutsSheetProps): JSX.Element {
  const [view, setView] = useState<ShortcutsView | null>(null);
  const closeRef = useLatestRef(onClose);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const isMac = useMemo(() => detectMacPlatform(), []);

  useLayoutEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => {
      openerRef.current?.focus?.();
    };
  }, []);

  useLayoutEffect(() => {
    let mounted = true;
    void Promise.resolve(window.electronAPI?.getShortcuts?.())
      .then((next) => {
        if (mounted) {
          setView(next ?? { builtIns: [], commands: [] });
        }
      })
      .catch(() => {
        if (mounted) {
          setView({ builtIns: [], commands: [] });
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useLayoutEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [closeRef]);

  const groups = useMemo(() => groupEntries(view), [view]);

  return (
    <section
      data-no-drag
      role="dialog"
      aria-label={TEXT.SHORTCUTS_TITLE}
      className="da-rise mb-1 rounded-xl border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-2 text-sm"
    >
      <header className="flex items-center gap-2 px-1">
        <Keyboard className="size-3.5 shrink-0 text-[var(--as-primary)]" aria-hidden />
        <span className="text-xs font-semibold opacity-80">{TEXT.SHORTCUTS_TITLE}</span>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label={TEXT.CLOSE_BUTTON}
          title={TEXT.CLOSE_BUTTON}
          className="ml-auto rounded-md p-1 opacity-60 hover:bg-[var(--as-secondary)] hover:opacity-100"
          onClick={onClose}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </header>
      <p className="px-1 pb-1 pt-0.5 text-[11px] opacity-60">{TEXT.SHORTCUTS_SUBTITLE}</p>
      <div data-testid="shortcuts-scroll" className="max-h-[22rem] overflow-y-auto">
        <div data-testid="shortcuts-grid" className="grid grid-cols-2 items-start gap-x-3 gap-y-1">
          {groups.map((group, index) => {
            const spansRow = groups.length % 2 === 1 && index === groups.length - 1;
            return (
              <section
                key={group.id}
                role="group"
                aria-label={group.label}
                className={`min-w-0 px-1 py-0.5 ${spansRow ? 'col-span-2' : ''}`}
              >
                <h4 className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-50">
                  {group.label}
                </h4>
                <ul>
                  {group.entries.map((entry) => (
                    <li
                      key={`${group.id}:${entry.action}`}
                      className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-[var(--as-secondary)]"
                    >
                      <span className="min-w-0 truncate text-xs" title={entry.label}>
                        {entry.label}
                      </span>
                      {entry.accelerator ? (
                        <kbd className="shrink-0 rounded border border-[var(--as-border)] bg-[var(--as-secondary)]/60 px-1.5 py-0.5 font-mono text-[10px] leading-none">
                          {displayAccelerator(entry.accelerator, isMac)}
                        </kbd>
                      ) : (
                        <span className="shrink-0 text-[10px] opacity-50">{TEXT.HOTKEYS_NOT_SET}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-[var(--as-border)] px-1 pt-2">
        <span className="text-[10px] opacity-50">{TEXT.SHORTCUTS_FOOTER}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onClose();
            void window.electronAPI.onSettingsOpen({ tab: 'hotkeys' });
            void window.electronAPI.hideWindow();
          }}
        >
          {TEXT.SHORTCUTS_CUSTOMIZE}
        </Button>
      </footer>
    </section>
  );
}
