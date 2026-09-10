import { describe, expect, it } from 'vitest';
import { substituteTemplate, templateArity, templatePlaceholders } from '@shared/commands/template';

describe('substituteTemplate', () => {
  it('replaces 1-based positional placeholders', () => {
    expect(substituteTemplate('deploy {{1}} to {{2}}', ['staging', 'prod'])).toEqual({
      ok: true,
      value: 'deploy staging to prod',
      missing: [],
    });
  });

  it('replaces {{query}} with the full argv', () => {
    expect(substituteTemplate('search: {{query}}', ['red', 'pandas'])).toEqual({
      ok: true,
      value: 'search: red pandas',
      missing: [],
    });
  });

  it('reuses the same position twice', () => {
    expect(substituteTemplate('{{1}} vs {{1}}', ['a']).value).toBe('a vs a');
  });

  it('reports missing positions and leaves them literal', () => {
    const result = substituteTemplate('{{1}} then {{3}}', ['a']);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([3]);
    expect(result.value).toBe('a then {{3}}');
  });

  it('treats {{0}} and unknown braces as literals', () => {
    expect(substituteTemplate('{{0}} {x} {{ query }}', ['a'])).toEqual({
      ok: true,
      value: '{{0}} {x} a',
      missing: [],
    });
  });

  it('handles templates without placeholders', () => {
    expect(substituteTemplate('plain text', [])).toEqual({ ok: true, value: 'plain text', missing: [] });
  });
});

describe('templatePlaceholders / templateArity', () => {
  it('lists query and index placeholders', () => {
    expect(templatePlaceholders('{{2}} {{query}} {{1}}')).toEqual([
      { kind: 'index', index: 2 },
      { kind: 'query' },
      { kind: 'index', index: 1 },
    ]);
  });

  it('computes the highest referenced position', () => {
    expect(templateArity('no args')).toBe(0);
    expect(templateArity('{{1}} {{3}} {{2}}')).toBe(3);
    expect(templateArity('{{query}}')).toBe(0);
  });
});
