import OpenAI from 'openai';
import * as fsSync from 'fs';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

const NO_SPEECH_PATTERNS: RegExp[] = [
  /no significant text/i,
  /no text to output/i,
  /no text detected/i,
  /\[inaudible\]/i,
  /^\(?\s*(silence|no speech|empty)\s*\)?$/i,
];

/** Classic Whisper decoding-loop hallucinations on silence/noise. */
const HALLUCINATION_PATTERNS: RegExp[] = [
  /thank you (for|and) (watching|reading|listening)/i,
  /please subscribe/i,
  /subtitles? (by|and)/i,
  /amara\.org/i,
  /^please (like|comment|share)/i,
  /^thank you[.!?]*$/i,
];

/** A short phrase looping many times is a decoding artifact, not speech. */
export function isRepetitionLoop(text: string, maxRepeats = 3): boolean {
  const words = text.trim().split(/\s+/);
  const maxPhraseSize = Math.floor(words.length / maxRepeats);
  for (let size = 1; size <= maxPhraseSize; size++) {
    const phrase = words.slice(0, size).join(' ').toLowerCase();
    let repeats = 0;
    let index = 0;
    while (index + size <= words.length) {
      if (words.slice(index, index + size).join(' ').toLowerCase() === phrase) {
        repeats += 1;
        index += size;
      } else {
        break;
      }
    }
    if (repeats >= maxRepeats) {
      return true;
    }
  }
  return false;
}

export interface WhisperSegment {
  no_speech_prob?: number;
  avg_logprob?: number;
}

/** Whisper's own confidence signals: high no_speech_prob or low logprob → decode noise. */
export function hasSpeechEvidence(segments: WhisperSegment[] | undefined): boolean {
  if (!segments || segments.length === 0) {
    return true;
  }
  return segments.some(
    (segment) => (segment.no_speech_prob ?? 0) < 0.6 && (segment.avg_logprob ?? 0) > -1
  );
}

export function sanitizeTranscript(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (NO_SPEECH_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return null;
  }
  if (HALLUCINATION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return null;
  }
  if (isRepetitionLoop(trimmed)) {
    return null;
  }
  return trimmed;
}

export async function transcribeAudio(params: {
  apiKey: string;
  apiBase: string;
  model: string;
  audio: Buffer;
  language?: string;
}): Promise<string> {
  const openai = new OpenAI({
    apiKey: params.apiKey,
    baseURL: params.apiBase,
  });

  const tempFilePath = path.join(os.tmpdir(), `audio-${Date.now()}.wav`);
  try {
    await fs.writeFile(tempFilePath, params.audio);
    const fileStream = fsSync.createReadStream(tempFilePath);

    // whisper-1 exposes per-segment confidence; use it to reject noise decodes.
    // gpt-4o-transcribe models do not support verbose_json.
    if (params.model.toLowerCase().includes('whisper')) {
      const detailed = (await openai.audio.transcriptions.create({
        file: fileStream,
        model: params.model,
        ...(params.language && params.language !== 'auto' ? { language: params.language } : {}),
        response_format: 'verbose_json',
      })) as unknown as { text?: string; segments?: WhisperSegment[] };

      const text = typeof detailed.text === 'string' ? detailed.text : '';
      if (!hasSpeechEvidence(detailed.segments)) {
        return '';
      }
      return text;
    }

    const transcription = await openai.audio.transcriptions.create({
      file: fileStream,
      model: params.model,
      ...(params.language && params.language !== 'auto' ? { language: params.language } : {}),
    });
    return transcription.text;
  } finally {
    try {
      await fs.unlink(tempFilePath);
    } catch (cleanupError) {
      console.error('Failed to delete temporary audio file:', cleanupError);
    }
  }
}
