// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { RunReportModal, PackReportRenderer, ArmModal } from '@renderer/shared/RunReportModal';
import { paneWidthClass } from '@renderer/shared/PackReportRenderer';
import type { MiniAppRunReportView } from '@shared/app-pack';

afterEach(cleanup);

function reportFixture(): MiniAppRunReportView {
  return {
    packTitle: 'Sample review',
    run: {
      id: 'run-1',
      packId: 'sample-review',
      packVersion: '0.1.0',
      rootPath: '/home/tester/projects/demo',
      status: 'done',
      totals: { scanned: 4, keep: 1, ask: 2, candidate: 1, ruleDecided: 1, modelDecided: 3, cacheHits: 1, pending: 0 },
      estimateCalls: 3,
      actualCalls: 3,
      inputTokens: 90,
      outputTokens: 30,
      error: null,
      conversationId: 'conv-1',
      engineId: 'systemone:prov-1:jev-1',
      execution: { decision: { providerId: 'prov-1', providerName: 'OpenRouter', model: 'jev-1' } },
      startedAt: 1_700_000_000_000,
      updatedAt: 1_700_000_042_000,
      finishedAt: 1_700_000_042_000,
    },
    items: [
      {
        relPath: 'cache/junk.tmp',
        verdict: 'candidate',
        confidence: 0.91,
        decidedBy: 'engine:llm',
        evidence: {
          rule: 'cache',
          list: 'candidate',
          meta: { size: 2048, ageDays: 40, ext: 'tmp' },
          answers: {
            safe: { type: 'choice', choice: 'yes', probabilities: { yes: 0.91 }, confidence: 0.91 },
            category: { type: 'choice', choice: 'temp', confidence: 0.8 },
          },
        },
      },
      { relPath: 'fresh.txt', verdict: 'keep', confidence: null, decidedBy: 'rule:fresh', evidence: { rule: 'fresh', list: 'keep', meta: { size: 12, ageDays: 1, ext: 'txt' } } },
      { relPath: 'mystery.dat', verdict: 'ask', confidence: null, decidedBy: 'cache', evidence: null },
      { relPath: 'weird.bin', verdict: 'ask', confidence: null, decidedBy: 'rule:weird', evidence: { rule: 'weird', list: 'ask', meta: { size: 500, ageDays: 400, ext: 'bin' } } },
    ],
    reportNodes: [
      { id: 'status', type: 'badge', bind: 'run.status' },
      { id: 'total', type: 'stat', bind: 'totals.scanned' },
      { id: 'bar', type: 'progress', bind: 'run.progress' },
      { id: 'filters', type: 'filter-bar', filters: ['verdict'] },
      { id: 'decided', type: 'select', bind: 'decidedByKind', options: ['rule', 'engine', 'cache'] },
      { id: 'items', type: 'table', columns: ['path', 'verdict', 'confidence', 'decidedBy', 'size', 'category'] },
      { id: 'ev', type: 'evidence' },
      { id: 'export-actions', type: 'actions', actions: ['run:export'] },
    ],
    labels: {
      'report.total': 'Files scanned',
      'rule.cache': 'Build cache',
      'rule.fresh': 'Recently modified',
      'rule.weird': 'Unusual',
      'question.safe': 'Safe to delete?',
      'question.category': 'Category',
      'status.temp': 'Temporary',
    },
  };
}

