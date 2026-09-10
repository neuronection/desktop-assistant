import { describe, it, expect, beforeEach } from 'vitest';
import type { CommandCatalogSnapshot } from '@shared/commands';
import { invalidateCommandCatalog, loadCommandCatalog, resolveSlashInput } from '@renderer/chat-react/commandSource';
import { slashExampleFor } from '@shared/commands';

const SNAPSHOT: CommandCatalogSnapshot = {
  entries: [
    {
      id: 'tool:screen_capture',
      kind: 'tool',
      title: 'Screen capture',
      category: 'tools',
      aliases: ['screenshot'],
      slash: 'screenshot',
      source: 'native',
      scopes: { palette: true, agent: false },
      args: [],
      toolName: 'screen_capture',
    },
    {
      id: 'tool:run_shell',
      kind: 'tool',
      title: 'Run shell',
      category: 'tools',
      aliases: ['shell'],
      slash: 'shell',
      source: 'native',
      scopes: { palette: true, agent: false },
      args: [{ name: 'command', required: true, type: 'string' }],
      toolName: 'run_shell',
    },
    {
      id: 'calc:evaluate',
      kind: 'builtin',
      title: 'Calculator',
      category: 'tools',
      aliases: ['calc'],
      slash: 'calc',
      source: 'system',
      scopes: { palette: true, agent: false },
      args: [{ name: 'expression', required: true, type: 'string' }],
      action: 'calc:evaluate',
    },
  ],
  recentIds: [],
  pins: [],
};

beforeEach(() => {
  invalidateCommandCatalog();
  (globalThis as { window?: unknown }).window = {
    electronAPI: { getCommandCatalog: async () => SNAPSHOT },
  };
});

describe('resolveSlashInput', () => {
  it('returns none for plain chat text or an empty catalog', async () => {
    expect(resolveSlashInput('hello world')).toEqual({ type: 'none' });
    expect(resolveSlashInput('/screenshot')).toEqual({ type: 'none' });
    await loadCommandCatalog();
    expect(resolveSlashInput('hello world')).toEqual({ type: 'none' });
  });

  it('resolves /screenshot to the tool with no args', async () => {
    await loadCommandCatalog();
    expect(resolveSlashInput('/screenshot')).toEqual({
      type: 'tool',
      direct: { name: 'screen_capture', args: {}, commandId: 'tool:screen_capture' },
    });
  });

  it('keeps the raw remainder for single-argument tools (/shell)', async () => {
    await loadCommandCatalog();
    expect(resolveSlashInput('/shell ls -la /tmp')).toEqual({
      type: 'tool',
      direct: { name: 'run_shell', args: { command: 'ls -la /tmp' }, commandId: 'tool:run_shell' },
    });
    expect(resolveSlashInput('/shell')).toEqual({
      type: 'tool',
      direct: { name: 'run_shell', args: { command: '' }, commandId: 'tool:run_shell' },
    });
  });

  it('fills untyped arguments from configured argument defaults', async () => {
    await loadCommandCatalog();
    const defaults = { 'tool:run_shell': { command: 'git status' } };
    expect(resolveSlashInput('/shell', defaults)).toEqual({
      type: 'tool',
      direct: { name: 'run_shell', args: { command: 'git status' }, commandId: 'tool:run_shell' },
    });
    expect(resolveSlashInput('/shell ls', defaults)).toEqual({
      type: 'tool',
      direct: { name: 'run_shell', args: { command: 'ls' }, commandId: 'tool:run_shell' },
    });
  });

  it('routes the legacy /open alias between url, path, and app', async () => {
    await loadCommandCatalog();
    expect(resolveSlashInput('/open https://example.com/x')).toEqual({
      type: 'tool',
      direct: { name: 'open_url', args: { url: 'https://example.com/x' }, commandId: 'tool:open_url' },
    });
    expect(resolveSlashInput('/open ~/Documents/notes')).toEqual({
      type: 'tool',
      direct: { name: 'open_path', args: { path: '~/Documents/notes' }, commandId: 'tool:open_path' },
    });
    expect(resolveSlashInput('/open firefox')).toEqual({
      type: 'tool',
      direct: { name: 'open_app', args: { name: 'firefox' }, commandId: 'tool:open_app' },
    });
    expect(resolveSlashInput('/open')).toEqual({ type: 'usage', usage: 'Usage: /open <url | path | app>' });
  });

  it('resolves builtins with tokenized argv', async () => {
    await loadCommandCatalog();
    expect(resolveSlashInput('/calc 2 + 2')).toEqual({
      type: 'builtin',
      entry: expect.objectContaining({ id: 'calc:evaluate' }),
      argv: ['2', '+', '2'],
    });
  });

  it('reports unknown commands', async () => {
    await loadCommandCatalog();
    expect(resolveSlashInput('/frobnicate now')).toEqual({ type: 'unknown', command: 'frobnicate' });
  });
});

describe('slashExampleFor (shared, catalog-driven)', () => {
  it('maps tools with canonical aliases to example invocations', () => {
    expect(slashExampleFor('screen_capture')).toBe('/screenshot');
    expect(slashExampleFor('run_shell')).toBe('/shell ls -la');
    expect(slashExampleFor('open_app')).toBe('/app firefox');
    expect(slashExampleFor('not_a_thing')).toBeNull();
  });
});
