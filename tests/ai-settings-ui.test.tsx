// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ApiTab } from '@renderer/settings-react/tabs/ApiTab';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { AiTask, LLMProviderType } from '@shared/types';
import { PROVIDER_PRESET_ORDER, PROVIDER_SETUP_PRESETS } from '@shared/ai/providerPresets';
import { TEXT, interpolate } from '@shared/constants/text';
import { chooseOption } from './combobox';

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

function mockApi(): { testProvider: ReturnType<typeof vi.fn>; fetchAvailableModels: ReturnType<typeof vi.fn>; addProvider: ReturnType<typeof vi.fn>; updateProvider: ReturnType<typeof vi.fn> } {
  const testProvider = vi.fn(async () => ({ ok: true, latencyMs: 42, modelCount: 3, error: null }));
  const fetchAvailableModels = vi.fn(async () => ({
    success: true,
    data: [{ id: 'remote-model', name: 'Remote Model', providerType: LLMProviderType.OPENAI, providerId: 'p1' }],
  }));
  const addProvider = vi.fn(async (data: unknown) => ({ success: true, data: { ...(data as object), id: 'new-row' } }));
  const updateProvider = vi.fn(async () => ({ success: true }));
  window.electronAPI = {
    ...window.electronAPI,
    testProvider,
    fetchAvailableModels,
    addProvider,
    updateProvider,
    deleteProvider: vi.fn(async () => ({ success: true })),
  } as unknown as typeof window.electronAPI;
  return { testProvider, fetchAvailableModels, addProvider, updateProvider };
}

/** Opens a provider row's `⋯` actions menu — the trigger opens on
 * pointerdown (Radix), so a plain click event would not open it. */
