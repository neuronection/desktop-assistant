import {
  SPEECH_INITIAL,
  isSpeechActive,
  reduceSpeech,
  speechPreempts,
  speechSameTier,
  type SpeechAction,
  type SpeechControl,
  type SpeechHistoryEntry,
  type SpeechNotice,
  type SpeechPlaybackFact,
  type SpeechPlayInstruction,
  type SpeechPreviewRequest,
  type SpeechRequest,
  type SpeechSnapshot,
  type SpeechSource,
  type SpeechSpeakOutcome,
} from '@shared/speech';
import { SPEECH_CHUNK_MAX_CHARS, splitSpeechChunks } from '@shared/text/speech-chunks';
import { MAX_TTS_CHARS, compactTtsError, type TtsAudio } from '@main/ai/tts';
import { TEXT, interpolate } from '@shared/constants/text';
import type { SpeechCacheHit, SpeechCacheKeyInput } from '@main/services/SpeechCacheService';
import type { ResolvedSpeechParams, SpeechTarget, SpeechTargetOverrides } from '@main/services/TtsService';
import type { SelectionResult } from '@main/services/DesktopContextService';

export const SPEECH_HISTORY_LIMIT = 20;
export const SPEECH_DEDUPE_WINDOW_MS = 2_000;
export const SPEECH_REPLY_CHUNK_CHARS = MAX_TTS_CHARS;
export const SPEECH_SHORT_CHUNK_CHARS = SPEECH_CHUNK_MAX_CHARS;
export const SPEECH_UTTERANCE_MAX_CHARS = 20_000;
export const SPEECH_PLAYBACK_GUARD_MS = 20_000;

export function speechRequestId(utteranceId: number, chunkIndex: number): string {
  return `speech:${utteranceId}:${chunkIndex}`;
}

/**
 * Side effects the bus needs from the host (plan 58 D1). The service owns
 * arbitration, the chunk pipeline and the queue; the host owns Electron,
 * config and the cache — so the bus is unit-testable with a fake host.
 */
export interface SpeechServiceHost {
  broadcast(snapshot: SpeechSnapshot): void;
  notify(notice: SpeechNotice): void;
  liveActive(): boolean;
  readSelection(): Promise<SelectionResult>;
  readClipboard(): Promise<string>;
  resolveTarget(overrides?: SpeechTargetOverrides): Promise<SpeechTarget | null>;
  synthesize(params: ResolvedSpeechParams): Promise<TtsAudio | null>;
  cancelSynthesis(requestId: string): void;
  cacheKey(input: SpeechCacheKeyInput): string;
  cacheLookup(key: string): Promise<SpeechCacheHit | null>;
  cacheStore(key: string, audio: TtsAudio): Promise<string | null>;
  cacheRegister(chunkKeys: string[]): Promise<unknown>;
  play(instruction: SpeechPlayInstruction): void;
  stopPlayback(): void;
  selectionMaxChars(): number;
  now(): number;
  onHistoryAvailable?(available: boolean): void;
}

interface HistoryRecord extends SpeechHistoryEntry {
  /** Replay text — in memory only, never persisted and never sent over IPC (plan 58 D9). */
  text: string;
}

interface ActiveUtterance {
  utteranceId: number;
  source: SpeechSource;
  text: string;
  chunks: string[];
  keys: string[];
  target: SpeechTarget;
  urls: (string | null)[];
  inFlight: Map<number, Promise<string | null>>;
  requestIds: Set<string>;
  /** Index currently playing; -1 until the first chunk starts. */
  playing: number;
  /** Next index that should start playing. */
  playhead: number;
  cached: number;
  synthesisCalls: number;
}

/**
 * The speech bus (plan 58 §4.4): one state machine owns "who is speaking".
 * Chunks are resolved one ahead, played by the overlay, and fed back as
 * typed facts; stale or foreign facts never advance an utterance.
 */
export class SpeechService {
  private snapshot: SpeechSnapshot = { ...SPEECH_INITIAL };
  private active: ActiveUtterance | null = null;
  private pending: { request: SpeechRequest & { text: string }; overrides?: SpeechTargetOverrides } | null = null;
  private history: HistoryRecord[] = [];
  private readonly dedupe = new Map<string, number>();
  private assignmentNotified = false;
  private starting = false;
  private playbackGuard: ReturnType<typeof setTimeout> | null = null;
  private readonly epoch = Math.floor(Date.now() / 1000) * 1000;
  private counter = 0;

  constructor(private readonly host: SpeechServiceHost) {}

  getSnapshot(): SpeechSnapshot {
    return this.snapshot;
  }

  getHistory(): SpeechHistoryEntry[] {
    return this.history.map(({ text: _text, ...entry }) => ({ ...entry }));
  }

