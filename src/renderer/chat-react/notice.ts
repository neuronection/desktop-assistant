import { TEXT } from '@shared/constants/text';
import type { NotificationRecordView } from '@shared/notifications';
import type { NotificationClickAction } from '@shared/schema/vocab';

export type NoticeType = 'success' | 'error' | 'info' | 'warn';

export interface NoticeState {
  id: number;
  type: NoticeType;
  message: string;
  /** Explicit deep-link action (plan 27 S2) — carries what text-derivation cannot (e.g. a run id). */
  action?: NoticeAction;
}

export interface NoticeEvent {
  type: NoticeType;
  message: string;
  action?: NoticeAction;
}

export type NoticeActionTarget = 'setup' | 'tasks' | 'miniapp-report' | 'notification';

export interface NoticeAction {
  label: string;
  target: NoticeActionTarget;
  /** miniapp-report routing: which pack card hosts the runs area and which run's report to pre-open. */
  packId?: string;
  runId?: string;
  /** notification routing: the record whose closed click action main routes. */
  notificationId?: string;
}

const NO_MODEL_PATTERN = /no model is assigned to the chat task/i;

/** Actionable errors get a deep-link button; everything else stays a plain message. */
export function noticeActionFor(message: string, hasConfiguredProvider: boolean): NoticeAction | null {
  if (!NO_MODEL_PATTERN.test(message)) {
    return null;
  }
  return hasConfiguredProvider
    ? { label: TEXT.NOTICE_ACTION_MODELS, target: 'tasks' }
    : { label: TEXT.NOTICE_ACTION_SETUP, target: 'setup' };
}

/** Notice button label per closed click action (plan 42 D2); `none` = no button. */
export function noticeActionLabelFor(clickAction: NotificationClickAction): string | null {
  switch (clickAction) {
    case 'open-conversation':
      return TEXT.NOTIFICATIONS_ACTION_OPEN_CONVERSATION;
    case 'open-settings':
      return TEXT.NOTIFICATIONS_ACTION_OPEN_SETTINGS;
    case 'open-pack-report':
      return TEXT.NOTIFICATIONS_ACTION_OPEN_PACK_REPORT;
    case 'open-path':
      return TEXT.NOTIFICATIONS_ACTION_OPEN_PATH;
    default:
      return null;
  }
}

/**
 * Launcher notice parity (plan 42 S2): a persisted record renders through
 * the SAME notice surface with its severity and a button that rides the
 * one main-side click router (`notifications:click`). Pure and testable.
 */
export function notificationNotice(record: NotificationRecordView): NoticeEvent {
  const label = noticeActionLabelFor(record.clickAction);
  return {
    type: record.severity,
    message: record.body ? `${record.title} — ${record.body}` : record.title,
    ...(label ? { action: { label, target: 'notification' as const, notificationId: record.id } } : {}),
  };
}

/** Actionable errors linger long enough to be clicked. */
export const NOTICE_ACTION_TIMEOUT_MS = 20000;

/** Errors stay readable; confirmations leave quickly; limit notices linger a little longer. */
export const NOTICE_TIMEOUT_MS: Record<NoticeType, number> = {
  error: 5000,
  success: 2500,
  info: 6000,
  warn: 7000,
};

export const NOTICE_EVENT = 'da-notice';

export function toNoticeEvent(detail: unknown): NoticeEvent | null {
  if (typeof detail !== 'object' || detail === null) {
    return null;
  }
  const { type, message } = detail as { type?: unknown; message?: unknown };
  if (
    (type !== 'success' && type !== 'error' && type !== 'info' && type !== 'warn') ||
    typeof message !== 'string' ||
    message.length === 0
  ) {
    return null;
  }
  return { type, message };
}

/** A new notice replaces the current one; a distinct id re-keys animations. */
export function nextNotice(current: NoticeState | null, event: NoticeEvent, now: number = Date.now()): NoticeState {
  void current;
  return { id: now, type: event.type, message: event.message, ...(event.action ? { action: event.action } : {}) };
}
