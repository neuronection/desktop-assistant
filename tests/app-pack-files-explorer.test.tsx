// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PackReportRenderer } from '@renderer/shared/PackReportRenderer';
import { reduceRunTree, adjustTreeForVerdict } from '@main/apps/run/tree';
import type { MiniAppRunItemRow } from '@main/apps/run/store';
import type { MiniAppRunItemView, MiniAppRunReportView, MiniAppRunTreeView } from '@shared/app-pack';

afterEach(cleanup);

function itemView(relPath: string, verdict: 'keep' | 'ask' | 'candidate'): MiniAppRunItemView {
  return {
    relPath,
    verdict,
    confidence: null,
    decidedBy: 'rule:test',
    evidence: { rule: 'test', list: 'keep', meta: { size: 100, ageDays: 10, ext: 'txt' } },
  };
}

function reportFixture(items: MiniAppRunItemView[]): MiniAppRunReportView {
  return {
    packTitle: 'Sample review',
    run: {
      id: 'run-1',
      packId: 'sample-review',
      packVersion: '1.0.0',
      rootPath: '/root',
      status: 'done',
      totals: { scanned: items.length, keep: 0, ask: 0, candidate: 0, ruleDecided: items.length, modelDecided: 0, cacheHits: 0, pending: 0 },
      estimateCalls: 0,
      actualCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      error: null,
      conversationId: null,
      startedAt: 1,
      updatedAt: 2,
      finishedAt: 3,
    },
    items,
    reportNodes: [
      { id: 'filters', type: 'filter-bar', filters: ['verdict'] },
      { id: 'items', type: 'table', columns: ['path', 'verdict', 'confidence', 'decidedBy', 'size', 'category'] },
    ],
    labels: {},
  };
}

const TREE: MiniAppRunTreeView = {
  runId: 'run-1',
  directories: [
    { path: '', directCounts: { keep: 0, ask: 0, candidate: 0 }, totalCounts: { keep: 2, ask: 2, candidate: 1 }, sizeByVerdict: { keep: 0, ask: 0, candidate: 0 }, totalSizeByVerdict: { keep: 100, ask: 100, candidate: 100 } },
    { path: 'src', directCounts: { keep: 0, ask: 0, candidate: 0 }, totalCounts: { keep: 1, ask: 1, candidate: 0 }, sizeByVerdict: { keep: 0, ask: 0, candidate: 0 }, totalSizeByVerdict: { keep: 100, ask: 100, candidate: 0 } },
    { path: 'src/assets', directCounts: { keep: 1, ask: 1, candidate: 0 }, totalCounts: { keep: 1, ask: 1, candidate: 0 }, sizeByVerdict: { keep: 100, ask: 100, candidate: 0 }, totalSizeByVerdict: { keep: 100, ask: 100, candidate: 0 } },
    { path: 'dist', directCounts: { keep: 1, ask: 1, candidate: 1 }, totalCounts: { keep: 1, ask: 1, candidate: 1 }, sizeByVerdict: { keep: 100, ask: 100, candidate: 100 }, totalSizeByVerdict: { keep: 100, ask: 100, candidate: 100 } },
  ],
};

function mockApi(items: MiniAppRunItemView[]) {
  const directory = vi.fn(async (_runId: string, prefix: string, page: number, verdict?: string) => {
    const matching = items.filter((item) => item.relPath.startsWith(prefix === '' ? '' : `${prefix}/`) && (!verdict || item.verdict === verdict));
    const pageCount = Math.max(1, Math.ceil(matching.length / 200));
    const safePage = Math.min(Math.max(1, page), pageCount);
    return {
      runId: 'run-1',
      prefix,
      page: safePage,
      pageCount,
      totalMatching: matching.length,
      items: matching.slice((safePage - 1) * 200, safePage * 200),
    };
  });
  return {
    directory,
    overrides: vi.fn(async (_runId: string, relPaths: string[], _verdict: string) => ({
      results: relPaths.map((relPath) => ({ relPath, ok: true })),
      applied: relPaths.length,
    })),
    prefixOverride: vi.fn(async (_runId: string, _prefix: string, _verdict: string, _source: string, maxItems: number) => ({
      applied: maxItems,
      remaining: 0,
    })),
    saveConfig: vi.fn(async (_id: string, values: Record<string, unknown>) => ({ ok: true, values })),
  };
}

