// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SetupWizard } from '@renderer/settings-react/tabs/SetupWizard';
import { LLMProviderType } from '@shared/types';
import { TEXT } from '@shared/constants/text';
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
      expect(screen.getByRole('button', { name: tile })).toBeTruthy();
    }
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
