import OpenAI from 'openai';
import { recordAiCall } from './audit';
import { AiTask } from '@shared/types';

export const MAX_TTS_CHARS = 4_000;

export interface TtsAudio {
  audioBase64: string;
  mime: string;
}

/**
 * Sanctioned non-chat model endpoint (the STT precedent): OpenAI-
 * compatible `/audio/speech` synthesis for the `tts` task, audited like
 * every gateway call. Returns base64 MP3 for renderer-side playback.
 */
export async function synthesizeSpeech(params: {
  apiKey: string;
  apiBase: string;
  model: string;
  text: string;
  voice: string;
  speed: number;
  providerId?: string;
  audit?: boolean;
}): Promise<TtsAudio> {
  const text = params.text.slice(0, MAX_TTS_CHARS);
  const startedAt = Date.now();
  const openai = new OpenAI({ apiKey: params.apiKey || 'local-server', baseURL: params.apiBase });
  try {
    const response = await openai.audio.speech.create({
      model: params.model,
      voice: (params.voice as 'alloy') || 'alloy',
      input: text,
      speed: Math.min(4, Math.max(0.25, params.speed || 1)),
      response_format: 'mp3',
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (params.audit !== false) {
      void recordAiCall({
        task: AiTask.TTS,
        providerId: params.providerId,
        model: params.model,
        durationMs: Date.now() - startedAt,
        outcome: 'ok',
      }).catch(() => undefined);
    }
    return { audioBase64: buffer.toString('base64'), mime: 'audio/mpeg' };
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
