import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILES = ['README.md', 'docs/STATUS.md', 'AGENTS.md'];

const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bNeedle\b/i, reason: 'retired decision engine' },
  { pattern: /Whisper-compatible/i, reason: 'retired STT claim' },
  { pattern: /\b1,?320\b/, reason: 'stale test count' },
  { pattern: /\b2,?313\b/, reason: 'stale test count' },
  { pattern: /Latest tagged release: v0\.2\.1/i, reason: 'stale release header' },
];

describe('retired-terms wall (plan 37 S3)', () => {
  it.each(FILES)('%s carries no retired or stale truth', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    for (const { pattern, reason } of FORBIDDEN) {
      expect(source, `${file}: ${reason}`).not.toMatch(pattern);
    }
  });
});
