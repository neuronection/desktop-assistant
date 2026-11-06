import { describe, expect, it } from 'vitest';
import { badgeCountOf, isBadgeSeverity, notificationListItem, type NotificationRecordView } from '@shared/notifications';

function record(overrides: Partial<NotificationRecordView> = {}): NotificationRecordView {
  return {
    id: 'n-1',
    kind: 'system',
    severity: 'info',
    title: 'Scheduled run finished',
    body: 'Your morning digest is ready.',
    payload: {},
    sourceRef: null,
    clickAction: 'none',
    dedupeKey: 'k',
    readAt: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('notification list item (plan 42 S2)', () => {
  it('maps a record to an unread list item with the count floored at 1', () => {
    const item = notificationListItem(record({ payload: { count: 3 } }));
    expect(item).toMatchObject({
      id: 'n-1',
      severity: 'info',
      title: 'Scheduled run finished',
      body: 'Your morning digest is ready.',
      unread: true,
      count: 3,
      createdAt: 1_700_000_000_000,
      clickAction: 'none',
      sourceRef: null,
    });
  });

  it('floors a missing or malformed count to 1 and treats readAt as read', () => {
    expect(notificationListItem(record()).count).toBe(1);
    expect(notificationListItem(record({ payload: { count: 'x' } })).count).toBe(1);
    expect(notificationListItem(record({ payload: { count: 0 } })).count).toBe(1);
    expect(notificationListItem(record({ readAt: 1 })).unread).toBe(false);
  });

  it('carries the closed click action and source ref through unchanged', () => {
    const item = notificationListItem(
      record({ clickAction: 'open-pack-report', sourceRef: JSON.stringify({ packId: 'p', runId: 'r' }) })
    );
    expect(item.clickAction).toBe('open-pack-report');
    expect(item.sourceRef).toBe(JSON.stringify({ packId: 'p', runId: 'r' }));
  });

  it('badges only unread warn/error records', () => {
    expect(isBadgeSeverity('warn')).toBe(true);
    expect(isBadgeSeverity('error')).toBe(true);
    expect(isBadgeSeverity('info')).toBe(false);
    expect(isBadgeSeverity('success')).toBe(false);
    const rows = [
      { readAt: null, severity: 'warn' as const },
      { readAt: null, severity: 'error' as const },
      { readAt: null, severity: 'info' as const },
      { readAt: 1, severity: 'error' as const },
    ];
    expect(badgeCountOf(rows)).toBe(2);
  });
});
