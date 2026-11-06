import { describe, expect, it } from 'vitest';
import { notificationNotice, toNoticeEvent } from '@renderer/chat-react/notice';
import { TEXT } from '@shared/constants/text';
import type { NotificationRecordView } from '@shared/notifications';

function record(overrides: Partial<NotificationRecordView> = {}): NotificationRecordView {
  return {
    id: 'n-1',
    kind: 'schedule',
    severity: 'warn',
    title: 'Run failed',
    body: 'The nightly assessment did not finish.',
    payload: {},
    sourceRef: null,
    clickAction: 'none',
    dedupeKey: 'k',
    readAt: null,
    createdAt: 1,
    ...overrides,
  };
}

describe('launcher notice parity (plan 42 S2)', () => {
  it('renders a record with its severity and a title — body message', () => {
    const notice = notificationNotice(record({ severity: 'warn' }));
    expect(notice.type).toBe('warn');
    expect(notice.message).toBe('Run failed — The nightly assessment did not finish.');
    expect(notice.action).toBeUndefined();
  });

  it('carries the one click router as the notice action', () => {
    const notice = notificationNotice(record({ clickAction: 'open-conversation', sourceRef: 'conv-1' }));
    expect(notice.action).toEqual({
      label: TEXT.NOTIFICATIONS_ACTION_OPEN_CONVERSATION,
      target: 'notification',
      notificationId: 'n-1',
    });
    expect(notificationNotice(record({ clickAction: 'open-path' })).action?.label).toBe(
      TEXT.NOTIFICATIONS_ACTION_OPEN_PATH
    );
  });

  it('falls back to the title when the body is empty', () => {
    expect(notificationNotice(record({ body: '' })).message).toBe('Run failed');
  });

  it('accepts the warn severity in the notice event guard', () => {
    expect(toNoticeEvent({ type: 'warn', message: 'careful' })).toEqual({ type: 'warn', message: 'careful' });
    expect(toNoticeEvent({ type: 'nope', message: 'x' })).toBeNull();
  });
});