function openProviderActions(name: string): void {
  fireEvent.pointerDown(
    screen.getByRole('button', { name: interpolate(TEXT.API_PROVIDERS_ACTIONS_ARIA, { name }) })
  );
}

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
    expect(screen.getByText('Text')).toBeTruthy();
    expect(screen.getByText('Vision')).toBeTruthy();
    expect(screen.getByText('Conversation titles')).toBeTruthy();
    expect(screen.getByText('Transcription')).toBeTruthy();
  });

  it('tests a provider connection through the IPC bridge', async () => {
    const { testProvider } = mockApi();
    const onChange = vi.fn();
    render(<ApiTab config={config()} onChange={onChange} />);
    openProviderActions(provider.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: TEXT.API_TEST }));
    await waitFor(() => expect(testProvider).toHaveBeenCalledWith(provider));
    await waitFor(() => expect(screen.getByText('Reachable')).toBeTruthy());
    // the count is live from the provider's registered catalog
    expect(screen.getByText('1 models')).toBeTruthy();
  });

  it('seeds provider presets on create and applies them when the type changes', async () => {
    const { addProvider } = mockApi();
    const onSetupComplete = vi.fn();
    render(<ApiTab config={config({ providers: [{ ...provider, apiKeyHint: 'sk-tes' }] })} onChange={vi.fn()} onSetupComplete={onSetupComplete} />);
    fireEvent.click(screen.getByText('Add New Provider'));
    fireEvent.click(screen.getByRole('button', { name: /Custom \/ manual/ }));
    chooseOption('Provider Type', 'Anthropic');
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
    chooseOption('Provider Type', 'Ollama (local)');
    expect((screen.getByPlaceholderText('e.g., My OpenAI Key') as HTMLInputElement).value).toBe('Ollama (local)');
  });

  it('keeps a typed connection name when the type changes', () => {
    mockApi();
    render(<ApiTab config={config({ providers: [{ ...provider, apiKeyHint: 'sk-tes' }] })} onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Add New Provider'));
    fireEvent.click(screen.getByRole('button', { name: /Custom \/ manual/ }));
    fireEvent.change(screen.getByPlaceholderText('e.g., My OpenAI Key'), { target: { value: 'My Server' } });
    chooseOption('Provider Type', 'GROQ');
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
    const kindGroup = await screen.findByLabelText(TEXT.API_MODEL_KIND_STEP);
    fireEvent.click(within(kindGroup).getByRole('button', { name: 'Text' }));
    fireEvent.click(await screen.findByText(TEXT.API_MANUAL_ID));
    expect(await screen.findByText(TEXT.API_MODEL_LIST_LABEL)).toBeTruthy();
    expect(screen.getByText('Capabilities')).toBeTruthy();
    expect(screen.getByText(TEXT.API_TEMPERATURE_LABEL)).toBeTruthy();
    expect(screen.getByText(TEXT.API_MAX_TOKENS_LABEL)).toBeTruthy();
    expect(screen.getByText(TEXT.API_REASONING_EFFORT)).toBeTruthy();

    // click the provider header OUTSIDE the open modal (Radix aria-hides
    // background content, and the provider-context banner inside the
    // dialog also carries the provider name)
    const card = () =>
      screen
        .getAllByText('Provider One')
        .filter((el) => el.closest('[role="dialog"]') === null)
        .at(-1)!;
    fireEvent.click(card());
    fireEvent.click(card());
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
    const tiles = PROVIDER_PRESET_ORDER.map((key) =>
      screen.getByRole('button', { name: new RegExp(PROVIDER_SETUP_PRESETS[key].label.replace(/[()]/g, '\\$&')) })
    );
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
    fireEvent.click(screen.getByRole('button', { name: /Google Gemini/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /OpenAI/ }));
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
    expect(screen.getByRole('button', { name: /OpenAI/ })).toBeTruthy();
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
    await waitFor(() =>
      expect(setupProviderFromPreset).toHaveBeenCalledWith('ollama', '', 'Ollama (local)', {
        bindChat: false,
        bindVision: false,
        bindStt: false,
        bindEmbeddings: false,
        bindDecision: false,
      })
    );
  });

  it('routes a mis-pasted key to the suspected vendor, keeping the key', async () => {
    const { setupProviderFromPreset } = mockSetupApi({
      setup: async () => ({ ok: false, assignedModelId: null, catalogCount: 0, errorCode: 'invalid_key', vendorMessage: '401', suspectedVendor: 'openrouter' }),
    });
    render(<ApiTab config={emptyConfig()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    fireEvent.click(screen.getByRole('button', { name: /OpenAI/ }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-or-v1-abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up automatically' }));
    await waitFor(() =>
      expect(setupProviderFromPreset).toHaveBeenCalledWith('openai', 'sk-or-v1-abc', 'OpenAI', {
        bindChat: false,
        bindVision: false,
        bindStt: false,
        bindEmbeddings: false,
        bindDecision: false,
      })
    );
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
    fireEvent.click(screen.getByRole('button', { name: /OpenAI/ }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-good' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up automatically' }));
    // connect is bind-less — the review step gates the defaults
    await waitFor(() =>
      expect(setupProviderFromPreset).toHaveBeenCalledWith('openai', 'sk-good', 'OpenAI', {
        bindChat: false,
        bindVision: false,
        bindStt: false,
        bindEmbeddings: false,
        bindDecision: false,
      })
    );
    // review step 2: "Default assignments" rows with now/fills sub-lines
    // (config ships no assignments yet → now: Not set)
    expect(await screen.findByText(TEXT.SETUP_STEP_DEFAULTS)).toBeTruthy();
    expect(screen.getByText(TEXT.SETUP_REVIEW_ASSIGNMENTS_TITLE)).toBeTruthy();
    const nowUnset = interpolate(TEXT.SETUP_REVIEW_CURRENT, { model: TEXT.API_DEFAULT_MODEL_UNSET });
    expect(
      screen.getAllByText(`${nowUnset} · ${interpolate(TEXT.SETUP_REVIEW_FILLS, { model: 'gpt-6.1-sol' })}`).length
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('OpenAI is connected. 3 models available.')).toBeTruthy();
    expect(screen.getByText('Chat now uses gpt-4o-mini.')).toBeTruthy();
    await waitFor(() => expect(onSetupComplete).toHaveBeenCalled());
    expect(setupProviderFromPreset).toHaveBeenCalledTimes(2);
  });

  it('binds default text and vision models through set-default-model after setup', async () => {
    const { setDefaultModel } = mockSetupApi({
      setup: async () => ({
        ok: true,
        provider: {
          id: 'row-1',
          name: 'OpenAI',
          availableModels: [
            { id: 'gpt-6.1-sol', name: 'Terra', providerType: LLMProviderType.OPENAI, providerId: 'row-1' },
            { id: 'gpt-6-luna', name: 'Luna', providerType: LLMProviderType.OPENAI, providerId: 'row-1' },
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
    fireEvent.click(screen.getByRole('button', { name: /OpenAI/ }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-good' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up automatically' }));
    expect(await screen.findByText(TEXT.SETUP_REVIEW_ASSIGNMENTS_TITLE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Default models');
    expect(screen.getByLabelText('Text')).toBeTruthy();
    const visionPick = screen.getByLabelText('Vision');
    fireEvent.click(visionPick);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    fireEvent.click(screen.getByRole('option', { name: /Luna/ }));
    chooseOption('Text', 'Text only (text-only)');
    fireEvent.click(screen.getAllByRole('button', { name: 'Set' })[0]);
    await waitFor(() => expect(setDefaultModel).toHaveBeenCalledWith('row-1', 'text-only', 'chat'));
    expect(await screen.findByText('Chat now uses text-only.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Set' })[1]);
    await waitFor(() => expect(setDefaultModel).toHaveBeenCalledWith('row-1', 'gpt-6-luna', 'vision'));
    expect(await screen.findByText('Vision turns use gpt-6-luna.')).toBeTruthy();
  });

  it('surfaces unknown vendor errors verbatim and offers retry', async () => {
    mockSetupApi({ setup: async () => ({ ok: false, assignedModelId: null, catalogCount: 0, errorCode: 'unknown', vendorMessage: 'weird vendor explosion' }) });
    render(<ApiTab config={emptyConfig()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    fireEvent.click(screen.getByRole('button', { name: /OpenAI/ }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up automatically' }));
    expect(await screen.findByText('Setup failed: weird vendor explosion')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
  });

  it('routes a timeout to retryable copy', async () => {
    mockSetupApi({ setup: async () => ({ ok: false, assignedModelId: null, catalogCount: 0, errorCode: 'timeout', vendorMessage: 'aborted' }) });
    render(<ApiTab config={emptyConfig()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    fireEvent.click(screen.getByRole('button', { name: /OpenAI/ }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up automatically' }));
    expect(await screen.findByText(/took too long to answer/)).toBeTruthy();
  });

  it('re-runs setup on demand from an editable review modal', async () => {
    const { setupProviderFromPreset } = mockSetupApi();
    const onSetupComplete = vi.fn();
    render(
      <ApiTab
        config={config({ providers: [{ ...provider, presetKey: 'openai', apiKeyHint: 'sk-tes' }] })}
        onChange={vi.fn()}
        onSetupComplete={onSetupComplete}
      />
    );
    openProviderActions(provider.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: TEXT.SETUP_SUBMIT }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Uses the stored key for "Provider One".');
    expect(dialog.textContent).not.toContain('{current}');
    expect(dialog.textContent).toContain('now: Not set');
    expect(within(dialog).getAllByRole('switch').length).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(setupProviderFromPreset).not.toHaveBeenCalled();
    openProviderActions(provider.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: TEXT.SETUP_SUBMIT }));
    const review = await screen.findByRole('dialog');
    fireEvent.click(within(review).getByRole('button', { name: /gpt-6-luna/ }));
    fireEvent.click(within(review).getByRole('switch', { name: /default vision model/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(setupProviderFromPreset).toHaveBeenCalledWith('openai', '', 'Provider One', {
        curatedIds: ['gpt-6.1-sol', 'whisper-1', 'text-embedding-3-small'],
        bindChat: true,
        bindVision: false,
        bindStt: true,
        bindEmbeddings: true,
        bindDecision: false,
      })
    );
    await waitFor(() => expect(onSetupComplete).toHaveBeenCalled());
  });

  it('reviews decision-capable presets with the decision bind switch (plan 26 D14)', async () => {
    const { setupProviderFromPreset } = mockSetupApi();
    render(
      <ApiTab
        config={config({ providers: [{ ...provider, presetKey: 'openrouter', apiKeyHint: 'sk-or' }] })}
        onChange={vi.fn()}
      />
    );
    openProviderActions(provider.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: TEXT.SETUP_SUBMIT }));
    const review = await screen.findByRole('dialog');
    expect(within(review).getAllByRole('switch').length).toBe(3);
    const decisionSwitch = within(review).getByRole('switch', { name: /decision model slots/ });
    expect(decisionSwitch.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(decisionSwitch);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(setupProviderFromPreset).toHaveBeenCalledWith('openrouter', '', 'Provider One', {
        curatedIds: ['openrouter/auto'],
        bindChat: true,
        bindVision: true,
        bindStt: true,
        bindEmbeddings: true,
        bindDecision: false,
      })
    );
  });

  it('shows the provider logo on rows and in the edit form', async () => {
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
    openProviderActions(gemini.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: TEXT.EDIT_BUTTON }));
    expect(document.querySelector('[role="dialog"] svg')).toBeTruthy();
  });

  it('removes all fetched models from the edit form after confirmation', async () => {
    const { updateProvider } = mockApi();
    const withModels = {
      ...provider,
      presetKey: 'openai',
      apiKeyHint: 'sk-tes',
      availableModels: [
        { id: 'gpt-6.1-sol', name: 'Terra', providerType: LLMProviderType.OPENAI, providerId: 'p1' },
        { id: 'gpt-6-luna', name: 'Luna', providerType: LLMProviderType.OPENAI, providerId: 'p1' },
      ],
    };
    render(<ApiTab config={config({ providers: [withModels] })} onChange={vi.fn()} />);
    openProviderActions(withModels.name);
    fireEvent.click(await screen.findByRole('menuitem', { name: TEXT.EDIT_BUTTON }));
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: /Remove all fetched models \(2\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByText('Save Provider'));
    await waitFor(() =>
      expect(updateProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', availableModels: [] }))
    );
  });
});

