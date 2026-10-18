/**
 * The timeout-safe pattern guard (audit 2026-10-18 F9): imported
 * `configSchema` string patterns are attacker-authored regex applied
 * host-side, and JS RegExp has no execution timeout — a catastrophic
 * pattern (`(a+)+$` against a non-matching subject) wedges the main
 * process synchronously. This static check refuses the ambiguous
 * backtracking classes at import: a quantifier that can iterate many
 * times (`*`, `+`, `{n,}`, `{n,m}` with m > 1) applied to a group that
 * already contains a quantifier (star height ≥ 2), any backreference,
 * quantifiers inside lookarounds, and unbounded counted repetitions.
 * Fail-closed by design: false positives (fixed-length nested counts)
 * are an authoring inconvenience, never a security risk; the bounded
 * wrapper `(...)+?`/`(...)?` class stays accepted because it is at
 * worst quadratic and the application site caps subject length.
 */

export type PatternSafetyVerdict = { ok: true } | { ok: false; reason: string };

const MAX_SINGLE_REPETITION = 1000;
const MAX_REPETITION_PRODUCT = 100_000;

interface Atom {
  isGroup: boolean;
  containsQuantifier: boolean;
}

interface Frame {
  containsQuantifier: boolean;
  lookaround: boolean;
  repetitionProduct: number;
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function countRepetition(source: string, index: number): { min: number; max: number; next: number } | null {
  if (source[index] !== '{') {
    return null;
  }
  let cursor = index + 1;
  let minText = '';
  while (cursor < source.length && isDigit(source[cursor])) {
    minText += source[cursor];
    cursor += 1;
  }
  if (minText.length === 0) {
    return null;
  }
  let maxText = minText;
  if (source[cursor] === ',') {
    cursor += 1;
    maxText = '';
    while (cursor < source.length && isDigit(source[cursor])) {
      maxText += source[cursor];
      cursor += 1;
    }
  }
  if (source[cursor] !== '}') {
    return null;
  }
  const min = Number(minText);
  const max = maxText.length === 0 ? Number.POSITIVE_INFINITY : Number(maxText);
  return { min, max, next: cursor + 1 };
}

export function isTimeoutSafePattern(source: string): PatternSafetyVerdict {
  const reject = (reason: string): PatternSafetyVerdict => ({ ok: false, reason });
  const frames: Frame[] = [{ containsQuantifier: false, lookaround: false, repetitionProduct: 1 }];
  let lastAtom: Atom | null = null;
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      const escaped = source[index + 1] ?? '';
      if (isDigit(escaped) && escaped !== '0') {
        return reject('backreferences are refused');
      }
      index += 2;
      lastAtom = { isGroup: false, containsQuantifier: false };
      continue;
    }
    if (char === '[') {
      let cursor = index + 1;
      if (source[cursor] === '^') {
        cursor += 1;
      }
      if (source[cursor] === ']') {
        cursor += 1;
      }
      while (cursor < source.length && source[cursor] !== ']') {
        cursor += source[cursor] === '\\' ? 2 : 1;
      }
      index = cursor + 1;
      lastAtom = { isGroup: false, containsQuantifier: false };
      continue;
    }
    if (char === '(') {
      const frame: Frame = { containsQuantifier: false, lookaround: false, repetitionProduct: 1 };
      let cursor = index + 1;
      if (source[cursor] === '?') {
        const kind = source[cursor + 1];
        if (kind === '=' || kind === '!') {
          frame.lookaround = true;
          cursor += 2;
        } else if (kind === '<') {
          const after = source[cursor + 2];
          if (after === '=' || after === '!') {
            frame.lookaround = true;
            cursor += 3;
          } else {
            cursor += 2;
            while (cursor < source.length && source[cursor] !== '>') {
              cursor += 1;
            }
            cursor += 1;
          }
        } else if (kind === ':') {
          cursor += 2;
        }
      }
      frames.push(frame);
      index = cursor;
      lastAtom = null;
      continue;
    }
    if (char === ')') {
      const frame = frames.pop();
      if (!frame || frames.length === 0) {
        return reject('unbalanced group');
      }
      if (frame.lookaround && frame.containsQuantifier) {
        return reject('quantifiers inside lookarounds are refused');
      }
      index += 1;
      lastAtom = { isGroup: true, containsQuantifier: frame.containsQuantifier };
      continue;
    }
    if (char === '*' || char === '+') {
      const verdict = quantify(frames, lastAtom, Number.POSITIVE_INFINITY, 1, false);
      if (verdict) {
        return verdict;
      }
      index += 1;
      if (source[index] === '?') {
        index += 1;
      }
      lastAtom = null;
      continue;
    }
    if (char === '?') {
      const verdict = quantify(frames, lastAtom, 1, 1, false);
      if (verdict) {
        return verdict;
      }
      index += source[index + 1] === '?' ? 2 : 1;
      lastAtom = null;
      continue;
    }
    if (char === '{') {
      const repetition = countRepetition(source, index);
      if (repetition) {
        const verdict = quantify(frames, lastAtom, repetition.max, repetition.min, true);
        if (verdict) {
          return verdict;
        }
        index = repetition.next;
        if (source[index] === '?') {
          index += 1;
        }
        lastAtom = null;
        continue;
      }
    }
    index += 1;
    lastAtom = { isGroup: false, containsQuantifier: false };
  }
  if (frames.length !== 1) {
    return reject('unbalanced group');
  }
  return { ok: true };
}

function quantify(frames: Frame[], lastAtom: Atom | null, max: number, min: number, counted: boolean): PatternSafetyVerdict | null {
  if (lastAtom === null) {
    return { ok: false, reason: 'quantifier with nothing to repeat' };
  }
  if (counted && max > MAX_SINGLE_REPETITION) {
    return { ok: false, reason: `a counted repetition exceeds ${MAX_SINGLE_REPETITION}` };
  }
  if (lastAtom.isGroup && lastAtom.containsQuantifier && max > 1) {
    return { ok: false, reason: 'a quantifier iterating more than once applies to a group that already contains one (star height ≥ 2)' };
  }
  const frame = frames[frames.length - 1];
  if (max > 1 || min > 1) {
    frame.containsQuantifier = true;
  }
  if (counted) {
    frame.repetitionProduct *= Math.min(max, MAX_REPETITION_PRODUCT);
    if (frame.repetitionProduct > MAX_REPETITION_PRODUCT) {
      return { ok: false, reason: `nested counted repetitions exceed the ${MAX_REPETITION_PRODUCT} product cap` };
    }
  }
  return null;
}