function setup(items: MiniAppRunItemView[], options: { tree?: MiniAppRunTreeView | null; keepRules?: string[] } = {}) {
  const api = mockApi(items);
  window.electronAPI = {
    getMiniAppRunTree: vi.fn(async () => (options.tree === undefined ? TREE : options.tree)),
    getMiniAppRunDirectory: api.directory,
    overrideMiniAppItems: api.overrides,
    overrideMiniAppPrefix: api.prefixOverride,
    saveMiniAppConfig: api.saveConfig,
    getMiniApps: vi.fn(async () => ({
      masterEnabled: true,
      packs: [
        {
          id: 'sample-review',
          configValues: { keepRules: options.keepRules ?? [], junkRules: [] },
          ruleBindings: [{ ruleId: 'user-keep', list: 'keep', configKey: 'keepRules', label: 'Keep rules' }],
        },
      ],
      removedBundled: [],
    })),
    overrideMiniAppItem: vi.fn(async () => ({ ok: true })),
    excludeMiniAppItem: vi.fn(async () => ({ ok: true })),
  } as unknown as typeof window.electronAPI;
  const onReportChanged = vi.fn(async () => undefined);
  render(
    <PackReportRenderer
      report={reportFixture(items)}
      onOverride={vi.fn(async () => undefined)}
      onReveal={vi.fn(async () => undefined)}
      onOpen={vi.fn(async () => undefined)}
      onRestore={vi.fn(async () => undefined)}
      onReportChanged={onReportChanged}
    />
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
  return { api, onReportChanged };
}

describe('DirectoryTree (plan 51 S3.4)', () => {
  it('renders the rail with disclosure buttons and aggregate badges; expanding navigates the paged table', async () => {
    const items = [
      itemView('src/assets/logo.png', 'keep'),
      itemView('src/index.ts', 'ask'),
      itemView('dist/app.js', 'candidate'),
      itemView('README.md', 'keep'),
    ];
    const { api } = setup(items);
    await screen.findByTestId('directory-tree');
    const root = screen.getByTestId('tree-node-root');
    expect(root.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByTestId('tree-node-src'));
    await waitFor(() => expect(api.directory).toHaveBeenCalledWith('run-1', 'src', 1, undefined));
    expect(screen.getByTestId('tree-badge-keep-src')).toBeTruthy();
    expect(screen.getByTestId('dir-crumb-src')).toBeTruthy();
  });

  it('verdict filter chips apply to tree badges and the directory query', async () => {
    const items = [
      itemView('src/assets/logo.png', 'keep'),
      itemView('dist/app.js', 'candidate'),
    ];
    const { api } = setup(items);
    await screen.findByTestId('directory-tree');
    fireEvent.click(screen.getByRole('button', { name: /candidate \(1\)/ }));
    await waitFor(() => expect(api.directory).toHaveBeenCalledWith('run-1', '', 1, 'candidate'));
    expect(screen.getByTestId('tree-badge-root').textContent).toBe('1');
  });
});

describe('Directory-scoped actions (plan 51 S3.4)', () => {
  it('Keep all / Exclude all run the bounded prefix loop and refresh tree + report', async () => {
    const items = Array.from({ length: 30 }, (_, index) => itemView(`d/f${index}.txt`, 'ask'));
    const { api, onReportChanged } = setup(items);
    await screen.findByTestId('directory-tree');
    fireEvent.click(screen.getByTestId('dir-keep-all'));
    fireEvent.click(await screen.findByTestId('scoped-action-confirm-go'));
    await waitFor(() => expect(api.prefixOverride).toHaveBeenCalledWith('run-1', '', 'keep', 'override', 2000));
    expect(api.prefixOverride).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onReportChanged).toHaveBeenCalled());
  });

  it('asks for confirmation above 50 items with the popup chrome law, then continues honestly', async () => {
    const items = Array.from({ length: 80 }, (_, index) => itemView(`d/f${index}.txt`, 'ask'));
    const { api } = setup(items);
    await screen.findByTestId('directory-tree');
    fireEvent.click(screen.getByTestId('dir-exclude-all'));
    const confirm = await screen.findByTestId('scoped-action-confirm');
    expect(confirm.getAttribute('role')).toBe('alertdialog');
    expect(confirm.textContent).toContain('Exclude 80 files under');
    const footer = Array.from(confirm.children).at(-1) as HTMLElement;
    expect(within(footer).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    fireEvent.click(within(footer).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.prefixOverride).toHaveBeenCalledWith('run-1', '', 'keep', 'exclude', 2000));
  });

  it('adds the directory glob to keep rules through the binding introspection', async () => {
    const items = [itemView('src/assets/logo.png', 'keep')];
    const { api } = setup(items, { keepRules: ['docs/**'] });
    await screen.findByTestId('directory-tree');
    fireEvent.click(screen.getByTestId('tree-node-src'));
    await screen.findByTestId('dir-crumb-src');
    fireEvent.click(screen.getByTestId('dir-add-rule'));
    await waitFor(() =>
      expect(api.saveConfig).toHaveBeenCalledWith('sample-review', expect.objectContaining({ keepRules: ['docs/**', 'src/**'] }))
    );
  });
});

