import type { NotificationInput } from '@main/services/NotificationService';
import { TEXT } from '@shared/constants/text';

/** The live approval toast (plan 63); the HUD also shows the amber state. */
export function buildLiveApprovalNotification(input: {
  conversationId: string | null;
  session: number;
}): NotificationInput {
  return {
    kind: 'system',
    severity: 'warn',
    title: TEXT.LIVE_ARIA,
    body: TEXT.LIVE_NOTICE_APPROVAL_NEEDED,
    clickAction: 'open-conversation',
    ...(input.conversationId ? { sourceRef: input.conversationId } : {}),
    dedupeKey: `live-approval-${input.session}`,
  };
}
