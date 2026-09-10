import { describe, it, expect } from 'vitest';
import { NOTICE_EVENT, NOTICE_TIMEOUT_MS, nextNotice, toNoticeEvent } from '@renderer/chat-react/notice';

describe('notice', () => {
  it('validates event payloads', () => {
    expect(toNoticeEvent({ type: 'error', message: 'boom' })).toEqual({ type: 'error', message: 'boom' });
    expect(toNoticeEvent({ type: 'success', message: 'ok' })).toEqual({ type: 'success', message: 'ok' });
    expect(toNoticeEvent({ type: 'bogus', message: 'x' })).toBeNull();
    expect(toNoticeEvent({ type: 'error', message: '' })).toBeNull();
    expect(toNoticeEvent({ type: 'error' })).toBeNull();
    expect(toNoticeEvent('nope')).toBeNull();
  });

  it('replaces the current notice and re-keys the animation', () => {
    const first = nextNotice(null, { type: 'error', message: 'first' }, 1000);
    expect(first).toEqual({ id: 1000, type: 'error', message: 'first' });
    const second = nextNotice(first, { type: 'success', message: 'second' }, 2000);
    expect(second).toEqual({ id: 2000, type: 'success', message: 'second' });
  });

  it('gives errors more reading time than confirmations', () => {
    expect(NOTICE_TIMEOUT_MS.error).toBeGreaterThan(NOTICE_TIMEOUT_MS.success);
  });

  it('exposes the event name used by the launcher bridge', () => {
    expect(NOTICE_EVENT).toBe('da-notice');
  });
});
