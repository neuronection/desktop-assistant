import { describe, it, expect } from 'vitest';
import { LiveSessionService, type LiveSessionHost } from '@main/services/LiveSessionService';
import type { LiveEvent } from '@shared/live';
import type { LiveIntentVerdict } from '@main/ai/decide/points/live-intent';
import type { UtteranceVerdict } from '@main/ai/utterance';

class FakeHost implements LiveSessionHost {
  events: LiveEvent[] = [];
  turns: string[] = [];
  cancelled = 0;
  intent: LiveIntentVerdict = { intent: 'ignore', source: 'fallback' };
  utterance: UtteranceVerdict = { complete: true };
  idleMs = 60_000;
  cap = 0;
  private timers = new Map<number, () => void>();
  private nextTimer = 1;

  broadcast(event: LiveEvent): void {
    this.events.push(event);
  }
  async startTurn(content: string): Promise<void> {
    this.turns.push(content);
  }
  cancelTurn(): boolean {
    this.cancelled += 1;
    return true;
  }
  async evaluateUtterance(): Promise<UtteranceVerdict> {
    return this.utterance;
  }
  async runLiveIntent(): Promise<LiveIntentVerdict> {
    return this.intent;
  }
  async recentExchange(): Promise<string | undefined> {
    return undefined;
  }
  idleTimeoutMs(): number {
    return this.idleMs;
  }
  turnCap(): number {
    return this.cap;
  }
  setTimer(fn: () => void): number {
    const id = this.nextTimer++;
    this.timers.set(id, fn);
    return id;
  }
  clearTimer(handle: number): void {
    this.timers.delete(handle);
  }
  fireTimers(): void {
    const fns = [...this.timers.values()];
    this.timers.clear();
    fns.forEach((fn) => fn());
  }
  states(): string[] {
    return this.events.filter((event) => event.type === 'state').map((event) => event.snapshot.state);
  }
}

async function toSpeaking(host: FakeHost, service: LiveSessionService): Promise<void> {
  service.start();
  service.micReady();
  await service.phraseCommitted('what is the weather');
  service.playbackStarted();
}

describe('LiveSessionService — session + turn loop (plan 25 S1)', () => {
  it('starts idempotently into arming and listens once the mic is ready', () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    service.start();
    expect(service.getSnapshot().state).toBe('arming');
    service.start();
    expect(host.states()).toEqual(['arming']);
    service.micReady();
    expect(service.getSnapshot()).toMatchObject({ state: 'listening', capture: 'open' });
  });

  it('gates a committed phrase and starts a turn when complete', async () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    service.start();
    service.micReady();
    await service.phraseCommitted('what is the weather');
    expect(host.turns).toEqual(['what is the weather']);
    expect(service.getSnapshot()).toMatchObject({ state: 'thinking', turns: 1, capture: 'closed' });
    expect(host.events).toContainEqual({ type: 'transcript', text: 'what is the weather', final: true });
  });

  it('keeps listening when the gate says incomplete, and uses corrected text', async () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    service.start();
    service.micReady();
    host.utterance = { complete: false };
    await service.phraseCommitted('and then');
    expect(service.getSnapshot().state).toBe('listening');
    expect(host.turns).toEqual([]);
    host.utterance = { complete: true, text: 'What is the weather?' };
    await service.phraseCommitted('what is the weather');
    expect(host.turns).toEqual(['What is the weather?']);
  });

  it('walks thinking → speaking → listening on playback events', async () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    await toSpeaking(host, service);
    expect(service.getSnapshot()).toMatchObject({ state: 'speaking', capture: 'open' });
    service.playbackEnded();
    expect(service.getSnapshot().state).toBe('listening');
  });

  it('stops with an ended event carrying the turn count', async () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    await toSpeaking(host, service);
    service.stop('user');
    expect(service.getSnapshot().state).toBe('idle');
    expect(host.events).toContainEqual({ type: 'ended', reason: 'user', turns: 1 });
  });
});

