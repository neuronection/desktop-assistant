/**
 * Unicode-safe text segmentation for stream display pacing and speech
 * chunking (plan 56). Word units follow Unicode letter/mark/number runs —
 * never `\b` or `[a-z]` classes, which delete Greek and other non-Latin
 * scripts. Block boundaries mirror the library `splitMarkdownBlocks`
 * semantics (blank lines, fenced code, `$$` math) plus fence/math close,
 * which is safe to settle on because a closed block renders independently;
 * the scanner exists because the library splitter trims blocks and the
 * pacer needs exact offsets, and it never parses or renders markdown.
 */

const WORD_UNIT_RE = /[\p{L}\p{M}\p{N}]+[^\p{L}\p{M}\p{N}\s]*\s*|[^\s\p{L}\p{M}\p{N}]+\s*|\s+/gu;

export const SENTENCE_BREAK_RE = /(?<=[.!?…\u037E])\s+(?=[\p{Lu}\p{N}"'\u201C(\u00AB])/u;

const HEADING_START_RE = /^\s{0,3}#{1,6}(\s|$)/;
const QUOTE_START_RE = /^\s{0,3}>/;
const BULLET_ITEM_RE = /^\s{0,3}[-*+]\s/;
const ORDERED_ITEM_RE = /^\s{0,3}(\d{1,9})[.)]\s/;

export interface WordUnitScan {
  complete: string[];
  rest: string;
}

/** Complete display units in `text` — word cores with attached punctuation
 * and trailing whitespace. A trailing unit without whitespace is `rest`:
 * it may still grow, so display layers buffer it. */
export function completeWordUnits(text: string): WordUnitScan {
  const complete: string[] = [];
  let lastEnd = 0;
  WORD_UNIT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_UNIT_RE.exec(text)) !== null) {
    const end = match.index + match[0].length;
    if (end === text.length && !/\s$/.test(match[0])) {
      break;
    }
    complete.push(match[0]);
    lastEnd = end;
  }
  return { complete, rest: text.slice(lastEnd) };
}

function fenceMarkerOf(trimmed: string): { char: string; bare: boolean } | null {
  const bare = /^(`{3,}|~{3,})$/.exec(trimmed);
  const marker = bare?.[1] ?? /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
  if (marker === undefined || marker.length === 0) {
    return null;
  }
  return { char: marker.charAt(0), bare: bare !== null };
}

/** Offsets (end positions of settled raw text) where a markdown block has
 * closed and its source may be committed as a whole. Blank lines, fence and
 * math blocks follow the library `splitMarkdownBlocks` semantics plus
 * fence/math close; heading, quote and list-item lines settle at CommonMark
 * block starts (a heading also settles at its line end). A bullet/ordered
 * item only interrupts a paragraph per CommonMark (ordered at 1), so a
 * `para\n- item` run stays one block exactly as it renders. A line-end
 * boundary only fires once the line demonstrably ended — a growing final
 * line (a `## ` heading or a bare ``` close can still change shape) never
 * settles. */
export function findBlockBoundaries(text: string): number[] {
  const ends: number[] = [];
  let fence: string | null = null;
  let math = false;
  let blockHasContent = false;
  let blockIsParagraph = false;
  let offset = 0;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineEnd = offset + line.length + (index < lines.length - 1 ? 1 : 0);
    const lineEnded = index < lines.length - 1;
    const trimmed = line.trim();
    const marker = fenceMarkerOf(trimmed);
    if (fence !== null) {
      if (marker !== null && marker.bare && marker.char === fence) {
        fence = null;
        if (lineEnded) {
          ends.push(lineEnd);
        }
        blockHasContent = false;
        blockIsParagraph = false;
      }
      offset = lineEnd;
      continue;
    }
    if (marker !== null) {
      if (blockHasContent) {
        ends.push(offset);
        blockHasContent = false;
        blockIsParagraph = false;
      }
      fence = marker.char;
      offset = lineEnd;
      continue;
    }
    if (math) {
      if (trimmed.endsWith('$$')) {
        math = false;
        if (lineEnded) {
          ends.push(lineEnd);
        }
        blockHasContent = false;
        blockIsParagraph = false;
      }
      offset = lineEnd;
      continue;
    }
    if (trimmed.startsWith('$$')) {
      if (blockHasContent) {
        ends.push(offset);
        blockHasContent = false;
        blockIsParagraph = false;
      }
      math = !(trimmed.endsWith('$$') && trimmed.length > 4);
      offset = lineEnd;
      continue;
    }
    if (trimmed === '') {
      if (blockHasContent && lineEnded) {
        ends.push(lineEnd);
        blockHasContent = false;
        blockIsParagraph = false;
      }
      offset = lineEnd;
      continue;
    }
    if (HEADING_START_RE.test(line)) {
      if (blockHasContent) {
        ends.push(offset);
      }
      if (lineEnded) {
        ends.push(lineEnd);
        blockHasContent = false;
        blockIsParagraph = false;
      } else {
        blockHasContent = true;
        blockIsParagraph = false;
      }
      offset = lineEnd;
      continue;
    }
    if (QUOTE_START_RE.test(line)) {
      if (blockHasContent && blockIsParagraph) {
        ends.push(offset);
        blockHasContent = false;
        blockIsParagraph = false;
      }
      blockHasContent = true;
      blockIsParagraph = false;
      offset = lineEnd;
      continue;
    }
    const ordered = ORDERED_ITEM_RE.exec(line);
    if (ordered !== null || BULLET_ITEM_RE.test(line)) {
      const canInterrupt = ordered !== null && ordered[1] === '1';
      if (blockHasContent && (!blockIsParagraph || canInterrupt)) {
        ends.push(offset);
        blockHasContent = false;
        blockIsParagraph = false;
      }
      blockHasContent = true;
      blockIsParagraph = false;
      offset = lineEnd;
      continue;
    }
    if (!blockHasContent) {
      blockIsParagraph = true;
    }
    blockHasContent = true;
    offset = lineEnd;
  }
  return ends;
}
