// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { RunReportModal, PackReportRenderer } from '@renderer/settings-react/apps/RunReportModal';
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
      startedAt: 1,
      updatedAt: 2,
      finishedAt: 3,
    },
    items: [
      { relPath: 'cache/junk.tmp', verdict: 'candidate', confidence: 0.91, decidedBy: 'engine:llm', evidence: { rule: 'cache', list: 'candidate', answers: { safe: { type: 'choice', choice: 'yes', probabilities: { yes: 0.91 }, confidence: 0.91 } } } },
      { relPath: 'fresh.txt', verdict: 'keep', confidence: null, decidedBy: 'rule:fresh', evidence: { rule: 'fresh', list: 'keep' } },
      { relPath: 'mystery.dat', verdict: 'ask', confidence: null, decidedBy: 'cache', evidence: null },
      { relPath: 'weird.bin', verdict: 'ask', confidence: null, decidedBy: 'rule:weird', evidence: { rule: 'weird', list: 'ask' } },
    ],
    reportNodes: [
      { id: 'status', type: 'badge', bind: 'run.status' },
      { id: 'total', type: 'stat', bind: 'totals.scanned' },
      { id: 'bar', type: 'progress', bind: 'run.progress' },
      { id: 'filters', type: 'filter-bar', filters: ['verdict'] },
      { id: 'items', type: 'table', columns: ['path', 'verdict', 'confidence', 'decidedBy'] },
      { id: 'ev', type: 'evidence' },
    ],
    labels: { 'report.total': 'Files scanned', 'rule.cache': 'Build cache', 'rule.fresh': 'Recently modified', 'rule.weird': 'Unusual' },
  };
}

function mockApi(): void {
  window.electronAPI = {
    miniAppRunReport: vi.fn(async () => reportFixture()),
    overrideMiniAppItem: vi.fn(async () => ({ ok: true })),
    excludeMiniAppItem: vi.fn(async () => ({ ok: true })),
    revealMiniAppItem: vi.fn(async () => ({ ok: true })),
    openMiniAppItem: vi.fn(async () => ({ ok: true })),
  } as unknown as typeof window.electronAPI;
}

async function scanNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
    .join('\n');
  expect(summary).toBe('');
}

describe('PackReportRenderer (plan 26 S5)', () => {
  it('renders the declarative schema: stats, totals line, table with evidence drilldown', async () => {
    mockApi();
    const { container } = render(
      <PackReportRenderer report={reportFixture()} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} />
    );
    expect(screen.getByText('Files scanned')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText(/4 scanned · 1 keep · 2 ask · 1 candidate/)).toBeTruthy();
    expect(screen.getByText('cache/junk.tmp')).toBeTruthy();
    expect(screen.getAllByText(/Evidence/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText(/Evidence/)[0]);
    expect(await screen.findByText(/"choice": "yes"/)).toBeTruthy();
    await scanNoViolations(container);
  });

  it('filter-bar filters the table by verdict', async () => {
    mockApi();
    render(<PackReportRenderer report={reportFixture()} onOverride={vi.fn(async () => undefined)} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} />);
    expect(screen.getByText('fresh.txt')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'candidate' }));
    await waitFor(() => {
      expect(screen.queryByText('fresh.txt')).toBeNull();
    });
    expect(screen.getByText('cache/junk.tmp')).toBeTruthy();
  });

  it('the review queue lists ask items and overrides persist via IPC', async () => {
    mockApi();
    const onOverride = vi.fn(async () => undefined);
    render(<PackReportRenderer report={reportFixture()} onOverride={onOverride} onReveal={vi.fn(async () => undefined)} onOpen={vi.fn(async () => undefined)} />);
    expect(screen.getByText(/Review — 2 items to decide/)).toBeTruthy();
    const mysteryRow = screen
      .getAllByText('mystery.dat')
      .map((node) => node.closest('li'))
      .find((li) => li !== null && within(li).queryByRole('button', { name: 'Keep' }) !== null) as HTMLElement;
    fireEvent.click(within(mysteryRow).getByRole('button', { name: 'Keep' }));
    await waitFor(() => {
      expect(onOverride).toHaveBeenCalledWith('mystery.dat', 'keep');
    });
    expect(screen.getByText(/Review — 1 items to decide/)).toBeTruthy();
  });
});

describe('RunReportModal (plan 26 S5)', () => {
  it('loads the report over IPC and renders it with no axe violations', async () => {
    mockApi();
    const { container } = render(<RunReportModal runId="run-1" onClose={vi.fn()} />);
    await screen.findByText('cache/junk.tmp');
    await scanNoViolations(container);
  });
});
