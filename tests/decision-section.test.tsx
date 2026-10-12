// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DecisionSection } from '@renderer/settings-react/tabs/DecisionSection';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { decisionSlot } from '@shared/ai/decisions';
import { TEXT, interpolate } from '@shared/constants/text';
import { chooseOption } from './combobox';

afterEach(cleanup);

function openSection(label: string): void {
  fireEvent.click(screen.getByRole('tab', { name: label }));
}

const assignedSlots = {
  [decisionSlot('tool-dispatch')]: 'jev-latest',
  [decisionSlot('boolean-gate')]: 'jev-latest',
};

function slotState(overrides: Partial<Record<string, { assignedModelId: string | null; readiness: unknown }>> = {}) {
  const base = {
    [decisionSlot('tool-dispatch')]: { assignedModelId: 'jev-latest', readiness: { state: 'ready' } },
    [decisionSlot('boolean-gate')]: { assignedModelId: 'jev-latest', readiness: { state: 'ready' } },
    [decisionSlot('choice')]: { assignedModelId: null, readiness: { state: 'unavailable', reason: 'No decision model is assigned.' } },
    [decisionSlot('score')]: { assignedModelId: null, readiness: { state: 'unavailable', reason: 'No decision model is assigned.' } },
    ...overrides,
  };
  return {
    slots: Object.entries(base).map(([slot, value]) => ({
      slot,
      capability: slot.replace('decision:', ''),
      transport: 'systemone',
      transportName: 'System One (TypeSafe SDK)',
      assignedModelId: value.assignedModelId,
      fallbackModelId: null,
      readiness: value.readiness,
    })),
  };
}

function mockApi(overrides: Record<string, unknown> = {}, configOverrides: Record<string, unknown> = {}): void {
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({
      ...DEFAULT_CONFIG,
      taskAssignments: { ...DEFAULT_CONFIG.taskAssignments, ...assignedSlots },
      ...configOverrides,
    })),
    saveConfig: vi.fn(async () => {}),
    getDecisionState: vi.fn(async () => slotState()),
    onSettingsOpen: vi.fn(async () => {}),
    getToolApps: vi.fn(async () => ({
      apps: [
        { app: { id: 'homeassistant', name: 'Home Assistant', enabled: true }, status: null, envKeys: [], headerKeys: [], knownTools: [] },
        { app: { id: 'weather', name: 'Weather', enabled: true }, status: null, envKeys: [], headerKeys: [], knownTools: [] },
      ],
      deferredSupported: true,
      nativeToolCount: 26,
    })),
    getToolAppDigestStats: vi.fn(async () => ({})),
    testDecision: vi.fn(async () => ({
      result: { status: 'decided', engine: 'jev-latest', confidence: 0.91, band: 'act', calls: [{ tool: 'light_turn_on' }] },
      durationMs: 42,
    })),
    ...overrides,
  } as unknown as typeof window.electronAPI;
}

