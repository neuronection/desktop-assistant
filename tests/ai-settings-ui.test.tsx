// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiTab } from '@renderer/settings-react/tabs/ApiTab';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { AiTask, LLMProviderType } from '@shared/types';

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

function mockApi(): { testProvider: ReturnType<typeof vi.fn>; fetchAvailableModels: ReturnType<typeof vi.fn> } {
  const testProvider = vi.fn(async () => ({ ok: true, latencyMs: 42, modelCount: 3, error: null }));
  const fetchAvailableModels = vi.fn(async () => ({
    success: true,
    data: [{ id: 'remote-model', name: 'Remote Model', providerType: LLMProviderType.OPENAI, providerId: 'p1' }],
  }));
  window.electronAPI = {
    ...window.electronAPI,
    testProvider,
    fetchAvailableModels,
  } as unknown as typeof window.electronAPI;
  return { testProvider, fetchAvailableModels };
}

import { TEXT } from '@shared/constants/text';

describe('ApiTab family ai-settings surface', () => {
  it('renders the providers, models and task sections', () => {
    mockApi();
    const onChange = vi.fn();
    render(<ApiTab config={config()} onChange={onChange} />);
    expect(screen.getByText('Providers')).toBeTruthy();
    expect(screen.getByText('Models')).toBeTruthy();
    expect(screen.getAllByText('Task Assignments').length).toBeGreaterThan(0);
    expect(screen.getByText('Chat turns')).toBeTruthy();
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

  it('seeds provider presets on create and applies them when the type changes', () => {
    mockApi();
    const onChange = vi.fn();
    render(<ApiTab config={config()} onChange={onChange} />);
    fireEvent.click(screen.getByText('Add New Provider'));
    fireEvent.change(screen.getByDisplayValue('OPENAI'), { target: { value: LLMProviderType.ANTHROPIC } });
    fireEvent.change(screen.getByPlaceholderText('e.g., My OpenAI Key'), { target: { value: 'Anthropic Direct' } });
    fireEvent.click(screen.getByText('Save Provider'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.arrayContaining([
          expect.objectContaining({ type: LLMProviderType.ANTHROPIC, apiBase: 'https://api.anthropic.com' }),
        ]),
      })
    );
  });

  it('auto-fills the connection name from the type when the field is empty', () => {
    mockApi();
    render(<ApiTab config={config()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Add New Provider'));
    const nameInput = screen.getByPlaceholderText('e.g., My OpenAI Key') as HTMLInputElement;
    expect(nameInput.value).toBe('');
    fireEvent.change(screen.getByDisplayValue('OPENAI'), { target: { value: LLMProviderType.OLLAMA } });
    expect((screen.getByPlaceholderText('e.g., My OpenAI Key') as HTMLInputElement).value).toBe('Ollama (local)');
  });

  it('keeps a typed connection name when the type changes', () => {
    mockApi();
    render(<ApiTab config={config()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Add New Provider'));
    fireEvent.change(screen.getByPlaceholderText('e.g., My OpenAI Key'), { target: { value: 'My Server' } });
    fireEvent.change(screen.getByDisplayValue('OPENAI'), { target: { value: LLMProviderType.GROQ } });
    expect((screen.getByPlaceholderText('e.g., My OpenAI Key') as HTMLInputElement).value).toBe('My Server');
  });

  it('expands a provider and opens the model draft modal with tuning fields', async () => {
    const { fetchAvailableModels } = mockApi();
    const onChange = vi.fn();
    render(<ApiTab config={config()} onChange={onChange} />);
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