describe('Multi-select mode (plan 51 S3.7)', () => {
  const items = [
    itemView('a.txt', 'ask'),
    itemView('b.txt', 'ask'),
    itemView('c.txt', 'candidate'),
    itemView('d.txt', 'keep'),
  ];

  it('enters via the Select toggle; checkboxes and the bulk bar exist only in the mode', async () => {
    setup(items);
    await screen.findAllByTestId('report-files-table');
    expect(screen.queryByTestId('bulk-bar')).toBeNull();
    expect(screen.queryByTestId('report-select-a.txt')).toBeNull();
    fireEvent.click(screen.getByTestId('report-select-toggle'));
    expect(screen.getByTestId('bulk-bar')).toBeTruthy();
    expect(screen.getByTestId('report-select-a.txt')).toBeTruthy();
    fireEvent.click(screen.getByTestId('bulk-done'));
    expect(screen.queryByTestId('bulk-bar')).toBeNull();
  });

  it('row click toggles, the header selects the page, shift-click extends a range, Escape exits', async () => {
    setup(items);
    await screen.findAllByTestId('report-files-table');
    fireEvent.click(screen.getByTestId('report-select-toggle'));
    fireEvent.click(screen.getByTestId('report-row-a.txt'));
    expect((screen.getByTestId('report-select-a.txt') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId('report-select-all-page'));
    expect((screen.getByTestId('report-select-d.txt') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId('report-select-all-page'));
    expect((screen.getByTestId('report-select-d.txt') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId('report-select-a.txt'));
    fireEvent.click(screen.getByTestId('report-select-c.txt'), { shiftKey: true });
    expect((screen.getByTestId('report-select-b.txt') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('report-select-d.txt') as HTMLInputElement).checked).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('bulk-bar')).toBeNull();
  });

  it('the drawer stays reachable via the info button while selecting; batch applies through the batch IPC', async () => {
    const { api } = setup(items);
    await screen.findAllByTestId('report-files-table');
    fireEvent.click(screen.getByTestId('report-select-toggle'));
    fireEvent.click(screen.getByTestId('report-row-a.txt'));
    fireEvent.click(screen.getByTestId('report-row-b.txt'));
    fireEvent.click(screen.getByTestId('bulk-candidate'));
    await waitFor(() => expect(api.overrides).toHaveBeenCalledWith('run-1', ['a.txt', 'b.txt'], 'candidate', 'override'));
    expect(screen.queryByTestId('bulk-bar')).toBeNull();
  });

  it('bulk Ask again re-queues the selection through the batch bridge (plan 54 follow-up)', async () => {
    const { api } = setup(items);
    await screen.findAllByTestId('report-files-table');
    fireEvent.click(screen.getByTestId('report-select-toggle'));
    fireEvent.click(screen.getByTestId('report-row-a.txt'));
    fireEvent.click(screen.getByTestId('report-row-b.txt'));
    fireEvent.click(screen.getByTestId('bulk-ask'));
    await waitFor(() => expect(api.overrides).toHaveBeenCalledWith('run-1', ['a.txt', 'b.txt'], 'ask', 'override'));
  });

  it('select all in this folder caps selection at the batch bound', async () => {
    const many = Array.from({ length: 700 }, (_, index) => itemView(`bulk/f${index}.txt`, 'ask'));
    const { api } = setup(many);
    await screen.findAllByTestId('report-files-table');
    fireEvent.click(screen.getByTestId('report-select-toggle'));
    fireEvent.click(screen.getByTestId('bulk-select-folder'));
    await waitFor(() => {
      expect(screen.getByTestId('bulk-count').textContent).toContain('500');
    });
    expect(api.directory.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('end-to-end Files flow (plan 51 S3.10)', () => {
  it('wires tabs → tree expansion → selection → drawer → scoped override through the bridge', async () => {
    const items = [
      itemView('src/assets/logo.png', 'keep'),
      itemView('src/index.ts', 'ask'),
      itemView('src/app.ts', 'ask'),
      itemView('dist/app.js', 'candidate'),
      itemView('README.md', 'keep'),
    ];
    const { api, onReportChanged } = setup(items);
    await screen.findByTestId('directory-tree');

    fireEvent.click(screen.getByTestId('tree-node-src'));
    await waitFor(() => expect(api.directory).toHaveBeenCalledWith('run-1', 'src', 1, undefined));

    fireEvent.click(screen.getByTestId('report-select-toggle'));
    fireEvent.click(screen.getByTestId('report-row-src/index.ts'));
    fireEvent.click(screen.getByTestId('report-row-src/app.ts'));
    fireEvent.click(screen.getByTestId('bulk-keep'));
    await waitFor(() => expect(api.overrides).toHaveBeenCalledWith('run-1', ['src/index.ts', 'src/app.ts'], 'keep', 'override'));
    await waitFor(() => expect(onReportChanged).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('report-info-src/assets/logo.png'));
    const drawer = await screen.findByTestId('item-drawer');
    expect(drawer.textContent).toContain('src/assets/logo.png');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('item-drawer')).toBeNull();

    fireEvent.click(screen.getByTestId('dir-keep-all'));
    fireEvent.click(await screen.findByTestId('scoped-action-confirm-go'));
    await waitFor(() => expect(api.prefixOverride).toHaveBeenCalledWith('run-1', 'src', 'keep', 'override', 2000));
  });
});

describe('Run-tree index (plan 51 S3.9 — main-side math)', () => {
  function row(relPath: string, verdict: 'keep' | 'ask' | 'candidate', size: number | null): MiniAppRunItemRow {
    return {
      runId: 'run-1',
      packId: 'pack',
      packVersion: '1.0.0',
      configHash: 'h',
      engineId: 'e',
      fingerprint: relPath,
      relPath,
      verdict,
      confidence: null,
      decidedBy: 'rule:test',
      evidence: size === null ? null : { meta: { size, ageDays: 5, ext: 'txt' } },
      updatedAt: 1,
    };
  }

  it('reduces 5000 files across 300 directories with exact bottom-up totals', () => {
    const rows: MiniAppRunItemRow[] = [];
    for (let dir = 0; dir < 300; dir += 1) {
      for (let file = 0; file < 16; file += 1) {
        const verdict = (['keep', 'ask', 'candidate'] as const)[(dir + file) % 3];
        rows.push(row(`dir${String(dir).padStart(3, '0')}/sub${file % 3}/f${file}.txt`, verdict, 10));
      }
    }
    rows.push(row('root-file.txt', 'keep', 7));
    const view = reduceRunTree('run-1', rows);
    const root = view.directories.find((dir) => dir.path === '');
    expect(root).toBeTruthy();
    expect(root?.totalCounts).toEqual({ keep: 1601, ask: 1600, candidate: 1600 });
    expect(root?.directCounts).toEqual({ keep: 1, ask: 0, candidate: 0 });
    expect(root?.totalSizeByVerdict).toEqual({ keep: 16000 + 7, ask: 16000, candidate: 16000 });
    const deep = view.directories.find((dir) => dir.path === 'dir000/sub0');
    expect(deep?.directCounts).toEqual({ keep: 6, ask: 0, candidate: 0 });
    expect(view.directories.every((dir, index) => index === 0 || view.directories[index - 1].path <= dir.path)).toBe(true);
  });

  it('size honesty: a meta-less item nulls its verdict size bucket bottom-up', () => {
    const rows = [row('a/b/f.txt', 'keep', 10), row('a/g.txt', 'keep', null)];
    const view = reduceRunTree('run-1', rows);
    const root = view.directories.find((dir) => dir.path === '');
    expect(root?.totalCounts.keep).toBe(2);
    expect(root?.totalSizeByVerdict.keep).toBeNull();
    const a = view.directories.find((dir) => dir.path === 'a');
    expect(a?.sizeByVerdict.keep).toBeNull();
    expect(a?.directCounts.keep).toBe(1);
  });

  it('override delta shifts counts along the directory chain without a re-reduce', () => {
    const rows = [row('a/b/f.txt', 'ask', 10), row('a/g.txt', 'keep', 5)];
    const view = reduceRunTree('run-1', rows);
    adjustTreeForVerdict(view, 'a/b/f.txt', 'ask', 'keep', 10);
    const root = view.directories.find((dir) => dir.path === '');
    expect(root?.totalCounts).toEqual({ keep: 2, ask: 0, candidate: 0 });
    expect(root?.totalSizeByVerdict.keep).toBeNull();
  });
});

describe('plan 51 review-fix regressions', () => {
  function row(relPath: string, verdict: 'keep' | 'ask' | 'candidate', size: number | null): MiniAppRunItemRow {
    return {
      runId: 'run-1',
      packId: 'pack',
      packVersion: '1.0.0',
      configHash: 'h',
      engineId: 'e',
      fingerprint: relPath,
      relPath,
      verdict,
      confidence: null,
      decidedBy: 'rule:test',
      evidence: size === null ? null : { meta: { size, ageDays: 5, ext: 'txt' } },
      updatedAt: 1,
    };
  }

  it('override deltas move direct counts only on the item directory, totals on every ancestor', () => {
    const rows = [row('a/b/f.txt', 'ask', 10), row('a/g.txt', 'keep', 5)];
    const view = reduceRunTree('run-1', rows);
    adjustTreeForVerdict(view, 'a/b/f.txt', 'ask', 'keep', 10);
    const own = view.directories.find((dir) => dir.path === 'a/b');
    expect(own?.directCounts).toEqual({ keep: 1, ask: 0, candidate: 0 });
    const parent = view.directories.find((dir) => dir.path === 'a');
    expect(parent?.directCounts).toEqual({ keep: 1, ask: 0, candidate: 0 });
    expect(parent?.totalCounts).toEqual({ keep: 2, ask: 0, candidate: 0 });
    const root = view.directories.find((dir) => dir.path === '');
    expect(root?.directCounts).toEqual({ keep: 0, ask: 0, candidate: 0 });
    expect(root?.totalCounts).toEqual({ keep: 2, ask: 0, candidate: 0 });
  });

  it('size honesty is order-independent: a sized item after a meta-less one keeps the bucket unknown', () => {
    const view = reduceRunTree('run-1', [row('a/known.txt', 'keep', 10), row('a/unknown.txt', 'keep', null)]);
    const bucket = view.directories.find((dir) => dir.path === 'a')?.sizeByVerdict.keep;
    expect(bucket).toBeNull();
  });
});
