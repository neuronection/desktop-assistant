import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { TEXT } from '@shared/constants/text';
import { DesktopModeIcon, ExpandedModeIcon, LauncherModeIcon } from './modeIcons';

export type ViewId = 'compact' | 'expanded' | 'desktop';

interface ViewOption {
  id: ViewId;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

const VIEWS: ViewOption[] = [
  { id: 'compact', label: TEXT.VIEW_COMPACT, description: TEXT.VIEW_COMPACT_HINT, icon: LauncherModeIcon },
  { id: 'expanded', label: TEXT.VIEW_EXPANDED, description: TEXT.VIEW_EXPANDED_HINT, icon: ExpandedModeIcon },
  { id: 'desktop', label: TEXT.VIEW_DESKTOP, description: TEXT.VIEW_DESKTOP_HINT, icon: DesktopModeIcon },
];

export interface ViewSwitcherProps {
  current: ViewId;
  /** The picked view — hosts ignore the current one and own the window transition (and menu close). */
  onSelect: (view: ViewId) => void;
  /** `popover` = trigger + anchored menu (headers); `inline` = the grid itself (compact launcher menu). */
  variant?: 'popover' | 'inline';
  /** Live accelerator hints from `config.hotkeys` (never hardcoded). */
  hints?: Partial<Record<ViewId, string>>;
  className?: string;
}

/**
 * One control for "where does the chat live" (plan 73): a 3-card grid of the
 * compact launcher, the expanded launcher and the desktop window, with the
 * active one checked. It is a handoff menu, not tabs — each view is its own
 * window. Popover in headers; the compact launcher mounts the grid in flow.
 */
export function ViewSwitcher({
  current,
  onSelect,
  variant = 'popover',
  hints,
  className = '',
}: ViewSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(open);

  useLayoutEffect(() => {
    openRef.current = open;
  }, [open]);

  const close = useCallback((focusTrigger = false): void => {
    setOpen(false);
    if (focusTrigger) {
      rootRef.current?.querySelector<HTMLButtonElement>('[data-view-trigger]')?.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && event.target instanceof Node && rootRef.current.contains(event.target)) {
        return;
      }
      close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [close, open]);

  useLayoutEffect(() => {
    if (open) {
      firstItemRef.current?.focus();
    }
  }, [open]);

  const pick = (view: ViewId): void => {
    setOpen(false);
    onSelect(view);
    rootRef.current?.querySelector<HTMLButtonElement>('[data-view-trigger]')?.focus();
  };

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown' && event.key !== 'ArrowLeft' && event.key !== 'ArrowUp') {
      return;
    }
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-view-option]') ?? []);
    if (items.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const next = currentIndex < 0 ? 0 : (currentIndex + (forward ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  const grid = (
    <div
      role={variant === 'popover' ? 'menu' : 'group'}
      aria-label={TEXT.SWITCH_VIEW_ARIA}
      onKeyDown={onGridKeyDown}
      data-testid="view-grid"
      className={variant === 'popover' ? 'grid grid-cols-1 gap-1 p-1' : 'grid grid-cols-3 gap-1'}
    >
      {VIEWS.map((view, index) => {
        const active = view.id === current;
        return (
          <button
            key={view.id}
            ref={index === 0 ? firstItemRef : undefined}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            data-view-option={view.id}
            data-testid={`view-option-${view.id}`}
            onClick={() => pick(view.id)}
            className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${
              active
                ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10'
                : 'border-[var(--as-border)] hover:border-[var(--as-primary)]/40 hover:bg-[var(--as-secondary)]'
            } ${variant === 'inline' ? 'flex-col items-center gap-1 px-1.5 py-2 text-center' : ''}`}
          >
            <view.icon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-xs font-medium">
                {view.label}
                {active && <Check className="size-3 shrink-0 text-[var(--as-primary)]" aria-hidden />}
              </span>
              <span className={`block text-[10px] leading-snug opacity-60 ${variant === 'inline' ? 'hidden' : ''}`}>
                {view.description}
              </span>
              {hints?.[view.id] && (
                <kbd
                  className={`mt-0.5 rounded border border-[var(--as-border)] px-1 font-mono text-[10px] leading-4 opacity-60 ${
                    variant === 'inline' ? 'mx-auto block w-fit' : 'inline-block'
                  }`}
                >
                  {hints[view.id]}
                </kbd>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (variant === 'inline') {
    return (
      <div ref={rootRef} className={className}>
        {grid}
      </div>
    );
  }

  const active = VIEWS.find((view) => view.id === current) ?? VIEWS[0];

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        data-view-trigger
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={TEXT.SWITCH_VIEW_ARIA}
        title={TEXT.SWITCH_VIEW_ARIA}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-[var(--as-secondary)]"
      >
        <active.icon className="h-4 w-4" />
        <span className="whitespace-nowrap">{active.label}</span>
        <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
      </button>
      {open && (
        <div
          data-no-drag
          data-testid="view-menu"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-1 text-[var(--as-fg)] shadow-[var(--as-shadow-3)]"
        >
          {grid}
        </div>
      )}
    </div>
  );
}
