import { describe, it, expect, beforeEach } from 'vitest';
import type { CommandCatalogSnapshot, CommandEntry } from '@shared/commands';
import { invalidateCommandCatalog, loadCommandCatalog, resolveSlashInput } from '@renderer/chat-react/commandSource';
import { missingRequiredArgs, slashExampleFor } from '@shared/commands';

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
      id: 'tool:web_search',
      kind: 'tool',
      title: 'Web search',
      category: 'web',
      aliases: ['web', 'search'],
      slash: 'web',
      source: 'native',
      scopes: { palette: true, agent: false },
      args: [
        { name: 'query', required: true, type: 'string' },
        { name: 'maxResults', required: false, type: 'number' },
      ],
      toolName: 'web_search',
    },
    {
      id: 'tool:memory_save',
      kind: 'tool',
      title: 'Memory save',
      category: 'tools',
      aliases: ['remember'],
      slash: 'remember',
      source: 'native',
      scopes: { palette: true, agent: false },
      args: [
        { name: 'content', required: true, type: 'string' },
        { name: 'tags', required: false, type: 'array' },
      ],
      toolName: 'memory_save',
    },
    {
      id: 'tool:find_files',
      kind: 'tool',
      title: 'Find files',
      category: 'tools',
      aliases: ['find'],
      slash: 'find',
      source: 'native',
      scopes: { palette: true, agent: false },
      args: [
        { name: 'pattern', required: true, type: 'string' },
        { name: 'root', required: false, type: 'string' },
        { name: 'limit', required: false, type: 'number' },
      ],
      toolName: 'find_files',
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
  recent: [],
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
    expect(resolveSlashInput('/screenshot')).toMatchObject({
      type: 'tool',
      direct: { name: 'screen_capture', args: {}, commandId: 'tool:screen_capture' },
    });
  });

  it('keeps the raw remainder for single-argument tools (/shell)', async () => {
    await loadCommandCatalog();
    expect(resolveSlashInput('/shell ls -la /tmp')).toMatchObject({
      type: 'tool',
      direct: { name: 'run_shell', args: { command: 'ls -la /tmp' }, commandId: 'tool:run_shell' },
    });
    expect(resolveSlashInput('/shell')).toMatchObject({
      type: 'tool',
      direct: { name: 'run_shell', args: { command: '' }, commandId: 'tool:run_shell' },
    });
  });

  it('keeps a free-text query whole instead of splitting it into optional args', async () => {
    await loadCommandCatalog();
    expect(resolveSlashInput('/web τεχνητή νοημοσύνη')).toMatchObject({
      type: 'tool',
      direct: { name: 'web_search', args: { query: 'τεχνητή νοημοσύνη' } },
    });
    expect(resolveSlashInput('/remember my deploy user is admin')).toMatchObject({
      type: 'tool',
      direct: { name: 'memory_save', args: { content: 'my deploy user is admin' } },
    });
    expect(resolveSlashInput('/search current events')).toMatchObject({
      type: 'tool',
      direct: { name: 'web_search', args: { query: 'current events' } },
    });
    // commands with an optional STRING argument keep positional parsing
    expect(resolveSlashInput('/find *.md ~/docs')).toMatchObject({
      type: 'tool',
      direct: { name: 'find_files', args: { pattern: '*.md', root: '~/docs' } },
    });
  });

  it('accepts inline flags for optional arguments (plan 78 phase 2)', async () => {
    await loadCommandCatalog();
    expect(resolveSlashInput('/web my query --maxResults 5')).toMatchObject({
      type: 'tool',
      direct: { name: 'web_search', args: { query: 'my query', maxResults: 5 } },
    });
    expect(resolveSlashInput('/web my query --maxResults=3')).toMatchObject({
      type: 'tool',
      direct: { name: 'web_search', args: { query: 'my query', maxResults: 3 } },
    });
    // an invalid optional value stays part of the query instead of silently vanishing
    expect(resolveSlashInput('/web how to use --maxResults in code')).toMatchObject({
      type: 'tool',
      direct: { args: { query: 'how to use --maxResults in code' } },
    });
    // unknown flags are text, never arguments
    expect(resolveSlashInput('/web --cached results')).toMatchObject({
      type: 'tool',
      direct: { args: { query: '--cached results' } },
    });
    expect(resolveSlashInput('/remember my fact --tags work,life')).toMatchObject({
      type: 'tool',
      direct: { name: 'memory_save', args: { content: 'my fact', tags: ['work', 'life'] } },
    });
    // positional commands accept flags for their optional arguments too
    expect(resolveSlashInput('/find *.md --root ~/docs --limit 20')).toMatchObject({
      type: 'tool',
      direct: { name: 'find_files', args: { pattern: '*.md', root: '~/docs', limit: 20 } },
    });
  });

  it('still reports a missing required argument when only flags were typed', async () => {
    await loadCommandCatalog();
    const web = SNAPSHOT.entries.find((entry) => entry.id === 'tool:web_search') as CommandEntry;
    expect(missingRequiredArgs(web, ['--maxResults', '5'], undefined, '--maxResults 5')).toEqual(['query']);
    expect(missingRequiredArgs(web, ['my', 'query'], undefined, 'my query')).toEqual([]);
  });

  it('fills untyped arguments from configured argument defaults', async () => {
    await loadCommandCatalog();
    const defaults = { 'tool:run_shell': { command: 'git status' } };
    expect(resolveSlashInput('/shell', defaults)).toMatchObject({
      type: 'tool',
      direct: { name: 'run_shell', args: { command: 'git status' }, commandId: 'tool:run_shell' },
    });
    expect(resolveSlashInput('/shell ls', defaults)).toMatchObject({
      type: 'tool',
      direct: { name: 'run_shell', args: { command: 'ls' }, commandId: 'tool:run_shell' },
    });
  });

  it('routes the legacy /open alias between url, path, and app', async () => {
    await loadCommandCatalog();
    expect(resolveSlashInput('/open https://example.com/x')).toMatchObject({
      type: 'tool',
      direct: { name: 'open_url', args: { url: 'https://example.com/x' }, commandId: 'tool:open_url' },
    });
    expect(resolveSlashInput('/open ~/Documents/notes')).toMatchObject({
      type: 'tool',
      direct: { name: 'open_path', args: { path: '~/Documents/notes' }, commandId: 'tool:open_path' },
    });
    expect(resolveSlashInput('/open firefox')).toMatchObject({
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
      electronAPI: { getCommandCatalog: async () => ({ entries: [...SNAPSHOT.entries, TRANSLATE_ENTRY], recent: [], pins: [] }) },
    };
    await loadCommandCatalog();
  });

  it('binds a leading built-in language code as target and the rest as text', () => {
    expect(resolveSlashInput('/tr el Good morning world')).toMatchObject({
      type: 'tool',
      direct: { name: 'translate', args: { text: 'Good morning world', target: 'el' }, commandId: 'tool:translate' },
    });
  });

  it('treats everything as text when the first token is not a language code', () => {
    expect(resolveSlashInput('/tr good morning world')).toMatchObject({
      type: 'tool',
      direct: { name: 'translate', args: { text: 'good morning world' }, commandId: 'tool:translate' },
    });
  });

  it('accepts custom language codes passed from config', () => {
    expect(resolveSlashInput('/tr grc ὦ φίλε', undefined, ['grc'])).toMatchObject({
      type: 'tool',
      direct: { name: 'translate', args: { text: 'ὦ φίλε', target: 'grc' }, commandId: 'tool:translate' },
    });
    expect(resolveSlashInput('/tr tok pona', undefined, [])).toMatchObject({
      type: 'tool',
      direct: { name: 'translate', args: { text: 'tok pona' }, commandId: 'tool:translate' },
    });
  });

  it('fills the target from configured argument defaults and still allows an override', () => {
    const defaults = { 'tool:translate': { target: 'de' } };
    expect(resolveSlashInput('/tr hello there', defaults, [])).toMatchObject({
      type: 'tool',
      direct: { name: 'translate', args: { text: 'hello there', target: 'de' }, commandId: 'tool:translate' },
    });
    expect(resolveSlashInput('/tr fr hello', defaults, []).direct?.args).toMatchObject({ text: 'hello', target: 'fr' });
  });

  it('resolves bare /tr and a lone language token to the empty-text tool call (the pad decision is the session layer’s)', () => {
    expect(resolveSlashInput('/tr')).toMatchObject({
      type: 'tool',
      direct: { name: 'translate', args: { text: '' }, commandId: 'tool:translate' },
    });
    expect(resolveSlashInput('/tr el')).toMatchObject({
      type: 'tool',
      direct: { name: 'translate', args: { text: '', target: 'el' }, commandId: 'tool:translate' },
    });
    expect(resolveSlashInput('/tr grc', undefined, ['grc']).type).toBe('tool');
    expect(resolveSlashInput('/tr hello')).toMatchObject({
      type: 'tool',
      direct: { name: 'translate', args: { text: 'hello' }, commandId: 'tool:translate' },
    });
  });

  it('works through the /translate alias', () => {
    expect(resolveSlashInput('/translate es hello')).toMatchObject({
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
