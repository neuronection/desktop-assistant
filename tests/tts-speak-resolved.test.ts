import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMProviderType } from '@shared/types';
import type { TtsAudio } from '@main/ai/tts';

const synthesizeSpeech = vi.fn(async (): Promise<TtsAudio> => ({ audioBase64: 'AAAA', mime: 'audio/wav' }));

vi.mock('@main/ai/tts', () => ({
  synthesizeSpeech: (...args: unknown[]) => synthesizeSpeech(...(args as [])),
  MAX_TTS_CHARS: 4000,
}));

let config: Record<string, unknown>;
let resolution: Record<string, unknown> | null;
let secret: string | null;

vi.mock('@main/services/ConfigService', () => ({
  MainConfigService: {
    getInstance: () => ({ getConfig: () => config }),
  },
}));

vi.mock('@main/services/SecretService', () => ({
  providerSecretKey: (id: string) => `provider:${id}`,
  SecretService: {
    getInstance: () => ({ getSecret: async () => secret }),
  },
}));

vi.mock('@shared/ai/tasks', () => ({
  resolveTaskModel: () => resolution,
}));

import { TtsService } from '@main/services/TtsService';

const provider = {
  id: 'p1',
  type: LLMProviderType.OPENAI,
  apiBase: 'https://api.example.test/v1',
  apiKey: 'config-key',
  timeout: 30_000,
};

beforeEach(() => {
  synthesizeSpeech.mockClear();
  config = { voice: { speakReplies: false, speechSpeed: 1.25 } };
  resolution = { providerId: 'p1', modelId: 'tts-1', provider };
  secret = null;
});

describe('TtsService.resolveTarget (plan 58 §4.4)', () => {
  it('resolves provider, model, key, speed and budget once', async () => {
    secret = 'keyring-key';
    const target = await new TtsService().resolveTarget();
    expect(target).toEqual({
      providerId: 'p1',
      providerType: LLMProviderType.OPENAI,
      apiBase: 'https://api.example.test/v1',
      modelId: 'tts-1',
      apiKey: 'keyring-key',
      voice: 'alloy',
      speed: 1.25,
      timeout: 30_000,
    });
  });

  it('falls back to the provider row key, and refuses a keyless non-OLLAMA provider', async () => {
    expect((await new TtsService().resolveTarget())?.apiKey).toBe('config-key');
    config = { voice: {} };
    resolution = { providerId: 'p2', modelId: 'tts-1', provider: { ...provider, apiKey: '' } };
    expect(await new TtsService().resolveTarget()).toBeNull();
    resolution = {
      providerId: 'p3',
      modelId: 'tts-1',
      provider: { ...provider, type: LLMProviderType.OLLAMA, apiKey: '' },
    };
    expect((await new TtsService().resolveTarget())?.apiKey).toBe('');
  });

  it('accepts a keyless loopback OpenAI-compatible provider (Kokoro/LocalAI/Piper)', async () => {
    config = { voice: {} };
    resolution = {
      providerId: 'p4',
      modelId: 'kokoro',
      provider: { ...provider, apiBase: 'http://localhost:8880/v1', apiKey: '' },
    };
    const target = await new TtsService().resolveTarget();
    expect(target?.apiKey).toBe('');
    expect(target?.voice).toBe('af_sky');
  });

  it('uses the configured voice and profile default, and drops speed where unsupported', async () => {
    config = { voice: { speechSpeed: 1.25, speechVoice: 'nova' } };
    expect((await new TtsService().resolveTarget())?.voice).toBe('nova');
    config = { voice: { speechSpeed: 1.25, speechVoice: '  ' } };
    expect((await new TtsService().resolveTarget())?.voice).toBe('alloy');
    resolution = {
      providerId: 'g1',
      modelId: 'gemini-tts',
      provider: {
        ...provider,
        type: LLMProviderType.GOOGLE,
        apiBase: 'https://generativelanguage.googleapis.com/v1beta',
      },
    };
    const gemini = await new TtsService().resolveTarget();
    expect(gemini?.voice).toBe('Kore');
    expect(gemini?.speed).toBeUndefined();
  });

  it('applies the preview overrides without persisting them', async () => {
    config = { voice: { speechVoice: 'nova', speechSpeed: 1 } };
    const target = await new TtsService().resolveTarget({ voice: 'onyx', speed: 1.5 });
    expect(target?.voice).toBe('onyx');
    expect(target?.speed).toBe(1.5);
    const defaulted = await new TtsService().resolveTarget({ voice: '' });
    expect(defaulted?.voice).toBe('alloy');
  });

  it('returns null without a tts assignment', async () => {
    resolution = null;
    expect(await new TtsService().resolveTarget()).toBeNull();
  });
});

describe('TtsService.speakResolved', () => {
  const target = {
    providerId: 'p1',
    providerType: LLMProviderType.OPENAI,
    apiBase: 'https://api.example.test/v1',
    modelId: 'tts-1',
    apiKey: 'key',
    voice: 'alloy',
    speed: 1.25,
    timeout: 30_000,
  };

  it('synthesizes with the resolved values', async () => {
    await new TtsService().speakResolved({ ...target, text: 'Hello.', voice: 'nova', requestId: 'req-12345678' });
    expect(synthesizeSpeech).toHaveBeenCalledWith({
      apiKey: 'key',
      apiBase: 'https://api.example.test/v1',
      model: 'tts-1',
      text: 'Hello.',
      voice: 'nova',
      speed: 1.25,
      providerType: LLMProviderType.OPENAI,
      providerId: 'p1',
      timeout: 30_000,
      signal: expect.anything(),
    });
  });

  it('sends exactly the resolved target (the voice profile owns the speed gate)', async () => {
    await new TtsService().speakResolved({ ...target, providerType: LLMProviderType.GOOGLE, text: 'Hello.' });
    expect(synthesizeSpeech.mock.calls[0][0]).toMatchObject({ speed: 1.25, voice: 'alloy' });
  });

  it('returns null for empty text without calling the provider', async () => {
    expect(await new TtsService().speakResolved({ ...target, text: '   ' })).toBeNull();
    expect(synthesizeSpeech).not.toHaveBeenCalled();
  });

  it('returns null when cancelled and propagates real failures', async () => {
    synthesizeSpeech.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    expect(await new TtsService().speakResolved({ ...target, text: 'Hello.' })).toBeNull();
    synthesizeSpeech.mockRejectedValueOnce(new Error('HTTP 500'));
    await expect(new TtsService().speakResolved({ ...target, text: 'Hello.' })).rejects.toThrow('HTTP 500');
  });
});

describe('TtsService.speak keeps the toggle gate', () => {
  it('returns null while speakReplies is off, then speaks when on', async () => {
    const service = new TtsService();
    expect(await service.speak('Hello.')).toBeNull();
    expect(synthesizeSpeech).not.toHaveBeenCalled();
    expect(await service.speak('Hello.', false)).not.toBeNull();
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
  });
});