  /** Replays a ring entry through the normal pipeline (source `replay`). */
  async replay(utteranceId: number): Promise<SpeechSpeakOutcome> {
    const entry = this.history.find((candidate) => candidate.utteranceId === utteranceId);
    if (!entry) {
      return 'ignored';
    }
    return this.speak({ text: entry.text, source: 'replay' });
  }

  isActive(): boolean {
    return isSpeechActive(this.snapshot.state) || this.pending !== null;
  }

  async speak(request: SpeechRequest): Promise<SpeechSpeakOutcome> {
    return this.enqueue(request);
  }

  /** Auditions the draft voice/speed through the same bus (Settings only). */
  async preview(request: SpeechPreviewRequest): Promise<SpeechSpeakOutcome> {
    const voice = request.voice?.trim() ?? '';
    const speed = request.speed;
    return this.enqueue(
      {
        text: TEXT.VOICE_PREVIEW_SAMPLE,
        source: 'preview',
        dedupeKey: `voice-preview:${voice}:${speed ?? ''}`,
      },
      { ...(request.voice !== undefined ? { voice: request.voice } : {}), ...(speed !== undefined ? { speed } : {}) }
    );
  }

  private async enqueue(
    request: SpeechRequest,
    overrides?: SpeechTargetOverrides,
    options: { skipDedupe?: boolean } = {}
  ): Promise<SpeechSpeakOutcome> {
    const text = request.text?.trim() ?? '';
    if (!text) {
      return 'ignored';
    }
    if (this.host.liveActive()) {
      this.host.notify({ code: 'live_busy' });
      return 'live_busy';
    }
    if (!options.skipDedupe && request.dedupeKey) {
      if (this.isDuplicate(request.dedupeKey)) {
        return 'duplicate';
      }
      this.dedupe.set(request.dedupeKey, this.host.now());
      this.pruneDedupe();
    }
    if (!this.active) {
      if (this.starting) {
        this.pending = { request: { ...request, text }, overrides };
        return 'queued';
      }
      this.starting = true;
      try {
        return await this.start({ ...request, text }, overrides);
      } finally {
        this.starting = false;
        if (!this.active) {
          this.drainPending();
        }
      }
    }
    const currentSource = this.snapshot.source;
    const preempts = speechPreempts(currentSource, request.source);
    const inaudible =
      speechSameTier(currentSource, request.source) &&
      this.snapshot.state === 'synthesizing' &&
      this.active.playing < 0;
    if (preempts || inaudible) {
      this.halt();
      this.resetToIdle();
      return this.start({ ...request, text }, overrides);
    }
    this.pending = { request: { ...request, text }, overrides };
    return 'queued';
  }

  async speakSelection(): Promise<SpeechSpeakOutcome> {
    const selection = await this.host.readSelection();
    if (!selection.ok || !selection.text) {
      this.host.notify({
        code: selection.reason === 'unsupported' ? 'selection_unsupported' : 'no_selection',
      });
      return 'ignored';
    }
    const text = selection.text.trim();
    const limit = this.host.selectionMaxChars();
    if (text.length > limit) {
      this.host.notify({ code: 'too_long', limit });
      return 'ignored';
    }
    return this.speak({ text, source: 'selection' });
  }

  async speakClipboard(): Promise<SpeechSpeakOutcome> {
    const text = (await this.host.readClipboard()).trim();
    if (!text) {
      this.host.notify({ code: 'no_selection' });
      return 'ignored';
    }
    const limit = this.host.selectionMaxChars();
    if (text.length > limit) {
      this.host.notify({ code: 'too_long', limit });
      return 'ignored';
    }
    return this.speak({ text, source: 'clipboard' });
  }

  control(action: SpeechControl): SpeechSnapshot {
    switch (action) {
      case 'pause':
        this.apply({ type: 'pause' });
        return this.snapshot;
      case 'resume':
        this.apply({ type: 'resume' });
        this.pump();
        return this.snapshot;
      case 'dismiss':
        this.apply({ type: 'dismiss' });
        return this.snapshot;
      case 'stop':
        this.stop();
        return this.snapshot;
    }
  }

  stop(): void {
    const wasActive = isSpeechActive(this.snapshot.state);
    this.halt();
    if (wasActive) {
      this.apply({ type: 'stop' });
    } else {
      this.host.broadcast(this.snapshot);
    }
  }

  /**
   * Suspend / screen-lock (plan 58 §4.4, race 8): land in `idle`, never
   * `paused` — resuming the machine must never start a chunk on its own.
   */
  suspend(): void {
    const wasActive = isSpeechActive(this.snapshot.state);
    this.clearPlaybackGuard();
    this.halt();
    if (!wasActive) {
      return;
    }
    this.resetToIdle();
    this.host.stopPlayback();
    this.host.broadcast(this.snapshot);
  }

