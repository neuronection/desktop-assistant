import { describe, it, expect, vi } from 'vitest';
import { LLMProviderType } from '@shared/types';
import { SpeechService, type SpeechServiceHost } from '@main/services/SpeechService';
import { attachSpeechPowerEvents, type SpeechPowerEvent } from '@main/services/speechPower';
import { speechCacheKey } from '@main/services/SpeechCacheService';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
}));

function fakeMonitor(): {
  monitor: { on(event: SpeechPowerEvent, listener: () => void): void };
  fire(event: SpeechPowerEvent): void;
} {
  const listeners = new Map<SpeechPowerEvent, (() => void)[]>();
  return {
    monitor: {
      on: (event, listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
    },
    fire: (event) => {
      for (const listener of listeners.get(event) ?? []) {
        listener();
      }
    },
  };
}

function host(): { host: SpeechServiceHost; state: { played: number } } {
  const state = { played: 0 };
  return {
    state,
    host: {
      broadcast: vi.fn(),
      notify: vi.fn(),
      liveActive: () => false,
      readSelection: async () => ({ ok: true, text: 'hello' }),
      readClipboard: async () => 'hello',
      resolveTarget: async () => ({
        providerId: 'p',
        providerType: LLMProviderType.OPENAI,
        apiBase: 'b',
        modelId: 'm',
        apiKey: 'k',
        speed: 1,
      }),
      synthesize: async () => ({ audioBase64: 'AAAA', mime: 'audio/wav' }),
      cancelSynthesis: vi.fn(),
      cacheKey: (input) => speechCacheKey(input),
      cacheLookup: async () => null,
      cacheStore: async () => null,
      cacheRegister: async () => null,
      play: () => {
        state.played += 1;
      },
      stopPlayback: vi.fn(),
      selectionMaxChars: () => 8000,
      now: () => 1000,
    },
  };
}

describe('speech power events (plan 58 race 8)', () => {
  it('subscribes to both suspend and lock-screen', () => {
    const speech = { suspend: vi.fn() };
    const { monitor, fire } = fakeMonitor();
    attachSpeechPowerEvents(monitor, speech);
    fire('suspend');
    fire('lock-screen');
    expect(speech.suspend).toHaveBeenCalledTimes(2);
  });

  it('lands a paused bus in idle — never paused, never auto-plays on wake', async () => {
    const harness = host();
    const service = new SpeechService(harness.host);
    await service.speak({ text: 'hello', source: 'selection' });
    await vi.waitFor(() => expect(service.getSnapshot().state).toBe('synthesizing'));
    service.control('pause');
    expect(service.getSnapshot().state).toBe('paused');

    const { monitor, fire } = fakeMonitor();
    attachSpeechPowerEvents(monitor, service);
    fire('suspend');

    expect(service.getSnapshot().state).toBe('idle');
    const broadcast = harness.host.broadcast as ReturnType<typeof vi.fn>;
    expect(broadcast).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'idle' }));
    const playedBeforeSuspend = harness.state.played;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.state.played).toBe(playedBeforeSuspend);
  });
});
