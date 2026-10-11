import { TEXT } from '@shared/constants/text';

export type NoticeType = 'success' | 'error' | 'info';

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

export type NoticeActionTarget = 'setup' | 'tasks' | 'miniapp-report';

export interface NoticeAction {
  label: string;
  target: NoticeActionTarget;
  /** miniapp-report routing: which pack card hosts the runs area and which run's report to pre-open. */
  packId?: string;
  runId?: string;
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

/** Actionable errors linger long enough to be clicked. */
export const NOTICE_ACTION_TIMEOUT_MS = 20000;

/** Errors stay readable; confirmations leave quickly; limit notices linger a little longer. */
export const NOTICE_TIMEOUT_MS: Record<NoticeType, number> = {
  error: 5000,
  success: 2500,
  info: 6000,
};

export const NOTICE_EVENT = 'da-notice';

export function toNoticeEvent(detail: unknown): NoticeEvent | null {
  if (typeof detail !== 'object' || detail === null) {
    return null;
  }
  const { type, message } = detail as { type?: unknown; message?: unknown };
  if (
    (type !== 'success' && type !== 'error' && type !== 'info') ||
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
