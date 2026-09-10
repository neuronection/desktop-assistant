export type NoticeType = 'success' | 'error';

export interface NoticeState {
  id: number;
  type: NoticeType;
  message: string;
}

export interface NoticeEvent {
  type: NoticeType;
  message: string;
}

/** Errors stay readable; confirmations leave quickly. */
export const NOTICE_TIMEOUT_MS: Record<NoticeType, number> = {
  error: 5000,
  success: 2500,
};

export const NOTICE_EVENT = 'da-notice';

export function toNoticeEvent(detail: unknown): NoticeEvent | null {
  if (typeof detail !== 'object' || detail === null) {
    return null;
  }
  const { type, message } = detail as { type?: unknown; message?: unknown };
  if ((type !== 'success' && type !== 'error') || typeof message !== 'string' || message.length === 0) {
    return null;
  }
  return { type, message };
}

/** A new notice replaces the current one; a distinct id re-keys animations. */
export function nextNotice(current: NoticeState | null, event: NoticeEvent, now: number = Date.now()): NoticeState {
  void current;
  return { id: now, type: event.type, message: event.message };
}
