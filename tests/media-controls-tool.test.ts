import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildMediaInvocation, mediaControlsTool } from '@main/ai/tools/native/media-controls';
import { NATIVE_TOOL_CATALOG } from '@main/ai/tools/native';
import type { NativeToolDefinition } from '@main/ai/tools/types';

const byName = (name: string): NativeToolDefinition<never> =>
  NATIVE_TOOL_CATALOG.find((tool) => tool.name === name) as unknown as NativeToolDefinition<never>;

describe('media invocation matrix', () => {
  it('maps every action to playerctl on linux, seek carrying seconds', () => {
    expect(buildMediaInvocation('play', 'linux')).toEqual({ file: 'playerctl', args: ['play'] });
    expect(buildMediaInvocation('play_pause', 'linux')).toEqual({ file: 'playerctl', args: ['play-pause'] });
    expect(buildMediaInvocation('next', 'linux')).toEqual({ file: 'playerctl', args: ['next'] });
    expect(buildMediaInvocation('seek', 'linux', 42)).toEqual({ file: 'playerctl', args: ['position', '42'] });
  });

  it('builds a Spotify/Music AppleScript on darwin', () => {
    const spec = buildMediaInvocation('pause', 'darwin');
    expect(spec?.file).toBe('osascript');
    const script = spec?.args.join(' ') ?? '';
    expect(script).toContain('Spotify');
    expect(script).toContain('Music');
    expect(script).toContain('pause');
    expect(buildMediaInvocation('seek', 'darwin', 90)?.args.join(' ')).toContain('set player position to 90');
  });

  it('degrades on win32 (no SMTC helper yet)', () => {
    expect(buildMediaInvocation('play', 'win32')).toBeNull();
  });
});

describe('media_controls tool', () => {
  it('registers as a state-changing desktop tool', () => {
    const def = byName('media_controls');
    expect(def.risk).toBe('state-changing');
    expect(def.category).toBe('desktop');
    expect(def.summarize({ action: 'seek', seconds: 30 })).toContain('30s');
  });

  it('rejects seek without seconds at the schema level', () => {
    const parsed = mediaControlsTool.schema.safeParse({ action: 'seek' });
    expect(parsed.success).toBe(false);
    expect(mediaControlsTool.schema.safeParse({ action: 'play' }).success).toBe(true);
  });

  it('executes through the real binary when a fake playerctl is on PATH', async () => {
    const shimDir = await mkdtemp(join(tmpdir(), 'da-playerctl-'));
    const scriptPath = join(shimDir, 'playerctl');
    await writeFile(scriptPath, '#!/bin/sh\nexit 0\n', { encoding: 'utf-8', mode: 0o755 });
    await chmod(scriptPath, 0o755);
    const originalPath = process.env.PATH ?? '';
    process.env.PATH = `${shimDir}:${originalPath}`;
    try {
      expect(await mediaControlsTool.exec({ action: 'play_pause' }, {})).toBe('Play/pause toggle — done.');
      expect(await mediaControlsTool.exec({ action: 'seek', seconds: 120 }, {})).toBe('Seek — done.');
    } finally {
      process.env.PATH = originalPath;
      await rm(shimDir, { recursive: true, force: true });
    }
  });

  it('degrades gracefully when playerctl is missing', async () => {
    const originalPath = process.env.PATH ?? '';
    process.env.PATH = '/nonexistent-da-test';
    try {
      expect(await mediaControlsTool.exec({ action: 'play' }, {})).toBe(
        'Not available on this system (needs playerctl).'
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