describe('LiveSessionService — barge-in (plan 25 D4/D16)', () => {
  it('ignores candidates outside speaking or with capture closed', async () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    service.start();
    service.micReady();
    await service.speechDetected({ transcript: 'hello there', currentSentence: '' });
    expect(host.events.some((event) => event.type === 'duck')).toBe(false);
    await toSpeaking(host, service);
    service.downgrade();
    await service.speechDetected({ transcript: 'hello there', currentSentence: '' });
    expect(host.events.filter((event) => event.type === 'duck' && event.on)).toEqual([]);
  });

  it('ducks, ignores, and unducks on an ignore verdict', async () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    await toSpeaking(host, service);
    host.intent = { intent: 'ignore', source: 'echo' };
    await service.speechDetected({ transcript: 'the weather is mild', currentSentence: 'the weather is mild today' });
    expect(host.events).toContainEqual({ type: 'duck', on: true });
    expect(host.events).toContainEqual({ type: 'duck', on: false });
    expect(host.events).toContainEqual({
      type: 'intent',
      intent: 'ignore',
      engine: 'echo',
      text: 'the weather is mild',
    });
    expect(service.getSnapshot()).toMatchObject({ state: 'speaking', candidate: false });
    expect(host.cancelled).toBe(0);
  });

  it('stops playback and cancels the turn on an interrupt verdict', async () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    await toSpeaking(host, service);
    host.intent = { intent: 'interrupt', source: 'engine', confidence: 0.9 };
    await service.speechDetected({ transcript: 'wait a moment', currentSentence: 'the weather is mild today' });
    expect(host.cancelled).toBe(1);
    expect(service.getSnapshot().state).toBe('listening');
    expect(host.events).toContainEqual({ type: 'intent', intent: 'interrupt', engine: 'engine' });
  });

  it('ends the session on an end verdict', async () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    await toSpeaking(host, service);
    host.intent = { intent: 'end', source: 'keyword' };
    await service.speechDetected({ transcript: 'goodbye', currentSentence: 'the weather is mild today' });
    expect(service.getSnapshot().state).toBe('idle');
    expect(host.events).toContainEqual({ type: 'ended', reason: 'spoken', turns: 1 });
  });

  it('downgrades once with a notice and closes capture while speaking', async () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    await toSpeaking(host, service);
    service.downgrade();
    service.downgrade();
    expect(service.getSnapshot()).toMatchObject({ downgraded: true, capture: 'closed' });
    expect(host.events.filter((event) => event.type === 'notice')).toHaveLength(1);
  });

  it('auto-downgrades after repeated echo-ignored candidates', async () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    await toSpeaking(host, service);
    host.intent = { intent: 'ignore', source: 'echo' };
    await service.speechDetected({ transcript: 'a', currentSentence: 'x' });
    await service.speechDetected({ transcript: 'b', currentSentence: 'x' });
    expect(service.getSnapshot().downgraded).toBe(false);
    await service.speechDetected({ transcript: 'c', currentSentence: 'x' });
    expect(service.getSnapshot()).toMatchObject({ downgraded: true, capture: 'closed' });
    expect(host.events).toContainEqual({ type: 'notice', level: 'info', code: 'echo_detected' });
  });
});

describe('LiveSessionService — approvals, failures, idle', () => {
  it('pauses for approval and resumes', async () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    service.start();
    service.micReady();
    await service.phraseCommitted('what is the weather');
    expect(service.getSnapshot().state).toBe('thinking');
    service.approvalPending();
    expect(service.getSnapshot()).toMatchObject({ state: 'paused', capture: 'closed' });
    service.approvalResolved();
    expect(service.getSnapshot().state).toBe('thinking');
  });

  it('returns to listening when a turn fails', async () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    await toSpeaking(host, service);
    service.turnFailed();
    expect(service.getSnapshot().state).toBe('listening');
  });

  it('stops on idle timeout with a notice', () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    service.start();
    service.micReady();
    host.fireTimers();
    expect(service.getSnapshot()).toMatchObject({ state: 'idle', reason: 'idle-timeout' });
    expect(host.events).toContainEqual({ type: 'notice', level: 'info', code: 'idle_timeout' });
  });

  it('surfaces a typed error and leaves the session in error', () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    service.start();
    service.fail('mic_denied');
    expect(service.getSnapshot()).toMatchObject({ state: 'error', reason: 'mic_denied' });
    expect(host.events).toContainEqual({ type: 'notice', level: 'error', code: 'mic_denied' });
  });

  it('surfaces a non-terminal warning without changing state', async () => {
    const host = new FakeHost();
    const service = new LiveSessionService(host);
    await toSpeaking(host, service);
    service.warn('tts_failed');
    expect(service.getSnapshot().state).toBe('speaking');
    expect(host.events).toContainEqual({ type: 'notice', level: 'warn', code: 'tts_failed' });
  });

  it('stops at the session turn cap with a notice', async () => {
    const host = new FakeHost();
    host.cap = 1;
    const service = new LiveSessionService(host);
    service.start();
    service.micReady();
    await service.phraseCommitted('first');
    expect(service.getSnapshot().turns).toBe(1);
    service.playbackEnded();
    await service.phraseCommitted('second');
    expect(service.getSnapshot().state).toBe('idle');
    expect(host.turns).toEqual(['first']);
    expect(host.events).toContainEqual({ type: 'notice', level: 'info', code: 'cost_cap' });
  });
});
