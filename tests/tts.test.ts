import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { synthesizeSpeech, MAX_TTS_CHARS } from '@main/ai/tts';
import { TtsService } from '@main/services/TtsService';
import { setAuditSink, setAiAuditClientProvider, type AiCallRecord } from '@main/ai/audit';
import { AiTask, LLMProviderType } from '@shared/types';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/da-tts-test', isPackaged: true },
}));

const createMock = vi.fn();
vi.mock('openai', () => ({
  default: class {
    audio = { speech: { create: createMock } };
  },
}));

beforeEach(() => {
  createMock.mockReset();
  const records: AiCallRecord[] = [];
  setAuditSink(async (record) => {
    records.push(record);
  });
  (setAuditSink as unknown as { records: AiCallRecord[] }).records = records;
  setAiAuditClientProvider(() => null);
});

afterEach(() => {
  setAuditSink(async () => undefined);
});

describe('synthesizeSpeech', () => {
  it('calls the OpenAI-compatible speech endpoint and returns base64 mp3', async () => {
    createMock.mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    const result = await synthesizeSpeech({
      apiKey: 'sk-test',
      apiBase: 'https://api.example.com/v1',
      model: 'tts-1',
      text: 'Hello there',
      voice: 'alloy',
      speed: 1.25,
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'tts-1', voice: 'alloy', input: 'Hello there', speed: 1.25, response_format: 'mp3' })
    );
    expect(result).toEqual({ audioBase64: Buffer.from([1, 2, 3]).toString('base64'), mime: 'audio/mpeg' });
  });

  it('caps the input text and clamps the speed', async () => {
    createMock.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([]).buffer });
    await synthesizeSpeech({
      apiKey: '',
      apiBase: 'http://localhost/v1',
      model: 'kokoro',
      text: 'x'.repeat(MAX_TTS_CHARS + 500),
      voice: '',
      speed: 9,
    });
    const call = createMock.mock.calls[0][0];
    expect(call.input.length).toBe(MAX_TTS_CHARS);
    expect(call.voice).toBe('alloy');
    expect(call.speed).toBe(4);
  });

  it('audits ok and error outcomes on the tts task', async () => {
    const records: AiCallRecord[] = [];
    setAuditSink(async (record) => {
      records.push(record);
    });

    createMock.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([9]).buffer });
    await synthesizeSpeech({ apiKey: 'k', apiBase: 'http://x/v1', model: 'tts-1', text: 'hi', voice: 'nova', speed: 1 });
    await vi.waitFor(() => {
      expect(records.some((record) => record.task === AiTask.TTS && record.outcome === 'ok')).toBe(true);
    });

    createMock.mockRejectedValue(new Error('endpoint down'));
    await expect(
      synthesizeSpeech({ apiKey: 'k', apiBase: 'http://x/v1', model: 'tts-1', text: 'hi', voice: 'nova', speed: 1 })
    ).rejects.toThrow('endpoint down');
    await vi.waitFor(() => {
      expect(records.some((record) => record.task === AiTask.TTS && record.outcome === 'error')).toBe(true);
    });
  });
});

describe('TtsService', () => {
  function withConfig(voice: Record<string, unknown>, taskAssignments: Record<string, string | null>): TtsService {
    const service = new TtsService();
    (service as unknown as { configService: { getConfig: () => unknown } }).configService = {
      getConfig: () => ({
        voice,
        taskAssignments,
        providers: [
          {
            id: 'p1',
            type: LLMProviderType.OPENAI,
            apiBase: 'https://api.example.com/v1',
            availableModels: [{ id: 'tts-1', name: 'TTS', providerType: 'openai', providerId: 'p1' }],
            customModels: [],
          },
        ],
      }),
    };
    return service;
  }

  it('returns null when speak replies is off (default)', async () => {
    const service = withConfig({ speakReplies: false }, { tts: 'tts-1' });
    await expect(service.speak('hello')).resolves.toBeNull();
  });

  it('returns null when no tts model is assigned', async () => {
    const service = withConfig({ speakReplies: true, speakVoice: 'coral', speakSpeed: 1 }, {});
    await expect(service.speak('hello')).resolves.toBeNull();
  });

  it('returns null for blank text', async () => {
    const service = withConfig({ speakReplies: true }, { tts: 'tts-1' });
    await expect(service.speak('   ')).resolves.toBeNull();
  });
});
