/**
 * Split speakable text into TTS chunks (plan 25 D8, chunk fallback). Chunks
 * are sentence-aligned and grouped up to a target size, so long replies are
 * synthesized in batches: an interruption wastes at most the in-flight
 * chunk, not the whole reply. Not the default path — short replies use one
 * call.
 */

export const SPEECH_CHUNK_MAX_CHARS = 300;

const SENTENCE_BREAK = /(?<=[.!?…])\s+(?=[A-Z0-9"'“(])/;

export function splitSpeechChunks(text: string, maxChars = SPEECH_CHUNK_MAX_CHARS): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }
  const sentences = normalized
    .split(SENTENCE_BREAK)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  const push = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }
  };
  let current = '';
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= maxChars) {
      current = `${current} ${sentence}`;
    } else {
      push(current);
      current = sentence;
    }
    while (current.length > maxChars) {
      const cut = current.lastIndexOf(' ', maxChars);
      const index = cut > Math.floor(maxChars * 0.5) ? cut : maxChars;
      push(current.slice(0, index));
      current = current.slice(index).trim();
    }
  }
  push(current);
  return chunks;
}
