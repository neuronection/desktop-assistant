// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiTab } from '@renderer/settings-react/tabs/ApiTab';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { AiTask, LLMProviderType } from '@shared/types';
import { PROVIDER_PRESET_ORDER, PROVIDER_SETUP_PRESETS } from '@shared/ai/providerPresets';

afterEach(cleanup);

const provider = {
  id: 'p1',
  name: 'Provider One',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://api.test/v1',
  timeout: 1000,
  temperature: 0.5,
  maxTokens: 1000,
  systemPrompt: '',
  availableModels: [
    { id: 'test-model', name: 'Test Model', providerType: LLMProviderType.OPENAI, providerId: 'p1', caps: ['text', 'tools'] },
  ],
  customModels: [],
};

const config = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  ...DEFAULT_CONFIG,
  providers: [provider],
  ...overrides,
});

function mockApi(): { testProvider: ReturnType<typeof vi.fn>; fetchAvailableModels: ReturnType<typeof vi.fn>; addProvider: ReturnType<typeof vi.fn> } {
  const testProvider = vi.fn(async () => ({ ok: true, latencyMs: 42, modelCount: 3, error: null }));
  const fetchAvailableModels = vi.fn(async () => ({
    success: true,
    data: [{ id: 'remote-model', name: 'Remote Model', providerType: LLMProviderType.OPENAI, providerId: 'p1' }],
  }));
  const addProvider = vi.fn(async (data: unknown) => ({ success: true, data: { ...(data as object), id: 'new-row' } }));
  window.electronAPI = {
    ...window.electronAPI,
    testProvider,
    fetchAvailableModels,
    addProvider,
    updateProvider: vi.fn(async () => ({ success: true })),
    deleteProvider: vi.fn(async () => ({ success: true })),
  } as unknown as typeof window.electronAPI;
  return { testProvider, fetchAvailableModels, addProvider };
}

import { TEXT } from '@shared/constants/text';

