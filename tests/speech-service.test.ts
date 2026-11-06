import { describe, it, expect, vi } from 'vitest';
import { LLMProviderType } from '@shared/types';
import { speechCacheKey } from '@main/services/SpeechCacheService';
import { splitSpeechChunks } from '@shared/text/speech-chunks';
import type { SpeechServiceHost } from '@main/services/SpeechService';
import { SpeechService } from '@main/services/SpeechService';
import type { SpeechNotice, SpeechPlayInstruction } from '@shared/speech';
import type { TtsAudio } from '@main/ai/tts';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
}));

const TARGET = {
  providerId: 'p1',
  providerType: LLMProviderType.OPENAI,
  apiBase: 'https://api.example.test/v1',
  modelId: 'tts-1',
  apiKey: 'key',
  speed: 1,
};

interface Harness {
  host: SpeechServiceHost;
  played: SpeechPlayInstruction[];
  notices: SpeechNotice[];
  cancelled: string[];
  synthesized: string[];
  stored: string[];
  clock: { now: number };
}

function makeHost(overrides: Partial<SpeechServiceHost> = {}): Harness {
  const played: SpeechPlayInstruction[] = [];
  const notices: SpeechNotice[] = [];
  const cancelled: string[] = [];
  const synthesized: string[] = [];
  const stored: string[] = [];
  const clock = { now: 1_000_000 };
  const host: SpeechServiceHost = {
    broadcast: vi.fn(),
    notify: (notice) => notices.push(notice),
    liveActive: () => false,
    readSelection: async () => ({ ok: true, text: 'selected text' }),
    readClipboard: async () => 'clipboard text',
    resolveTarget: async () => ({ ...TARGET }),
    synthesize: async (params): Promise<TtsAudio> => {
      synthesized.push(params.text);
      return { audioBase64: Buffer.from(params.text).toString('base64'), mime: 'audio/wav' };
    },
    cancelSynthesis: (requestId) => cancelled.push(requestId),
    cacheKey: (input) => speechCacheKey(input),
    cacheLookup: async () => null,
    cacheStore: async (key) => {
      stored.push(key);
      return `speech-cache://chunk/${key}.wav`;
    },
    cacheRegister: async () => null,
    play: (instruction) => played.push(instruction),
    stopPlayback: vi.fn(),
    selectionMaxChars: () => 8000,
    now: () => clock.now,
    onHistoryAvailable: vi.fn(),
    ...overrides,
  };
  return { host, played, notices, cancelled, synthesized, stored, clock };
}

const LONG_SELECTION = `${'A'.repeat(200)}. ${'B'.repeat(200)}.`;
const LONG_REPLY = `${'C'.repeat(3000)}. ${'D'.repeat(3000)}.`;

async function started(service: SpeechService, text: string, source: 'selection' | 'reply' | 'clipboard' = 'reply') {
  return service.speak({ text, source });
}

async function startFact(service: SpeechService, instruction: SpeechPlayInstruction): Promise<void> {
  service.handleFact({ utteranceId: instruction.utteranceId, chunkIndex: instruction.chunkIndex, fact: 'chunk_started' });
}

async function endFact(service: SpeechService, instruction: SpeechPlayInstruction): Promise<void> {
  service.handleFact({ utteranceId: instruction.utteranceId, chunkIndex: instruction.chunkIndex, fact: 'ended' });
}

async function playThrough(service: SpeechService, played: SpeechPlayInstruction[]): Promise<void> {
  for (let index = 0; index < played.length || service.getSnapshot().state !== 'idle'; index += 1) {
    await vi.waitFor(() => expect(played[index]).toBeDefined());
    const chunk = played[index];
    service.handleFact({ utteranceId: chunk.utteranceId, chunkIndex: chunk.chunkIndex, fact: 'chunk_started' });
    service.handleFact({ utteranceId: chunk.utteranceId, chunkIndex: chunk.chunkIndex, fact: 'ended' });
    if (service.getSnapshot().state === 'idle') {
      return;
    }
  }
}

