import { describe, it, expect } from 'vitest';
import { SPEECH_NOTICE_CODES, type SpeechNotice } from '@shared/speech';
import { speechNoticeBody, speechNoticeInput } from '@main/services/speechNotices';
import { TEXT } from '@shared/constants/text';

describe('speech notices (plan 58 D15)', () => {
  it('rides the closed system kind with one dedupe key per code', () => {
    const keys = new Set<string>();
    for (const code of SPEECH_NOTICE_CODES) {
      const input = speechNoticeInput({ code });
      expect(input.kind).toBe('system');
      expect(input.title).toBe(TEXT.SPEECH_NOTICE_TITLE);
      expect(input.dedupeKey).toBe(`speech_${code}`);
      keys.add(input.dedupeKey);
    }
    expect(keys.size).toBe(SPEECH_NOTICE_CODES.length);
  });

  it('deep-links the missing assignment to the task-assignment page', () => {
    const input = speechNoticeInput({ code: 'no_tts_assignment' });
    expect(input.clickAction).toBe('open-settings');
    expect(input.sourceRef).toBe('api:tasks');
    for (const code of SPEECH_NOTICE_CODES.filter((candidate) => candidate !== 'no_tts_assignment')) {
      const other = speechNoticeInput({ code });
      expect(other.clickAction).toBe('none');
      expect(other.sourceRef).toBeNull();
    }
  });

  it('names the configured limit for a too-long selection', () => {
    const notice: SpeechNotice = { code: 'too_long', limit: 8000 };
    expect(speechNoticeBody(notice)).toContain('8000');
  });

  it('carries the compact provider detail and the unavailable accelerator', () => {
    expect(speechNoticeBody({ code: 'provider_error', detail: 'rate limited (HTTP 429)' })).toContain(
      'rate limited (HTTP 429)'
    );
    expect(speechNoticeBody({ code: 'hotkey_unavailable', detail: 'CommandOrControl+Shift+S' })).toContain(
      'CommandOrControl+Shift+S'
    );
  });

  it('maps severities without inventing new levels', () => {
    expect(speechNoticeInput({ code: 'no_selection' }).severity).toBe('info');
    expect(speechNoticeInput({ code: 'selection_unsupported' }).severity).toBe('warn');
    expect(speechNoticeInput({ code: 'provider_error' }).severity).toBe('error');
  });
});
