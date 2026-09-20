import { useEffect, useRef, useState, type ComponentType, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowLeft, History, Settings, SquarePen } from 'lucide-react';
import { TEXT, interpolate } from '@shared/constants/text';
import { DesktopModeIcon, ExpandedModeIcon } from '@renderer/shared/modeIcons';

export interface LauncherMenuConversation {
  id: string;
  title: string;
  updatedAt?: string;
}

export interface LauncherMenuProps {
  onToggleExpand: () => void;
  onOpenDesktop: () => void;
  onNewConversation: () => void;
  onOpenSettings: () => void;
  onOpenConversation: (id: string) => void;
  onOpenConversationDesktop: (id: string) => void;
  conversations: LauncherMenuConversation[];
  activeId: string | null;
  onClose: () => void;
}

interface MenuTileItem {
  key: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
  badge?: number;
  action: () => void;
}

function relativeTime(iso: string | undefined): string {
  if (!iso) {
    return '';
  }
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) {
    return '';
  }
  const minutes = Math.floor((Date.now() - ms) / 60000);
  if (minutes < 1) {
    return TEXT.HISTORY_JUST_NOW;
  }
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (minutes < 60) {
    return format.format(-minutes, 'minute');
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return format.format(-hours, 'hour');
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return format.format(-days, 'day');
  }
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const tileClass =
  'group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-100 hover:bg-[var(--as-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--as-focus-ring)]';
const iconTileClass =
  'flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent bg-[var(--as-secondary)]/70 text-[var(--as-fg)]/70 transition-colors duration-100 group-hover:border-[var(--as-primary)]/30 group-hover:bg-[var(--as-primary)]/10 group-hover:text-[var(--as-primary)]';
const shortcutClass =
  'shrink-0 rounded border border-[var(--as-border)] bg-[var(--as-secondary)]/60 px-1 py-0.5 text-[10px] font-medium leading-none opacity-60';
const focusRingClass = 'focus-visible:outline-2 focus-visible:outline-[var(--as-focus-ring)]';

function MenuTile({ item }: { item: MenuTileItem }): JSX.Element {
  return (
    <button type="button" role="menuitem" className={tileClass} onClick={item.action}>
      <span className={iconTileClass} aria-hidden>
        <item.icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {typeof item.badge === 'number' && item.badge > 0 && (
        <span className="shrink-0 rounded-full bg-[var(--as-primary)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--as-primary)]">
          {item.badge}
        </span>
      )}
      {item.shortcut && <kbd className={shortcutClass}>{item.shortcut}</kbd>}
    </button>
  );
}

function MenuSeparator(): JSX.Element {
  return <div role="separator" className="my-1 border-t border-[var(--as-border)]" />;
}

