import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { EmptyState } from '@neuronection/assistant-ui/empty-state';
import { BellOff } from 'lucide-react';
import { TEXT, interpolate } from '@shared/constants/text';
import { notificationListItem, type NotificationListItem } from '@shared/notifications';
import type { NotificationSeverity } from '@shared/schema/vocab';

type Filter = 'all' | 'unread';

const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  info: TEXT.NOTIFICATIONS_SEVERITY_INFO,
  success: TEXT.NOTIFICATIONS_SEVERITY_SUCCESS,
  warn: TEXT.NOTIFICATIONS_SEVERITY_WARN,
  error: TEXT.NOTIFICATIONS_SEVERITY_ERROR,
};

const SEVERITY_CLASS: Record<NotificationSeverity, string> = {
  info: 'bg-[var(--as-muted)] text-[var(--as-muted-fg)]',
  success: 'bg-[var(--as-accent-soft,var(--as-muted))] text-[var(--as-accent-fg,var(--as-fg))]',
  warn: 'bg-[var(--as-warn-soft,var(--as-muted))] text-[var(--as-warn-fg,var(--as-fg))]',
  error: 'bg-[var(--as-danger-soft,var(--as-muted))] text-[var(--as-danger-fg,var(--as-fg))]',
};

const ACTION_LABEL: Record<NotificationListItem['clickAction'], string | null> = {
  none: null,
  'open-conversation': TEXT.NOTIFICATIONS_ACTION_OPEN_CONVERSATION,
  'open-settings': TEXT.NOTIFICATIONS_ACTION_OPEN_SETTINGS,
  'open-pack-report': TEXT.NOTIFICATIONS_ACTION_OPEN_PACK_REPORT,
  'open-path': TEXT.NOTIFICATIONS_ACTION_OPEN_PATH,
};

function formatWhen(createdAt: number): string {
  return new Date(createdAt).toLocaleString();
}

export function NotificationsTab(): JSX.Element {
  const [items, setItems] = useState<NotificationListItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmClear, setConfirmClear] = useState(false);

  const reload = useCallback(async () => {
    const records = (await window.electronAPI.listNotifications?.()) ?? [];
    setItems(records.map(notificationListItem));
  }, []);

  useEffect(() => {
    void reload();
    const unsubscribe = window.electronAPI.onNotificationsChanged?.(() => {
      void reload();
    });
    return () => unsubscribe?.();
  }, [reload]);

  const visible = useMemo(
    () => (filter === 'unread' ? items.filter((item) => item.unread) : items),
    [items, filter]
  );

  const markRead = useCallback(async (id: string) => {
    await window.electronAPI.markNotificationRead?.(id);
  }, []);

  const markAllRead = useCallback(async () => {
    await window.electronAPI.markAllNotificationsRead?.();
  }, []);

  const openItem = useCallback(async (id: string) => {
    await window.electronAPI.clickNotification?.(id);
  }, []);

  const clearAll = useCallback(async () => {
    await window.electronAPI.clearNotifications?.();
    setConfirmClear(false);
  }, []);

  return (
    <div role="tabpanel" aria-label={TEXT.NOTIFICATIONS_TITLE} className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{TEXT.NOTIFICATIONS_TITLE}</h3>
        <p className="text-sm opacity-60">{TEXT.NOTIFICATIONS_SUBTITLE}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={TEXT.NOTIFICATIONS_TITLE} className="flex gap-1 rounded-lg border border-[var(--as-border)] p-0.5">
          {(['all', 'unread'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant={filter === value ? 'default' : 'ghost'}
              size="sm"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'all' ? TEXT.NOTIFICATIONS_FILTER_ALL : TEXT.NOTIFICATIONS_FILTER_UNREAD}
            </Button>
          ))}
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => void markAllRead()} disabled={!items.some((item) => item.unread)}>
          {TEXT.NOTIFICATIONS_MARK_ALL_READ}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmClear(true)} disabled={items.length === 0}>
          {TEXT.NOTIFICATIONS_CLEAR}
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title={filter === 'unread' ? TEXT.NOTIFICATIONS_EMPTY_UNREAD : TEXT.NOTIFICATIONS_EMPTY}
          description={TEXT.NOTIFICATIONS_SUBTITLE}
        />
      ) : (
        <ul role="list" aria-label={TEXT.NOTIFICATIONS_TITLE} className="space-y-2">
          {visible.map((item) => {
            const actionLabel = ACTION_LABEL[item.clickAction];
            return (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-xl border border-[var(--as-border)] bg-[var(--as-card,transparent)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_CLASS[item.severity]}`}>
                        {SEVERITY_LABEL[item.severity]}
                      </span>
                      <span className="truncate text-sm font-semibold">{item.title}</span>
                      {item.count > 1 && (
                        <span className="text-xs opacity-60">{interpolate(TEXT.NOTIFICATIONS_TIMES, { count: item.count })}</span>
                      )}
                      {item.unread && (
                        <span className="text-xs font-medium text-[var(--as-accent-fg,var(--as-fg))]">
                          {TEXT.NOTIFICATIONS_UNREAD}
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm opacity-80">{item.body}</p>
                    <p className="text-xs opacity-50">{formatWhen(item.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {actionLabel && (
                      <Button type="button" variant="secondary" size="sm" onClick={() => void openItem(item.id)}>
                        {actionLabel}
                      </Button>
                    )}
                    {item.unread && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`${TEXT.NOTIFICATIONS_MARK_READ}: ${item.title}`}
                        onClick={() => void markRead(item.id)}
                      >
                        {TEXT.NOTIFICATIONS_MARK_READ}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmationModal
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={TEXT.NOTIFICATIONS_CLEAR}
        description={TEXT.NOTIFICATIONS_CLEAR_CONFIRM}
        confirmLabel={TEXT.NOTIFICATIONS_CLEAR}
        cancelLabel={TEXT.CANCEL_BUTTON}
        destructive
        onConfirm={() => void clearAll()}
      />
    </div>
  );
}
