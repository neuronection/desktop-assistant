// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiTab } from '@renderer/settings-react/tabs/ApiTab';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { AiTask, LLMProviderType } from '@shared/types';
import { TEXT } from '@shared/constants/text';
import { chooseOption } from './combobox';

afterEach(cleanup);

const PRIVACY_NOTICE_VERBATIM =
  'Decision models run in the cloud: your prompt and the candidate tools for the step are sent to the assigned provider (e.g. TypeSafe or OpenRouter). Your API key stays on this device.';

const provider = {
  id: 'p1',
  name: 'OpenRouter',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://openrouter.ai/api/v1',
  timeout: 1000,
  temperature: 0.5,
  maxTokens: 1000,
  systemPrompt: '',
  availableModels: [
    { id: 'openrouter/auto', name: 'Auto', providerType: LLMProviderType.OPENAI, providerId: 'p1', caps: ['text', 'tools'] },
    { id: 'openrouter.jev-latest', name: 'Jev via OpenRouter', providerType: LLMProviderType.OPENAI, providerId: 'p1', caps: ['decision'], decisionTransport: 'systemone' as const },
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

function openTasks(): void {
  fireEvent.click(screen.getByRole('tab', { name: TEXT.API_TASKS_TITLE }));
}

describe('ApiTab Decision models group (plan 26 S3)', () => {
  it('ships the privacy notice VERBATIM above the assignment list (§13.5)', () => {
    mockApi();
    render(<ApiTab config={config()} onChange={vi.fn()} />);
    openTasks();
    expect(screen.getByText(PRIVACY_NOTICE_VERBATIM)).toBeTruthy();
    expect(TEXT.DECISION_PRIVACY_NOTICE).toBe(PRIVACY_NOTICE_VERBATIM);
  });

  it('renders the four capability slots with primary and fallback pickers', async () => {
    mockApi();
    render(<ApiTab config={config()} onChange={vi.fn()} />);
    openTasks();
    expect(await screen.findByText(TEXT.API_DECISION_GROUP_TITLE)).toBeTruthy();
    for (const label of [
      TEXT.API_TASK_DECISION_TOOL_DISPATCH,
      TEXT.API_TASK_DECISION_BOOLEAN_GATE,
      TEXT.API_TASK_DECISION_CHOICE,
      TEXT.API_TASK_DECISION_SCORE,
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getAllByText(TEXT.API_DECISION_FALLBACK_LABEL).length).toBeGreaterThanOrEqual(4);
  });

  it('retired intent task row is gone', async () => {
    mockApi();
    render(<ApiTab config={config()} onChange={vi.fn()} />);
    openTasks();
    await screen.findByText(TEXT.API_DECISION_GROUP_TITLE);
    expect(screen.queryByText('Decisions (intent)')).toBeNull();
  });

  it('assigns a decision slot through the picker (decision models only)', async () => {
    mockApi();
    const onChange = vi.fn();
    render(<ApiTab config={config()} onChange={onChange} section="tasks" />);
    await screen.findByText(TEXT.API_DECISION_GROUP_TITLE);
    chooseOption(TEXT.API_TASK_DECISION_TOOL_DISPATCH, /Jev via OpenRouter/);
    await waitFor(() => {
      const update = onChange.mock.calls.at(-1)?.[0] as Partial<AppConfig>;
      expect(update.taskAssignments?.['decision:tool-dispatch']).toBe('openrouter.jev-latest');
    });
  });

  it('assigns a fallback slot through the secondary picker', async () => {
    mockApi();
    const onChange = vi.fn();
    render(<ApiTab config={config()} onChange={onChange} section="tasks" />);
    await screen.findByText(TEXT.API_DECISION_GROUP_TITLE);
    chooseOption(
      `${TEXT.API_DECISION_FALLBACK_LABEL} — ${TEXT.API_TASK_DECISION_BOOLEAN_GATE}`,
      /Jev via OpenRouter/
    );
    await waitFor(() => {
      const update = onChange.mock.calls.at(-1)?.[0] as Partial<AppConfig>;
      expect(update.taskFallbackAssignments?.['decision:boolean-gate']).toBe('openrouter.jev-latest');
    });
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

  it('offers unpin when the assigned row is a pinned version', async () => {
    mockApi();
    const onChange = vi.fn();
    const cfg = config({
      providers: [
        {
          ...provider,
          availableModels: [
            provider.availableModels[0],
            { ...provider.availableModels[1], id: 'jev-1.13' },
          ],
        },
      ],
      taskAssignments: {
        ...DEFAULT_CONFIG.taskAssignments,
        'decision:tool-dispatch': 'jev-1.13',
      },
      decision: {
        ...DEFAULT_CONFIG.decision,
        observedVersions: { 'openrouter.jev-latest': 'jev-1.13' },
      },
    });
    render(<ApiTab config={cfg} onChange={onChange} section="tasks" />);
    fireEvent.click(
      await screen.findByRole('button', { name: TEXT.API_DECISION_USE_ALIAS })
    );
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const update = onChange.mock.calls.at(-1)?.[0] as Partial<AppConfig>;
    expect(update.providers?.[0].availableModels?.some((model) => model.id === 'openrouter.jev-latest')).toBe(true);
    expect(update.taskAssignments?.['decision:tool-dispatch']).toBe('openrouter.jev-latest');
  });
});

describe('ApiTab embeddings row + decision pre-suggestion (plan 26 embeddings wave)', () => {
  const embedConfig = () =>
    config({
      providers: [
        {
          ...provider,
          availableModels: [
            ...provider.availableModels,
            { id: 'text-embedding-3-small', name: 'Embed', providerType: LLMProviderType.OPENAI, providerId: 'p1', caps: ['embeddings'] },
          ],
        },
      ],
    });

  it('ships the embeddings row in the defaults group and assigns through it (embeddings-filtered)', async () => {
    mockApi();
    const onChange = vi.fn();
    render(<ApiTab config={embedConfig()} onChange={onChange} section="tasks" />);
    expect(await screen.findByText(TEXT.API_TASK_EMBED)).toBeTruthy();
    expect(screen.getByText(TEXT.API_TASK_EMBED_DESCRIPTION)).toBeTruthy();
    // the embeddings picker offers only embeddings-capable rows
    chooseOption(TEXT.API_TASK_EMBED, /Embed/);
    await waitFor(() => {
      const update = onChange.mock.calls.at(-1)?.[0] as Partial<AppConfig>;
      expect(update.taskAssignments?.[AiTask.EMBED]).toBe('text-embedding-3-small');
    });
  });

  it('suggests the preset decisionDefault on empty decision rows — display-only', async () => {
    mockApi();
    const onChange = vi.fn();
    render(
      <ApiTab
        config={config({ providers: [{ ...provider, presetKey: 'openrouter' }] })}
        onChange={onChange}
        section="tasks"
      />
    );
    await screen.findByText(TEXT.API_DECISION_GROUP_TITLE);
    const hints = await screen.findAllByText(TEXT.DECISION_SUGGESTED.replace('{model}', 'typesafe/jev-1.13'));
    expect(hints.length).toBeGreaterThanOrEqual(1);
    // display-only: rendering the suggestion never assigns
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows no suggestion when the slot is filled or no preset declares a default', async () => {
    mockApi();
    render(
      <ApiTab
        config={config({
          providers: [{ ...provider, presetKey: 'openrouter' }],
          taskAssignments: { ...DEFAULT_CONFIG.taskAssignments, 'decision:tool-dispatch': 'openrouter.jev-latest' },
        })}
        onChange={vi.fn()}
        section="tasks"
      />
    );
    await screen.findByText(TEXT.API_DECISION_GROUP_TITLE);
    // 4 decision slots, 1 filled — only the 3 empty ones carry the hint
    const hints = await screen.findAllByText(TEXT.DECISION_SUGGESTED.replace('{model}', 'typesafe/jev-1.13'));
    expect(hints.length).toBe(3);
  });
});
