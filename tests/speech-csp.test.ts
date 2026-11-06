import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const rendererDir = join(process.cwd(), 'src/renderer');

function cspOf(file: string): string {
  const html = readFileSync(join(rendererDir, file), 'utf8');
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  if (!match) {
    throw new Error(`${file} carries no CSP meta`);
  }
  return match[1];
}

const MEDIA_TOKEN = 'speech-cache:';

describe('speech-cache CSP (plan 58 §4.3)', () => {
  it('lets the launcher and the overlay load cached audio', () => {
    for (const file of ['index.html', 'speech-overlay.html']) {
      expect(cspOf(file), file).toContain(`media-src 'self' data: ${MEDIA_TOKEN}`);
    }
  });

  it('keeps the overlay policy identical to the launcher policy but for that token', () => {
    const overlay = cspOf('speech-overlay.html');
    const launcher = cspOf('index.html');
    const withoutToken = (policy: string): string => policy.replace(` ${MEDIA_TOKEN}`, '');
    expect(withoutToken(overlay)).toBe(withoutToken(launcher));
    expect(withoutToken(overlay).endsWith("media-src 'self' data:;")).toBe(true);
  });

  it('grants the scheme to no other entry', () => {
    for (const file of ['settings.html', 'pack-window.html', 'result-viewer.html']) {
      const policy = cspOf(file);
      expect(policy, file).not.toContain(MEDIA_TOKEN);
      expect(policy, file).not.toContain('media-src');
    }
  });
});
