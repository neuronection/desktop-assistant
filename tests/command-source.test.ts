import { describe, expect, it } from 'vitest';
import type { CommandCatalogSnapshot, CommandEntry } from '@shared/commands';
import { parsePalettePrefix } from '@shared/commands';
import {
  FREQUENCY_BOOST_CAP,
  PALETTE_BROWSE_PER_CATEGORY,
  PALETTE_RECENT_WINDOW_MS,
  RECENT_BOOST_VALUES,
  bestFieldMatch,
  buildPaletteModel,
  formatSlashEntry,
  frequencyBoost,
  rankEntries,
  webSearchBrowserOverride,
} from '@renderer/chat-react/commandSource';

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

const CATALOG: CommandCatalogSnapshot = {
  entries: [
    entry({ id: 'tool:screen_capture', title: 'Screen capture', aliases: ['screenshot'], category: 'tools' }),
    entry({ id: 'tool:run_shell', title: 'Run shell', aliases: ['shell'], category: 'tools' }),
    entry({ id: 'tool:web_search', title: 'Web search', aliases: ['web', 'search'], category: 'web' }),
    entry({ id: 'nav:open-settings', title: 'Open settings', aliases: ['settings'], category: 'navigation' }),
    entry({ id: 'calc:evaluate', title: 'Calculator', aliases: ['calc'], category: 'tools', action: 'calc:evaluate' }),
  ],
  recent: [{ id: 'tool:run_shell', usedAt: Date.now() }, { id: 'calc:evaluate', usedAt: Date.now() }],
  pins: ['tool:screen_capture'],
};

describe('rankEntries', () => {
  it('prefers exact matches over substring matches', () => {
    const entries = [entry({ id: 'a', title: 'shellx' }), entry({ id: 'b', title: 'shell' })];
    expect(rankEntries(entries, 'shell').map((item) => item.entry.id)).toEqual(['b', 'a']);
  });

  it('ranks typo matches below substring matches (same query)', () => {
    const entries = [
      entry({ id: 'substring', title: 'Shellz Tool' }),
      entry({ id: 'typo-near', title: 'Shellza' }),
      entry({ id: 'typo-far', title: 'Shezzz' }),
    ];
    expect(rankEntries(entries, 'shellz').map((item) => item.entry.id)).toEqual([
      'substring',
      'typo-near',
      'typo-far',
    ]);
  });

  it('breaks score ties alphabetically by id', () => {
    const entries = [entry({ id: 'z', title: 'alpha tool' }), entry({ id: 'a', title: 'alpha tool' })];
    expect(rankEntries(entries, 'alpha').map((item) => item.entry.id)).toEqual(['a', 'z']);
  });

  it('boosts recent entries within a tier but never across tiers', () => {
    const entries = [
      entry({ id: 'recent-substring', title: 'shellx tool' }),
      entry({ id: 'plain-substring', title: 'shell tool' }),
    ];
    const ranked = rankEntries(entries, 'shell', ['recent-substring']);
    expect(ranked[0]?.entry.id).toBe('recent-substring');
    const maxBoost = Math.max(...RECENT_BOOST_VALUES);
    const typoFloor = 20;
    expect(maxBoost).toBeLessThan(typoFloor);
  });

  it('boosts frequently used commands within a tier', () => {
    const entries = [entry({ id: 'often', title: 'shell often' }), entry({ id: 'rare', title: 'shell rare' })];
    expect(rankEntries(entries, 'shell', [], { often: 20 }).map((item) => item.entry.id)).toEqual(['often', 'rare']);
    expect(rankEntries(entries, 'shell', [], { rare: 20 }).map((item) => item.entry.id)).toEqual(['rare', 'often']);
  });

  it('keeps field tiers above any frequency boost', () => {
    const entries = [
      entry({ id: 'title-match', title: 'shell' }),
      entry({ id: 'keyword-match', title: 'Unrelated', aliases: ['shell'] }),
    ];
    expect(rankEntries(entries, 'shell', [], { 'title-match': 0, 'keyword-match': 500 }).map((item) => item.entry.id)).toEqual([
      'keyword-match',
      'title-match',
    ]);
  });

  it('caps the frequency boost', () => {
    expect(frequencyBoost(0)).toBe(0);
    expect(frequencyBoost(1)).toBeCloseTo(1.5);
    expect(frequencyBoost(15)).toBe(FREQUENCY_BOOST_CAP);
    expect(frequencyBoost(10_000)).toBe(FREQUENCY_BOOST_CAP);
  });

  it('matches against aliases and keywords, not just titles', () => {
    const grep = entry({ id: 'tool:grep_files', title: 'Grep files', aliases: ['grep'] });
    expect(rankEntries([grep], 'grep')).toHaveLength(1);
    expect(bestFieldMatch(grep, 'grep')).toEqual({ tier: 'keyword', score: expect.any(Number) });
    expect(bestFieldMatch(grep, 'nothing-matches')).toBeNull();
  });

  it('ranks keyword matches above title matches — typed /web (plan 14 §2 feedback)', () => {
    const entries = [
      entry({ id: 'web:open_url', title: 'Open url', aliases: ['url'], category: 'web', subtitle: "Open a URL (http, https, or mailto) in the user's default browser." }),
      entry({ id: 'web:fetch', title: 'Web fetch', aliases: ['fetch'], category: 'web', subtitle: 'Fetch a public http(s) web page and return its readable text.' }),
      entry({ id: 'web:search', title: 'Web search', aliases: ['search'], slash: 'web', category: 'web', subtitle: 'Search the web and return result titles, URLs, and snippets.' }),
    ];
    expect(rankEntries(entries, 'web').map((item) => item.entry.id)).toEqual([
      'web:search',
      'web:fetch',
      'web:open_url',
    ]);
  });

  it('ranks title matches above description matches', () => {
    const entries = [
      entry({ id: 'desc', title: 'Reader', subtitle: 'fetch pages and extract text' }),
      entry({ id: 'title', title: 'Fetch' }),
    ];
    expect(rankEntries(entries, 'fetch').map((item) => item.entry.id)).toEqual(['title', 'desc']);
  });

  it('ranks description matches above bare category matches', () => {
    const entries = [
      entry({ id: 'cat-only', title: 'Compass', subtitle: 'Navigate somewhere else', category: 'web' }),
      entry({ id: 'desc', title: 'Compass pro', subtitle: 'reads web pages offline', category: 'tools' }),
    ];
    expect(rankEntries(entries, 'web').map((item) => item.entry.id)).toEqual(['desc', 'cat-only']);
  });

  it('recent boost reorders within a tier but never across field tiers', () => {
    const entries = [
      entry({ id: 'recent-title', title: 'webx tool' }),
      entry({ id: 'plain-keyword', title: 'Other', aliases: ['web'] }),
    ];
    const ranked = rankEntries(entries, 'web', ['recent-title']);
    expect(ranked[0]?.entry.id).toBe('plain-keyword');
    expect(ranked[0]?.tier).toBe('keyword');
    expect(ranked[1]?.tier).toBe('title');
  });
});