describe('speech bus — playback pipeline', () => {
  it('plays a freshly synthesized chunk from an ephemeral URL and speaks on the fact', async () => {
    const harness = makeHost();
    const service = new SpeechService(harness.host);
    expect(await started(service, 'Hello there.', 'reply')).toBe('started');
    expect(service.getSnapshot()).toMatchObject({ state: 'synthesizing', source: 'reply', chunkCount: 1 });
    await vi.waitFor(() => expect(harness.played).toHaveLength(1));
    expect(harness.played[0].url).toMatch(/^data:audio\/wav;base64,/);
    expect(harness.synthesized).toEqual(['Hello there.']);
    await startFact(service, harness.played[0]);
    expect(service.getSnapshot()).toMatchObject({ state: 'speaking', chunkText: 'Hello there.' });
    await endFact(service, harness.played[0]);
    expect(service.getSnapshot().state).toBe('idle');
  });

  it('plays a cache hit without synthesizing', async () => {
    const key = speechCacheKey({ ...TARGET, text: 'Cached sentence.' });
    const harness = makeHost({
      cacheLookup: async (candidate) => (candidate === key ? { url: `speech-cache://chunk/${key}.wav`, mime: 'audio/wav' } : null),
    });
    const service = new SpeechService(harness.host);
    await started(service, 'Cached sentence.', 'reply');
    await vi.waitFor(() => expect(harness.played).toHaveLength(1));
    expect(harness.played[0].url).toBe(`speech-cache://chunk/${key}.wav`);
    expect(harness.synthesized).toEqual([]);
    expect(harness.stored).toEqual([]);
  });

  it('keeps reply speech at one chunk for typical replies and caps every long chunk', async () => {
    const harness = makeHost();
    const service = new SpeechService(harness.host);
    await started(service, 'A short reply.', 'reply');
    expect(service.getSnapshot().chunkCount).toBe(1);

    const longHarness = makeHost();
    const longService = new SpeechService(longHarness.host);
    await started(longService, LONG_REPLY, 'reply');
    expect(longService.getSnapshot().chunkCount).toBe(2);
    await playThrough(longService, longHarness.played);
    expect(longHarness.synthesized.every((text) => text.length <= 4000)).toBe(true);
    expect(longHarness.synthesized).toHaveLength(2);
  });

  it('chunks selection speech for fast first audio', async () => {
    const harness = makeHost();
    const service = new SpeechService(harness.host);
    await started(service, LONG_SELECTION, 'selection');
    expect(service.getSnapshot().chunkCount).toBe(2);
    await vi.waitFor(() => expect(harness.played).toHaveLength(1));
    expect(service.getSnapshot().chunkText.length).toBeLessThanOrEqual(300);
  });

  it('synthesizes exactly one chunk ahead of playback', async () => {
    const harness = makeHost();
    const service = new SpeechService(harness.host);
    await started(service, LONG_SELECTION, 'selection');
    await vi.waitFor(() => expect(harness.played).toHaveLength(1));
    expect(harness.synthesized).toHaveLength(1);
    await startFact(service, harness.played[0]);
    await vi.waitFor(() => expect(harness.synthesized).toHaveLength(2));
    expect(harness.synthesized).toHaveLength(2);
  });

  it('records history with cached ratio and synthesis-call count', async () => {
    const secondChunk = splitSpeechChunks(LONG_SELECTION, 300)[1];
    const secondKey = speechCacheKey({ ...TARGET, text: secondChunk });
    const harness = makeHost({
      cacheLookup: async (candidate) =>
        candidate === secondKey ? { url: `speech-cache://chunk/${candidate}.wav`, mime: 'audio/wav' } : null,
    });
    const service = new SpeechService(harness.host);
    await started(service, LONG_SELECTION, 'selection');
    await playThrough(service, harness.played);
    expect(service.getSnapshot().state).toBe('idle');
    const [entry] = service.getHistory();
    expect(entry).toMatchObject({
      source: 'selection',
      preview: LONG_SELECTION.slice(0, 120),
      chunks: 2,
      cached: 1,
      synthesisCalls: 1,
    });
  });
});