function directoryMockFor(items: MiniAppRunItemView[]) {
  return vi.fn(async (_runId: string, prefix: string, page: number, verdict?: string) => {
    const matching = items.filter(
      (item) => item.relPath.startsWith(prefix === '' ? '' : `${prefix}/`) && (!verdict || item.verdict === verdict)
    );
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
}

function mockApi(): void {
  const fixture = reportFixture();
  window.electronAPI = {
    miniAppRunReport: vi.fn(async () => reportFixture()),
    getMiniAppRunDirectory: directoryMockFor(fixture.items),
    overrideMiniAppItem: vi.fn(async () => ({ ok: true })),
    excludeMiniAppItem: vi.fn(async () => ({ ok: true })),
    revealMiniAppItem: vi.fn(async () => ({ ok: true })),
    openMiniAppItem: vi.fn(async () => ({ ok: true })),
    cancelMiniAppRun: vi.fn(async () => ({ ok: true })),
    startMiniAppRun: vi.fn(async () => ({ ok: true, runId: 'run-2' })),
  } as unknown as typeof window.electronAPI;
}

async function scanNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
    .join('\n');
  expect(summary).toBe('');
}

async function openFilesTab(): Promise<HTMLElement> {
  mockApi();
  const { container } = render(
    <PackReportRenderer report={reportFixture()} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
  await screen.findAllByTestId('report-files-table');
  return container;
}

describe('PackReportRenderer — run-level chrome consolidation (plan 52 S1)', () => {
  it('renders exactly one Export action: the header home; manifest actions nodes are stripped from the Files surface', async () => {
    const container = await openFilesTab();
    expect(screen.getAllByRole('button', { name: 'Export Markdown' }).length).toBe(1);
    expect(screen.queryByTestId('surface-export-actions')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="surface-"]').length).toBeGreaterThan(0);
  });

  it('strips only the run-level action from a mixed actions node — the rest still render through the surface', async () => {
    mockApi();
    const mixed = reportFixture();
    mixed.reportNodes = [...mixed.reportNodes, { id: 'mixed-actions', type: 'actions', actions: ['run:export', 'run:diff'] }];
    render(
      <PackReportRenderer report={mixed} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findAllByTestId('report-files-table');
    expect(screen.getAllByRole('button', { name: 'Export Markdown' }).length).toBe(1);
    expect(screen.queryByTestId('surface-action-run:export')).toBeNull();
    expect(screen.getByTestId('surface-action-run:diff')).toBeTruthy();
  });

  it('renders the status as a dot + word that labels the run, not a button look-alike', () => {
    mockApi();
    render(
      <PackReportRenderer report={reportFixture()} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    const status = screen.getByTestId('report-status-badge');
    expect(status.tagName).toBe('SPAN');
    expect(status.querySelector('button')).toBeNull();
    expect(status.textContent).toContain('Done');
  });

  it('the arm CTA carries the gated candidate count and disables at zero', async () => {
    mockApi();
    const onArm = vi.fn();
    render(
      <PackReportRenderer report={{ ...reportFixture(), canArm: true }} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} onArm={onArm} />
    );
    const arm = screen.getByTestId('report-arm');
    expect(arm.textContent).toBe('Quarantine 1 candidate(s)…');
    expect((arm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(arm);
    expect(onArm).toHaveBeenCalledTimes(1);

    const keepOnly = reportFixture();
    keepOnly.items = keepOnly.items.filter((item) => item.verdict !== 'candidate');
    window.electronAPI.getMiniAppRunDirectory = directoryMockFor(keepOnly.items);
    cleanup();
    render(
      <PackReportRenderer report={{ ...keepOnly, canArm: true }} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} onArm={onArm} />
    );
    await waitFor(() => expect((screen.getByTestId('report-arm') as HTMLButtonElement).disabled).toBe(true));
  });
});

describe('PackReportRenderer — Files-tab chrome budget (plan 52 S2)', () => {
  const paneChildrenTestids = (container: HTMLElement): string[] =>
    Array.from(container.querySelector('[data-testid="report-files-pane"]')?.children ?? []).map(
      (child) => (child as HTMLElement).getAttribute('data-testid') ?? ''
    );

  it('a flat run renders exactly 2 toolbar rows + 1 compact context line before the results, with no navigation chrome', async () => {
    mockApi();
    const { container } = render(
      <PackReportRenderer report={reportFixture()} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findAllByTestId('report-files-table');
    expect(paneChildrenTestids(container)).toEqual(['report-toolbar-row-1', 'report-toolbar-row-2', 'report-context-line', 'report-files-body']);
    expect(screen.queryByTestId('directory-tree')).toBeNull();
    expect(screen.queryByTestId('dir-crumb-root')).toBeNull();
    expect(screen.getByTestId('report-context-facts').textContent).toBe('Root folder · 4 file(s) · — · 2 ask');
    expect(screen.getByTestId('dir-add-rule').textContent).toBe('Add ** to keep rules');
    const facets = container.querySelector('[data-testid="report-toolbar-row-2"] [data-testid="surface"]') as HTMLElement;
    expect(facets.className).toContain('flex');
    expect(facets.children.length).toBe(2);
  });

  it('a deep run keeps the tree rail and folds folder actions onto the single breadcrumb context row', async () => {
    mockApi();
    window.electronAPI.getMiniAppRunTree = vi.fn(async () => ({
      runId: 'run-1',
      directories: [
        { path: '', directCounts: { keep: 0, ask: 0, candidate: 0 }, totalCounts: { keep: 1, ask: 1, candidate: 1 }, sizeByVerdict: { keep: 0, ask: 0, candidate: 0 }, totalSizeByVerdict: { keep: 10, ask: 10, candidate: 10 } },
        { path: 'src', directCounts: { keep: 0, ask: 0, candidate: 0 }, totalCounts: { keep: 1, ask: 1, candidate: 1 }, sizeByVerdict: { keep: 0, ask: 0, candidate: 0 }, totalSizeByVerdict: { keep: 10, ask: 10, candidate: 10 } },
        { path: 'src/assets', directCounts: { keep: 1, ask: 1, candidate: 1 }, totalCounts: { keep: 1, ask: 1, candidate: 1 }, sizeByVerdict: { keep: 10, ask: 10, candidate: 10 }, totalSizeByVerdict: { keep: 10, ask: 10, candidate: 10 } },
      ],
    })) as unknown as typeof window.electronAPI.getMiniAppRunTree;
    const { container } = render(
      <PackReportRenderer report={reportFixture()} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findAllByTestId('report-files-table');
    expect(paneChildrenTestids(container)).toEqual(['report-toolbar-row-1', 'report-toolbar-row-2', 'report-context-line', 'report-files-body']);
    expect(screen.getByTestId('directory-tree')).toBeTruthy();
    expect(screen.getByTestId('dir-crumb-root')).toBeTruthy();
    expect(screen.queryByTestId('report-context-facts')).toBeNull();
    const contextRow = screen.getByTestId('report-context-line');
    expect(within(contextRow).getByTestId('dir-keep-all')).toBeTruthy();
    expect(within(contextRow).getByTestId('dir-exclude-all')).toBeTruthy();
    expect(within(contextRow).queryByTestId('dir-add-rule')).toBeNull();
  });
});

describe('PackReportRenderer — tabbed shell (plan 51 S3.2)', () => {
  it('serves Overview (rings + totals + stats), Files (table) and Review (queue) from one shell', async () => {
    mockApi();
    render(
      <PackReportRenderer report={reportFixture()} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    const tabs = screen.getByRole('tablist');
    expect(tabs).toBeTruthy();
    expect(screen.getByTestId('pack-verdict-rings')).toBeTruthy();
    expect(screen.getByText(/4 scanned · 1 keep · 2 ask · 1 candidate/)).toBeTruthy();
    expect(screen.getByText('Files scanned')).toBeTruthy();
    expect(screen.queryByText('cache/junk.tmp')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect((await screen.findAllByTestId('report-files-table')).length).toBeGreaterThan(0);
    expect(screen.getByText('cache/junk.tmp')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Review (2)' }));
    expect(await screen.findByText(/Review — 2 items to decide/)).toBeTruthy();
  });

  it('keeps the header row (status + export) above the tabs on every tab', async () => {
    mockApi();
    render(
      <PackReportRenderer report={reportFixture()} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    expect(screen.getByTestId('report-status-badge')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export Markdown' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findAllByTestId('report-files-table');
    expect(screen.getByTestId('report-status-badge')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export Markdown' })).toBeTruthy();
  });
});

describe('PackReportRenderer — rings (plan 51 S3.1)', () => {
  it('renders verdict + decision-source rings with accessible legends', async () => {
    mockApi();
    const { container } = render(
      <PackReportRenderer report={reportFixture()} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    const rings = screen.getByTestId('pack-verdict-rings');
    expect(rings.querySelectorAll('svg').length).toBe(2);
    expect(screen.getByRole('img', { name: 'Verdict distribution: 1 keep, 2 ask, 1 candidate' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Decision sources: 1 by rules, 3 by the model, 1 cache hits' })).toBeTruthy();
    await scanNoViolations(container);
  });
});

describe('PackReportRenderer — name-block rows (plan 52 S3.2)', () => {
  it('composes the meta line on the row: verdict chip, tiny size, evidence chip — confidence lives in the popup (plan 53 review)', async () => {
    await openFilesTab();
    const row = screen.getByTestId('report-row-cache/junk.tmp');
    expect(screen.getByTestId('report-verdict-cache/junk.tmp').textContent).toBe('candidate');
    expect(screen.queryByTestId('report-confidence-cache/junk.tmp')).toBeNull();
    expect(row.textContent).toContain('2.0 KB');
    expect(row.textContent).toContain('Build cache');
    const name = row.querySelector('.line-clamp-3') as HTMLElement;
    expect(name).toBeTruthy();
    expect(name.className).toContain('[overflow-wrap:anywhere]');
    expect(name.getAttribute('title')).toBe('cache/junk.tmp');
    expect(name.textContent).toBe('cache/junk.tmp');
  });

  it('carries one primary quick action per verdict; the rest live in the popup', async () => {
    const onOverride = vi.fn(async () => undefined);
    render(
      <PackReportRenderer report={reportFixture()} onOverride={onOverride} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findAllByTestId('report-files-table');
    fireEvent.click(screen.getByTestId('report-override-keep-cache/junk.tmp'));
    await waitFor(() => expect(onOverride).toHaveBeenCalledWith('cache/junk.tmp', 'keep'));
    expect(screen.queryByTestId('report-override-exclude-cache/junk.tmp')).toBeNull();
    expect(screen.queryByTestId('report-override-candidate-cache/junk.tmp')).toBeNull();
    fireEvent.click(screen.getByTestId('report-override-candidate-fresh.txt'));
    await waitFor(() => expect(onOverride).toHaveBeenCalledWith('fresh.txt', 'candidate'));
    expect(screen.queryByTestId('report-override-keep-fresh.txt')).toBeNull();
    expect(screen.queryByTestId('report-override-exclude-fresh.txt')).toBeNull();
  });

  it('opens the popup from a row click or the name control, with the invoking control as the focus-return anchor', async () => {
    await openFilesTab();
    fireEvent.click(screen.getByTestId('report-row-cache/junk.tmp'));
    expect(screen.getByTestId('item-drawer')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('data-testid')).toBe('report-info-cache/junk.tmp');
    });
    fireEvent.click(screen.getByTestId('report-name-fresh.txt'));
    expect(screen.getByTestId('item-drawer')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('data-testid')).toBe('report-name-fresh.txt');
    });
  });

  it('subdues zero-count filter chips but keeps them visible (plan 52 S3.4)', async () => {
    mockApi();
    const noCandidates = reportFixture();
    noCandidates.items = noCandidates.items.filter((item) => item.verdict !== 'candidate');
    window.electronAPI.getMiniAppRunDirectory = directoryMockFor(noCandidates.items);
    render(
      <PackReportRenderer report={noCandidates} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findAllByTestId('report-files-table');
    const chip = screen.getByTestId('surface-filter-verdict-candidate');
    expect(chip.textContent).toBe('candidate (0)');
    expect(chip.className).toContain('opacity-50');
    expect(screen.getByTestId('surface-filter-verdict-ask').className).not.toContain('opacity-50');
  });

  it('names the search scope in the placeholder (plan 52 S3.4)', async () => {
    await openFilesTab();
    expect(screen.getByPlaceholderText('Search this folder')).toBeTruthy();
  });
});

describe('PackReportRenderer — structured columns, sort, group, facet counts (plan 51 S3.5/S3.6)', () => {
  it('sorts by size and groups by category with group headings', async () => {
    await openFilesTab();
    fireEvent.click(within(screen.getByTestId('report-sort')).getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Size' }));
    const rows = screen.getAllByTestId(/^report-row-/);
    expect(rows.length).toBe(4);
    fireEvent.click(within(screen.getByTestId('report-group')).getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Category' }));
    expect(screen.getByTestId('report-group-heading-Temporary')).toBeTruthy();
    expect(screen.getAllByTestId(/^report-row-/).length).toBe(4);
  });

  it('shows per-facet counts on the verdict filter chips and filters rows', async () => {
    await openFilesTab();
    fireEvent.click(screen.getByRole('button', { name: 'candidate (1)' }));
    await waitFor(() => {
      expect(screen.queryByTestId('report-row-fresh.txt')).toBeNull();
    });
    expect(screen.getByTestId('report-row-cache/junk.tmp')).toBeTruthy();
  });

  it('filters by the decidedBy select node', async () => {
    await openFilesTab();
    fireEvent.change(screen.getByTestId('surface-select-decidedByKind'), { target: { value: 'engine' } });
    expect(screen.getByTestId('report-row-cache/junk.tmp')).toBeTruthy();
    expect(screen.queryByTestId('report-row-fresh.txt')).toBeNull();
  });
});

describe('PackReportRenderer — fit-by-design laws (plan 51 S3.3)', () => {
  it.each(['sm', 'md', 'lg'] as const)('at width class %s the table fits (no horizontal scroll) and primary columns are present', async (widthClass) => {
    await openFilesTab();
    const tables = await screen.findAllByTestId('report-files-table');
    const table = tables[0];
    expect(table.querySelector('table')?.className).toContain('table-fixed');
    expect(table.querySelector('table')?.className).toContain('w-full');
    expect(table.className).not.toContain('overflow-x-auto');
    expect(paneWidthClass(100)).toBe('sm');
    expect(paneWidthClass(500)).toBe('md');
    expect(paneWidthClass(900)).toBe('lg');
    void widthClass;
  });

  it('the width matrix retires the secondary columns entirely — the name block carries the row (plan 52 S3.3)', async () => {
    await openFilesTab();
    const headers = Array.from(screen.getAllByRole('columnheader')).map((node) => node.textContent);
    expect(headers.length).toBeGreaterThanOrEqual(2);
    expect(headers.every((header) => header === 'File' || header === 'Actions')).toBe(true);
    expect(screen.queryByText('Decided by: engine:llm')).toBeNull();
  });

  it('the table fits by design: no percentage+fixed width sum overflows the fixed layout, actions wrap (plan 52 review)', async () => {
    const container = await openFilesTab();
    const headers = Array.from(container.querySelectorAll('thead th')) as HTMLElement[];
    const widthClasses = headers.map((th) => (th.className.match(/w-\S+/) ?? [])[0] ?? '');
    expect(widthClasses.some((width) => width === 'w-full')).toBe(false);
    expect(widthClasses.at(-1)).toBe('w-24');
    const actionsCell = container.querySelector('tbody td:last-child span');
    expect(actionsCell?.className).toContain('flex-wrap');
  });
});

describe('PackItemDrawer (plan 51 S3.8)', () => {
  it('opens with the popup chrome law: header and actions live outside the scrollable body', async () => {
    await openFilesTab();
    fireEvent.click(screen.getByTestId('report-info-cache/junk.tmp'));
    const drawer = screen.getByTestId('item-drawer');
    expect(drawer.getAttribute('role')).toBe('dialog');
    expect(drawer.getAttribute('aria-modal')).toBe('false');
    const scrolling = Array.from(drawer.children).find((child) => (child as HTMLElement).className.includes('overflow-y-auto')) as HTMLElement;
    expect(scrolling).toBeTruthy();
    expect(scrolling.contains(screen.getByTestId('drawer-close'))).toBe(false);
    expect(scrolling.textContent).toContain('Safe to delete?');
    expect(scrolling.textContent).toContain('Temporary');
    const footer = Array.from(drawer.children).at(-1) as HTMLElement;
    expect(footer.className).not.toContain('overflow-y-auto');
    expect(within(footer).getByRole('button', { name: 'Keep' })).toBeTruthy();
    expect(within(footer).getByRole('button', { name: 'Show in folder' })).toBeTruthy();
  });

  it('closes on Escape and on ✕, and returns focus to the invoking row button', async () => {
    await openFilesTab();
    fireEvent.click(screen.getByTestId('report-info-weird.bin'));
    const drawer = screen.getByTestId('item-drawer');
    expect(drawer).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('item-drawer')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('data-testid')).toBe('report-info-weird.bin');
    });
    fireEvent.click(screen.getByTestId('report-info-weird.bin'));
    fireEvent.click(screen.getByTestId('drawer-close'));
    expect(screen.queryByTestId('item-drawer')).toBeNull();
  });

  it('falls back to a raw JSON block for unknown evidence shapes', async () => {
    await openFilesTab();
    fireEvent.click(screen.getByTestId('report-info-mystery.dat'));
    const drawer = screen.getByTestId('item-drawer');
    expect(drawer.textContent).toContain('No evidence was recorded');
  });

  it('applies overrides from the drawer footer', async () => {
    const onOverride = vi.fn(async () => undefined);
    render(
      <PackReportRenderer report={reportFixture()} onOverride={onOverride} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findAllByTestId('report-files-table');
    fireEvent.click(screen.getByTestId('report-info-mystery.dat'));
    const drawer = screen.getByTestId('item-drawer');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(onOverride).toHaveBeenCalledWith('mystery.dat', 'keep'));
  });
});

describe('PackItemDrawer — the facts home (plan 52 S3.3)', () => {
  it('uses the project popup theme: solid raised surface, modal radius and shadow', async () => {
    await openFilesTab();
    fireEvent.click(screen.getByTestId('report-info-cache/junk.tmp'));
    const drawer = screen.getByTestId('item-drawer');
    expect(drawer.className).toContain('bg-[var(--as-surface-raised)]');
    expect(drawer.className).not.toMatch(/bg-\[var\(--as-surface\)\]/);
    expect(drawer.className).toContain('rounded-[var(--as-radius-lg)]');
    expect(drawer.className).toContain('shadow-[var(--as-shadow-3)]');
  });

  it('carries the full directory with the directory segment emphasized, and the labeled facts', async () => {
    await openFilesTab();
    fireEvent.click(screen.getByTestId('report-info-cache/junk.tmp'));
    const drawer = screen.getByTestId('item-drawer');
    const folder = screen.getByTestId('drawer-fact-folder');
    expect(folder.textContent).toContain('cache/');
    expect(folder.textContent).toContain('junk.tmp');
    expect(folder.querySelector('.font-medium')?.textContent).toBe('cache/');
    expect(folder.querySelector('[title="cache/junk.tmp"]')).toBeTruthy();
    expect(screen.getByTestId('drawer-fact-size').textContent).toContain('2.0 KB');
    expect(screen.getByTestId('drawer-fact-age').textContent).toContain('40 d');
    expect(screen.getByTestId('drawer-fact-category').textContent).toContain('Temporary');
    expect(screen.getByTestId('drawer-fact-confidence')).toBeTruthy();
    const decided = screen.getByTestId('drawer-fact-decidedBy');
    expect(decided.textContent).toContain('model');
    expect(decided.querySelector('[title="engine:llm"]')).toBeTruthy();
  });

  it('keeps Open folder / Open file prominent in the pinned footer', async () => {
    await openFilesTab();
    fireEvent.click(screen.getByTestId('report-info-cache/junk.tmp'));
    const footer = Array.from(screen.getByTestId('item-drawer').children).at(-1) as HTMLElement;
    const reveal = within(footer).getByTestId('drawer-reveal');
    const open = within(footer).getByTestId('drawer-open');
    expect(reveal.textContent).toContain('Show in folder');
    expect(open.textContent).toContain('Open');
    expect(reveal.className).toContain('outline');
    expect(open.className).toContain('outline');
    const firstButtons = Array.from(footer.querySelectorAll('button')).slice(0, 3);
    expect(firstButtons.map((button) => button.getAttribute('data-testid'))).toEqual(['drawer-ask-again', 'drawer-reveal', 'drawer-open']);
  });

  it('the footer still carries the full override set, including exclude', async () => {
    const onOverride = vi.fn(async () => undefined);
    render(
      <PackReportRenderer report={reportFixture()} onOverride={onOverride} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findAllByTestId('report-files-table');
    fireEvent.click(screen.getByTestId('report-info-cache/junk.tmp'));
    const footer = Array.from(screen.getByTestId('item-drawer').children).at(-1) as HTMLElement;
    fireEvent.click(within(footer).getByRole('button', { name: 'Exclude' }));
    await waitFor(() => expect(onOverride).toHaveBeenCalledWith('cache/junk.tmp', 'exclude'));
  });

  it('Ask again sends the item back to the review queue (plan 54 follow-up)', async () => {
    const onOverride = vi.fn(async () => undefined);
    render(
      <PackReportRenderer report={reportFixture()} onOverride={onOverride} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findAllByTestId('report-files-table');
    fireEvent.click(screen.getByTestId('report-info-fresh.txt'));
    fireEvent.click(screen.getByTestId('drawer-ask-again'));
    await waitFor(() => expect(onOverride).toHaveBeenCalledWith('fresh.txt', 'ask'));
  });

  it('a root-level file renders no directory segment', async () => {
    await openFilesTab();
    fireEvent.click(screen.getByTestId('report-info-fresh.txt'));
    const folder = screen.getByTestId('drawer-fact-folder');
    expect(folder.querySelector('.font-medium')).toBeNull();
    expect(folder.textContent).toContain('fresh.txt');
  });
});

describe('PackReportRenderer — pagination (plan 31 S2, main-paged listing)', () => {
  function bigFixture(itemCount: number): MiniAppRunReportView {
    const base = reportFixture();
    return {
      ...base,
      items: Array.from({ length: itemCount }, (_, index) => ({
        relPath: `bulk/file-${String(index).padStart(3, '0')}.tmp`,
        verdict: (index % 2 === 0 ? 'keep' : 'ask') as 'keep' | 'ask',
        confidence: index % 2 === 0 ? 0.8 : null,
        decidedBy: 'engine:llm',
        evidence: null,
      })),
    };
  }

  it('renders 200 rows per page; the pager walks without mounting everything', async () => {
    mockApi();
    window.electronAPI.getMiniAppRunDirectory = directoryMockFor(bigFixture(450).items) as unknown as typeof window.electronAPI.getMiniAppRunDirectory;
    render(
      <PackReportRenderer report={bigFixture(450)} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findAllByTestId('report-files-table');
    const rowsOnPage = (): number => document.querySelectorAll('tbody tr').length;
    expect(rowsOnPage()).toBe(200);
    fireEvent.click(screen.getByTestId('dir-next'));
    await waitFor(() => expect(screen.getByTestId('dir-page-status').textContent).toContain('Page 2 of 3'));
    expect(rowsOnPage()).toBe(200);
    fireEvent.click(screen.getByTestId('dir-next'));
    await waitFor(() => expect(rowsOnPage()).toBe(50));
    expect((screen.getByTestId('dir-next') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('dir-page-status').textContent).toContain('450 files');
  });

  it('resets to the first page when the verdict filter changes', async () => {
    mockApi();
    window.electronAPI.getMiniAppRunDirectory = directoryMockFor(bigFixture(450).items) as unknown as typeof window.electronAPI.getMiniAppRunDirectory;
    render(
      <PackReportRenderer report={bigFixture(450)} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findAllByTestId('report-files-table');
    expect(document.querySelectorAll('tbody tr')).toHaveLength(200);
    fireEvent.click(screen.getByTestId('dir-next'));
    await waitFor(() => expect(screen.getByTestId('dir-page-status').textContent).toContain('Page 2 of 3'));
    fireEvent.click(screen.getByRole('button', { name: /keep \(225\)/ }));
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr')).toHaveLength(200);
    });
    expect(screen.getByTestId('dir-page-status').textContent).toContain('225 files');
  });

  it('is axe-clean with the pager present', { timeout: 30_000 }, async () => {
    mockApi();
    window.electronAPI.getMiniAppRunDirectory = directoryMockFor(bigFixture(450).items) as unknown as typeof window.electronAPI.getMiniAppRunDirectory;
    const { container } = render(
      <PackReportRenderer report={bigFixture(450)} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findAllByTestId('report-files-table');
    await waitFor(() => expect(screen.getByTestId('dir-page-status').textContent).toContain('450 files'));
    expect(screen.getByTestId('dir-next')).toBeTruthy();
    await scanNoViolations(container);
  });
});

describe('PackReportRenderer — review queue + axe (plan 26 S5, tab shell)', () => {
  it('the review queue is served by the paged verdict=ask query, never the capped view', async () => {
    mockApi();
    const onOverride = vi.fn(async () => undefined);
    render(
      <PackReportRenderer report={reportFixture()} onOverride={onOverride} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Review (2)' }));
    await waitFor(() => expect(window.electronAPI.getMiniAppRunDirectory).toHaveBeenCalledWith('run-1', '', 1, 'ask'));
  });

  it('the review queue lists ask items and overrides persist via IPC', async () => {
    mockApi();
    const onOverride = vi.fn(async () => undefined);
    render(
      <PackReportRenderer report={reportFixture()} onOverride={onOverride} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Review (2)' }));
    const queue = await screen.findByText(/Review — 2 items to decide/);
    expect(queue).toBeTruthy();
    const mysteryRow = screen
      .getAllByText('mystery.dat')
      .map((node) => node.closest('li'))
      .find((li) => li !== null && within(li).queryByRole('button', { name: 'Keep' }) !== null) as HTMLElement;
    fireEvent.click(within(mysteryRow).getByRole('button', { name: 'Keep' }));
    await waitFor(() => {
      expect(onOverride).toHaveBeenCalledWith('mystery.dat', 'keep');
    });
  });

  it('an empty review tab renders an honest empty state', async () => {
    mockApi();
    const base = reportFixture();
    const withoutAsks = base.items.filter((item) => item.verdict !== 'ask');
    window.electronAPI.getMiniAppRunDirectory = directoryMockFor(withoutAsks) as unknown as typeof window.electronAPI.getMiniAppRunDirectory;
    render(
      <PackReportRenderer
        report={{ ...base, items: withoutAsks }}
        onOverride={vi.fn(async () => undefined)}
        onReveal={vi.fn(async () => undefined)}
        onOpen={vi.fn(async () => undefined)}
        onRestore={vi.fn(async () => undefined)}
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Review (0)' }));
    expect(await screen.findByText(/Nothing to review/)).toBeTruthy();
  });

  it('is axe-clean across tabs with the drawer open', { timeout: 30_000 }, async () => {
    mockApi();
    const { container } = render(
      <PackReportRenderer report={reportFixture()} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findAllByTestId('report-files-table');
    fireEvent.click(screen.getByTestId('report-info-cache/junk.tmp'));
    await screen.findByTestId('item-drawer');
    await scanNoViolations(container);
  });
});

describe('RunReportModal (plan 26 S5)', () => {
  it('loads the report over IPC and renders it with no axe violations', async () => {
    mockApi();
    const { container } = render(<RunReportModal runId="run-1" onClose={vi.fn()} />);
    await screen.findByTestId('pack-verdict-rings');
    await scanNoViolations(container);
  });

  it('shows the run execution summary and stops a running run from the header (plan 54)', async () => {
    mockApi();
    const base = reportFixture();
    window.electronAPI.miniAppRunReport = vi.fn(async () => ({ ...base, run: { ...base.run, status: 'running', finishedAt: null } })) as unknown as typeof window.electronAPI.miniAppRunReport;
    render(<RunReportModal runId="run-1" onClose={vi.fn()} />);
    const summary = await screen.findByTestId('run-summary');
    expect(summary.textContent).toContain('OpenRouter · jev-1');
    expect(summary.textContent).toContain('Elapsed');
    fireEvent.click(screen.getByTestId('run-action-stop'));
    await waitFor(() => expect(window.electronAPI.cancelMiniAppRun).toHaveBeenCalledWith('run-1'));
    await waitFor(() => expect(window.electronAPI.miniAppRunReport).toHaveBeenCalledTimes(2));
  });

  it('offers restart on a settled report header (plan 54)', async () => {
    mockApi();
    render(<RunReportModal runId="run-1" onClose={vi.fn()} />);
    await screen.findByTestId('run-summary');
    fireEvent.click(screen.getByTestId('run-action-restart'));
    await waitFor(() => expect(window.electronAPI.startMiniAppRun).toHaveBeenCalledWith('sample-review', '/home/tester/projects/demo'));
  });
});

describe('ArmModal (plan 26 S6)', () => {
  it('renders the gated proposal grouped by category with no axe violations; resolve approves via IPC', async () => {
    mockApi();
    window.electronAPI.armMiniAppRun = vi.fn(async () => ({
      ok: true,
      proposal: {
        id: 'prop-1',
        payload: {
          items: [
            { relPath: 'logs/a.log', confidence: 0.95, category: 'logs' },
            { relPath: 'tmp/b.tmp', confidence: 0.9, category: null },
          ],
        },
      },
    })) as unknown as typeof window.electronAPI.armMiniAppRun;
    const resolve = vi.fn(async () => ({ ok: true, outcome: [{ relPath: 'logs/a.log', outcome: 'moved' }, { relPath: 'tmp/b.tmp', outcome: 'moved' }] }));
    window.electronAPI.resolveMiniAppProposal = resolve as unknown as typeof window.electronAPI.resolveMiniAppProposal;
    const { container } = render(<ArmModal runId="run-1" onClose={vi.fn()} onChanged={vi.fn(async () => undefined)} />);
    expect(await screen.findByText('logs/a.log')).toBeTruthy();
    expect(screen.getByText('logs')).toBeTruthy();
    await scanNoViolations(container);
    fireEvent.click(screen.getByRole('button', { name: 'Move to quarantine' }));
    await waitFor(() => {
      expect(resolve).toHaveBeenCalledWith('prop-1', true);
    });
    expect(await screen.findByText(/2 moved/)).toBeTruthy();
  });
  it('shows the reclaimable-space line on Overview (plan 51 S4.4)', async () => {
    mockApi();
    window.electronAPI.miniAppQuarantineStatus = vi.fn(async () => ({ total: 2, restorable: 2, bytes: 5000 })) as unknown as typeof window.electronAPI.miniAppQuarantineStatus;
    render(
      <PackReportRenderer report={reportFixture()} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    const line = await screen.findByTestId('report-reclaim-line');
    expect(line.textContent).toContain('2.0 KB');
    expect(line.textContent).toContain('4.9 KB');
    expect(screen.queryByTestId('report-digest')).toBeNull();
  });

  it('renders the AI digest on Overview when one was produced (plan 51 S6.1)', async () => {
    mockApi();
    window.electronAPI.miniAppQuarantineStatus = vi.fn(async () => ({ total: 0, restorable: 0, bytes: 0 })) as unknown as typeof window.electronAPI.miniAppQuarantineStatus;
    window.electronAPI.getMiniAppRunDigest = vi.fn(async () => 'Candidates cluster in src/generated; the 3 asks are small odd files.') as unknown as typeof window.electronAPI.getMiniAppRunDigest;
    render(
      <PackReportRenderer report={reportFixture()} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} onRestore={vi.fn(async () => undefined)} />
    );
    const digest = await screen.findByTestId('report-digest');
    expect(digest.textContent).toContain('AI digest');
    expect(digest.textContent).toContain('Candidates cluster in src/generated');
    expect(digest.textContent).toContain('AI-generated — check it against the numbers');
  });

  it('renders the arm card copy varies by destination (plan 51 S4.7)', async () => {
    mockApi();
    window.electronAPI.armMiniAppRun = vi.fn(async () => ({
      ok: true,
      proposal: {
        id: 'prop-trash',
        payload: {
          destination: 'system-trash',
          items: [{ relPath: 'logs/a.log', confidence: 0.95, category: 'logs' }],
        },
      },
    })) as unknown as typeof window.electronAPI.armMiniAppRun;
    window.electronAPI.resolveMiniAppProposal = vi.fn(async () => ({ ok: true, executed: false })) as unknown as typeof window.electronAPI.resolveMiniAppProposal;
    render(<ArmModal runId="run-1" onClose={vi.fn()} onChanged={vi.fn(async () => undefined)} />);
    const body = await screen.findByTestId('arm-destination-body');
    expect(body.textContent).toContain('system trash');
    expect(body.textContent).toContain('you restore them from your file manager');
    expect(screen.getByTestId('arm-confirm').textContent).toBe('Move to system trash');
  });
});
