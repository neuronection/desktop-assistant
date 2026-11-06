import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { synthesizeSpeech, compactTtsError, MAX_TTS_CHARS } from '@main/ai/tts';
import { TtsService } from '@main/services/TtsService';
import { setAuditSink, setAiAuditClientProvider, type AiCallRecord } from '@main/ai/audit';
import { AiTask, LLMProviderType } from '@shared/types';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/da-tts-test', isPackaged: true },
}));

const createMock = vi.fn();
const clientOptionsMock = vi.fn();
vi.mock('openai', () => ({
  default: class {
    audio = { speech: { create: createMock } };
    constructor(options: unknown) {
      clientOptionsMock(options);
    }
  },
}));

const fetchMock = vi.fn();

beforeEach(() => {
  createMock.mockReset();
  clientOptionsMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  const records: AiCallRecord[] = [];
  setAuditSink(async (record) => {
    records.push(record);
  });
  (setAuditSink as unknown as { records: AiCallRecord[] }).records = records;
  setAiAuditClientProvider(() => null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAuditSink(async () => undefined);
});

describe('synthesizeSpeech', () => {
  it('calls the OpenAI-compatible speech endpoint and returns base64 wav', async () => {
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
      expect.objectContaining({ model: 'tts-1', voice: 'alloy', input: 'Hello there', speed: 1.25, response_format: 'wav' })
    );
    expect(result).toEqual({ audioBase64: Buffer.from([1, 2, 3]).toString('base64'), mime: 'audio/wav' });
  });

  it('defaults the voice per provider: ollama speaks Piper-style, others alloy', async () => {
    createMock.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([]).buffer });
    await synthesizeSpeech({
      apiKey: '',
      apiBase: 'http://localhost:11434/v1',
      model: 'lfm3-audio:latest',
      text: 'hi',
      providerType: LLMProviderType.OLLAMA,
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ voice: 'female', response_format: 'wav' })
    );
    await synthesizeSpeech({
      apiKey: 'k',
      apiBase: 'http://x/v1',
      model: 'tts-1',
      text: 'hi',
      providerType: LLMProviderType.OPENAI,
    });
    expect(createMock).toHaveBeenLastCalledWith(expect.objectContaining({ voice: 'alloy' }));
  });

  it('passes an explicit voice override through', async () => {
    createMock.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([]).buffer });
    await synthesizeSpeech({
      apiKey: '',
      apiBase: 'http://localhost:11434/v1',
      model: 'lfm3-audio:latest',
      text: 'hi',
      voice: 'male-british-english',
      providerType: LLMProviderType.OLLAMA,
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ voice: 'male-british-english' })
    );
  });

  it('aborts via the audioOps signal (second SDK options arg)', async () => {
    createMock.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1]).buffer });
    const controller = new AbortController();
    await synthesizeSpeech({ apiKey: 'k', apiBase: 'http://x/v1', model: 'tts-1', text: 'hi', signal: controller.signal });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'hi' }),
      expect.objectContaining({ signal: controller.signal })
    );
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

describe('compactTtsError', () => {
  it('maps provider status codes to short display text', () => {
    expect(compactTtsError({ status: 404 })).toBe('model or endpoint not found (HTTP 404)');
    expect(compactTtsError({ status: 403 })).toBe('access denied (HTTP 403)');
    expect(compactTtsError({ status: 429 })).toBe('rate limited (HTTP 429)');
    expect(compactTtsError({ status: 500 })).toBe('HTTP 500');
  });

  it('maps timeouts to a short notice (the raw undici message is useless)', () => {
    expect(
      compactTtsError(Object.assign(new Error('Request timed out. Node.js fetch timed out waiting for response headers'), { name: 'APIConnectionTimeoutError' }))
    ).toBe('no response from the server (timed out)');
    expect(compactTtsError(new Error('fetch failed'))).toBe('fetch failed');
  });

  it('surfaces the server 400 text — it names the rejected param', () => {
    expect(
      compactTtsError(
        Object.assign(new Error('400 voice "alloy" is not supported; use female or male'), { status: 400 })
      )
    ).toBe('voice "alloy" is not supported; use female or male');
    expect(compactTtsError({ status: 400 })).toBe('HTTP 400');
  });

  it('falls back to the error message, then to a generic string', () => {
    expect(compactTtsError(new Error('endpoint down'))).toBe('endpoint down');
    expect(compactTtsError('boom')).toBe('boom');
    expect(compactTtsError(null)).toBe('unknown error');
  });
});

