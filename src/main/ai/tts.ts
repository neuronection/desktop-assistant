import OpenAI from 'openai';
import { recordAiCall } from './audit';
import { AiTask, LLMProviderType } from '@shared/types';

export const MAX_TTS_CHARS = 4_000;

export interface TtsAudio {
  audioBase64: string;
  mime: string;
}

/**
 * Sanctioned non-chat model endpoint (the STT precedent): synthesis for
 * the `tts` task, audited like every gateway call. Two flavors:
 * OpenAI-compatible `/audio/speech` (default) and native Gemini
 * `generateContent` (responseModalities AUDIO, PCM → WAV) for
 * `LLMProviderType.GOOGLE` providers. Returns base64 audio for
 * renderer-side playback.
 */
export async function synthesizeSpeech(params: {
  apiKey: string;
  apiBase: string;
  model: string;
  text: string;
  /** Optional voice override; when omitted each flavor uses its own default. */
  voice?: string;
  /** Optional speed override; when omitted the provider default applies. */
  speed?: number;
  providerType?: LLMProviderType;
  providerId?: string;
  audit?: boolean;
  /** Cancellation (audioOps seam): aborts the provider request. */
  signal?: AbortSignal;
  /** Provider-configured request budget (ms) — honors the provider row's
   * `timeout` so slow local servers fail bounded instead of hanging on
   * undici's default headers timeout. */
  timeout?: number;
}): Promise<TtsAudio> {
  const text = params.text.slice(0, MAX_TTS_CHARS);
  const startedAt = Date.now();
  try {
    const audio =
      params.providerType === LLMProviderType.GOOGLE
        ? await synthesizeGemini({ ...params, text })
        : await synthesizeOpenAI({ ...params, text });
    if (params.audit !== false) {
      void recordAiCall({
        task: AiTask.TTS,
        providerId: params.providerId,
        model: params.model,
        durationMs: Date.now() - startedAt,
        outcome: 'ok',
      }).catch(() => undefined);
    }
    return audio;
  } catch (error) {
    if (params.audit !== false) {
      void recordAiCall({
        task: AiTask.TTS,
        providerId: params.providerId,
        model: params.model,
        durationMs: Date.now() - startedAt,
        outcome: 'error',
        error: (error as Error).message?.slice(0, 300),
      }).catch(() => undefined);
    }
    throw error;
  }
}

async function synthesizeOpenAI(params: {
  apiKey: string;
  apiBase: string;
  model: string;
  text: string;
  voice?: string;
  speed?: number;
  providerType?: LLMProviderType;
  signal?: AbortSignal;
  timeout?: number;
}): Promise<TtsAudio> {
  const openai = new OpenAI({
    apiKey: params.apiKey || 'local-server',
    baseURL: params.apiBase,
    // The provider's own budget — a cold local TTS server (model load) can
    // exceed undici's default headers timeout, which surfaced as a raw
    // UND_ERR_HEADERS_TIMEOUT instead of a bounded, readable failure.
    ...(params.timeout ? { timeout: params.timeout } : {}),
  });
  const response = await openai.audio.speech.create(
    {
      model: params.model,
      // Per-flavor default voices (the Gemini Kore precedent): ollama's
      // /v1/audio/speech validates Piper-style voices (female, male,
      // female-<language>) and 400s on OpenAI names like alloy.
      voice: (params.voice as 'alloy') || (params.providerType === LLMProviderType.OLLAMA ? 'female' : 'alloy'),
      input: params.text,
      ...(params.speed !== undefined ? { speed: Math.min(4, Math.max(0.25, params.speed)) } : {}),
      // WAV is the one format every /audio/speech server accepts: OpenAI
      // cloud, ollama (mp3 rejected with a 400) and kokoro-class local
      // gateways. Renderer playback is proven by the Gemini flavor.
      response_format: 'wav',
    },
    ...(params.signal ? [{ signal: params.signal }] : [])
  );
  const buffer = Buffer.from(await response.arrayBuffer());
  return { audioBase64: buffer.toString('base64'), mime: 'audio/wav' };
}

const GEMINI_DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini's own default when no voice override is given. */
const GEMINI_DEFAULT_VOICE = 'Kore';

async function synthesizeGemini(params: {
  apiKey: string;
  apiBase: string;
  model: string;
  text: string;
  voice?: string;
  signal?: AbortSignal;
  timeout?: number;
}): Promise<TtsAudio> {
  const base = (params.apiBase || GEMINI_DEFAULT_BASE).replace(/\/$/, '').replace(/\/openai$/, '');
  const voiceName = params.voice || GEMINI_DEFAULT_VOICE;
  // Compose the cancel signal with the provider budget so both bounds apply.
  const timeoutSignal = params.timeout ? AbortSignal.timeout(params.timeout) : undefined;
  const signal =
    params.signal && timeoutSignal
      ? AbortSignal.any([params.signal, timeoutSignal])
      : (params.signal ?? timeoutSignal);
  const response = await fetch(`${base}/models/${encodeURIComponent(params.model)}:generateContent`, {
    method: 'POST',
    ...(signal ? { signal } : {}),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': params.apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: params.text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    }),
  });
  if (!response.ok) {
    throw await geminiApiError(response);
  }
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
  };
  const inline = payload.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData;
  if (!inline?.data) {
    throw new Error('Gemini returned no audio for this request');
  }
  const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? '')?.[1]) || 24000;
  return { audioBase64: pcmToWav(Buffer.from(inline.data, 'base64'), rate).toString('base64'), mime: 'audio/wav' };
}

async function geminiApiError(response: Response): Promise<Error> {
  const body = await response.text().catch(() => '');
  let message = body.slice(0, 200) || `HTTP ${response.status}`;
  try {
    message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? message;
  } catch {
    // keep raw text
  }
  const error = new Error(message.slice(0, 200)) as Error & { status?: number };
  error.status = response.status;
  return error;
}

function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Short, renderer-displayable failure text (the raw OpenAI SDK message
 * is "404 status code (no body)" — useless in a notice banner). The
 * full error stays in the main-process log and the AiCall audit row.
 */
export function compactTtsError(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  const name = (error as { name?: string } | null)?.name;
  if (status === undefined && (name === 'APIConnectionTimeoutError' || /timed out|HeadersTimeout/i.test((error as Error | null)?.message ?? ''))) {
    return 'no response from the server (timed out)';
  }
  if (typeof status === 'number' && Number.isFinite(status)) {
    if (status === 404) {
      return 'model or endpoint not found (HTTP 404)';
    }
    if (status === 401 || status === 403) {
      return `access denied (HTTP ${status})`;
    }
    if (status === 429) {
      return 'rate limited (HTTP 429)';
    }
    // A 400 names the rejected param and what the server wants (e.g.
    // "voice "alloy" is not supported; use female or male…") — far more
    // actionable than "HTTP 400".
    if (status === 400) {
      const message = (error as Error | null)?.message;
      if (message) {
        return message.replace(/^\d+(\s+status code[^:]*:)?\s*/, '').slice(0, 160) || 'HTTP 400';
      }
      return 'HTTP 400';
    }
    return `HTTP ${status}`;
  }
  const message = typeof error === 'string' ? error : (error as Error | null)?.message;
  return message ? message.slice(0, 120) : 'unknown error';
}
