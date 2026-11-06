import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const repo = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

const sources = sourceFiles(join(repo, 'src'));

describe('one speech owner (plan 58 D1/S6a)', () => {
  it('deleted the renderer reply player', () => {
    expect(existsSync(join(repo, 'src/renderer/chat-react/speechPlayer.ts'))).toBe(false);
  });

  it('lets only the live loop import the renderer speech queue', () => {
    const importers = sources.filter(
      (file) =>
        !file.endsWith('/speechQueue.ts') &&
        /from '\.\/speechQueue'|from '@renderer\/chat-react\/speechQueue'/.test(readFileSync(file, 'utf8'))
    );
    expect(importers.map((file) => file.slice(repo.length + 1))).toEqual([
      'src/renderer/live-host/main.ts',
    ]);
  });

  it('sends the reply path through the bus IPC instead of synthesizing locally', () => {
    const session = readFileSync(join(repo, 'src/renderer/chat-react/useChatSession.ts'), 'utf8');
    expect(session).toContain('window.electronAPI.speakText({');
    expect(session).toContain("source: 'reply'");
    expect(session).not.toContain('createSpeechPlayer');
    expect(session).not.toContain('speechPlayer');
  });

  it('keeps the overlay on its own playback controller', () => {
    const overlayFiles = sources.filter((file) => file.includes('/speech-overlay-react/'));
    expect(overlayFiles.length).toBeGreaterThan(0);
    for (const file of overlayFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('speechQueue');
      expect(source).not.toContain('synthesizeTts');
    }
  });

  it('keeps synthesis main-side (the overlay never sees a provider key or endpoint)', () => {
    for (const file of sources.filter((path) => path.includes('/speech-overlay-react/'))) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/apiKey|apiBase|openai|@langchain/);
    }
  });
});
