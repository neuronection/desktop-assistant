import type { NotificationClickAction, NotificationKind, NotificationSeverity } from './schema/vocab';
import { TEXT } from './constants/text';

/** The persisted record shape as it crosses the IPC bridge. */
export interface NotificationRecordView {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  sourceRef: string | null;
  clickAction: NotificationClickAction;
  dedupeKey: string;
  readAt: number | null;
  createdAt: number;
}

/** The inbox list item (plan 42 S2): a record reduced to what a row renders. */
export interface NotificationListItem {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
  /** `readAt === null`. */
  unread: boolean;
  /** Dedupe count (`payload.count`), floored at 1. */
  count: number;
  /** Epoch ms. */
  createdAt: number;
  /** Closed vocabulary — drives the deep-link button (or none). */
  clickAction: NotificationClickAction;
  sourceRef: string | null;
}

/**
 * Record → list item. Pure: the inbox and its tests share one mapping, and
 * the count floor means a malformed payload can never render "0×".
 */
export function notificationListItem(record: NotificationRecordView): NotificationListItem {
  const rawCount = record.payload?.count;
  const count = typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 1;
  return {
    id: record.id,
    kind: record.kind,
    severity: record.severity,
    title: record.title,
    body: record.body,
    unread: record.readAt === null,
    count,
    createdAt: record.createdAt,
    clickAction: record.clickAction,
    sourceRef: record.sourceRef,
  };
}

/** Unread `warn`/`error` records are what the tray badge counts (plan 42 D3). */
export function isBadgeSeverity(severity: NotificationSeverity): boolean {
  return severity === 'warn' || severity === 'error';
}

export function badgeCountOf(records: readonly Pick<NotificationRecordView, 'readAt' | 'severity'>[]): number {
  return records.filter((record) => record.readAt === null && isBadgeSeverity(record.severity)).length;
}

/**
 * What each platform can actually render for the tray badge (plan 42 S2):
 * macOS has a numeric title; Windows/Linux tray icons have no badge, so
 * the count rides the tooltip. Stated honestly, never faked.
 */
export function trayBadgeSupport(platform: string): { native: boolean; description: string } {
  if (platform === 'darwin') {
    return { native: true, description: TEXT.NOTIFICATIONS_BADGE_DARWIN };
  }
  if (platform === 'win32') {
    return { native: false, description: TEXT.NOTIFICATIONS_BADGE_WIN32 };
  }
  return { native: false, description: TEXT.NOTIFICATIONS_BADGE_LINUX };
}
