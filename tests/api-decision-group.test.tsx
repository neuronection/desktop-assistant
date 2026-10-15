// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiTab } from '@renderer/settings-react/tabs/ApiTab';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT, interpolate } from '@shared/constants/text';
import { DECISION_DEFAULT_SLOT } from '@shared/ai/decisions';
import { chooseOption } from './combobox';

afterEach(cleanup);

const PRIVACY_NOTICE_VERBATIM =
  'Decision models run in the cloud: your prompt and the candidate tools for the step are sent to the assigned provider (e.g. TypeSafe or OpenRouter). Your API key stays on this device.';

const provider = {
  id: 'p1',
  name: 'OpenRouter',
  type: 0,
  apiKey: '',
  apiBase: 'https://openrouter.ai/api/v1',
  timeout: 1000,
  temperature: 0.5,
  maxTokens: 1000,
  systemPrompt: '',
  availableModels: [
    { id: 'openrouter/auto', name: 'Auto', providerType: 0, providerId: 'p1', caps: ['text', 'tools'] },
    { id: 'openrouter.jev-latest', name: 'Jev via OpenRouter', providerType: 0, providerId: 'p1', caps: ['decision'], decisionTransport: 'systemone' as const },
  ],
  customModels: [],
};

const config = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  ...DEFAULT_CONFIG,
  providers: [provider],
  ...overrides,
});

function mockApi(): void {
  window.electronAPI = {
    ...window.electronAPI,
    testProvider: vi.fn(async () => ({ ok: true, latencyMs: 42, modelCount: 3, error: null })),
    fetchAvailableModels: vi.fn(async () => ({ success: true, data: [] })),
    addProvider: vi.fn(async (data: unknown) => ({ success: true, data: { ...(data as object), id: 'new-row' } })),
    updateProvider: vi.fn(async () => ({ success: true })),
    deleteProvider: vi.fn(async () => ({ success: true })),
  } as unknown as typeof window.electronAPI;
}

const KIND_LABELS = [
  TEXT.API_TASK_DECISION_TOOL_DISPATCH,
  TEXT.API_TASK_DECISION_BOOLEAN_GATE,
  TEXT.API_TASK_DECISION_CHOICE,
  TEXT.API_TASK_DECISION_SCORE,
];

