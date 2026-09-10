import { describe, expect, it } from 'vitest';
import type { CommandEntry } from '@shared/commands';
import { resolveCommandAlias, sortedAliasEntries } from '@shared/commands/resolve';

function entry(overrides: Partial<CommandEntry> & { id: string }): CommandEntry {
  return {
    kind: 'tool',
    title: overrides.id,
    category: 'tools',
    aliases: [],
    source: 'native',
    scopes: { palette: true, agent: false },
    args: [],
    ...overrides,
  };
}

describe('resolveCommandAlias', () => {
  it('matches aliases case-insensitively with or without slash', () => {
    const entries = [entry({ id: 'tool:run_shell', aliases: ['shell'] })];
    expect(resolveCommandAlias(entries, '/shell ls')?.entry.id).toBe('tool:run_shell');
    expect(resolveCommandAlias(entries, '/SHELL')?.entry.id).toBe('tool:run_shell');
  });

  it('requires the slash prefix — bare words are chat, not commands', () => {
    const entries = [entry({ id: 'tool:run_shell', aliases: ['shell'] })];
    expect(resolveCommandAlias(entries, 'shell')).toBeNull();
  });

  it('returns null for unknown alias or non-slash free text', () => {
    const entries = [entry({ id: 'a', aliases: ['alpha'] })];
    expect(resolveCommandAlias(entries, '/beta')).toBeNull();
    expect(resolveCommandAlias(entries, 'just text')).toBeNull();
  });

  it('ignores entries hidden from the palette', () => {
    const entries = [entry({ id: 'a', aliases: ['x'], scopes: { palette: false, agent: true } })];
    expect(resolveCommandAlias(entries, '/x')).toBeNull();
  });

  it('prefers builtins over user customs (D6 shadow order)', () => {
    const entries = [
      entry({ id: 'custom:calc', source: 'user', aliases: ['calc'] }),
      entry({ id: 'calc:evaluate', source: 'system', aliases: ['calc'] }),
    ];
    expect(resolveCommandAlias(entries, '/calc 1+1')?.entry.id).toBe('calc:evaluate');
  });

  it('prefers user customs over native tools', () => {
    const entries = [
      entry({ id: 'tool:run_shell', source: 'native', aliases: ['shell'] }),
      entry({ id: 'custom:shell-safe', source: 'user', aliases: ['shell'] }),
    ];
    expect(resolveCommandAlias(entries, '/shell ls')?.entry.id).toBe('custom:shell-safe');
  });

  it('breaks ties deterministically by id', () => {
    const entries = [
      entry({ id: 'tool:b', source: 'user', aliases: ['dup'] }),
      entry({ id: 'tool:a', source: 'user', aliases: ['dup'] }),
    ];
    expect(resolveCommandAlias(entries, '/dup')?.entry.id).toBe('tool:a');
    expect(sortedAliasEntries(entries).map((item) => item.id)).toEqual(['tool:a', 'tool:b']);
  });

  it('matches the canonical slash even when not listed in aliases', () => {
    const entries = [entry({ id: 'calc:evaluate', source: 'system', aliases: [], slash: 'calc' })];
    expect(resolveCommandAlias(entries, '/calc 2*2')?.entry.id).toBe('calc:evaluate');
  });
});
