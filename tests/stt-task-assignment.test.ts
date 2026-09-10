import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getConfig, getSecret, transcribeAudioMock } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getSecret: vi.fn(),
  transcribeAudioMock: vi.fn(),
}));

vi.mock('@main/services/ConfigService', () => ({
  MainConfigService: { getInstance: () => ({ getConfig }) },
}));

vi.mock('@main/services/SecretService', () => ({
  SecretService: { getInstance: () => ({ getSecret }) },
  providerSecretKey: (id: string) => `provider:${id}`,
}));

vi.mock('@main/ai/stt', () => ({
  sanitizeTranscript: (text: string | null | undefined) => (text ? text.trim() : null),
  transcribeAudio: transcribeAudioMock,
}));

import { SttService } from '@main/services/SttService';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { LLMProviderType } from '@shared/types';

const provider = (overrides: Record<string, unknown> = {}) => ({
  ...DEFAULT_CONFIG.providers[0],
  id: 'p1',
  apiBase: 'https://whisper.local/v1',
  ...overrides,
});

const configWith = (sttAssignment: string | null, providerOverrides: Record<string, unknown> = {}, voiceOverrides: Record<string, unknown> = {}) => ({
  ...DEFAULT_CONFIG,
  providers: [
    provider({
      availableModels: [{ id: 'whisper-1', name: 'Whisper', providerType: LLMProviderType.OPENAI, providerId: 'p1', caps: ['audio'] }],
      ...providerOverrides,
    }),
  ],
  taskAssignments: { ...DEFAULT_CONFIG.taskAssignments, stt: sttAssignment },
  voice: { ...DEFAULT_CONFIG.voice, ...voiceOverrides },
});

describe('SttService task-assignment resolution', () => {
  beforeEach(() => {
    transcribeAudioMock.mockReset();
    getSecret.mockReset();
  });

  it('resolves the assigned model and its provider credentials', async () => {
    getConfig.mockReturnValue(configWith('whisper-1'));
    getSecret.mockResolvedValue('sk-secret-1234');
    transcribeAudioMock.mockResolvedValue('  hello world  ');

    const result = await new SttService().transcribe(Buffer.from('wav'));

    expect(getSecret).toHaveBeenCalledWith('provider:p1');
    expect(transcribeAudioMock).toHaveBeenCalledWith({
      apiKey: 'sk-secret-1234',
      apiBase: 'https://whisper.local/v1',
      model: 'whisper-1',
      audio: expect.any(Buffer),
    });
    expect(result).toBe('hello world');
  });

  it('falls back to the config provider key, then the local-server placeholder', async () => {
    getConfig.mockReturnValue(configWith('whisper-1', { apiKey: 'sk-config-key' }));
    getSecret.mockResolvedValue(null);
    await new SttService().transcribe(Buffer.from('wav'));
    expect(transcribeAudioMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-config-key' }));

    getConfig.mockReturnValue(configWith('whisper-1', { apiKey: '' }));
    await new SttService().transcribe(Buffer.from('wav'));
    expect(transcribeAudioMock).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'local-server' }));
  });

  it('rejects when no transcription model is assigned', async () => {
    getConfig.mockReturnValue(configWith(null));
    await expect(new SttService().transcribe(Buffer.from('wav'))).rejects.toThrow(/No transcription model/);
    expect(transcribeAudioMock).not.toHaveBeenCalled();
  });

  it('rejects when the assigned model is not in the registry', async () => {
    getConfig.mockReturnValue(configWith('gone-model'));
    await expect(new SttService().transcribe(Buffer.from('wav'))).rejects.toThrow(/No transcription model/);
    expect(transcribeAudioMock).not.toHaveBeenCalled();
  });

  it('passes a pinned language and omits it on auto-detect', async () => {
    getConfig.mockReturnValue(configWith('whisper-1', {}, { language: 'de' }));
    getSecret.mockResolvedValue(null);
    await new SttService().transcribe(Buffer.from('wav'));
    expect(transcribeAudioMock).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'de' }));

    getConfig.mockReturnValue(configWith('whisper-1', {}, { language: 'auto' }));
    await new SttService().transcribe(Buffer.from('wav'));
    expect(transcribeAudioMock).toHaveBeenLastCalledWith(expect.objectContaining({ language: undefined }));
  });

  it('rejects when voice input is disabled', async () => {
    getConfig.mockReturnValue(configWith('whisper-1', {}, { enabled: false }));
    await expect(new SttService().transcribe(Buffer.from('wav'))).rejects.toThrow(/disabled/);
    expect(transcribeAudioMock).not.toHaveBeenCalled();
  });
});
