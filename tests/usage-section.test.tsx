// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { UsageSection } from '@renderer/settings-react/tools/UsageSection';
import type { ToolUsageStats } from '@shared/toolUsage';

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

afterEach(cleanup);

function stats(overrides: Partial<ToolUsageStats> = {}): ToolUsageStats {
  return {
    windowDays: 30,
    total: 5,
    rows: [
      {
        tool: 'web_fetch',
        total: 4,
        ok: 3,
        errors: 1,
        denied: 0,
        approvals: { auto: 3, once: 1 },
        avgDurationMs: 150,
        lastUsedAt: '2026-09-15T10:00:00.000Z',
      },
      { tool: 'run_shell', total: 1, ok: 0, errors: 0, denied: 1, approvals: { denied: 1 }, avgDurationMs: 0, lastUsedAt: '2026-09-14T10:00:00.000Z' },
    ],
    recentFailures: [{ tool: 'web_fetch', outcome: 'error', approvedBy: 'once', at: '2026-09-15T10:00:00.000Z' }],
    ...overrides,
  };
}

describe('UsageSection', () => {
  it('renders per-tool bars, counts and the failures list', async () => {
    window.electronAPI = { getToolUsageStats: vi.fn(async () => stats()) } as unknown as typeof window.electronAPI;
    render(<UsageSection />);
    await screen.findAllByText('web_fetch');
    expect(screen.getByText('run_shell')).toBeTruthy();
    expect(screen.getByText('5 audited calls')).toBeTruthy();
    expect(screen.getByText('Recent failures')).toBeTruthy();
    expect(screen.getByRole('meter', { name: 'web_fetch: 4 calls' })).toBeTruthy();
  });

  it('switches the stats window through the IPC', async () => {
    const getToolUsageStats = vi.fn(async (days: number | null) => stats({ windowDays: days }));
    window.electronAPI = { getToolUsageStats } as unknown as typeof window.electronAPI;
    render(<UsageSection />);
    await screen.findAllByText('web_fetch');
    fireEvent.click(screen.getByRole('radio', { name: '7d' }));
    await waitFor(() => {
      expect(getToolUsageStats).toHaveBeenCalledWith(7);
    });
    fireEvent.click(screen.getByRole('radio', { name: 'all' }));
    await waitFor(() => {
      expect(getToolUsageStats).toHaveBeenCalledWith(null);
    });
  });

  it('shows the empty and error states', async () => {
    window.electronAPI = { getToolUsageStats: vi.fn(async () => stats({ rows: [], total: 0, recentFailures: [] })) } as unknown as typeof window.electronAPI;
    const { container } = render(<UsageSection />);
    await screen.findByText('No tool activity in this window yet.');
    expect(container.querySelector('[role="meter"]')).toBeNull();

    window.electronAPI.getToolUsageStats = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof window.electronAPI.getToolUsageStats;
    fireEvent.click(screen.getByRole('radio', { name: '7d' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be loaded');
  });

  it('is axe-clean with data', async () => {
    window.electronAPI = { getToolUsageStats: vi.fn(async () => stats()) } as unknown as typeof window.electronAPI;
    const { container } = render(
      <main>
        <UsageSection />
      </main>
    );
    await screen.findAllByText('web_fetch');
    const results = await axe.run(container);
    const componentViolations = results.violations.filter(
      (violation) => !['document-title', 'html-has-lang'].includes(violation.id)
    );
    expect(componentViolations).toEqual([]);
  });
});
