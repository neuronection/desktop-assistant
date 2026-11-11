// @vitest-environment jsdom
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import type { ElectronAPI } from '@shared/types';
import type { TurnReceipt as TurnReceiptData } from '@shared/usage';
import { TurnReceipt } from '@renderer/chat-react/TurnReceipt';

afterEach(cleanup);

const receipt: TurnReceiptData = {
  messageId: 'm1',
  calls: 2,
  inputTokens: 1_200,
  outputTokens: 300,
  costMicros: 12_300,
  unpricedCalls: 0,
  models: [
    { model: 'gpt-6.1-sol', providerId: 'openai', calls: 2, inputTokens: 1_200, outputTokens: 300, costMicros: 12_300 },
  ],
  tools: [{ tool: 'file_write', outcome: 'ok', approvedBy: 'once', durationMs: 10 }],
  destinations: [
    { id: 'e1', at: new Date().toISOString(), host: 'api.openai.com', classification: 'public', mode: 'off', allowed: true, method: 'POST', turnId: 'm1' },
  ],
};

describe('TurnReceipt', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: Partial<ElectronAPI> }).electronAPI = {
      getTurnReceipt: vi.fn(async () => receipt),
    };
  });

  it('shows cost, tokens, destinations and tools', async () => {
    render(<TurnReceipt messageId="m1" />);
    expect(await screen.findByText(/Cost \$0\.0123/)).toBeTruthy();
    expect(screen.getByText(/api\.openai\.com/)).toBeTruthy();
    expect(screen.getByText(/file_write/)).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = render(<TurnReceipt messageId="m1" />);
    await screen.findByText(/Cost \$0\.0123/);
    const results = await axe.run(container);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
