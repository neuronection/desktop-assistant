// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DecisionSection } from '@renderer/settings-react/tabs/DecisionSection';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';

afterEach(cleanup);

function mockApi(overrides: Record<string, unknown> = {}): void {
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG, decision: { engine: 'off', actThreshold: 0.85, confirmThreshold: 0.5 } })),
    saveConfig: vi.fn(async () => {}),
    getDecisionState: vi.fn(async () => ({
      needle: { runtimePresent: true, weightsPresent: false, downloading: false, receivedBytes: 0, totalBytes: 35335380 },
    })),
    downloadDecisionWeights: vi.fn(async () => ({ ok: true })),
    cancelDecisionDownload: vi.fn(async () => true),
    testDecision: vi.fn(async () => ({
      result: { status: 'decided', engine: 'needle', confidence: 0.91, band: 'act', calls: [{ tool: 'light_turn_on' }] },
      durationMs: 42,
    })),
    ...overrides,
  } as unknown as typeof window.electronAPI;
}

describe('DecisionSection', () => {
  it('defaults to off without thresholds or test row', async () => {
    mockApi();
    render(<DecisionSection />);
    expect(await screen.findByText(TEXT.DECISION_TITLE)).toBeTruthy();
    expect((screen.getByLabelText(TEXT.DECISION_ENGINE_ARIA) as HTMLSelectElement).value).toBe('off');
    expect(screen.queryByLabelText(TEXT.DECISION_ACT_THRESHOLD_LABEL)).toBeNull();
    expect(screen.queryByLabelText(TEXT.DECISION_TEST_ARIA)).toBeNull();
  });

  it('persists the engine switch and shows the test row', async () => {
    mockApi();
    render(<DecisionSection />);
    const engine = await screen.findByLabelText(TEXT.DECISION_ENGINE_ARIA);
    fireEvent.change(engine, { target: { value: 'llm' } });
    await waitFor(() =>
      expect(window.electronAPI.saveConfig).toHaveBeenCalledWith({
        decision: { engine: 'llm', actThreshold: 0.85, confirmThreshold: 0.5 },
      })
    );
    expect(await screen.findByLabelText(TEXT.DECISION_TEST_ARIA)).toBeTruthy();
  });

  it('runs the test and renders engine, confidence, band, and calls', async () => {
    mockApi();
    window.electronAPI.loadConfig = vi.fn(async () => ({
      ...DEFAULT_CONFIG,
      decision: { engine: 'needle', actThreshold: 0.85, confirmThreshold: 0.5 },
    }));
    render(<DecisionSection />);
    const input = await screen.findByLabelText(TEXT.DECISION_TEST_ARIA);
    fireEvent.change(input, { target: { value: 'dim the living room to 30' } });
    fireEvent.click(screen.getByRole('button', { name: TEXT.DECISION_TEST_RUN }));
    await waitFor(() => expect(window.electronAPI.testDecision).toHaveBeenCalledWith('dim the living room to 30'));
    expect(await screen.findByText(/91% confident/)).toBeTruthy();
    expect(screen.getByText(/run it/)).toBeTruthy();
    expect(screen.getByText(/light_turn_on/)).toBeTruthy();
  });

  it('offers the download with progress for needle without weights', async () => {
    mockApi();
    window.electronAPI.loadConfig = vi.fn(async () => ({
      ...DEFAULT_CONFIG,
      decision: { engine: 'needle', actThreshold: 0.85, confirmThreshold: 0.5 },
    }));
    render(<DecisionSection />);
    const download = await screen.findByRole('button', { name: TEXT.DECISION_DOWNLOAD_ARIA });
    fireEvent.click(download);
    await waitFor(() => expect(window.electronAPI.downloadDecisionWeights).toHaveBeenCalled());
    expect(await screen.findByText(TEXT.DECISION_WEIGHTS_MISSING)).toBeTruthy();
  });

  it('shows downloading state with cancel', async () => {
    mockApi({
      getDecisionState: vi.fn(async () => ({
        needle: { runtimePresent: true, weightsPresent: false, downloading: true, receivedBytes: 17667690, totalBytes: 35335380 },
      })),
    });
    window.electronAPI.loadConfig = vi.fn(async () => ({
      ...DEFAULT_CONFIG,
      decision: { engine: 'needle', actThreshold: 0.85, confirmThreshold: 0.5 },
    }));
    render(<DecisionSection />);
    expect(await screen.findByText('Downloading… 50%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.DECISION_DOWNLOAD_CANCEL }));
    await waitFor(() => expect(window.electronAPI.cancelDecisionDownload).toHaveBeenCalled());
  });
});
