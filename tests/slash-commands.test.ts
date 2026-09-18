import { describe, it, expect, beforeEach } from 'vitest';
import type { CommandCatalogSnapshot, CommandEntry } from '@shared/commands';
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

const TRANSLATE_ENTRY: CommandEntry = {
  id: 'tool:translate',
  kind: 'tool',
  title: 'Translate',
  category: 'tools',
  aliases: ['tr', 'translate'],
  slash: 'tr',
  source: 'native',
  scopes: { palette: true, agent: false },
  args: [
    { name: 'text', required: true, type: 'string' },
    { name: 'target', required: false, type: 'string' },
    { name: 'source', required: false, type: 'string' },
  ],
  toolName: 'translate',
};

describe('resolveSlashInput translate grammar (/tr [target] <text>)', () => {
  beforeEach(async () => {
    (globalThis as { window?: unknown }).window = {
      electronAPI: { getCommandCatalog: async () => ({ entries: [...SNAPSHOT.entries, TRANSLATE_ENTRY], recentIds: [], pins: [] }) },
    };
    await loadCommandCatalog();
  });

  it('binds a leading built-in language code as target and the rest as text', () => {
    expect(resolveSlashInput('/tr el Good morning world')).toEqual({
      type: 'tool',
      direct: { name: 'translate', args: { text: 'Good morning world', target: 'el' }, commandId: 'tool:translate' },
    });
  });

  it('treats everything as text when the first token is not a language code', () => {
    expect(resolveSlashInput('/tr good morning world')).toEqual({
      type: 'tool',
      direct: { name: 'translate', args: { text: 'good morning world' }, commandId: 'tool:translate' },
    });
  });

  it('accepts custom language codes passed from config', () => {
    expect(resolveSlashInput('/tr grc ὦ φίλε', undefined, ['grc'])).toEqual({
      type: 'tool',
      direct: { name: 'translate', args: { text: 'ὦ φίλε', target: 'grc' }, commandId: 'tool:translate' },
    });
    expect(resolveSlashInput('/tr tok pona', undefined, [])).toEqual({
      type: 'tool',
      direct: { name: 'translate', args: { text: 'tok pona' }, commandId: 'tool:translate' },
    });
  });

  it('fills the target from configured argument defaults and still allows an override', () => {
    const defaults = { 'tool:translate': { target: 'de' } };
    expect(resolveSlashInput('/tr hello there', defaults, [])).toEqual({
      type: 'tool',
      direct: { name: 'translate', args: { text: 'hello there', target: 'de' }, commandId: 'tool:translate' },
    });
    expect(resolveSlashInput('/tr fr hello', defaults, []).direct?.args).toMatchObject({ text: 'hello', target: 'fr' });
  });

  it('reports usage for a bare /tr or a lone language token', () => {
    expect(resolveSlashInput('/tr')).toEqual({ type: 'usage', usage: 'Usage: /tr [language] <text> — e.g. /tr el Good morning' });
    expect(resolveSlashInput('/tr el')).toEqual({ type: 'usage', usage: 'Usage: /tr [language] <text> — e.g. /tr el Good morning' });
    expect(resolveSlashInput('/tr grc', undefined, ['grc']).type).toBe('usage');
    expect(resolveSlashInput('/tr hello')).toEqual({
      type: 'tool',
      direct: { name: 'translate', args: { text: 'hello' }, commandId: 'tool:translate' },
    });
  });

  it('works through the /translate alias', () => {
    expect(resolveSlashInput('/translate es hello')).toEqual({
      type: 'tool',
      direct: { name: 'translate', args: { text: 'hello', target: 'es' }, commandId: 'tool:translate' },
    });
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