describe('buildPaletteModel', () => {
  it('builds pinned, then suggested, then fresh recents, then every remaining command (plan 72/76)', () => {
    const model = buildPaletteModel(CATALOG, '');
    expect(model.sections.slice(0, 3).map((section) => section.key)).toEqual(['pinned', 'suggested', 'recent']);
    expect(model.sections[0]?.items.map((item) => item.entry.id)).toEqual(['tool:screen_capture']);
    expect(model.sections[1]?.items.map((item) => item.entry.id)).toEqual(['nav:open-settings']);
    expect(model.sections[2]?.items.map((item) => item.entry.id)).toEqual(['tool:run_shell', 'calc:evaluate']);
    const browseIds = model.sections
      .filter((section) => section.key.startsWith('browse:'))
      .flatMap((section) => section.items.map((item) => item.entry.id));
    expect(browseIds.length).toBeGreaterThan(0);
    const allIds = model.sections.flatMap((section) => section.items.map((item) => item.entry.id));
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(model.total).toBe(allIds.length);
  });

  it('lists every command in its category section, never repeating the launch-pad rows', () => {
    const model = buildPaletteModel(CATALOG, '');
    const web = model.sections.find((section) => section.key === 'browse:web');
    expect(web?.items.map((item) => item.entry.id)).toEqual(['tool:web_search']);
    expect(model.sections.filter((section) => section.key.startsWith('browse:')).map((section) => section.key)).toEqual(['browse:web']);
  });

  it('keeps only recents inside the window, capped at three and newest first', () => {
    const now = Date.UTC(2026, 10, 10, 12);
    const snapshot: CommandCatalogSnapshot = {
      entries: [
        entry({ id: 'tool:a', title: 'A', category: 'tools' }),
        entry({ id: 'tool:b', title: 'B', category: 'tools' }),
        entry({ id: 'tool:c', title: 'C', category: 'tools' }),
        entry({ id: 'tool:d', title: 'D', category: 'tools' }),
        entry({ id: 'tool:stale', title: 'Stale', category: 'tools' }),
      ],
      recent: [
        { id: 'tool:a', usedAt: now - 60_000 },
        { id: 'tool:b', usedAt: now - 3_600_000 },
        { id: 'tool:c', usedAt: now - 5 * 3_600_000 },
        { id: 'tool:d', usedAt: now - 30_000 },
        { id: 'tool:stale', usedAt: now - PALETTE_RECENT_WINDOW_MS - 1 },
      ],
      pins: [],
    };
    const model = buildPaletteModel(snapshot, '', [], [], now);
    const recent = model.sections.find((section) => section.key === 'recent');
    expect(recent?.items.map((item) => item.entry.id)).toEqual(['tool:d', 'tool:a', 'tool:b']);
  });

  it('does not pad the recent section with stale uses', () => {
    const now = Date.UTC(2026, 10, 10, 12);
    const snapshot: CommandCatalogSnapshot = {
      entries: [entry({ id: 'tool:old', title: 'Old', category: 'tools' })],
      recent: [{ id: 'tool:old', usedAt: now - PALETTE_RECENT_WINDOW_MS - 5_000 }],
      pins: [],
    };
    const model = buildPaletteModel(snapshot, '', [], [], now);
    expect(model.sections.find((section) => section.key === 'recent')).toBeUndefined();
  });

  it('caps the browse list per category and reports what typing would find', () => {
    const entries = Array.from({ length: 12 }, (_, index) =>
      entry({ id: `tool:bulk_${index}`, title: `Bulk ${String(index).padStart(2, '0')}`, category: 'tools' })
    );
    const model = buildPaletteModel({ entries, recent: [], pins: [] }, '');
    const browse = model.sections.find((section) => section.key === 'browse:tools');
    expect(browse?.items).toHaveLength(PALETTE_BROWSE_PER_CATEGORY);
    expect(model.browseHidden).toBe(12 - PALETTE_BROWSE_PER_CATEGORY);
    expect(model.total).toBe(PALETTE_BROWSE_PER_CATEGORY);
  });

  it('never repeats an id across pinned, suggested and recent', () => {
    const now = Date.UTC(2026, 10, 10, 12);
    const snapshot: CommandCatalogSnapshot = {
      ...CATALOG,
      recent: [
        { id: 'tool:screen_capture', usedAt: now - 1_000 },
        { id: 'nav:open-settings', usedAt: now - 2_000 },
        { id: 'tool:run_shell', usedAt: now - 3_000 },
      ],
    };
    const model = buildPaletteModel(snapshot, '', [], [], now);
    const ids = model.sections.flatMap((section) => section.items.map((item) => item.entry.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('tool:screen_capture');
    expect(ids).toContain('nav:open-settings');
  });

  it('returns one mixed results section with pinned entries first', () => {
    const model = buildPaletteModel(CATALOG, 'sh');
    expect(model.sections.map((section) => section.key)).toEqual(['results']);
    expect(model.sections[0]?.items[0]?.entry.id).toBe('tool:screen_capture');
    expect(model.total).toBeGreaterThan(0);
  });

  it('exposes the argv parsed from the query for arg-completeness checks', () => {
    const model = buildPaletteModel(CATALOG, 'shell ls -la');
    expect(model.alias).toBe('shell');
    expect(model.argv).toEqual(['ls', '-la']);
  });

  it('returns no sections when nothing matches', () => {
    expect(buildPaletteModel(CATALOG, 'zzzz').sections).toEqual([]);
  });

  it('hides entries without palette scope from matches, pins, and recents', () => {
    const snapshot: CommandCatalogSnapshot = {
      entries: [
        entry({ id: 'tool:web_fetch', title: 'Web fetch', category: 'web', scopes: { palette: false, agent: false } }),
        entry({ id: 'tool:sysinfo', title: 'System info', aliases: ['sysinfo'], category: 'tools' }),
      ],
      recent: [{ id: 'tool:web_fetch', usedAt: Date.now() }],
      pins: ['tool:web_fetch'],
    };
    expect(buildPaletteModel(snapshot, 'fetch').total).toBe(0);
    const empty = buildPaletteModel(snapshot, '');
    expect(empty.sections.map((section) => section.key)).toEqual(['browse:tools']);
    expect(empty.sections[0]?.items.map((item) => item.entry.id)).toEqual(['tool:sysinfo']);
  });
});

describe('exact-alias collapse and internal-first ordering (plan 14 S9 feedback)', () => {
  it('collapses exact typed command names to that command only', () => {
    const model = buildPaletteModel(CATALOG, 'shell ls');
    expect(model.total).toBe(1);
    expect(model.sections[0]?.items[0]?.entry.id).toBe('tool:run_shell');
  });

  it('suppresses fuzzy matches when the typed alias is reserved but filtered (mini /exit)', () => {
    const withQuit = {
      ...CATALOG,
      entries: [...CATALOG.entries, entry({ id: 'nav:quit', title: 'Quit', aliases: ['quit', 'exit'], source: 'system', category: 'navigation' })],
    };
    expect(buildPaletteModel(withQuit, 'exit', ['nav:quit']).sections).toEqual([]);
    const visible = buildPaletteModel(withQuit, 'exit');
    expect(visible.total).toBe(1);
    expect(visible.sections[0]?.items[0]?.entry.id).toBe('nav:quit');
  });

  it('orders equal-ranked internal tools before external apps', () => {
    const withApp = {
      ...CATALOG,
      entries: [
        ...CATALOG.entries,
        entry({ id: 'app:shellapp', title: 'ShellApp', aliases: ['shell'], source: 'app', category: 'apps' }),
      ],
    };
    const model = buildPaletteModel(withApp, 'shell', ['tool:screen_capture']);
    const items = model.sections[0]?.items.map((item) => item.entry.id) ?? [];
    expect(items).toEqual(['tool:run_shell', 'app:shellapp']);
  });
});

describe('formatSlashEntry', () => {
  it('formats slash + argv for the turn path', () => {
    expect(formatSlashEntry(CATALOG.entries[1] as CommandEntry, ['ls', '-la'])).toBe('/shell ls -la');
    expect(formatSlashEntry(CATALOG.entries[0] as CommandEntry, [])).toBe('/screenshot');
  });
});

describe('webSearchBrowserOverride (plan 14 S4 / D12)', () => {
  it('returns null for inline mode with providers configured', () => {
    expect(webSearchBrowserOverride('news', { enabledProviders: 1, behavior: 'inline', fallbackEngine: '' })).toBeNull();
  });

  it('falls back to the engine URL when no providers are configured', () => {
    expect(
      webSearchBrowserOverride('red pandas', { enabledProviders: 0, behavior: 'inline', fallbackEngine: 'https://duckduckgo.com/?q=' })
    ).toBe('https://duckduckgo.com/?q=red%20pandas');
  });

  it('browser mode wins even with providers configured', () => {
    expect(
      webSearchBrowserOverride('news', { enabledProviders: 2, behavior: 'browser', fallbackEngine: 'https://duckduckgo.com/?q=' })
    ).toBe('https://duckduckgo.com/?q=news');
  });

  it('falls back to the default engine when the configured template is empty', () => {
    expect(webSearchBrowserOverride('x', { enabledProviders: 0, behavior: 'inline', fallbackEngine: '   ' })).toBe(
      'https://duckduckgo.com/?q=x'
    );
  });
});

describe('palette prefix grammar', () => {
  const entries = [
    entry({ id: 'tool:web_search', title: 'Web search', category: 'web', aliases: ['web'] }),
    entry({ id: 'calc:evaluate', title: 'Calculator', category: 'tools', action: 'calc:evaluate' }),
    entry({ id: 'app:figma', title: 'Figma', category: 'apps' }),
    entry({ id: 'nav:open-settings', title: 'Settings', category: 'navigation' }),
  ];
  const snapshot: CommandCatalogSnapshot = { entries, recent: [], pins: [] };

  it('parses the four prefixes and leaves prose alone', () => {
    expect(parsePalettePrefix('>set')).toEqual({ kind: 'commands', query: 'set' });
    expect(parsePalettePrefix('@fig')).toEqual({ kind: 'apps', query: 'fig' });
    expect(parsePalettePrefix('=2+2')).toEqual({ kind: 'calc', query: '2+2' });
    expect(parsePalettePrefix('g cats')).toEqual({ kind: 'web', query: 'cats' });
    expect(parsePalettePrefix('great')).toEqual({ kind: 'none', query: 'great' });
    expect(parsePalettePrefix('/web cats')).toEqual({ kind: 'none', query: '/web cats' });
  });

  it('> searches commands and hides apps', () => {
    const model = buildPaletteModel(snapshot, '>set');
    expect(model.total).toBe(1);
    expect(model.sections[0]?.items[0]?.entry.id).toBe('nav:open-settings');
    expect(model.argv).toEqual(['set']);
  });

  it('@ searches apps only', () => {
    const model = buildPaletteModel(snapshot, '@fig');
    expect(model.sections[0]?.items.map((item) => item.entry.id)).toEqual(['app:figma']);
  });

  it('g selects the web search command with the query as argv', () => {
    const model = buildPaletteModel(snapshot, 'g cats photos');
    expect(model.sections[0]?.items.map((item) => item.entry.id)).toEqual(['tool:web_search']);
    expect(model.argv).toEqual(['cats', 'photos']);
  });

  it('= selects the calculator with the expression as argv', () => {
    const model = buildPaletteModel(snapshot, '=2+2');
    expect(model.sections[0]?.items.map((item) => item.entry.id)).toEqual(['calc:evaluate']);
    expect(model.argv).toEqual(['2+2']);
  });
});