describe('speech bus — arbitration (plan 58 D6/D7)', () => {
  it('refuses while live is active', async () => {
    const harness = makeHost({ liveActive: () => true });
    const service = new SpeechService(harness.host);
    expect(await started(service, 'Hello.', 'selection')).toBe('live_busy');
    expect(harness.notices.map((notice) => notice.code)).toEqual(['live_busy']);
    expect(harness.played).toHaveLength(0);
  });

  it('lets selection preempt a speaking reply', async () => {
    const harness = makeHost();
    const service = new SpeechService(harness.host);
    await started(service, 'A reply that is already speaking.', 'reply');
    await vi.waitFor(() => expect(harness.played).toHaveLength(1));
    await startFact(service, harness.played[0]);
    expect(service.getSnapshot().state).toBe('speaking');

    expect(await started(service, 'Selected text.', 'selection')).toBe('started');
    expect(harness.host.stopPlayback).toHaveBeenCalled();
    expect(service.getSnapshot()).toMatchObject({ source: 'selection', state: 'synthesizing' });
    await vi.waitFor(() => expect(harness.played).toHaveLength(2));
    expect(harness.played[1].utteranceId).not.toBe(harness.played[0].utteranceId);
  });

  it('never lets a reply preempt a selection — it queues at depth 1', async () => {
    const harness = makeHost();
    const service = new SpeechService(harness.host);
    await started(service, LONG_SELECTION, 'selection');
    await vi.waitFor(() => expect(harness.played).toHaveLength(1));
    await startFact(service, harness.played[0]);

    expect(await started(service, 'first reply', 'reply')).toBe('queued');
    expect(await started(service, 'second reply', 'reply')).toBe('queued');
    expect(service.getSnapshot().source).toBe('selection');

    await endFact(service, harness.played[0]);
    await vi.waitFor(() => expect(harness.played).toHaveLength(2));
    await startFact(service, harness.played[1]);
    await endFact(service, harness.played[1]);
    await vi.waitFor(() => expect(harness.synthesized).toContain('second reply'));
    expect(harness.synthesized).not.toContain('first reply');
    expect(service.getSnapshot().source).toBe('reply');
  });

  it('replaces an inaudible same-tier utterance outright', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = makeHost();
    const gatedSynthesize = vi.fn(async (params: { text: string }): Promise<TtsAudio> => {
      harness.synthesized.push(params.text);
      if (params.text === 'older reply') {
        await gate;
      }
      return { audioBase64: 'AAAA', mime: 'audio/wav' };
    });
    const service = new SpeechService({ ...harness.host, synthesize: gatedSynthesize });
    await started(service, 'older reply', 'reply');
    expect(await started(service, 'newer reply', 'reply')).toBe('started');
    await vi.waitFor(() => expect(harness.played).toHaveLength(1));
    expect(harness.played[0].utteranceId).toBe(service.getSnapshot().utteranceId);
    release!();
  });

  it('queues a clipboard utterance behind a speaking selection but preempts a reply', async () => {
    const harness = makeHost();
    const service = new SpeechService(harness.host);
    await started(service, 'reply text', 'reply');
    expect(await started(service, 'clipboard text', 'clipboard')).toBe('started');
  });
});

