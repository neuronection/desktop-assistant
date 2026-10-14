// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SetupWizard } from '@renderer/settings-react/tabs/SetupWizard';
import { LLMProviderType } from '@shared/types';
import { TEXT, interpolate } from '@shared/constants/text';
import { chooseOption } from './combobox';

afterEach(cleanup);

const decisionProvider = {
  id: 'provider-ts',
  name: 'TypeSafe',
  type: LLMProviderType.DECISION,
  apiKey: '',
  apiBase: 'https://api.typesafe.ai',
  presetKey: 'typesafe',
  timeout: 120000,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: '',
  availableModels: [
    { id: 'jev-latest', name: 'Jev (latest)', providerType: LLMProviderType.DECISION, providerId: 'provider-ts', caps: ['decision'], decisionTransport: 'systemone' as const },
  ],
  customModels: [],
};

function mockApi(): void {
  window.electronAPI = {
    ...window.electronAPI,
    writeToClipboard: vi.fn(async () => true),
    openExternal: vi.fn(async () => {}),
    setDefaultModel: vi.fn(async () => undefined),
  } as unknown as typeof window.electronAPI;
}

describe('SetupWizard decision support (plan 26 S3)', () => {
  it('tiles the docs-verified typesafe decision preset (exposure switch flipped, §13.3 superseded)', () => {
    mockApi();
    render(<SetupWizard open={true} onOpenChange={vi.fn()} onSetupComplete={vi.fn()} onOpenManualForm={vi.fn()} />);
    const tiles = screen.getAllByRole('button', { name: /TypeSafe/ });
    expect(tiles.length).toBeGreaterThan(0);
    const grid = tiles[0].closest('[data-as="provider-setup-tiles"]');
    const keys = Array.from(grid?.querySelectorAll('[data-preset]') ?? []).map(
      (node) => (node as HTMLElement).dataset.preset
    );
    expect(keys).toContain('typesafe');
    expect(keys.indexOf('typesafe')).toBeGreaterThan(keys.indexOf('openrouter'));
    expect(keys.indexOf('typesafe')).toBeLessThan(keys.indexOf('anthropic'));
    for (const tile of ['OpenAI', 'Google Gemini', 'OpenRouter']) {
      expect(screen.getByRole('button', { name: new RegExp(tile) })).toBeTruthy();
    }
    // capability chips: openrouter [chat, decision], ollama [chat, decision, local], typesafe [decision]
    const openrouter = screen.getAllByRole('button', { name: /OpenRouter/ })[0];
    expect(within(openrouter).getByText('Chat')).toBeTruthy();
    expect(within(openrouter).getByText('Decision')).toBeTruthy();
    const ollama = screen.getAllByRole('button', { name: /Ollama/ })[0];
    expect(within(ollama).getByText('Chat')).toBeTruthy();
    expect(within(ollama).getAllByText('Local')).toHaveLength(1);
    expect(within(ollama).getByText('Decision')).toBeTruthy();
    expect(within(tiles[0]).getAllByText('Decision')).toHaveLength(1);
    expect(within(tiles[0]).queryByText('Chat')).toBeNull();
  });

  it('renders the decision-probe pending state for a decision-only preset', async () => {
    mockApi();
    let resolveSetup: (value: unknown) => void = () => {};
    window.electronAPI.setupProviderFromPreset = vi.fn(
      () => new Promise((resolve) => { resolveSetup = resolve; })
    ) as unknown as typeof window.electronAPI.setupProviderFromPreset;
    render(
      <SetupWizard open={true} onOpenChange={vi.fn()} onSetupComplete={vi.fn()} onOpenManualForm={vi.fn()} initialPreset="typesafe" />
    );
    await screen.findByLabelText(TEXT.SETUP_KEY_LABEL);
    fireEvent.change(screen.getByLabelText(TEXT.SETUP_KEY_LABEL), { target: { value: 'ts-key' } });
    const submit = screen.getByRole('button', { name: TEXT.SETUP_SUBMIT });
    fireEvent.click(submit);
    expect(await screen.findByText(TEXT.SETUP_PROBE_PENDING)).toBeTruthy();
    resolveSetup({ ok: false, assignedModelId: null, catalogCount: 0, errorCode: 'invalid_key', vendorMessage: 'nope' });
    await screen.findByRole('alert');
  });

  it('shows decision rebind rows and binds slots on the success panel', async () => {
    mockApi();
    window.electronAPI.setupProviderFromPreset = vi.fn(async () => ({
      ok: true,
      provider: decisionProvider,
      assignedModelId: null,
      assignedDecisionSlots: { 'decision:tool-dispatch': 'jev-latest' },
      catalogCount: 1,
    })) as unknown as typeof window.electronAPI.setupProviderFromPreset;
    render(
      <SetupWizard open={true} onOpenChange={vi.fn()} onSetupComplete={vi.fn()} onOpenManualForm={vi.fn()} initialPreset="typesafe" />
    );
    await screen.findByLabelText(TEXT.SETUP_KEY_LABEL);
    fireEvent.change(screen.getByLabelText(TEXT.SETUP_KEY_LABEL), { target: { value: 'ts-key' } });
    fireEvent.click(screen.getByRole('button', { name: TEXT.SETUP_SUBMIT }));
    // review gates the bindings — step 2 is the task-centric "Choose
    // defaults" review; a decision-only preset shows the decision
    // default row only (no curated cards to show)
    expect(await screen.findByText(TEXT.SETUP_STEP_DEFAULTS)).toBeTruthy();
    expect(screen.getByText(TEXT.SETUP_REVIEW_ASSIGNMENTS_TITLE)).toBeTruthy();
    expect(screen.getByText(TEXT.API_DECISION_DEFAULT_ROW_LABEL)).toBeTruthy();
    const nowUnset = interpolate(TEXT.SETUP_REVIEW_CURRENT, { model: TEXT.API_DEFAULT_MODEL_UNSET });
    expect(
      screen.getByText(`${nowUnset} · ${interpolate(TEXT.SETUP_REVIEW_FILLS, { model: 'Jev (latest)' })}`)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.SETUP_APPLY }));
    await waitFor(() =>
      expect(window.electronAPI.setupProviderFromPreset).toHaveBeenLastCalledWith(
        'typesafe',
        'ts-key',
        'TypeSafe',
        expect.objectContaining({ bindDecision: true })
      )
    );
    expect(await screen.findByText(TEXT.SETUP_SUCCESS_TITLE)).toBeTruthy();
    expect(
      await screen.findByText(TEXT.SETUP_SUCCESS_ASSIGNED_DECISION.replace('{slot}', 'decision:tool-dispatch').replace('{model}', 'jev-latest'))
    ).toBeTruthy();
    const decisionCombos = screen.getAllByLabelText(TEXT.SETUP_DEFAULTS_DECISION);
    expect(decisionCombos.length).toBe(4);
    const choiceTrigger = document.querySelector('[id="setup-default-decision:choice"]');
    expect(choiceTrigger).toBeTruthy();
    fireEvent.click(choiceTrigger as HTMLElement);
    fireEvent.click(screen.getByRole('option', { name: /Jev/ }));
    const setButtons = screen.getAllByRole('button', { name: TEXT.SETUP_DEFAULTS_SET });
    fireEvent.click(setButtons[setButtons.length - 1]);
    await waitFor(() =>
      expect(window.electronAPI.setDefaultModel).toHaveBeenCalledWith('provider-ts', 'jev-latest', expect.stringMatching(/^decision:/))
    );
  });
});