describe('DecisionSection (plan 26 S3: behavior-only surface)', () => {
  it('shows the deep-link card into API settings and no engine selector', async () => {
    mockApi();
    render(<DecisionSection />);
    expect(await screen.findByText(TEXT.DECISION_SETUP_CARD_TITLE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.DECISION_SETUP_CARD_ACTION }));
    expect(window.electronAPI.onSettingsOpen).toHaveBeenCalledWith({ tab: 'api', section: 'tasks' });
    expect(document.querySelector('#decision-engine')).toBeNull();
  });

  it('hides thresholds and the test row when no decision model is assigned', async () => {
    mockApi(
      { getDecisionState: vi.fn(async () => slotState({ [decisionSlot('tool-dispatch')]: { assignedModelId: null, readiness: { state: 'unavailable', reason: 'No decision model is assigned.' } }, [decisionSlot('boolean-gate')]: { assignedModelId: null, readiness: { state: 'unavailable', reason: 'No decision model is assigned.' } } })) },
      { taskAssignments: { ...DEFAULT_CONFIG.taskAssignments } }
    );
    render(<DecisionSection />);
    expect(await screen.findByText(TEXT.DECISION_NOT_ASSIGNED)).toBeTruthy();
    expect(screen.getByText(TEXT.DECISION_SECTION_NEEDS_ENGINE)).toBeTruthy();
    expect(screen.queryByLabelText(TEXT.DECISION_TEST_ARIA)).toBeNull();
  });

  it('runs the test and renders model, confidence, band, and calls', async () => {
    mockApi();
    render(<DecisionSection />);
    fireEvent.change(await screen.findByLabelText(TEXT.DECISION_TEST_ARIA), {
      target: { value: 'dim the living room' },
    });
    fireEvent.click(screen.getByRole('button', { name: TEXT.DECISION_TEST_RUN }));
    expect(await screen.findByText('jev-latest')).toBeTruthy();
    expect(
      screen.getByText(
        interpolate(TEXT.DECISION_TEST_RESULT, {
          confidence: 91,
          band: TEXT.DECISION_TEST_BAND_ACT,
        })
      )
    ).toBeTruthy();
    expect(
      screen.getByText(interpolate(TEXT.DECISION_TEST_CALLS, { tools: 'light_turn_on' }))
    ).toBeTruthy();
  });

  it('adds and edits a custom rule (plan 24 S7)', async () => {
    mockApi();
    render(<DecisionSection />);
    openSection(TEXT.DECISION_TAB_RULES);
    fireEvent.click(await screen.findByRole('button', { name: TEXT.DECISION_RULE_ADD }));
    const match = await screen.findByLabelText(TEXT.DECISION_RULE_MATCH_ARIA);
    fireEvent.change(match, { target: { value: 'HassTurnOff' } });
    chooseOption(TEXT.DECISION_RULE_ACTION_ARIA, TEXT.DECISION_RULE_ACTION_NOTIFY);
    fireEvent.change(screen.getByLabelText(TEXT.DECISION_RULE_TEXT_ARIA), { target: { value: 'Lights out' } });
    await waitFor(() => {
      const last = vi.mocked(window.electronAPI.saveConfig).mock.calls.at(-1)?.[0] as {
        decision?: { rules?: { matchTool: string; action: string; text?: string }[] };
      };
      expect(last?.decision?.rules?.at(0)).toMatchObject({ matchTool: 'HassTurnOff', action: 'notify', text: 'Lights out' });
    });
  });

  it('lists the voice usages that run through the assigned model, read-only', async () => {
    mockApi(
      {},
      {
        voice: { ...DEFAULT_CONFIG.voice, autoSend: true, autoSendEngine: 'decision' },
      }
    );
    render(<DecisionSection />);
    expect(await screen.findByText(TEXT.DECISION_USED_BY_AUTO_SEND)).toBeTruthy();
    expect(
      (await screen.findAllByText(interpolate(TEXT.DECISION_USED_BY_USING, { engine: 'jev-latest' }))).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(TEXT.DECISION_USED_BY_LIVE)).toBeTruthy();
  });

  it('lists tool apps as scope checkboxes and persists toggles', async () => {
    mockApi();
    render(<DecisionSection />);
    openSection(TEXT.DECISION_TAB_SCOPE);
    const checkbox = await screen.findByLabelText(`${TEXT.DECISION_SCOPE_APPS_LABEL}: Home Assistant`);
    fireEvent.click(checkbox);
    await waitFor(() => {
      const last = vi.mocked(window.electronAPI.saveConfig).mock.calls.at(-1)?.[0] as {
        decision?: { scope?: { apps?: string[] } };
      };
      expect(last?.decision?.scope?.apps).toEqual(['homeassistant']);
    });
  });

  it('adds a route tool through the form and persists it', async () => {
    mockApi(
      {},
      {
        providers: [
          {
            id: 'p1',
            name: 'Test',
            type: 'openai',
            apiKey: '',
            apiBase: 'https://x',
            timeout: 1,
            temperature: 0.7,
            maxTokens: 10,
            systemPrompt: '',
            availableModels: [{ id: 'model-mini', name: 'Mini', caps: ['text'] }],
            customModels: [],
          },
        ],
      }
    );
    render(<DecisionSection />);
    openSection(TEXT.DECISION_TAB_ROUTING);
    fireEvent.click(await screen.findByRole('button', { name: TEXT.DECISION_ROUTE_ADD }));
    fireEvent.change(screen.getByLabelText(TEXT.DECISION_ROUTE_NAME_ARIA), { target: { value: 'ask_gemini' } });
    fireEvent.change(screen.getByLabelText(TEXT.DECISION_ROUTE_DESCRIPTION_ARIA), {
      target: { value: 'Route to Gemini.' },
    });
    chooseOption(TEXT.DECISION_ROUTE_MODEL_ARIA, /Mini/);
    fireEvent.click(screen.getByRole('button', { name: TEXT.DECISION_ROUTE_SAVE }));
    await waitFor(() => {
      const last = vi.mocked(window.electronAPI.saveConfig).mock.calls.at(-1)?.[0] as {
        decision?: { routeTools?: { name: string; modelId: string }[] };
      };
      expect(last?.decision?.routeTools?.at(0)).toMatchObject({ name: 'ask_gemini', modelId: 'model-mini' });
    });
  });

  it('persists the extra prompt on blur, trimmed and capped', async () => {
    mockApi();
    render(<DecisionSection />);
    const area = await screen.findByLabelText(TEXT.DECISION_PROMPT_ARIA);
    fireEvent.change(area, { target: { value: '  Prefer exact entity names.  ' } });
    fireEvent.blur(area);
    await waitFor(() => {
      const last = vi.mocked(window.electronAPI.saveConfig).mock.calls.at(-1)?.[0] as {
        decision?: { prompt?: string };
      };
      expect(last?.decision?.prompt).toBe('Prefer exact entity names.');
    });
  });

  it('shows the one-time legacy-engine notice and clears it on dismiss (plan 26 S2)', async () => {
    mockApi(
      {},
      {
        decision: { ...DEFAULT_CONFIG.decision, legacyEngineNotice: true },
      }
    );
    render(<DecisionSection />);
    expect(await screen.findByText(TEXT.DECISION_LEGACY_NOTICE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.DECISION_LEGACY_DISMISS }));
    await waitFor(() => {
      const last = vi.mocked(window.electronAPI.saveConfig).mock.calls.at(-1)?.[0] as {
        decision?: { legacyEngineNotice?: boolean };
      };
      expect(last?.decision?.legacyEngineNotice).toBe(false);
    });
  });
});