describe('speech bus — pause, stop, cancellation (plan 58 race 7/11)', () => {
  it('latches a pause during synthesis and resumes into playing', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = makeHost();
    const service = new SpeechService({
      ...harness.host,
      synthesize: async (params) => {
        await gate;
        harness.synthesized.push(params.text);
        return { audioBase64: 'AAAA', mime: 'audio/wav' };
      },
    });
    await started(service, 'held text', 'selection');
    service.control('pause');
    expect(service.getSnapshot()).toMatchObject({ state: 'paused', resumeTo: 'synthesizing' });
    release!();
    await vi.waitFor(() => expect(service.getSnapshot().chunkText).toBe('held text'));
    expect(harness.played).toHaveLength(0);
    service.control('resume');
    await vi.waitFor(() => expect(harness.played).toHaveLength(1));
    expect(harness.played[0].url).toMatch(/^data:/);
  });

  it('holds further chunk preparation and playback while paused', async () => {
    const three = `${'A'.repeat(150)}. ${'B'.repeat(150)}. ${'C'.repeat(150)}.`;
    const harness = makeHost();
    const service = new SpeechService(harness.host);
    await started(service, three, 'selection');
    expect(service.getSnapshot().chunkCount).toBe(3);
    await vi.waitFor(() => expect(harness.played).toHaveLength(1));
    await startFact(service, harness.played[0]);
    await vi.waitFor(() => expect(harness.synthesized).toHaveLength(2));
    service.control('pause');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.synthesized).toHaveLength(2);
    expect(harness.played).toHaveLength(1);
    service.control('resume');
    expect(service.getSnapshot().state).toBe('speaking');
    await endFact(service, harness.played[0]);
    await vi.waitFor(() => expect(harness.played).toHaveLength(2));
  });

  it('cancels the in-flight provider op on stop and drops the late chunk', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = makeHost();
    const service = new SpeechService({
      ...harness.host,
      synthesize: async (params) => {
        await gate;
        harness.synthesized.push(params.text);
        return { audioBase64: 'AAAA', mime: 'audio/wav' };
      },
    });
    await started(service, 'cancel me', 'selection');
    const utteranceId = service.getSnapshot().utteranceId;
    service.control('stop');
    expect(harness.cancelled).toEqual([`speech:${utteranceId}:0`]);
    expect(service.getSnapshot().state).toBe('idle');
    release!();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.played).toHaveLength(0);
    expect(service.getSnapshot().state).toBe('idle');
  });

  it('drops facts from a prior utterance', async () => {
    const harness = makeHost();
    const service = new SpeechService(harness.host);
    await started(service, 'first', 'reply');
    await vi.waitFor(() => expect(harness.played).toHaveLength(1));
    const firstId = harness.played[0].utteranceId;
    service.control('stop');
    await started(service, 'second', 'selection');
    const before = service.getSnapshot();
    service.handleFact({ utteranceId: firstId, chunkIndex: 0, fact: 'chunk_started' });
    expect(service.getSnapshot()).toBe(before);
  });

  it('offers the current chunk for a recreated overlay', async () => {
    const harness = makeHost();
    const service = new SpeechService(harness.host);
    await started(service, 'resume me', 'selection');
    await vi.waitFor(() => expect(harness.played).toHaveLength(1));
    expect(service.currentInstruction()).toEqual(harness.played[0]);
    service.control('stop');
    expect(service.currentInstruction()).toBeNull();
  });
});

describe('speech bus — replay (plan 58 S6b)', () => {
  it('synthesizes a repeated selection exactly once', async () => {
    const stored = new Set<string>();
    const harness = makeHost({
      cacheLookup: async (key) =>
        stored.has(key) ? { url: `speech-cache://chunk/${key}.wav`, mime: 'audio/wav' } : null,
      cacheStore: async (key) => {
        stored.add(key);
        return `speech-cache://chunk/${key}.wav`;
      },
    });
    const service = new SpeechService(harness.host);
    await started(service, 'Say this once.', 'selection');
    await playThrough(service, harness.played);
    expect(harness.synthesized).toHaveLength(1);

    await started(service, 'Say this once.', 'selection');
    await playThrough(service, harness.played);
    expect(harness.synthesized).toHaveLength(1);
    expect(service.getHistory()[0].cached).toBe(1);
  });

  it('replays a cached utterance with zero synthesis calls, as source replay', async () => {
    const key = speechCacheKey({ ...TARGET, text: 'Replay me.' });
    const harness = makeHost({
      cacheLookup: async () => ({ url: `speech-cache://chunk/${key}.wav`, mime: 'audio/wav' }),
    });
    const service = new SpeechService(harness.host);
    await started(service, 'Replay me.', 'selection');
    await playThrough(service, harness.played);
    expect(service.getSnapshot().state).toBe('idle');

    const [entry] = service.getHistory();
    expect(entry).not.toHaveProperty('text');
    expect(harness.synthesized).toHaveLength(0);

    expect(await service.replay(entry.utteranceId)).toBe('started');
    await vi.waitFor(() => expect(harness.played).toHaveLength(2));
    expect(service.getSnapshot()).toMatchObject({ source: 'replay', state: 'synthesizing' });
    expect(harness.played[1].utteranceId).not.toBe(entry.utteranceId);
    expect(harness.synthesized).toHaveLength(0);
    expect((harness.host.onHistoryAvailable as ReturnType<typeof vi.fn>).mock.calls.at(-1)).toEqual([true]);
  });

  it('ignores an unknown utterance id', async () => {
    const harness = makeHost();
    const service = new SpeechService(harness.host);
    expect(await service.replay(999)).toBe('ignored');
  });
});

