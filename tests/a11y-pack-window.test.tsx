// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import type { MiniAppRunReportView } from '@shared/app-pack';

beforeAll(() => {
  if (!('ResizeObserver' in window)) {
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(cleanup);

const REPORT: MiniAppRunReportView = {
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
  packTitle: 'Sample review',
  items: [
    { relPath: 'cache/junk.tmp', verdict: 'candidate', confidence: 0.91, decidedBy: 'engine:llm', evidence: { rule: 'cache', answers: { safe: 'yes' } } },
    { relPath: 'fresh.txt', verdict: 'keep', confidence: null, decidedBy: 'rule:fresh', evidence: null },
  ],
  reportNodes: [
    { id: 'status', type: 'badge', bind: 'run.status' },
    { id: 'total', type: 'stat', bind: 'totals.scanned' },
    { id: 'bar', type: 'progress', bind: 'run.progress' },
    { id: 'filters', type: 'filter-bar', filters: ['verdict'] },
    { id: 'items', type: 'table', columns: ['path', 'verdict', 'confidence', 'decidedBy'] },
    { id: 'ev', type: 'evidence' },
  ],
  labels: { 'report.total': 'Files scanned', 'rule.cache': 'Build cache' },
  canArm: false,
  windowSupported: true,
};

function mockApi(): void {
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ theme: 'classic' })),
    minimizeWindow: vi.fn(),
    closeWindow: vi.fn(),
    miniAppRunReport: vi.fn(async () => REPORT),
    overrideMiniAppItem: vi.fn(async () => ({ ok: true })),
    excludeMiniAppItem: vi.fn(async () => ({ ok: true })),
    revealMiniAppItem: vi.fn(async () => ({ ok: true })),
    openMiniAppItem: vi.fn(async () => ({ ok: true })),
    restoreMiniAppItem: vi.fn(async () => ({ ok: true, restoredPath: '/x' })),
    exportMiniAppRun: vi.fn(async () => ({ ok: true, text: 'x', fileName: 'x.md' })),
    saveFile: vi.fn(async () => ({ ok: true })),
  } as unknown as typeof window.electronAPI;
}

describe('PackWindowApp (ui:window surface host) — a11y smoke', () => {
  it('renders the report with no axe violations (the family a11y bar)', async () => {
    mockApi();
    const { PackWindowApp } = await import('@renderer/pack-window-react/PackWindowApp');
    const { container } = render(<PackWindowApp />);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Files scanned');
    });
    const results = await axe.run(container);
    const summary = results.violations
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
      .join('\n');
    expect(summary).toBe('');
  });

  it('surfaces a missing report under role=status without violations', async () => {
    mockApi();
    window.electronAPI.miniAppRunReport = vi.fn(async () => null) as unknown as typeof window.electronAPI.miniAppRunReport;
    const { PackWindowApp } = await import('@renderer/pack-window-react/PackWindowApp');
    const { container } = render(<PackWindowApp />);
    await waitFor(() => {
      expect(document.body.textContent).toContain('no longer available');
    });
    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });
});
