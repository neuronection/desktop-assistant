import { describe, expect, it, vi } from 'vitest';
import { DictationService } from '@main/services/DictationService';
import { DICTATION_IDLE } from '@shared/dictation';

const HUD = 11;
const LAUNCHER = 22;

describe('the shared dictation session (plan 83 S1)', () => {
  it('starts once: a second window is refused while a session is live', () => {
    const service = new DictationService();
    const first = service.begin('hud', HUD);
    expect(first.ok).toBe(true);
    expect(first.snapshot).toMatchObject({ phase: 'recording', origin: 'hud' });

    const second = service.begin('launcher', LAUNCHER);
    expect(second.ok).toBe(false);
    expect(second.snapshot.origin).toBe('hud');
    expect(service.ownerId()).toBe(HUD);
  });

  it('lets the same owner restart after an idle session', () => {
    const service = new DictationService();
    service.begin('hud', HUD);
    service.report(HUD, { phase: 'idle' });
    expect(service.snapshot()).toEqual(DICTATION_IDLE);
    expect(service.ownerId()).toBeNull();
    expect(service.begin('launcher', LAUNCHER).ok).toBe(true);
  });

  it('ignores reports from a window that does not own the session', () => {
    const service = new DictationService();
    service.begin('hud', HUD);

    expect(service.report(LAUNCHER, { interim: 'not mine', phase: 'recording' })).toBeNull();
    expect(service.snapshot().interim).toBe('');
  });

  it('broadcasts every accepted change to all surfaces', () => {
    const service = new DictationService();
    const seen = vi.fn();
    service.subscribe(seen);
    service.begin('hud', HUD);
    service.report(HUD, { interim: 'hello', level: 0.4 });
    service.report(HUD, { phase: 'ready', interim: '', transcript: 'hello' });
    service.end(HUD);

    expect(seen).toHaveBeenCalledTimes(4);
    expect(seen.mock.calls.map(([snapshot]) => snapshot.phase)).toEqual([
      'recording',
      'recording',
      'ready',
      'idle',
    ]);
  });

  it('ends the session when the owner disappears', () => {
    const service = new DictationService();
    service.begin('hud', HUD);
    service.end(HUD, { force: true });
    expect(service.snapshot()).toEqual(DICTATION_IDLE);
    expect(service.ownerId()).toBeNull();
  });

  it('clamps text and level at the shared boundary', () => {
    const service = new DictationService();
    service.begin('hud', HUD);
    const snapshot = service.report(HUD, { level: 9, interim: 'x'.repeat(30_000) });
    expect(snapshot?.level).toBe(1);
    expect(snapshot?.interim.length).toBe(20_000);
  });

  it('a non-owner cannot end a live session', () => {
    const service = new DictationService();
    service.begin('hud', HUD);
    service.end(LAUNCHER);
    expect(service.snapshot().phase).toBe('recording');
  });
});
