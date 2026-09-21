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
    getToolApps: vi.fn(async () => ({
      apps: [
        { app: { id: 'homeassistant', name: 'Home Assistant', enabled: true }, status: null, envKeys: [], headerKeys: [], knownTools: [] },
        { app: { id: 'weather', name: 'Weather', enabled: true }, status: null, envKeys: [], headerKeys: [], knownTools: [] },
      ],
      deferredSupported: true,
      nativeToolCount: 26,
    })),
    getToolAppDigestStats: vi.fn(async () => ({})),
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
        decision: {
          engine: 'llm',
          actThreshold: 0.85,
          confirmThreshold: 0.5,
          scope: { apps: [], includeNatives: false },
          routeTools: [],
          prompt: '',
        },
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

  it('shows the needle model credit and opens its page externally', async () => {
    mockApi({
      openExternal: vi.fn(async () => {}),
    });
    window.electronAPI.loadConfig = vi.fn(async () => ({
      ...DEFAULT_CONFIG,
      decision: { engine: 'needle', actThreshold: 0.85, confirmThreshold: 0.5 },
    }));
    render(<DecisionSection />);
    expect(await screen.findByText(TEXT.DECISION_NEEDLE_CREDIT)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.DECISION_NEEDLE_CREDIT_ARIA }));
    await waitFor(() =>
      expect(window.electronAPI.openExternal).toHaveBeenCalledWith('https://huggingface.co/Cactus-Compute/needle3')
    );
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

describe('DecisionSection scope & routing (plan 20 S7c)', () => {
  const loadedDecision = { engine: 'needle', actThreshold: 0.85, confirmThreshold: 0.5 };

  function scopeConfig(decision: Record<string, unknown> = loadedDecision): void {
    mockApi();
    window.electronAPI.loadConfig = vi.fn(async () => ({
      ...DEFAULT_CONFIG,
      providers: [
        {
          ...DEFAULT_CONFIG.providers[0],
          availableModels: [
            { id: 'model-mini', name: 'Model Mini', providerType: 'openai', providerId: DEFAULT_CONFIG.providers[0].id },
            { id: 'gemini-pro', name: 'Gemini Pro', providerType: 'openai', providerId: DEFAULT_CONFIG.providers[0].id },
          ],
        },
      ],
      decision,
    }));
  }

  it('lists tool apps as scope checkboxes and persists toggles', async () => {
    scopeConfig();
    render(<DecisionSection />);
    const checkbox = await screen.findByLabelText(`${TEXT.DECISION_SCOPE_APPS_LABEL}: Home Assistant`);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(window.electronAPI.saveConfig).toHaveBeenCalledWith({
        decision: {
          ...loadedDecision,
          scope: { apps: ['homeassistant'], includeNatives: false },
          routeTools: [],
          prompt: '',
        },
      })
    );
  });

  it('toggles the built-in tools switch and shows the idle hint for an empty scope', async () => {
    scopeConfig({ ...loadedDecision, scope: { apps: [], includeNatives: false } });
    render(<DecisionSection />);
    expect(await screen.findByText(TEXT.DECISION_SCOPE_IDLE_HINT)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: TEXT.DECISION_SCOPE_NATIVES_LABEL }));
    await waitFor(() =>
      expect(window.electronAPI.saveConfig).toHaveBeenCalledWith({
        decision: {
          ...loadedDecision,
          scope: { apps: [], includeNatives: true },
          routeTools: [],
          prompt: '',
        },
      })
    );
  });

  it('adds a route tool through the form and persists it', async () => {
    scopeConfig();
    render(<DecisionSection />);
    fireEvent.click(await screen.findByRole('button', { name: TEXT.DECISION_ROUTE_ADD }));
    fireEvent.change(screen.getByLabelText(TEXT.DECISION_ROUTE_NAME_ARIA), { target: { value: 'ask_gemini' } });
    fireEvent.change(screen.getByLabelText(TEXT.DECISION_ROUTE_DESCRIPTION_ARIA), {
      target: { value: 'Route hard questions.' },
    });
    fireEvent.change(screen.getByLabelText(TEXT.DECISION_ROUTE_MODEL_ARIA), { target: { value: 'gemini-pro' } });
    fireEvent.change(screen.getByLabelText(TEXT.DECISION_ROUTE_EXAMPLES_ARIA), {
      target: { value: 'what is the capital of France\ncompare two phones' },
    });
    fireEvent.click(screen.getByRole('button', { name: TEXT.DECISION_ROUTE_SAVE }));
    await waitFor(() =>
      expect(window.electronAPI.saveConfig).toHaveBeenCalledWith({
        decision: {
          ...loadedDecision,
          scope: { apps: [], includeNatives: false },
          routeTools: [
            {
              name: 'ask_gemini',
              description: 'Route hard questions.',
              modelId: 'gemini-pro',
              examples: ['what is the capital of France', 'compare two phones'],
            },
          ],
          prompt: '',
        },
      })
    );
  });

  it('rejects an invalid route tool name without persisting', async () => {
    scopeConfig();
    render(<DecisionSection />);
    fireEvent.click(await screen.findByRole('button', { name: TEXT.DECISION_ROUTE_ADD }));
    fireEvent.change(screen.getByLabelText(TEXT.DECISION_ROUTE_NAME_ARIA), { target: { value: 'Bad Name' } });
    fireEvent.change(screen.getByLabelText(TEXT.DECISION_ROUTE_DESCRIPTION_ARIA), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(TEXT.DECISION_ROUTE_MODEL_ARIA), { target: { value: 'gemini-pro' } });
    fireEvent.click(screen.getByRole('button', { name: TEXT.DECISION_ROUTE_SAVE }));
    expect(await screen.findByText(TEXT.DECISION_ROUTE_NAME_INVALID)).toBeTruthy();
    expect(window.electronAPI.saveConfig).not.toHaveBeenCalled();
  });

  it('removes a route tool', async () => {
    scopeConfig({
      ...loadedDecision,
      routeTools: [{ name: 'ask_gemini', description: 'Route.', modelId: 'gemini-pro' }],
    });
    render(<DecisionSection />);
    fireEvent.click(await screen.findByRole('button', { name: `${TEXT.DECISION_ROUTE_REMOVE}: ask_gemini` }));
    await waitFor(() =>
      expect(window.electronAPI.saveConfig).toHaveBeenCalledWith({
        decision: {
          ...loadedDecision,
          scope: { apps: [], includeNatives: false },
          routeTools: [],
          prompt: '',
        },
      })
    );
  });

  it('persists the extra prompt on blur, trimmed and capped', async () => {
    scopeConfig();
    render(<DecisionSection />);
    const prompt = await screen.findByLabelText(TEXT.DECISION_PROMPT_ARIA);
    fireEvent.change(prompt, { target: { value: '  Prefer exact entity names.  ' } });
    fireEvent.blur(prompt);
    await waitFor(() =>
      expect(window.electronAPI.saveConfig).toHaveBeenCalledWith({
        decision: {
          ...loadedDecision,
          scope: { apps: [], includeNatives: false },
          routeTools: [],
          prompt: 'Prefer exact entity names.',
        },
      })
    );
  });
});