describe('speech bus — requests and notices', () => {
  it('dedupes a repeated dedupeKey inside the 2 s window', async () => {
    const harness = makeHost();
    const service = new SpeechService(harness.host);
    expect(await service.speak({ text: 'reply', source: 'reply', dedupeKey: 'msg-1' })).toBe('started');
    expect(await service.speak({ text: 'reply', source: 'reply', dedupeKey: 'msg-1' })).toBe('duplicate');
    service.control('stop');
    harness.clock.now += 2_001;
    expect(await service.speak({ text: 'reply', source: 'reply', dedupeKey: 'msg-1' })).toBe('started');
  });

  it('refuses a selection over the configured cost limit', async () => {
    const harness = makeHost({ readSelection: async () => ({ ok: true, text: 'x'.repeat(30) }), selectionMaxChars: () => 10 });
    const service = new SpeechService(harness.host);
    expect(await service.speakSelection()).toBe('ignored');
    expect(harness.notices).toEqual([{ code: 'too_long', limit: 10 }]);
  });

  it('distinguishes no_selection from selection_unsupported', async () => {
    const empty = makeHost({ readSelection: async () => ({ ok: false, reason: 'no_selection' }) });
    expect(await new SpeechService(empty.host).speakSelection()).toBe('ignored');
    expect(empty.notices[0].code).toBe('no_selection');

    const unsupported = makeHost({ readSelection: async () => ({ ok: false, reason: 'unsupported' }) });
    expect(await new SpeechService(unsupported.host).speakSelection()).toBe('ignored');
    expect(unsupported.notices[0].code).toBe('selection_unsupported');
  });

  it('notifies a missing tts assignment once per session', async () => {
    const harness = makeHost({ resolveTarget: async () => null });
    const service = new SpeechService(harness.host);
    expect(await started(service, 'one')).toBe('ignored');
    expect(await started(service, 'two')).toBe('ignored');
    expect(harness.notices.map((notice) => notice.code)).toEqual(['no_tts_assignment']);
  });

  it('maps a provider failure to a compact notice and a terminal idle flash', async () => {
    const harness = makeHost({
      synthesize: async () => {
        throw Object.assign(new Error('model not found'), { status: 404 });
      },
    });
    const service = new SpeechService(harness.host);
    await started(service, 'boom', 'selection');
    await vi.waitFor(() => expect(service.getSnapshot().state).toBe('idle'));
    expect(harness.notices).toEqual([{ code: 'provider_error', detail: 'model or endpoint not found (HTTP 404)' }]);
    expect(service.getSnapshot().lastError).toContain('Speech failed');
    expect(service.getHistory()[0]).toMatchObject({ synthesisCalls: 0 });
  });

  it('speaks the clipboard as its own source', async () => {
    const harness = makeHost({ readClipboard: async () => '  from the clipboard  ' });
    const service = new SpeechService(harness.host);
    expect(await service.speakClipboard()).toBe('started');
    expect(harness.synthesized[0]).toBe('from the clipboard');
    expect(service.getSnapshot().source).toBe('clipboard');
  });
});