  handleFact(fact: SpeechPlaybackFact): void {
    const active = this.active;
    if (!active || fact.utteranceId !== active.utteranceId) {
      return;
    }
    this.apply({ type: 'fact', fact });
    if (fact.fact === 'chunk_started') {
      if (this.snapshot.state !== 'speaking') {
        return;
      }
      this.clearPlaybackGuard();
      active.playing = fact.chunkIndex;
      active.playhead = fact.chunkIndex;
      this.pump();
      return;
    }
    if (fact.fact === 'ended') {
      this.clearPlaybackGuard();
      active.playing = -1;
      active.playhead = fact.chunkIndex + 1;
      if (this.snapshot.state === 'paused') {
        return;
      }
      if (active.playhead >= active.chunks.length) {
        this.complete();
        return;
      }
      const url = active.urls[active.playhead];
      if (url) {
        this.playChunk(active, active.playhead);
      } else {
        this.pump();
      }
      return;
    }
    this.clearPlaybackGuard();
    this.host.notify({ code: 'playback_failed' });
    this.fail(active, TEXT.SPEECH_PLAYBACK_FAILED);
  }

  private async start(
    request: SpeechRequest & { text: string },
    overrides?: SpeechTargetOverrides
  ): Promise<SpeechSpeakOutcome> {
    const target = await this.host.resolveTarget(overrides);
    if (!target) {
      if (!this.assignmentNotified) {
        this.assignmentNotified = true;
        this.host.notify({ code: 'no_tts_assignment' });
      }
      return 'ignored';
    }
    this.assignmentNotified = false;
    const limit = request.source === 'reply' ? SPEECH_REPLY_CHUNK_CHARS : SPEECH_SHORT_CHUNK_CHARS;
    const chunks = splitSpeechChunks(request.text.slice(0, SPEECH_UTTERANCE_MAX_CHARS), limit)
      .map((chunk) => chunk.slice(0, MAX_TTS_CHARS))
      .filter(Boolean);
    if (chunks.length === 0) {
      return 'ignored';
    }
    this.counter += 1;
    const utteranceId = this.epoch + this.counter;
    const keys = chunks.map((chunk) => this.host.cacheKey({ ...target, text: chunk }));
    const active: ActiveUtterance = {
      utteranceId,
      source: request.source,
      text: request.text,
      chunks,
      keys,
      target,
      urls: new Array(chunks.length).fill(null),
      inFlight: new Map(),
      requestIds: new Set(),
      playing: -1,
      playhead: 0,
      cached: 0,
      synthesisCalls: 0,
    };
    this.active = active;
    this.apply({ type: 'start', utteranceId, source: request.source, chunkCount: chunks.length });
    void this.host.cacheRegister(keys).catch(() => undefined);
    this.pump();
    return 'started';
  }

  private pump(): void {
    const active = this.active;
    if (!active || this.snapshot.state === 'paused') {
      return;
    }
    if (active.playhead >= active.chunks.length) {
      this.complete();
      return;
    }
    const index = active.playhead;
    if (active.urls[index]) {
      if (active.playing < 0) {
        this.playChunk(active, index);
      }
      const next = index + 1;
      if (next < active.chunks.length && !active.urls[next] && !active.inFlight.has(next)) {
        void this.prepareChunk(active, next);
      }
      return;
    }
    if (!active.inFlight.has(index)) {
      void this.prepareChunk(active, index);
    }
  }

  private prepareChunk(active: ActiveUtterance, index: number): Promise<string | null> {
    const running = active.inFlight.get(index);
    if (running) {
      return running;
    }
    const task = this.resolveChunk(active, index).finally(() => {
      active.inFlight.delete(index);
    });
    active.inFlight.set(index, task);
    return task;
  }

  private async resolveChunk(active: ActiveUtterance, index: number): Promise<string | null> {
    const key = active.keys[index];
    try {
      const hit = await this.host.cacheLookup(key);
      if (this.active !== active) {
        return null;
      }
      if (hit) {
        active.cached += 1;
        return this.fulfil(active, index, hit.url);
      }
      const requestId = speechRequestId(active.utteranceId, index);
      active.requestIds.add(requestId);
      let audio: TtsAudio | null;
      try {
        audio = await this.host.synthesize({ ...active.target, text: active.chunks[index], requestId });
      } finally {
        active.requestIds.delete(requestId);
      }
      if (!audio || this.active !== active) {
        return null;
      }
      active.synthesisCalls += 1;
      const url = `data:${audio.mime};base64,${audio.audioBase64}`;
      const fulfilled = this.fulfil(active, index, url);
      void this.host.cacheStore(key, audio).catch(() => null);
      return fulfilled;
    } catch (error) {
      if (this.active !== active) {
        return null;
      }
      const detail = compactTtsError(error);
      this.host.notify({ code: 'provider_error', detail });
      this.fail(active, interpolate(TEXT.SPEECH_FAILED, { error: detail }));
      return null;
    }
  }

