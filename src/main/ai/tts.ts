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
}): Promise<TtsAudio> {
  const openai = new OpenAI({ apiKey: params.apiKey || 'local-server', baseURL: params.apiBase });
  const response = await openai.audio.speech.create({
    model: params.model,
    voice: (params.voice as 'alloy') || 'alloy',
    input: params.text,
    ...(params.speed !== undefined ? { speed: Math.min(4, Math.max(0.25, params.speed)) } : {}),
    response_format: 'mp3',
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { audioBase64: buffer.toString('base64'), mime: 'audio/mpeg' };
}

const GEMINI_DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini's own default when no voice override is given. */
const GEMINI_DEFAULT_VOICE = 'Kore';

const OPENAI_VOICE_TO_GEMINI: Record<string, string> = {
  alloy: 'Kore',
  ash: 'Charon',
  ballad: 'Enceladus',
  coral: 'Aoede',
  echo: 'Puck',
  fable: 'Fenrir',
  nova: 'Zephyr',
  onyx: 'Alnilam',
  sage: 'Leda',
  shimmer: 'Laomedeia',
};

async function synthesizeGemini(params: {
  apiKey: string;
  apiBase: string;
  model: string;
  text: string;
  voice?: string;
}): Promise<TtsAudio> {
  const base = (params.apiBase || GEMINI_DEFAULT_BASE).replace(/\/$/, '').replace(/\/openai$/, '');
  const voiceName = params.voice ? (OPENAI_VOICE_TO_GEMINI[params.voice] ?? params.voice) : GEMINI_DEFAULT_VOICE;
  const response = await fetch(`${base}/models/${encodeURIComponent(params.model)}:generateContent`, {
    method: 'POST',
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
    return `HTTP ${status}`;
  }
  const message = typeof error === 'string' ? error : (error as Error | null)?.message;
  return message ? message.slice(0, 120) : 'unknown error';
}