export function LauncherMenu(props: LauncherMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<'menu' | 'history'>('menu');
  const viewRef = useRef<'menu' | 'history'>('menu');
  viewRef.current = view;
  const { onClose } = props;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (viewRef.current === 'history') {
          setView('menu');
          return;
        }
        onClose();
      }
    };
    const onMouseDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onMouseDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus();
  }, [view]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []);
    if (items.length === 0) {
      return;
    }
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'ArrowDown') {
      next = current < 0 ? 0 : (current + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
      next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else {
      next = items.length - 1;
    }
    event.preventDefault();
    items[next].focus();
  };

  const menuItems: MenuTileItem[] = [
    { key: 'new', icon: SquarePen, label: TEXT.MENU_NEW_CONVERSATION, action: () => { onClose(); props.onNewConversation(); } },
    { key: 'history', icon: History, label: TEXT.MENU_HISTORY, badge: props.conversations.length, action: () => setView('history') },
    { key: 'expand', icon: ExpandedModeIcon, label: TEXT.MENU_EXPAND_ACTION, shortcut: TEXT.SHORTCUT_EXPAND, action: () => { onClose(); props.onToggleExpand(); } },
    { key: 'desktop', icon: DesktopModeIcon, label: TEXT.LAUNCHER_OPEN_DESKTOP_ACTION, shortcut: TEXT.SHORTCUT_DESKTOP, action: () => { onClose(); props.onOpenDesktop(); } },
    { key: 'settings', icon: Settings, label: TEXT.MENU_SETTINGS, action: () => { onClose(); props.onOpenSettings(); } },
  ];

  return (
    <div
      ref={ref}
      data-no-drag
      role="menu"
      aria-label={view === 'menu' ? TEXT.MENU_LAUNCHER_LABEL : TEXT.MENU_HISTORY_LABEL}
      onKeyDown={moveFocus}
      className="da-rise mb-1 ml-auto w-64 overflow-hidden rounded-xl border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-1.5 text-sm shadow-xl"
    >
      {view === 'menu' ? (
        <>
          {menuItems.slice(0, 2).map((item) => (
            <MenuTile key={item.key} item={item} />
          ))}
          <MenuSeparator />
          {menuItems.slice(2, 4).map((item) => (
            <MenuTile key={item.key} item={item} />
          ))}
          <MenuSeparator />
          {menuItems.slice(4).map((item) => (
            <MenuTile key={item.key} item={item} />
          ))}
        </>
      ) : (
        <>
          <div role="group" className="flex items-center gap-1 px-0.5 py-0.5">
            <button
              type="button"
              role="menuitem"
              aria-label={TEXT.HISTORY_BACK}
              title={TEXT.HISTORY_BACK}
              className={`flex size-6 shrink-0 items-center justify-center rounded-md opacity-70 hover:bg-[var(--as-secondary)] hover:opacity-100 ${focusRingClass}`}
              onClick={() => setView('menu')}
            >
              <ArrowLeft className="size-3.5" aria-hidden />
            </button>
            <span className="text-xs font-semibold opacity-80">{TEXT.MENU_HISTORY}</span>
            {props.conversations.length > 0 && (
              <span className="ml-auto pr-1 text-[10px] opacity-50">
                {interpolate(TEXT.MENU_HISTORY_COUNT, { count: props.conversations.length })}
              </span>
            )}
          </div>
          {props.conversations.length === 0 ? (
            <div role="group" className="px-2.5 py-3 text-center text-xs opacity-50">
              {TEXT.HISTORY_EMPTY}
            </div>
          ) : (
            <div role="group" className="max-h-56 overflow-y-auto">
              {props.conversations.map((conversation) => {
                const title = conversation.title?.trim() || TEXT.HISTORY_UNTITLED;
                return (
                  <div
                    key={conversation.id}
                    role="group"
                    className="group flex items-center rounded-lg hover:bg-[var(--as-secondary)] focus-within:bg-[var(--as-secondary)]"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      title={TEXT.HISTORY_OPEN_EXPANDED}
                      className={`flex min-w-0 flex-1 items-center gap-2 rounded-l-lg px-2 py-1.5 text-left ${focusRingClass}`}
                      onClick={() => {
                        onClose();
                        props.onOpenConversation(conversation.id);
                      }}
                    >
                      <span
                        aria-hidden
                        className={`size-1.5 shrink-0 rounded-full ${
                          conversation.id === props.activeId ? 'bg-[var(--as-primary)]' : 'bg-[var(--as-border)]'
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs">{title}</span>
                      <span className="shrink-0 text-[10px] opacity-50">{relativeTime(conversation.updatedAt)}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      aria-label={TEXT.HISTORY_OPEN_DESKTOP}
                      title={TEXT.HISTORY_OPEN_DESKTOP}
                      className={`flex size-7 shrink-0 items-center justify-center rounded-md opacity-40 transition-opacity hover:bg-[var(--as-secondary)] hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 ${focusRingClass}`}
                      onClick={() => {
                        onClose();
                        props.onOpenConversationDesktop(conversation.id);
                      }}
                    >
                      <DesktopModeIcon className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