describe('synthesizeSpeech (Gemini native)', () => {
  const GOOGLE_PARAMS = {
    apiKey: 'g-key',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3.1-flash-tts-preview',
    text: 'Hello there',
    voice: 'Kore',
    speed: 1,
    providerType: LLMProviderType.GOOGLE,
  };

  function geminiResponse(mimeType = 'audio/L16;codec=pcm;rate=24000') {
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from([1, 2, 3, 4]).toString('base64'), mimeType } }] } }],
      }),
    };
  }

  it('posts generateContent with AUDIO modality and wraps the PCM in WAV', async () => {
    fetchMock.mockResolvedValue(geminiResponse());
    const result = await synthesizeSpeech(GOOGLE_PARAMS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent');
    expect(init.headers['x-goog-api-key']).toBe('g-key');
    const body = JSON.parse(init.body);
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
    expect(body.contents[0].parts[0].text).toBe('Hello there');
    expect(result.mime).toBe('audio/wav');
    const wav = Buffer.from(result.audioBase64, 'base64');
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(4);
    expect(wav.length).toBe(48);
  });

  it('parses the sample rate from the mimeType and passes the configured voice through', async () => {
    fetchMock.mockResolvedValue(geminiResponse('audio/L16;codec=pcm;rate=16000'));
    const result = await synthesizeSpeech({ ...GOOGLE_PARAMS, voice: 'Sulafat' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Sulafat');
    const wav = Buffer.from(result.audioBase64, 'base64');
    expect(wav.readUInt32LE(24)).toBe(16000);
  });

  it('never maps an OpenAI voice alias onto a Gemini voice', async () => {
    fetchMock.mockResolvedValue(geminiResponse());
    await synthesizeSpeech({ ...GOOGLE_PARAMS, voice: 'nova' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('nova');
  });

  it('normalizes provider errors with the HTTP status', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ error: { code: 404, message: 'Model not found', status: 'NOT_FOUND' } }),
    });
    await expect(synthesizeSpeech(GOOGLE_PARAMS)).rejects.toMatchObject({ status: 404, message: 'Model not found' });
    await vi.waitFor(() => {
      const records: AiCallRecord[] = (setAuditSink as unknown as { records: AiCallRecord[] }).records;
      expect(records.some((record) => record.task === AiTask.TTS && record.outcome === 'error')).toBe(true);
    });
  });

  it('reports a missing inline payload as a plain error', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ candidates: [] }) });
    await expect(synthesizeSpeech(GOOGLE_PARAMS)).rejects.toThrow('no audio');
  });
});

describe('TtsService', () => {
  function withConfig(voice: Record<string, unknown>, taskAssignments: Record<string, string | null>, providerOverrides: Record<string, unknown> = {}): TtsService {
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
            apiKey: 'sk-inline',
            availableModels: [{ id: 'tts-1', name: 'TTS', providerType: 'openai', providerId: 'p1' }],
            customModels: [],
            ...providerOverrides,
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
    const service = withConfig({ speakReplies: true }, {});
    await expect(service.speak('hello')).resolves.toBeNull();
  });

  it('returns null for blank text', async () => {
    const service = withConfig({ speakReplies: true }, { tts: 'tts-1' });
    await expect(service.speak('   ')).resolves.toBeNull();
  });

  it('explicit speaks skip the toggle but still need the assignment', async () => {
    createMock.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([7]).buffer });
    const noToggle = withConfig({ speakReplies: false }, { tts: 'tts-1' });
    const result = await noToggle.speak('read this', false);
    expect(result?.audioBase64).toBeTruthy();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ input: 'read this' }));

    const unassigned = withConfig({ speakReplies: false }, {});
    await expect(unassigned.speak('read this', false)).resolves.toBeNull();
  });

  it('a cancelled synthesis resolves null — silent, never an error', async () => {
    createMock.mockRejectedValue(Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' }));
    const service = withConfig({ speakReplies: false }, { tts: 'tts-1' });
    await expect(service.speak('read this', false, 'tts-test-req-1')).resolves.toBeNull();
  });

  it('honors the provider timeout budget on the synthesis client', async () => {
    createMock.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([7]).buffer });
    const service = withConfig({ speakReplies: false }, { tts: 'tts-1' }, { timeout: 120000 });
    await service.speak('read this', false);
    expect(clientOptionsMock).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://api.example.com/v1', timeout: 120000 }));
  });

  it('routes Google providers to the native Gemini path', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from([5, 6]).toString('base64'), mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }],
      }),
    });
    const service = new TtsService();
    (service as unknown as { configService: { getConfig: () => unknown } }).configService = {
      getConfig: () => ({
        voice: { speakReplies: true },
        taskAssignments: { tts: 'gemini-3.1-flash-tts-preview' },
        providers: [
          {
            id: 'g1',
            type: LLMProviderType.GOOGLE,
            apiBase: 'https://generativelanguage.googleapis.com/v1beta',
            apiKey: 'g-inline',
            availableModels: [
              { id: 'gemini-3.1-flash-tts-preview', name: 'Gemini TTS', providerType: 'google', providerId: 'g1' },
            ],
            customModels: [],
          },
        ],
      }),
    };
    const result = await service.speak('hello');
    expect(createMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toContain('models/gemini-3.1-flash-tts-preview:generateContent');
    expect(result?.mime).toBe('audio/wav');
  });
});