describe('SetupWizard embeddings rebind row (plan 26 embeddings wave)', () => {
  const openaiProvider = {
    id: 'provider-oa',
    name: 'OpenAI',
    type: LLMProviderType.OPENAI,
    apiKey: '',
    apiBase: 'https://api.openai.com/v1',
    presetKey: 'openai',
    timeout: 120000,
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: '',
    availableModels: [
      { id: 'gpt-5.6-terra', name: 'Terra', providerType: LLMProviderType.OPENAI, providerId: 'provider-oa', caps: ['text', 'tools'] },
      { id: 'text-embedding-3-small', name: 'Embed', providerType: LLMProviderType.OPENAI, providerId: 'provider-oa', caps: ['embeddings'] },
    ],
    customModels: [],
  };

  function mockEmbedApi(): void {
    window.electronAPI = {
      ...window.electronAPI,
      writeToClipboard: vi.fn(async () => true),
      openExternal: vi.fn(async () => {}),
      setDefaultModel: vi.fn(async () => undefined),
    } as unknown as typeof window.electronAPI;
  }

  it('shows the embed rebind row when the preset declares embeddingsModel and binds through it', async () => {
    mockEmbedApi();
    window.electronAPI.setupProviderFromPreset = vi.fn(async () => ({
      ok: true,
      provider: openaiProvider,
      assignedModelId: 'gpt-5.6-terra',
      assignedEmbeddingsModel: 'text-embedding-3-small',
      catalogCount: 2,
    })) as unknown as typeof window.electronAPI.setupProviderFromPreset;
    render(
      <SetupWizard open={true} onOpenChange={vi.fn()} onSetupComplete={vi.fn()} onOpenManualForm={vi.fn()} initialPreset="openai" />
    );
    await screen.findByLabelText(TEXT.SETUP_KEY_LABEL);
    fireEvent.change(screen.getByLabelText(TEXT.SETUP_KEY_LABEL), { target: { value: 'sk-key' } });
    fireEvent.click(screen.getByRole('button', { name: TEXT.SETUP_SUBMIT }));
    // review gates the bindings — curated cards under "Models to add",
    // per-task rows with now/fills sub-lines under "Default assignments"
    expect(await screen.findByText(TEXT.SETUP_STEP_DEFAULTS)).toBeTruthy();
    expect(screen.getByText(TEXT.SETUP_REVIEW_ASSIGNMENTS_TITLE)).toBeTruthy();
    const nowUnset = interpolate(TEXT.SETUP_REVIEW_CURRENT, { model: TEXT.API_DEFAULT_MODEL_UNSET });
    // chat and vision both fill the preferred (vision-capable) card…
    expect(
      screen.getAllByText(`${nowUnset} · ${interpolate(TEXT.SETUP_REVIEW_FILLS, { model: 'gpt-5.6-terra' })}`).length
    ).toBe(2);
    expect(screen.getByText(TEXT.SETUP_DEFAULTS_TEXT)).toBeTruthy();
    expect(screen.getByText(TEXT.SETUP_DEFAULTS_STT)).toBeTruthy();
    // …the embeddings row fills its curated embeddings card
    expect(screen.getByText(TEXT.SETUP_DEFAULTS_EMBED)).toBeTruthy();
    expect(
      screen.getByText(`${nowUnset} · ${interpolate(TEXT.SETUP_REVIEW_FILLS, { model: 'text-embedding-3-small' })}`)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.SETUP_APPLY }));
    expect(await screen.findByText(TEXT.SETUP_SUCCESS_TITLE)).toBeTruthy();
    // gap-filled binding is reported…
    expect(
      await screen.findByText(TEXT.SETUP_SUCCESS_ASSIGNED_EMBED.replace('{model}', 'text-embedding-3-small'))
    ).toBeTruthy();
    // …and the embeddings-filtered rebind row is offered
    expect(screen.getByLabelText(TEXT.SETUP_DEFAULTS_EMBED)).toBeTruthy();
    fireEvent.click(document.querySelector('[id="setup-default-embed"]') as HTMLElement);
    fireEvent.click(screen.getByRole('option', { name: /Embed/ }));
    const embedRow = (document.querySelector('[id="setup-default-embed"]') as HTMLElement).closest('div.flex.items-center');
    fireEvent.click(within(embedRow as HTMLElement).getByRole('button', { name: TEXT.SETUP_DEFAULTS_SET }));
    await waitFor(() =>
      expect(window.electronAPI.setDefaultModel).toHaveBeenCalledWith('provider-oa', 'text-embedding-3-small', 'embed')
    );
  });
});
