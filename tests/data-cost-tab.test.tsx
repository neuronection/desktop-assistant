// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { ElectronAPI } from '@shared/types';
import type { UsageReport } from '@shared/usage';
import { DataCostTab } from '@renderer/settings-react/tabs/DataCostTab';

afterEach(cleanup);

const report: UsageReport = {
  today: { calls: 2, inputTokens: 1_200, outputTokens: 300, costUsd: 0.0123, unpricedCalls: 0, partialTokenCalls: 0 },
  month: { calls: 9, inputTokens: 9_000, outputTokens: 2_000, costUsd: 0.081, unpricedCalls: 2, partialTokenCalls: 1 },
  byModel: [
    {
      model: 'gpt-5.1',
      providerId: 'p1',
      calls: 2,
      inputTokens: 1_200,
      outputTokens: 300,
      costUsd: 0.0123,
      unpricedCalls: 0,
      partialTokenCalls: 0,
    },
  ],
  recent: [
    {
      id: 'c1',
      task: 'chat',
      providerId: 'p1',
      model: 'gpt-5.1',
      resolvedModel: null,
      inputTokens: 1_000,
      outputTokens: 200,
      costUsd: 0.01,
      outcome: 'ok',
      createdAt: new Date('2026-11-11T09:00:00').toISOString(),
    },
  ],
  pricing: [],
};

describe('DataCostTab', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: Partial<ElectronAPI> }).electronAPI = {
      getUsageReport: vi.fn(async () => report),
    };
  });

  it('shows the totals and adds a price row through config', async () => {
    const onChange = vi.fn();
    render(<DataCostTab config={DEFAULT_CONFIG} onChange={onChange} />);
    expect((await screen.findAllByText('$0.0123')).length).toBeGreaterThan(0);
    expect(screen.getByText('≥ $0.0810')).toBeTruthy();
    expect(screen.getByText('By model')).toBeTruthy();
    expect(screen.getAllByText('gpt-5.1').length).toBeGreaterThan(0);
    expect(screen.getByText(/1 calls with partial token data/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
    expect(onChange).toHaveBeenCalledWith({
      usage: { pricing: [{ model: '', inputPerMillion: 0, outputPerMillion: 0 }] },
    });
  });

  it('disables Add model at the cap', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      usage: {
        pricing: Array.from({ length: 200 }, (_, index) => ({
          model: `model-${index}`,
          inputPerMillion: 1,
          outputPerMillion: 1,
        })),
      },
    };
    render(<DataCostTab config={config} onChange={vi.fn()} />);
    expect((await screen.findByRole('button', { name: 'Add model' })).hasAttribute('disabled')).toBe(true);
  });

  it('has no axe violations', async () => {
    const { container } = render(<DataCostTab config={DEFAULT_CONFIG} onChange={vi.fn()} />);
    await screen.findAllByText('$0.0123');
    const results = await axe.run(container);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