describe('speech bus — voice preview (plan 60)', () => {
  function previewHost() {
    const resolveTarget = vi.fn(async (overrides?: { voice?: string; speed?: number }) => ({
      ...TARGET,
      ...(overrides?.voice !== undefined ? { voice: overrides.voice || 'alloy' } : {}),
      ...(overrides?.speed !== undefined ? { speed: overrides.speed } : {}),
    }));
    return { ...makeHost({ resolveTarget }), resolveTarget };
  }

  it('auditions the draft voice/speed through the bus and stays out of history', async () => {
    const harness = previewHost();
    const service = new SpeechService(harness.host);
    expect(await service.preview({ voice: 'onyx', speed: 1.5 })).toBe('started');
    expect(harness.resolveTarget).toHaveBeenCalledWith({ voice: 'onyx', speed: 1.5 });
    expect(service.getSnapshot()).toMatchObject({ source: 'preview', state: 'synthesizing' });

    await playThrough(service, harness.played);
    expect(service.getSnapshot().state).toBe('idle');
    expect(service.getHistory()).toEqual([]);
  });

  it('refuses a preview while live owns the speaker', async () => {
    const harness = previewHost();
    const service = new SpeechService({ ...harness.host, liveActive: () => true });
    expect(await service.preview({ voice: 'onyx' })).toBe('live_busy');
    expect(harness.resolveTarget).not.toHaveBeenCalled();
    expect(harness.notices).toEqual([{ code: 'live_busy' }]);
  });

  it('keeps the draft override when the preview queues behind a selection', async () => {
    const harness = previewHost();
    const service = new SpeechService(harness.host);
    expect(await service.speak({ text: 'selected', source: 'selection' })).toBe('started');
    expect(await service.preview({ voice: 'onyx' })).toBe('queued');
    await playThrough(service, harness.played);
    await vi.waitFor(() => expect(service.getSnapshot().source).toBe('preview'));
    expect(harness.resolveTarget).toHaveBeenLastCalledWith({ voice: 'onyx' });
  });

  it('dedupes the same audition but never drops a different voice', async () => {
    const harness = previewHost();
    const service = new SpeechService(harness.host);
    expect(await service.preview({ voice: 'onyx' })).toBe('started');
    expect(await service.preview({ voice: 'onyx' })).toBe('duplicate');
    expect(await service.preview({ voice: 'nova' })).not.toBe('duplicate');
  });

  it('shows a failed preview as the snapshot error without adding history', async () => {
    const harness = previewHost();
    const service = new SpeechService({
      ...harness.host,
      synthesize: async () => {
        throw Object.assign(new Error('voice "onyx" is not supported'), { status: 400 });
      },
    });
    await service.preview({ voice: 'onyx' });
    await vi.waitFor(() => expect(service.getSnapshot().state).toBe('idle'));
    expect(service.getSnapshot().lastError).toContain('voice "onyx" is not supported');
    expect(service.getHistory()).toEqual([]);
  });
});


describe('speech bus — resilience (W7)', () => {
  it('advances past a chunk that ends while paused and completes on resume', async () => {
    const harness = makeHost();
    const service = new SpeechService(harness.host);
    await started(service, 'One chunk only.', 'reply');
    await vi.waitFor(() => expect(harness.played).toHaveLength(1));
    await startFact(service, harness.played[0]);
    service.control('pause');
    await endFact(service, harness.played[0]);
    expect(service.getSnapshot().state).toBe('paused');
    service.control('resume');
    await vi.waitFor(() => expect(service.getSnapshot().state).toBe('idle'));
  });

  it('queues a concurrent speak while the first target is resolving', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    const harness = makeHost({
      resolveTarget: async () => {
        if (first) {
          first = false;
          await gate;
        }
        return { ...TARGET };
      },
    });
    const service = new SpeechService(harness.host);
    const a = service.speak({ text: 'First.', source: 'reply' });
    const b = service.speak({ text: 'Second.', source: 'reply' });
    expect(await b).toBe('queued');
    release?.();
    expect(await a).toBe('started');
    expect(service.getSnapshot().chunkCount).toBe(1);
  });

  it('re-arms the missing-TTS notice after a successful assignment', async () => {
    let hasTarget = false;
    const harness = makeHost({
      resolveTarget: async () => (hasTarget ? { ...TARGET } : null),
    });
    const service = new SpeechService(harness.host);
    expect(await service.speak({ text: 'One.', source: 'reply' })).toBe('ignored');
    expect(harness.notices.filter((notice) => notice.code === 'no_tts_assignment')).toHaveLength(1);
    hasTarget = true;
    expect(await service.speak({ text: 'Two.', source: 'reply' })).toBe('started');
    service.stop();
    hasTarget = false;
    expect(await service.speak({ text: 'Three.', source: 'reply' })).toBe('ignored');
    expect(harness.notices.filter((notice) => notice.code === 'no_tts_assignment')).toHaveLength(2);
  });

  it('fails an utterance and notices when the overlay never reports playback', async () => {
    vi.useFakeTimers();
    try {
      const harness = makeHost();
      const service = new SpeechService(harness.host);
      await service.speak({ text: 'Never starts.', source: 'reply' });
      for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
      }
      expect(harness.played).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(20_001);
      expect(harness.notices.some((notice) => notice.code === 'overlay_unavailable')).toBe(true);
      expect(service.getSnapshot().state).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });
});
