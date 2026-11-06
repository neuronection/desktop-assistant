import type { SpeechNotice } from '@shared/speech';
import { TEXT, interpolate } from '@shared/constants/text';
import type { NotificationInput } from '@main/services/NotificationService';

const SEVERITY: Record<SpeechNotice['code'], NotificationInput['severity']> = {
  no_selection: 'info',
  too_long: 'info',
  live_busy: 'info',
  selection_unsupported: 'warn',
  no_tts_assignment: 'warn',
  playback_failed: 'warn',
  overlay_unavailable: 'warn',
  hotkey_unavailable: 'warn',
  provider_error: 'error',
};

export function speechNoticeBody(notice: SpeechNotice): string {
  switch (notice.code) {
    case 'no_selection':
      return TEXT.SPEECH_NOTICE_NO_SELECTION;
    case 'selection_unsupported':
      return TEXT.SPEECH_NOTICE_SELECTION_UNSUPPORTED;
    case 'too_long':
      return interpolate(TEXT.SPEECH_NOTICE_TOO_LONG, { limit: notice.limit ?? 0 });
    case 'no_tts_assignment':
      return TEXT.SPEECH_NOTICE_NO_TTS_ASSIGNMENT;
    case 'live_busy':
      return TEXT.SPEECH_NOTICE_LIVE_BUSY;
    case 'provider_error':
      return interpolate(TEXT.SPEECH_FAILED, { error: notice.detail ?? TEXT.SPEECH_PLAYBACK_FAILED });
    case 'playback_failed':
      return TEXT.SPEECH_NOTICE_PLAYBACK_FAILED;
    case 'overlay_unavailable':
      return TEXT.SPEECH_NOTICE_OVERLAY_UNAVAILABLE;
    case 'hotkey_unavailable':
      return interpolate(TEXT.SPEECH_NOTICE_HOTKEY_UNAVAILABLE, { accelerator: notice.detail ?? '' });
  }
}

/**
 * D15 notice contract (plan 58): the closed `system` kind, one dedupe key
 * per notice code (a held hotkey must not burn the rate budget) and a real
 * `SettingsOpenTarget` deep link for the missing-assignment case.
 */
export function speechNoticeInput(notice: SpeechNotice): NotificationInput {
  return {
    kind: 'system',
    severity: SEVERITY[notice.code],
    title: TEXT.SPEECH_NOTICE_TITLE,
    body: speechNoticeBody(notice),
    dedupeKey: `speech_${notice.code}`,
    clickAction: notice.code === 'no_tts_assignment' ? 'open-settings' : 'none',
    sourceRef:
      notice.code === 'no_tts_assignment' ? 'api:tasks' : null,
  };
}