describe('ApiTab family ai-settings surface', () => {
  it('renders the providers, models and task sections', () => {
    mockApi();
    const onChange = vi.fn();
    render(<ApiTab config={config()} onChange={onChange} />);
    expect(screen.getByRole('tab', { name: 'Providers', selected: true })).toBeTruthy();
    expect(screen.getByRole('tabpanel', { name: 'Providers' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
    expect(screen.getByRole('tab', { name: 'Models', selected: true })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Task Assignments' }));
    expect(screen.getByText('Default text model')).toBeTruthy();
    expect(screen.getByText('Default vision model')).toBeTruthy();
    expect(screen.getByText('Conversation titles')).toBeTruthy();
    expect(screen.getByText('Transcription (voice input)')).toBeTruthy();
  });

  it('tests a provider connection through the IPC bridge', async () => {
    const { testProvider } = mockApi();
    const onChange = vi.fn();
    render(<ApiTab config={config()} onChange={onChange} />);
    fireEvent.click(screen.getByText('Test'));
    await waitFor(() => expect(testProvider).toHaveBeenCalledWith(provider));
    await waitFor(() => expect(screen.getByText('Reachable')).toBeTruthy());
    expect(screen.getByText('3 models')).toBeTruthy();
  });

  it('seeds provider presets on create and applies them when the type changes', async () => {
    const { addProvider } = mockApi();
    const onSetupComplete = vi.fn();
    render(<ApiTab config={config({ providers: [{ ...provider, apiKeyHint: 'sk-tes' }] })} onChange={vi.fn()} onSetupComplete={onSetupComplete} />);
    fireEvent.click(screen.getByText('Add New Provider'));
    fireEvent.click(screen.getByRole('button', { name: /Custom \/ manual/ }));
    fireEvent.change(screen.getByDisplayValue('OPENAI'), { target: { value: LLMProviderType.ANTHROPIC } });
    fireEvent.change(screen.getByPlaceholderText('e.g., My OpenAI Key'), { target: { value: 'Anthropic Direct' } });
    fireEvent.click(screen.getByText('Save Provider'));
    await waitFor(() =>
      expect(addProvider).toHaveBeenCalledWith(
        expect.objectContaining({ type: LLMProviderType.ANTHROPIC, apiBase: 'https://api.anthropic.com' })
      )
    );
    await waitFor(() => expect(onSetupComplete).toHaveBeenCalled());
  });

  it('auto-fills the connection name from the type when the field is empty', () => {
    mockApi();
    render(<ApiTab config={config({ providers: [{ ...provider, apiKeyHint: 'sk-tes' }] })} onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Add New Provider'));
    fireEvent.click(screen.getByRole('button', { name: /Custom \/ manual/ }));
    const nameInput = screen.getByPlaceholderText('e.g., My OpenAI Key') as HTMLInputElement;
    expect(nameInput.value).toBe('');
    fireEvent.change(screen.getByDisplayValue('OPENAI'), { target: { value: LLMProviderType.OLLAMA } });
    expect((screen.getByPlaceholderText('e.g., My OpenAI Key') as HTMLInputElement).value).toBe('Ollama (local)');
  });

  it('keeps a typed connection name when the type changes', () => {
    mockApi();
    render(<ApiTab config={config({ providers: [{ ...provider, apiKeyHint: 'sk-tes' }] })} onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Add New Provider'));
    fireEvent.click(screen.getByRole('button', { name: /Custom \/ manual/ }));
    fireEvent.change(screen.getByPlaceholderText('e.g., My OpenAI Key'), { target: { value: 'My Server' } });
    fireEvent.change(screen.getByDisplayValue('OPENAI'), { target: { value: LLMProviderType.GROQ } });
    expect((screen.getByPlaceholderText('e.g., My OpenAI Key') as HTMLInputElement).value).toBe('My Server');
  });

  it('expands a provider and opens the model draft modal with tuning fields', async () => {
    const { fetchAvailableModels } = mockApi();
    const onChange = vi.fn();
    render(<ApiTab config={config()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
    const providerNodes = screen.getAllByText('Provider One');
    fireEvent.click(providerNodes[providerNodes.length - 1]);
    await waitFor(() => expect(fetchAvailableModels).toHaveBeenCalled(), { timeout: 3000 });
    expect(await screen.findByText('test-model')).toBeTruthy();
    fireEvent.click(screen.getByText(/Add model/));
    expect(await screen.findByText(TEXT.API_MODEL_LIST_LABEL)).toBeTruthy();
    expect(screen.getByText('Capabilities')).toBeTruthy();
    expect(screen.getByText(TEXT.API_TEMPERATURE_LABEL)).toBeTruthy();
    expect(screen.getByText(TEXT.API_MAX_TOKENS_LABEL)).toBeTruthy();
    expect(screen.getByText(TEXT.API_REASONING_EFFORT)).toBeTruthy();

    const card = () => screen.getAllByText('Provider One');
    fireEvent.click(card()[card().length - 1]);
    fireEvent.click(card()[card().length - 1]);
    await waitFor(() => expect(fetchAvailableModels).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });
});

describe('ApiTab setup card (plan 21 Stage B)', () => {
  const emptyConfig = (): AppConfig => ({ ...config(), providers: [], defaultProviderId: null, taskAssignments: { ...DEFAULT_CONFIG.taskAssignments } });

  function mockSetupApi(overrides: {
    setup?: (presetKey: string, apiKey: string) => unknown;
    probeOk?: boolean;
  } = {}): { setupProviderFromPreset: ReturnType<typeof vi.fn>; testProvider: ReturnType<typeof vi.fn>; setDefaultModel: ReturnType<typeof vi.fn> } {
    const setupProviderFromPreset = vi.fn(overrides.setup ?? (async () => ({ ok: true, provider: { name: 'OpenAI' }, assignedModelId: 'gpt-4o-mini', catalogCount: 3 })));
    const testProvider = vi.fn(async () => ({ ok: overrides.probeOk ?? false, latencyMs: 1, modelCount: 0, error: null }));
    const setDefaultModel = vi.fn(async () => ({ success: true }));
    window.electronAPI = {
      ...window.electronAPI,
      setupProviderFromPreset,
      setDefaultModel,
      testProvider,
      writeToClipboard: vi.fn(async () => true),
      openExternal: vi.fn(async () => undefined),
    } as unknown as typeof window.electronAPI;
    return { setupProviderFromPreset, testProvider, setDefaultModel };
  }

  it('shows neutral tiles in preset order with no recommended copy', () => {
    mockSetupApi();
    render(<ApiTab config={emptyConfig()} onChange={vi.fn()} />);
    expect(screen.getByText('Set up AI')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    const tiles = PROVIDER_PRESET_ORDER.map((key) => screen.getByRole('button', { name: PROVIDER_SETUP_PRESETS[key].label }));
    for (let i = 0; i < tiles.length - 1; i++) {
      expect(tiles[i].compareDocumentPosition(tiles[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByText(/recommended/i)).toBeNull();
  });

  it('hides the card once a configured provider exists', () => {
    mockSetupApi();
    render(<ApiTab config={config({ providers: [{ ...provider, apiKeyHint: 'sk-tes' }] })} onChange={vi.fn()} />);
    expect(screen.queryByText('Set up AI')).toBeNull();
  });

  it('shows the card for the seeded keyless placeholder row', () => {
    mockSetupApi();
    render(<ApiTab config={config()} onChange={vi.fn()} />);
    expect(screen.getByText('Set up AI')).toBeTruthy();
  });

  it('opens the guided form with prefilled name, key field, and a read-only base under Advanced', () => {
    mockSetupApi();
    render(<ApiTab config={emptyConfig()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    fireEvent.click(screen.getByRole('button', { name: 'Google Gemini' }));
    expect(screen.getByText('Open https://aistudio.google.com/app/apikey and sign in with a Google account.')).toBeTruthy();
    expect((screen.getByLabelText('Connection name') as HTMLInputElement).value).toBe('Google Gemini');
    expect(screen.getByLabelText('API key')).toBeTruthy();
    fireEvent.click(screen.getByText('Advanced'));
    const base = screen.getByLabelText('API base URL') as HTMLInputElement;
    expect(base.readOnly).toBe(true);
    expect(base.value).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(screen.getByText('Google offers a free AI Studio tier — no credit card required.')).toBeTruthy();
  });

  it('routes an edited base URL to the manual form carrying name, type and key', () => {
    mockSetupApi();
    render(<ApiTab config={emptyConfig()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }));
    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'My proxy' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-proxy-key' } });
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText('API base URL'), { target: { value: 'https://my-proxy.example/v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Provider' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByPlaceholderText('e.g., My OpenAI Key') as HTMLInputElement).value).toBe('My proxy');
    expect(screen.queryByRole('button', { name: 'Set up automatically' })).toBeNull();
  });

  it('pre-selects a tile from a pasted key without locking the choice', () => {
    mockSetupApi();
    render(<ApiTab config={emptyConfig()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    const wizard = document.querySelector('[data-setup-wizard]') as HTMLElement;
    fireEvent.paste(wizard, { clipboardData: { getData: () => 'sk-or-v1-abc123' } });
    expect(screen.getByText('OpenRouter')).toBeTruthy();
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('sk-or-v1-abc123');
    fireEvent.click(screen.getByRole('button', { name: 'Choose another provider' }));
    expect(screen.getByRole('button', { name: 'OpenAI' })).toBeTruthy();
  });

  it('offers one-click connect when Ollama is detected', async () => {
    mockSetupApi({ probeOk: true });
    render(<ApiTab config={emptyConfig()} onChange={vi.fn()} />);
    expect(await screen.findByText('Ollama detected — connect in one click')).toBeTruthy();
  });

  it('connects a detected Ollama keylessly through the setup bridge', async () => {
    const { setupProviderFromPreset } = mockSetupApi({ probeOk: true, setup: async () => ({ ok: true, provider: { name: 'Ollama (local)' }, assignedModelId: null, catalogCount: 2 }) });
    render(<ApiTab config={emptyConfig()} onChange={vi.fn()} />);
    const banner = await screen.findByText('Ollama detected — connect in one click');
    fireEvent.click(banner.parentElement!.querySelector('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(setupProviderFromPreset).toHaveBeenCalledWith('ollama', '', 'Ollama (local)'));
  });

  it('routes a mis-pasted key to the suspected vendor, keeping the key', async () => {
    const { setupProviderFromPreset } = mockSetupApi({
      setup: async () => ({ ok: false, assignedModelId: null, catalogCount: 0, errorCode: 'invalid_key', vendorMessage: '401', suspectedVendor: 'openrouter' }),
    });
    render(<ApiTab config={emptyConfig()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-or-v1-abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up automatically' }));
    await waitFor(() => expect(setupProviderFromPreset).toHaveBeenCalledWith('openai', 'sk-or-v1-abc', 'OpenAI'));
    expect(await screen.findByText(/looks like a OpenRouter API key/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Set up OpenRouter instead' }));
    expect(screen.getByText('Copy the key — it starts with sk-or-v1-.')).toBeTruthy();
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('sk-or-v1-abc');
  });

  it('reveals the assigned model and refreshes the main config on success', async () => {
    const { setupProviderFromPreset } = mockSetupApi();
    const onSetupComplete = vi.fn();
    render(<ApiTab config={emptyConfig()} onChange={vi.fn()} onSetupComplete={onSetupComplete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-good' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up automatically' }));
    await waitFor(() => expect(setupProviderFromPreset).toHaveBeenCalledWith('openai', 'sk-good', 'OpenAI'));
    expect(await screen.findByText('OpenAI is connected. 3 models available.')).toBeTruthy();
    expect(screen.getByText('Chat now uses gpt-4o-mini.')).toBeTruthy();
    await waitFor(() => expect(onSetupComplete).toHaveBeenCalled());
  });

  it('binds default text and vision models through set-default-model after setup', async () => {
    const { setDefaultModel } = mockSetupApi({
      setup: async () => ({
        ok: true,
        provider: {
          id: 'row-1',
          name: 'OpenAI',
          availableModels: [
            { id: 'gpt-5.6-terra', name: 'Terra', providerType: LLMProviderType.OPENAI, providerId: 'row-1' },
            { id: 'gpt-5.6-luna', name: 'Luna', providerType: LLMProviderType.OPENAI, providerId: 'row-1' },
            { id: 'text-only', name: 'Text only', providerType: LLMProviderType.OPENAI, providerId: 'row-1', caps: ['text'] },
          ],
        },
        assignedModelId: null,
        assignedVisionModelId: null,
        catalogCount: 3,
      }),
    });
    render(<ApiTab config={emptyConfig()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-good' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up automatically' }));
    await screen.findByText('Default models');
    const textPick = screen.getByLabelText('Default text model');
    const visionPick = screen.getByLabelText('Default vision model');
    expect(visionPick.querySelectorAll('option')).toHaveLength(3);
    fireEvent.change(textPick, { target: { value: 'text-only' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Set' })[0]);
    await waitFor(() => expect(setDefaultModel).toHaveBeenCalledWith('row-1', 'text-only', 'chat'));
    expect(await screen.findByText('Chat now uses text-only.')).toBeTruthy();
    fireEvent.change(visionPick, { target: { value: 'gpt-5.6-luna' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Set' })[1]);
    await waitFor(() => expect(setDefaultModel).toHaveBeenCalledWith('row-1', 'gpt-5.6-luna', 'vision'));
    expect(await screen.findByText('Vision turns use gpt-5.6-luna.')).toBeTruthy();
  });

  it('surfaces unknown vendor errors verbatim and offers retry', async () => {
    mockSetupApi({ setup: async () => ({ ok: false, assignedModelId: null, catalogCount: 0, errorCode: 'unknown', vendorMessage: 'weird vendor explosion' }) });
    render(<ApiTab config={emptyConfig()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up automatically' }));
    expect(await screen.findByText('Setup failed: weird vendor explosion')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
  });

  it('routes a timeout to retryable copy', async () => {
    mockSetupApi({ setup: async () => ({ ok: false, assignedModelId: null, catalogCount: 0, errorCode: 'timeout', vendorMessage: 'aborted' }) });
    render(<ApiTab config={emptyConfig()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up automatically' }));
    expect(await screen.findByText(/took too long to answer/)).toBeTruthy();
  });

  it('re-runs setup on demand from a provider row with the stored key', async () => {
    const { setupProviderFromPreset } = mockSetupApi();
    const onSetupComplete = vi.fn();
    render(
      <ApiTab
        config={config({ providers: [{ ...provider, presetKey: 'openai', apiKeyHint: 'sk-tes' }] })}
        onChange={vi.fn()}
        onSetupComplete={onSetupComplete}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Set up automatically — refresh/ }));
    await waitFor(() => expect(setupProviderFromPreset).toHaveBeenCalledWith('openai', '', 'Provider One'));
    await waitFor(() => expect(onSetupComplete).toHaveBeenCalled());
  });

  it('shows the provider logo on rows and in the edit form', () => {
    mockSetupApi();
    mockApi();
    const gemini = {
      ...provider,
      type: LLMProviderType.GOOGLE,
      apiBase: 'https://generativelanguage.googleapis.com/v1beta',
      presetKey: 'gemini',
    };
    render(<ApiTab config={config({ providers: [gemini] })} onChange={vi.fn()} />);
    const row = screen.getByText('Provider One').closest('li') as HTMLElement;
    expect(row.querySelector('svg')).toBeTruthy();
    fireEvent.click(screen.getByText('Edit'));
    expect(document.querySelector('[role="dialog"] svg')).toBeTruthy();
  });
});

