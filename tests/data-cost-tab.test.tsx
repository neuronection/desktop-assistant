// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { LLMProviderType, type ElectronAPI } from '@shared/types';
import type { UsageReport } from '@shared/usage';
import { DataCostTab } from '@renderer/settings-react/tabs/DataCostTab';

afterEach(cleanup);

const report: UsageReport = {
  today: { calls: 2, inputTokens: 1_200, outputTokens: 300, costMicros: 12300, unpricedCalls: 0, partialTokenCalls: 0 },
  month: { calls: 9, inputTokens: 9_000, outputTokens: 2_000, costMicros: 81000, unpricedCalls: 2, partialTokenCalls: 1 },
  byModel: [
    {
      model: 'gpt-5.1',
      providerId: 'p1',
      calls: 2,
      inputTokens: 1_200,
      outputTokens: 300,
      costMicros: 12300,
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
      costMicros: 10000,
      outcome: 'ok',
      createdAt: new Date('2026-11-11T09:00:00').toISOString(),
    },
  ],
};

describe('DataCostTab', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: Partial<ElectronAPI> }).electronAPI = {
      getUsageReport: vi.fn(async () => report),
      getEgressLog: vi.fn(async () => [
        {
          id: 'e1',
          at: new Date('2026-11-11T09:00:00').toISOString(),
          host: 'api.openai.com',
          classification: 'public' as const,
          mode: 'strict-local' as const,
          allowed: false,
          method: 'POST',
        },
      ]),
      clearEgressLog: vi.fn(async () => true),
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
    fireEvent.click(screen.getByRole('tab', { name: 'Prices' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
    expect(onChange).toHaveBeenCalledWith({
      usage: {
        pricing: [{ model: '', inputMicrosPerMillion: 0, outputMicrosPerMillion: 0, match: 'exact' }],
        budget: { dailyMicros: null, monthlyMicros: null },
      },
    });
  });

  it('shows the vendored built-in rate and checked date for a configured model', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      providers: [
        {
          id: 'p1',
          name: 'OpenAI',
          type: LLMProviderType.OPENAI,
          apiKey: '',
          apiBase: 'https://api.openai.com/v1',
          timeout: 30_000,
          maxTokens: 1024,
          systemPrompt: '',
          presetKey: 'openai',
          availableModels: [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', providerType: LLMProviderType.OPENAI, providerId: 'p1' }],
        },
      ],
    };
    render(<DataCostTab config={config as never} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Prices' }));
    expect(screen.getByText('Built-in list prices')).toBeTruthy();
    expect(screen.getByText(/\$2\.0000 in \/ \$10\.0000 out per 1M/)).toBeTruthy();
    expect(screen.getByText(/checked 2026-11-11/)).toBeTruthy();
  });

  it('shows custom rows with micros-backed USD inputs and resets by removing the override', async () => {
    const onChange = vi.fn();
    const config = {
      ...DEFAULT_CONFIG,
      usage: {
        pricing: [
          { model: 'custom-model', inputMicrosPerMillion: 1_250_000, outputMicrosPerMillion: 10_000_000 },
        ],
      },
    };
    render(<DataCostTab config={config} onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Prices' }));
    expect(screen.getByText('Custom prices')).toBeTruthy();
    expect((screen.getByLabelText('Input $/1M 1') as HTMLInputElement).value).toBe('1.25');
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    expect(onChange).toHaveBeenCalledWith({ usage: { pricing: [] } });
  });

  it('disables Add model at the cap', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      usage: {
        pricing: Array.from({ length: 200 }, (_, index) => ({
          model: `model-${index}`,
          inputMicrosPerMillion: 1_000_000,
          outputMicrosPerMillion: 1_000_000,
        })),
      },
    };
    render(<DataCostTab config={config} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Prices' }));
    expect((await screen.findByRole('button', { name: 'Add model' })).hasAttribute('disabled')).toBe(true);
  });

  it('shows recent calls on their own tab', async () => {
    render(<DataCostTab config={DEFAULT_CONFIG} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Recent calls' }));
    expect(await screen.findByText('chat')).toBeTruthy();
    expect(screen.getByText('gpt-5.1')).toBeTruthy();
  });

  it('edits a budget cap through config', async () => {
    const onChange = vi.fn();
    render(<DataCostTab config={DEFAULT_CONFIG} onChange={onChange} />);
    fireEvent.change(await screen.findByLabelText('Daily cap'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith({
      usage: {
        pricing: [],
        budget: { dailyMicros: 5_000_000, monthlyMicros: null },
      },
    });
  });

  it('shows the egress log and clears it', async () => {
    render(<DataCostTab config={DEFAULT_CONFIG} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Network' }));
    expect(await screen.findByText('api.openai.com')).toBeTruthy();
    expect(screen.getByText('blocked')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear log' }));
    expect(window.electronAPI.clearEgressLog).toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = render(<DataCostTab config={DEFAULT_CONFIG} onChange={vi.fn()} />);
    await screen.findAllByText('$0.0123');
    const results = await axe.run(container);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
