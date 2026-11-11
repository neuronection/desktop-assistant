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
  today: { calls: 2, inputTokens: 1_200, outputTokens: 300, costUsd: 0.0123, unpricedCalls: 1 },
  month: { calls: 9, inputTokens: 9_000, outputTokens: 2_000, costUsd: 0.081, unpricedCalls: 2 },
  byModel: [],
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
    expect(await screen.findByText('$0.0123')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
    expect(onChange).toHaveBeenCalledWith({
      usage: { pricing: [{ model: '', inputPerMillion: 0, outputPerMillion: 0 }] },
    });
  });

  it('has no axe violations', async () => {
    const { container } = render(<DataCostTab config={DEFAULT_CONFIG} onChange={vi.fn()} />);
    await screen.findByText('$0.0123');
    const results = await axe.run(container);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
