import { describe, it, expect } from 'vitest';
import { buildLiveApprovalNotification } from '@main/liveNotifications';
import { TEXT } from '@shared/constants/text';

describe('live approval notification (plan 63)', () => {
  it('routes to the conversation and dedupes per session', () => {
    expect(buildLiveApprovalNotification({ conversationId: 'conv-7', session: 3 })).toEqual({
      kind: 'system',
      severity: 'warn',
      title: TEXT.LIVE_ARIA,
      body: TEXT.LIVE_NOTICE_APPROVAL_NEEDED,
      clickAction: 'open-conversation',
      sourceRef: 'conv-7',
      dedupeKey: 'live-approval-3',
    });
  });

  it('omits the source when the conversation is unknown', () => {
    const notification = buildLiveApprovalNotification({ conversationId: null, session: 1 });
    expect(notification.sourceRef).toBeUndefined();
    expect(notification.dedupeKey).toBe('live-approval-1');
  });
});
