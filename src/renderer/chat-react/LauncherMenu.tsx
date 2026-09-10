import { useEffect, useRef, type JSX } from 'react';
import { Maximize2, Monitor, Settings, SquarePen } from 'lucide-react';
import { TEXT } from '@shared/constants/text';

export interface LauncherMenuProps {
  onToggleExpand: () => void;
  onOpenDesktop: () => void;
  onNewConversation: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

export function LauncherMenu(props: LauncherMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const { onClose } = props;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
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

  const items = [
    { key: 'new', icon: SquarePen, label: TEXT.MENU_NEW_CONVERSATION, action: props.onNewConversation },
    { key: 'expand', icon: Maximize2, label: TEXT.MENU_EXPAND, action: props.onToggleExpand },
    { key: 'desktop', icon: Monitor, label: TEXT.LAUNCHER_OPEN_DESKTOP, action: props.onOpenDesktop },
    { key: 'settings', icon: Settings, label: TEXT.MENU_SETTINGS, action: props.onOpenSettings },
  ];

  return (
    <div
      ref={ref}
      data-no-drag
      role="menu"
      aria-label={TEXT.MENU_LAUNCHER_LABEL}
      className="da-rise mb-1 flex flex-col overflow-hidden rounded-lg border border-[var(--as-border)] bg-[var(--as-surface-raised)] text-sm shadow-lg"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className="flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--as-secondary)]"
          onClick={() => {
            onClose();
            item.action();
          }}
        >
          <item.icon className="h-3.5 w-3.5 opacity-70" aria-hidden />
          {item.label}
        </button>
      ))}
    </div>
  );
}
