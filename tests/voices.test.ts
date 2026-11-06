import { describe, it, expect } from 'vitest';
import { LLMProviderType } from '@shared/types';
import { resolveVoiceProfile } from '@shared/ai/voices';
import { isKeylessBaseUrl } from '@shared/ai/local';

describe('voice profiles (plan 60)', () => {
  it('matches Kokoro by model id or base URL before the provider type', () => {
    const byModel = resolveVoiceProfile({
      providerType: LLMProviderType.OPENAI,
      modelId: 'kokoro',
      apiBase: 'http://localhost:8880/v1',
    });
    expect(byModel.id).toBe('kokoro');
    expect(byModel.defaultVoice).toBe('af_sky');
    expect(byModel.supportsSpeed).toBe('yes');
    expect(byModel.voices.map((voice) => voice.id)).toContain('af_sky');

    const byBase = resolveVoiceProfile({
      providerType: LLMProviderType.OPENAI,
      modelId: 'tts-1',
      apiBase: 'http://kokoro.local:8880/v1',
    });
    expect(byBase.id).toBe('kokoro');
  });

  it('uses the Gemini prebuilt list and never supports speed there', () => {
    const profile = resolveVoiceProfile({ providerType: LLMProviderType.GOOGLE, modelId: 'gemini-tts' });
    expect(profile.id).toBe('gemini');
    expect(profile.defaultVoice).toBe('Kore');
    expect(profile.supportsSpeed).toBe('no');
    expect(profile.voices.map((voice) => voice.id)).toEqual(
      expect.arrayContaining(['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede', 'Sulafat'])
    );
  });

  it('uses Piper defaults for Ollama', () => {
    const profile = resolveVoiceProfile({ providerType: LLMProviderType.OLLAMA, modelId: 'lfm3-audio' });
    expect(profile.id).toBe('piper');
    expect(profile.defaultVoice).toBe('female');
    expect(profile.voices.map((voice) => voice.id)).toEqual(['female', 'male']);
  });

  it('keeps the OpenAI list, and marks tts-1 speed support explicitly', () => {
    const tts1 = resolveVoiceProfile({ providerType: LLMProviderType.OPENAI, modelId: 'tts-1' });
    expect(tts1.id).toBe('openai');
    expect(tts1.defaultVoice).toBe('alloy');
    expect(tts1.supportsSpeed).toBe('yes');
    expect(tts1.voices.map((voice) => voice.id)).toEqual(
      expect.arrayContaining(['alloy', 'nova', 'onyx', 'shimmer'])
    );

    const gpt4o = resolveVoiceProfile({ providerType: LLMProviderType.OPENAI, modelId: 'gpt-4o-mini-tts' });
    expect(gpt4o.supportsSpeed).toBe('unknown');
  });

  it('falls back to the generic profile for unknown or missing targets', () => {
    for (const target of [
      {},
      { providerType: LLMProviderType.ANTHROPIC, modelId: 'claude' },
      { providerType: LLMProviderType.DECISION, modelId: 'systemone' },
    ]) {
      const profile = resolveVoiceProfile(target);
      expect(profile.id).toBe('generic');
      expect(profile.defaultVoice).toBe('alloy');
      expect(profile.voices).toEqual([]);
    }
  });
});

describe('keyless local providers (plan 60 D7)', () => {
  it('accepts loopback, mDNS and RFC1918 hosts', () => {
    for (const base of [
      'http://localhost:8880/v1',
      'http://127.0.0.1:8080/v1',
      'http://[::1]:8080/v1',
      'http://speech.local/v1',
      'http://host.docker.internal:8880/v1',
      'http://10.0.0.5:8880/v1',
      'http://192.168.1.20:8880/v1',
      'http://172.16.4.2:8880/v1',
      'http://172.31.0.9:8880/v1',
    ]) {
      expect(isKeylessBaseUrl(base), base).toBe(true);
    }
  });

  it('does not treat a public host, an empty base or a bad URL as keyless', () => {
    for (const base of [
      'https://api.openai.com/v1',
      'https://speech.example.com/v1',
      'http://172.32.0.1:8880/v1',
      'http://8.8.8.8/v1',
      '',
      undefined,
      'not a url',
    ]) {
      expect(isKeylessBaseUrl(base), String(base)).toBe(false);
    }
  });
});
