import {
  LIVE_ECHO_DOWNGRADE_STREAK,
  LIVE_INITIAL,
  LIVE_INTENT_TIMEOUT_MS,
  isLiveActive,
  reduceLive,
  type LiveAction,
  type LiveEndReason,
  type LiveEvent,
  type LiveNoticeCode,
  type LiveSnapshot,
} from '@shared/live';
import type { UtteranceVerdict } from '@main/ai/utterance';
import type { LiveIntentInput, LiveIntentVerdict } from '@main/ai/decide/points/live-intent';

/**
 * Side effects the live loop needs from the host (plan 25 D1). The
 * service owns the state machine and the intent ladder; the host owns
 * turns, audio, config, and broadcasting — so the loop is unit-testable
 * with a fake host and no Electron.
 */
export interface LiveSessionHost {
  broadcast(event: LiveEvent): void;
  startTurn(content: string): Promise<void>;
  cancelTurn(): boolean;
  evaluateUtterance(text: string): Promise<UtteranceVerdict>;
  runLiveIntent(input: LiveIntentInput): Promise<LiveIntentVerdict>;
  recentExchange(): Promise<string | undefined>;
  idleTimeoutMs(): number;
  /** Session turn cap; 0 = unlimited (plan 25 D14). */
  turnCap(): number;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(handle: number): void;
}

/**
 * Main-owned live conversation loop (plan 25 S1). Renderer reports facts
 * (`mic_ready`, `phrase_committed`, `speech_detected`, playback) and
 * never sequences the loop; this service applies the reducer and emits
 * authoritative `live:event` pushes.
 */
export class LiveSessionService {
  private snapshot: LiveSnapshot;
  private idleHandle: number | null = null;
  private echoStreak = 0;
  private intentInFlight = false;

  constructor(private readonly host: LiveSessionHost) {
    this.snapshot = { ...LIVE_INITIAL };
  }

  getSnapshot(): LiveSnapshot {
    return this.snapshot;
  }

  /** Idempotent: starting an active session is a no-op. */
  start(): LiveSnapshot {
    if (isLiveActive(this.snapshot.state)) {
      return this.snapshot;
    }
    this.apply({ type: 'start' });
    return this.snapshot;
  }

  stop(reason: LiveEndReason): LiveSnapshot {
    if (this.snapshot.state === 'idle') {
      return this.snapshot;
    }
    const { turns } = this.snapshot;
    this.clearIdle();
    this.host.broadcast({ type: 'duck', on: false });
    this.apply({ type: 'stop', reason });
    this.host.broadcast({ type: 'ended', reason, turns });
    return this.snapshot;
  }

  micReady(): void {
    this.apply({ type: 'mic_ready' });
    this.armIdle();
  }

  /** A committed phrase: gate it, then either start a turn or keep listening. */
  async phraseCommitted(transcript: string): Promise<void> {
    if (this.snapshot.state !== 'listening') {
      return;
    }
    this.clearIdle();
    const session = this.snapshot.session;
    this.apply({ type: 'phrase_committed' });
    const verdict = await this.host.evaluateUtterance(transcript).catch(() => null);
    if (this.snapshot.session !== session || this.currentState() !== 'transcribing') {
      return;
    }
    const text = (verdict?.text ?? transcript).trim();
    if (!verdict?.complete || !text) {
      this.apply({ type: 'keep_listening' });
      this.armIdle();
      return;
    }
    const cap = this.host.turnCap();
    if (cap > 0 && this.snapshot.turns >= cap) {
      this.host.broadcast({ type: 'notice', level: 'info', code: 'cost_cap' });
      this.stop('user');
      return;
    }
    this.apply({ type: 'turn_started' });
    this.host.broadcast({ type: 'transcript', text, final: true });
    try {
      await this.host.startTurn(text);
    } catch (error) {
      console.error('live turn start failed:', error);
      this.host.broadcast({ type: 'notice', level: 'error', code: 'turn_failed' });
      this.turnFailed();
    }
  }