describe('ApiTab Decision defaults (plan 29 / ADR-0036, uniform section ruling)', () => {
  it('ships the privacy notice VERBATIM as the Decision kinds description (§13.5)', () => {
    mockApi();
    render(<ApiTab config={config()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: TEXT.API_TASKS_TITLE }));
    expect(screen.getByText(PRIVACY_NOTICE_VERBATIM)).toBeTruthy();
    expect(TEXT.DECISION_PRIVACY_NOTICE).toBe(PRIVACY_NOTICE_VERBATIM);
  });

  it('the decision default rides the Default models section; the kind rows form the Decision kinds group', async () => {
    mockApi();
    render(<ApiTab config={config()} onChange={vi.fn()} section="tasks" />);
    await screen.findByText(TEXT.API_DECISION_KINDS_GROUP_TITLE);
    expect(screen.getByText(TEXT.API_TASKS_DEFAULTS_SECTION)).toBeTruthy();
    expect(screen.getByText(TEXT.API_DECISION_DEFAULT_ROW_LABEL)).toBeTruthy();
    for (const label of KIND_LABELS) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText(TEXT.API_DECISION_GROUP_TITLE)).toBeNull();
    // ADR-0037: default rows are single-picker — no fallback pickers on
    // the Default models rows.
    expect(screen.queryByRole('combobox', { name: `${TEXT.API_DECISION_FALLBACK_LABEL} — ${TEXT.API_TASK_CHAT}` })).toBeNull();
  });

  it('retired intent task row is gone', async () => {
    mockApi();
    render(<ApiTab config={config()} onChange={vi.fn()} section="tasks" />);
    await screen.findByText(TEXT.API_DECISION_KINDS_GROUP_TITLE);
    expect(screen.queryByText('Decisions (intent)')).toBeNull();
  });

  it('an empty default shows the D4 hint line and the preset suggestion in the default row', async () => {
    mockApi();
    render(
      <ApiTab
        config={config({
          providers: [{ ...provider, presetKey: 'openrouter' }],
        })}
        onChange={vi.fn()}
        section="tasks"
      />
    );
    expect(await screen.findByText(/^Assign one decision model to power all four decision kinds/)).toBeTruthy();
    expect(screen.getAllByText(/Suggested: typesafe\/jev-1\.13/).length).toBeGreaterThan(0);
  });

  it('the kinds pickers offer only decision models; an unset kind shows the inherit placeholder (single-picker contract)', async () => {
    mockApi();
    const onChange = vi.fn();
    render(<ApiTab config={config()} onChange={onChange} section="tasks" />);
    await screen.findByText(TEXT.API_DECISION_KINDS_GROUP_TITLE);
    const pickerName = TEXT.API_TASK_DECISION_TOOL_DISPATCH;
    // Empty decision default → short muted state; the meta line names the
    // inherit target (nothing set to default to here).
    expect(screen.getByLabelText(pickerName).textContent).toBe(TEXT.API_DECISION_INHERITED);
    fireEvent.click(screen.getByLabelText(pickerName));
    const jevOption = await screen.findByRole('option', { name: 'Jev via OpenRouter' });
    const listbox = jevOption.closest('[role="listbox"]');
    expect(listbox).toBeTruthy();
    const names = Array.from(listbox!.querySelectorAll('[role="option"]')).map(
      (option) => option.textContent
    );
    // No explicit "Inherits" entry — the option list carries models only.
    expect(names).toEqual(['Jev via OpenRouter']);
    // Selecting a model assigns it.
    fireEvent.click(jevOption);
    await waitFor(() => {
      const update = onChange.mock.calls.at(-1)?.[0] as Partial<AppConfig>;
      expect(update.taskAssignments?.['decision:tool-dispatch']).toBe('openrouter.jev-latest');
    });
  });

  it('assigns a kind override through the picker; the placeholder names the resolved default (matrix 1/2)', async () => {
    mockApi();
    const onChange = vi.fn();
    render(
      <ApiTab
        config={config({
          taskAssignments: {
            ...DEFAULT_CONFIG.taskAssignments,
            [DECISION_DEFAULT_SLOT]: 'openrouter.jev-latest',
          },
        })}
        onChange={onChange}
        section="tasks"
      />
    );
    await screen.findByText(TEXT.API_DECISION_KINDS_GROUP_TITLE);
    // The trigger reads the short inherit state; the meta line names the
    // resolved default the kind defaults to.
    expect(screen.getByLabelText(TEXT.API_TASK_DECISION_BOOLEAN_GATE).textContent).toBe(
      TEXT.API_DECISION_INHERITED
    );
    // every kind row shows the defaults-to line (the decision default resolves)
    expect(
      screen.getAllByText(
        interpolate(TEXT.API_DECISION_DEFAULTS_TO, { model: 'Jev via OpenRouter' })
      )
    ).toHaveLength(4);
    chooseOption(`${TEXT.API_TASK_DECISION_BOOLEAN_GATE}`, 'Jev via OpenRouter');
    await waitFor(() => {
      const update = onChange.mock.calls.at(-1)?.[0] as Partial<AppConfig>;
      expect(update.taskAssignments?.['decision:boolean-gate']).toBe('openrouter.jev-latest');
    });
  });

  it('kind rows are single-picker: no fallback picker exists (2026-10-14 ruling)', async () => {
    mockApi();
    const onChange = vi.fn();
    render(<ApiTab config={config()} onChange={onChange} section="tasks" />);
    await screen.findByText(TEXT.API_DECISION_KINDS_GROUP_TITLE);
    // The UI no longer offers fallback assignment (config data untouched).
    for (const label of KIND_LABELS) {
      expect(screen.queryByRole('combobox', { name: `${TEXT.API_DECISION_FALLBACK_LABEL} — ${label}` })).toBeNull();
    }
    // No "Primary" leg either — one picker per row.
    expect(
      screen.queryByRole('combobox', {
        name: `${TEXT.API_DECISION_PRIMARY_LABEL} — ${TEXT.API_TASK_DECISION_BOOLEAN_GATE}`,
      })
    ).toBeNull();
  });

  it('the X clear on a kind row assigns null — the inherit state (matrix 3)', async () => {
    mockApi();
    const onChange = vi.fn();
    render(
      <ApiTab
        config={config({
          taskAssignments: {
            ...DEFAULT_CONFIG.taskAssignments,
            'decision:tool-dispatch': 'openrouter.jev-latest',
          },
        })}
        onChange={onChange}
        section="tasks"
      />
    );
    await screen.findByText(TEXT.API_DECISION_KINDS_GROUP_TITLE);
    fireEvent.click(
      screen.getByRole('button', {
        name: `${TEXT.API_DEFAULT_MODEL_UNSET} — ${TEXT.API_TASK_DECISION_TOOL_DISPATCH}`,
      })
    );
    await waitFor(() => {
      const update = onChange.mock.calls.at(-1)?.[0] as Partial<AppConfig>;
      expect(update.taskAssignments?.['decision:tool-dispatch']).toBeNull();
    });
  });

  it('"Simplify" appears only when 4/4 kinds resolve to one model and the default is empty (matrix 6)', async () => {
    mockApi();
    const onChange = vi.fn();
    render(
      <ApiTab
        config={config({
          taskAssignments: {
            ...DEFAULT_CONFIG.taskAssignments,
            'decision:tool-dispatch': 'openrouter.jev-latest',
            'decision:boolean-gate': 'openrouter.jev-latest',
            'decision:choice': 'openrouter.jev-latest',
            'decision:score': 'openrouter.jev-latest',
          },
        })}
        onChange={onChange}
        section="tasks"
      />
    );
    const chip = await screen.findByRole('button', {
      name: (TEXT.API_DECISION_SIMPLIFY as string).replace('{model}', 'Jev via OpenRouter'),
    });
    fireEvent.click(chip);
    await waitFor(() => {
      const update = onChange.mock.calls.at(-1)?.[0] as Partial<AppConfig>;
      expect(update.taskAssignments?.[DECISION_DEFAULT_SLOT]).toBe('openrouter.jev-latest');
    });
  });

  it('no "Simplify" when the default is already set (matrix 6)', async () => {
    mockApi();
    render(
      <ApiTab
        config={config({
          taskAssignments: {
            ...DEFAULT_CONFIG.taskAssignments,
            [DECISION_DEFAULT_SLOT]: 'openrouter.jev-latest',
            'decision:tool-dispatch': 'openrouter.jev-latest',
          },
        })}
        onChange={vi.fn()}
        section="tasks"
      />
    );
    await screen.findByText(TEXT.API_DECISION_KINDS_GROUP_TITLE);
    expect(screen.queryByRole('button', { name: /Simplify/ })).toBeNull();
  });

  it('shows the pin affordance once a version has been observed and pins the model row', async () => {
    mockApi();
    const onChange = vi.fn();
    const cfg = config({
      taskAssignments: {
        ...DEFAULT_CONFIG.taskAssignments,
        'decision:tool-dispatch': 'openrouter.jev-latest',
      },
      decision: {
        ...DEFAULT_CONFIG.decision,
        observedVersions: { 'openrouter.jev-latest': 'jev-1.13' },
      },
    });
    render(<ApiTab config={cfg} onChange={onChange} section="tasks" />);
    const pin = await screen.findByRole('button', {
      name: TEXT.API_DECISION_PIN_TO.replace('{version}', 'jev-1.13'),
    });
    fireEvent.click(pin);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const update = onChange.mock.calls.at(-1)?.[0] as Partial<AppConfig>;
    const pinned = update.providers?.[0].availableModels?.find((model) => model.id === 'jev-1.13');
    expect(pinned).toBeTruthy();
    expect(update.taskAssignments?.['decision:tool-dispatch']).toBe('jev-1.13');
  });
});
