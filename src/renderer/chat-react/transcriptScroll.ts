export interface TranscriptResponseTarget {
  live: boolean;
  messageId: string | null;
}

/** Put the start of the latest reply at the top of the transcript viewport.
 * Used once when the launcher opens expanded mode: the user wants the new
 * answer, not the beginning of the whole conversation. Instant (not smooth)
 * so reduced-motion users get the same stable result. */
export function scrollTranscriptToResponseStart(
  root: HTMLElement | null,
  target: TranscriptResponseTarget
): boolean {
  if (!root) {
    return false;
  }
  const row = target.live
    ? root.querySelector<HTMLElement>('[data-as="chat-transcript-live"]')
    : target.messageId !== null
      ? Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]')).find(
          (candidate) => candidate.getAttribute('data-message-id') === target.messageId
        ) ?? null
      : null;
  if (!row) {
    return false;
  }
  row.scrollIntoView({ block: 'start', behavior: 'auto' });
  return true;
}