  private fulfil(active: ActiveUtterance, index: number, url: string): string {
    active.urls[index] = url;
    this.apply({ type: 'chunk_ready', utteranceId: active.utteranceId, chunkIndex: index, chunkText: active.chunks[index] });
    if (this.snapshot.state !== 'paused' && active.playing < 0 && index === active.playhead) {
      this.playChunk(active, index);
    }
    return url;
  }

  private playChunk(active: ActiveUtterance, index: number): void {
    const url = active.urls[index];
    if (!url) {
      return;
    }
    active.playing = index;
    active.playhead = index;
    this.host.play({ utteranceId: active.utteranceId, chunkIndex: index, url });
    this.armPlaybackGuard(active, index);
  }

  private armPlaybackGuard(active: ActiveUtterance, index: number): void {
    this.clearPlaybackGuard();
    const timer = setTimeout(() => {
      this.playbackGuard = null;
      if (this.active !== active || active.playing !== index) {
        return;
      }
      this.host.notify({ code: 'overlay_unavailable' });
      this.fail(active, TEXT.SPEECH_PLAYBACK_FAILED);
    }, SPEECH_PLAYBACK_GUARD_MS);
    timer.unref?.();
    this.playbackGuard = timer;
  }

  private clearPlaybackGuard(): void {
    if (this.playbackGuard !== null) {
      clearTimeout(this.playbackGuard);
      this.playbackGuard = null;
    }
  }

  private complete(): void {
    this.clearPlaybackGuard();
    const active = this.active;
    this.active = null;
    if (active) {
      this.pushHistory(active);
    }
    if (this.snapshot.state !== 'idle') {
      this.apply({ type: 'stop' });
    } else {
      this.host.broadcast(this.snapshot);
    }
    this.drainPending();
  }

  private fail(active: ActiveUtterance, detail: string): void {
    this.clearPlaybackGuard();
    this.active = null;
    if (isSpeechActive(this.snapshot.state)) {
      this.apply({
        type: 'fact',
        fact: {
          utteranceId: active.utteranceId,
          chunkIndex: Math.max(active.playhead, this.snapshot.chunkIndex),
          fact: 'error',
          detail,
        },
      });
    }
    this.pushHistory(active);
    this.drainPending();
  }

  private halt(): void {
    this.clearPlaybackGuard();
    const active = this.active;
    this.active = null;
    this.pending = null;
    if (!active) {
      return;
    }
    for (const requestId of active.requestIds) {
      this.host.cancelSynthesis(requestId);
    }
    this.host.stopPlayback();
    this.pushHistory(active);
  }

  private drainPending(): void {
    const next = this.pending;
    this.pending = null;
    if (next) {
      void this.enqueue(next.request, next.overrides, { skipDedupe: true });
    }
  }

  private apply(action: SpeechAction): void {
    const next = reduceSpeech(this.snapshot, action);
    if (next === this.snapshot) {
      return;
    }
    this.snapshot = next;
    this.host.broadcast(next);
  }

  /** Reissues the current chunk for a recreated overlay (plan 58 §4.2). */
  currentInstruction(): SpeechPlayInstruction | null {
    const active = this.active;
    if (!active) {
      return null;
    }
    const index = active.playing >= 0 ? active.playing : active.playhead;
    const url = active.urls[index];
    if (!url) {
      return null;
    }
    return { utteranceId: active.utteranceId, chunkIndex: index, url };
  }

  private resetToIdle(): void {
    this.snapshot = reduceSpeech(this.snapshot, { type: 'stop' });
  }

  private pushHistory(active: ActiveUtterance): void {
    if (active.source === 'preview') {
      return;
    }
    this.history.unshift({
      text: active.text,
      utteranceId: active.utteranceId,
      source: active.source,
      preview: active.text.replace(/\s+/g, ' ').trim().slice(0, 120),
      at: this.host.now(),
      chunks: active.chunks.length,
      cached: active.cached,
      synthesisCalls: active.synthesisCalls,
    });
    this.history = this.history.slice(0, SPEECH_HISTORY_LIMIT);
    this.host.onHistoryAvailable?.(this.history.length > 0);
  }

  private isDuplicate(key: string): boolean {
    const seen = this.dedupe.get(key);
    return seen !== undefined && this.host.now() - seen < SPEECH_DEDUPE_WINDOW_MS;
  }

  private pruneDedupe(): void {
    if (this.dedupe.size <= 64) {
      return;
    }
    const cutoff = this.host.now() - SPEECH_DEDUPE_WINDOW_MS;
    for (const [key, at] of this.dedupe) {
      if (at < cutoff) {
        this.dedupe.delete(key);
      }
    }
  }
}