  /** A barge-in candidate captured while the assistant speaks. */
  async speechDetected(input: { transcript: string; currentSentence: string }): Promise<void> {
    if (this.snapshot.state !== 'speaking' || this.snapshot.capture !== 'open' || this.intentInFlight) {
      return;
    }
    this.intentInFlight = true;
    const session = this.snapshot.session;
    this.apply({ type: 'speech_candidate' });
    this.host.broadcast({ type: 'duck', on: true });
    try {
      const recentExchange = await this.host.recentExchange();
      const verdict = await this.raceTimeout(
        this.host
          .runLiveIntent({
            transcript: input.transcript,
            currentSentence: input.currentSentence,
            recentExchange,
          })
          .catch((): LiveIntentVerdict => ({ intent: 'ignore', source: 'fallback' })),
        { intent: 'ignore', source: 'fallback' }
      );
      // Drop a stale verdict: the session ended or the turn moved on mid-classification.
      if (this.snapshot.session !== session || this.currentState() !== 'speaking') {
        this.host.broadcast({ type: 'duck', on: false });
        return;
      }
      if (verdict.intent === 'end') {
        this.echoStreak = 0;
        this.host.broadcast({ type: 'intent', intent: 'end', engine: verdict.source });
        this.stop('spoken');
        return;
      }
      if (verdict.intent === 'interrupt') {
        this.echoStreak = 0;
        this.host.cancelTurn();
        this.apply({ type: 'live_intent', intent: 'interrupt' });
        this.host.broadcast({ type: 'duck', on: false });
        this.host.broadcast({ type: 'intent', intent: 'interrupt', engine: verdict.source });
        this.armIdle();
        return;
      }
      this.apply({ type: 'live_intent', intent: 'ignore' });
      this.host.broadcast({ type: 'duck', on: false });
      this.host.broadcast({ type: 'intent', intent: 'ignore', engine: verdict.source, text: input.transcript });
      if (verdict.source === 'echo') {
        this.echoStreak += 1;
        if (this.echoStreak >= LIVE_ECHO_DOWNGRADE_STREAK) {
          this.echoStreak = 0;
          this.downgrade('echo_detected');
        }
      } else {
        this.echoStreak = 0;
      }
    } finally {
      this.intentInFlight = false;
    }
  }

  playbackStarted(): void {
    this.apply({ type: 'playback_started' });
  }

  turnFinished(): void {
    this.apply({ type: 'turn_finished' });
  }

  playbackEnded(): void {
    this.apply({ type: 'playback_ended' });
    this.armIdle();
  }

  /** User-initiated stop of the current reply (button / Escape). */
  interrupt(): void {
    this.apply({ type: 'interrupt' });
    this.armIdle();
  }

  turnFailed(): void {
    this.apply({ type: 'turn_failed' });
    this.armIdle();
  }

  approvalPending(): void {
    this.clearIdle();
    this.apply({ type: 'approval_pending' });
  }

  approvalResolved(): void {
    this.apply({ type: 'approval_resolved' });
  }

  /** Switch to half-duplex (echo control unavailable) with a notice. */
  downgrade(code: LiveNoticeCode = 'barge_in_unavailable'): void {
    if (this.snapshot.downgraded) {
      return;
    }
    this.apply({ type: 'downgrade' });
    this.host.broadcast({ type: 'notice', level: 'info', code });
  }

  /** User-chosen duplex for the current session (no notice — the user did it). */
  setFullDuplex(fullDuplex: boolean): void {
    if (!isLiveActive(this.snapshot.state) || this.snapshot.downgraded === !fullDuplex) {
      return;
    }
    this.apply({ type: 'set_duplex', fullDuplex });
    if (fullDuplex) {
      this.echoStreak = 0;
    }
  }

  fail(code: Extract<LiveEvent, { type: 'notice' }>['code']): void {
    this.clearIdle();
    this.apply({ type: 'error', code });
    this.host.broadcast({ type: 'notice', level: 'error', code });
  }

  /** A non-terminal problem (STT/TTS hiccup) — surfaced without ending the session. */
  warn(code: LiveNoticeCode): void {
    this.host.broadcast({ type: 'notice', level: 'warn', code });
  }

  /** Bounds a barge-in classification so a hung engine can't hold the duck (plan 25 S4). */
  private raceTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
    return new Promise<T>((resolve) => {
      let settled = false;
      const handle = this.host.setTimer(() => {
        if (!settled) {
          settled = true;
          resolve(fallback);
        }
      }, LIVE_INTENT_TIMEOUT_MS);
      const finish = (value: T): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.host.clearTimer(handle);
        resolve(value);
      };
      promise.then(finish, () => finish(fallback));
    });
  }

  private currentState(): LiveSnapshot['state'] {
    return this.snapshot.state;
  }

  private apply(action: LiveAction): void {
    const next = reduceLive(this.snapshot, action);
    if (next === this.snapshot) {
      return;
    }
    this.snapshot = next;
    this.host.broadcast({ type: 'state', snapshot: next });
  }

  private armIdle(): void {
    this.clearIdle();
    if (this.snapshot.state !== 'listening') {
      return;
    }
    this.idleHandle = this.host.setTimer(() => {
      this.idleHandle = null;
      if (this.snapshot.state === 'listening') {
        this.host.broadcast({ type: 'notice', level: 'info', code: 'idle_timeout' });
        this.stop('idle-timeout');
      }
    }, this.host.idleTimeoutMs());
  }

  private clearIdle(): void {
    if (this.idleHandle !== null) {
      this.host.clearTimer(this.idleHandle);
      this.idleHandle = null;
    }
  }
}
