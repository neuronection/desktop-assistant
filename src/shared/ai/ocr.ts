import type { AiTask } from '@shared/types';
import type { EgressMode } from '@shared/egress';

/**
 * OCR engine selection (plan 82) — the pure half, so the capability report,
 * the engine picker and the tests cannot disagree.
 */

export type OcrEngine = 'local' | 'model';

export interface OcrEngineContext {
  localAvailable: boolean;
  modelAvailable: boolean;
  /** False when the egress policy blocks the OCR provider's host. */
  modelAllowed: boolean;
}

export interface OcrEngineChoice {
  engine: OcrEngine | null;
  /** Why no engine runs, for the UI (never a silent failure). */
  reason: 'none' | 'blocked' | null;
}

/**
 * Local first (free, no egress), model second. A blocked model with no local
 * engine is `blocked`, not `none` — the UI must be able to say why.
 */
export function chooseOcrEngine(context: OcrEngineContext): OcrEngineChoice {
  if (context.localAvailable) {
    return { engine: 'local', reason: null };
  }
  if (context.modelAvailable && context.modelAllowed) {
    return { engine: 'model', reason: null };
  }
  if (context.modelAvailable && !context.modelAllowed) {
    return { engine: null, reason: 'blocked' };
  }
  return { engine: null, reason: 'none' };
}

/**
 * BCP-47-ish app locale → tesseract traineddata code. Unknown languages fall
 * back to English rather than failing: a wrong OCR language is a quality
 * problem, a missing traineddata is a hard failure.
 */
const TESSERACT_LANGUAGES: Record<string, string> = {
  ar: 'ara',
  cs: 'ces',
  da: 'dan',
  de: 'deu',
  el: 'ell',
  en: 'eng',
  es: 'spa',
  fi: 'fin',
  fr: 'fra',
  he: 'heb',
  hi: 'hin',
  hu: 'hun',
  it: 'ita',
  ja: 'jpn',
  ko: 'kor',
  nl: 'nld',
  no: 'nor',
  pl: 'pol',
  pt: 'por',
  ro: 'ron',
  ru: 'rus',
  sk: 'slk',
  sv: 'swe',
  tr: 'tur',
  uk: 'ukr',
  vi: 'vie',
  zh: 'chi_sim',
};

export function tesseractLanguage(locale: string | undefined | null): string {
  const base = (locale ?? '').toLowerCase().split(/[-_]/)[0]?.trim() ?? '';
  return TESSERACT_LANGUAGES[base] ?? 'eng';
}

/** The OCR prompt is deliberately unforgiving: text only, no commentary. */
export const OCR_PROMPT = [
  'Extract every piece of text from this image exactly as written.',
  'Preserve the reading order and the line breaks.',
  'Do not translate, summarise, describe the image or add commentary.',
  'If the image contains no text, return nothing at all.',
].join(' ');

export const OCR_MAX_TEXT_CHARS = 20_000;

/** Trim, normalise line endings, drop a fenced-code wrapper, cap the result. */
export function normaliseOcrText(raw: string, cap: number = OCR_MAX_TEXT_CHARS): string {
  let text = (raw ?? '').replace(/\r\n?/g, '\n').trim();
  const fenced = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(text);
  if (fenced) {
    text = fenced[1].trim();
  }
  return text.length > cap ? text.slice(0, cap).trimEnd() : text;
}

/**
 * Condense OCR text into a search query: the first non-empty line, collapsed
 * and cut at a word boundary. Raw OCR is a bad query (multiline, hundreds of
 * chars); the card keeps the full text behind its own action.
 */
export function condenseOcrQuery(raw: string, max = 120): string {
  const line = (raw ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((entry) => entry.replace(/\s+/g, ' ').trim())
    .find((entry) => entry.length > 0);
  if (!line) {
    return '';
  }
  if (line.length <= max) {
    return line;
  }
  const cut = line.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trim();
}

/** The audit label every OCR model call carries (`AiCall.task`). */
export const OCR_AUDIT_TASK = 'ocr' as AiTask;

export interface OcrCapabilityReport {
  local: boolean;
  model: boolean;
  provider?: string;
  modelId?: string;
  allowed: boolean;
  egress: EgressMode;
}
