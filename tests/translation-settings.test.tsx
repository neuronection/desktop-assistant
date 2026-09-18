// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { TranslationSection } from '@renderer/settings-react/tabs/TranslationSection';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { TranslationProviderSaveInput, TranslationProviderView } from '@shared/translation';

afterEach(cleanup);

const providerView = (overrides: Partial<TranslationProviderView['config']> = {}): TranslationProviderView => ({
  config: {
    id: 'srv-1',
    name: 'Local LibreTranslate',
    type: 'libretranslate',
    enabled: true,
    apiBase: 'http://lt.local',
    ...overrides,
  },
  hasKey: false,
});

const baseConfig = (translation: Partial<typeof DEFAULT_CONFIG.translation> = {}) => ({
  ...DEFAULT_CONFIG,
  translation: { ...DEFAULT_CONFIG.translation, ...translation },
});

function mockApi(options: { config?: ReturnType<typeof baseConfig>; providers?: TranslationProviderView[]; saveProvider?: ReturnType<typeof vi.fn> } = {}): void {
  window.electronAPI = {
    loadConfig: vi.fn(async () => options.config ?? baseConfig()),
    saveConfig: vi.fn(async () => {}),
    getTranslationProviders: vi.fn(async () => options.providers ?? []),
    saveTranslationProvider: options.saveProvider ?? vi.fn(async (input: TranslationProviderSaveInput) => ({ config: { ...input }, hasKey: Boolean(input.key || input.keyHint) })),
    deleteTranslationProvider: vi.fn(async () => true),
    setTranslationProviderEnabled: vi.fn(async () => true),
    moveTranslationProvider: vi.fn(async () => true),
    testTranslationProvider: vi.fn(async () => ({ ok: true, translation: 'Hola', latencyMs: 12 })),
  } as unknown as typeof window.electronAPI;
}

describe('TranslationSection config surface', () => {
  it('renders mode, default target, and the empty custom-language state', async () => {
    mockApi();
    render(<TranslationSection />);
    await waitFor(() => expect((screen.getByLabelText('Translation engine mode') as HTMLSelectElement).value).toBe('auto'));
    expect(screen.getByText('No custom languages — the built-in list applies.')).toBeTruthy();
    expect(screen.getByText('No services configured — only the LLM engine can answer (when assigned).')).toBeTruthy();
  });

  it('persists a mode change through the full translation section', async () => {
    mockApi();
    render(<TranslationSection />);
    await waitFor(() => expect(screen.getByLabelText('Translation engine mode')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Translation engine mode'), { target: { value: 'service' } });
    await waitFor(() => {
      expect(window.electronAPI.saveConfig).toHaveBeenCalledWith({
        translation: expect.objectContaining({ mode: 'service' }),
      });
    });
  });

  it('clears the default target when set back to none', async () => {
    mockApi({ config: baseConfig({ defaultTarget: 'el' }) });
    render(<TranslationSection />);
    await waitFor(() => expect((screen.getByLabelText('Default target language') as HTMLSelectElement).value).toBe('el'));
    fireEvent.change(screen.getByLabelText('Default target language'), { target: { value: '' } });
    await waitFor(() => {
      expect(window.electronAPI.saveConfig).toHaveBeenCalledWith({
        translation: expect.objectContaining({ defaultTarget: null }),
      });
    });
  });

  it('saves the defaultTarget for a custom language code', async () => {
    mockApi({ config: baseConfig({ customLanguages: [{ code: 'grc', name: 'Ancient Greek' }] }) });
    render(<TranslationSection />);
    const select = await screen.findByLabelText('Default target language');
    fireEvent.change(select, { target: { value: 'grc' } });
    await waitFor(() => {
      expect(window.electronAPI.saveConfig).toHaveBeenCalledWith({
        translation: expect.objectContaining({ defaultTarget: 'grc' }),
      });
    });
  });
});

describe('TranslationSection custom languages', () => {
  it('adds a custom language and persists it', async () => {
    mockApi();
    render(<TranslationSection />);
    await screen.findByLabelText('Code');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'grc' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ancient Greek' } });
    fireEvent.change(screen.getByLabelText('Native name (optional)'), { target: { value: 'Ἑλληνική' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add language' }));
    await waitFor(() => {
      expect(window.electronAPI.saveConfig).toHaveBeenCalledWith({
        translation: expect.objectContaining({
          customLanguages: [{ code: 'grc', name: 'Ancient Greek', nativeName: 'Ἑλληνική' }],
        }),
      });
    });
    expect(screen.getByText('Ancient Greek')).toBeTruthy();
  });

  it('rejects built-in collisions, duplicates, and invalid codes without saving', async () => {
    mockApi({ config: baseConfig({ customLanguages: [{ code: 'grc', name: 'Ancient Greek' }] }) });
    render(<TranslationSection />);
    await screen.findByLabelText('Code');

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'EL' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fake Greek' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add language' }));
    await screen.findByText("'el' is already a built-in language.");

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'grc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add language' }));
    await screen.findByText("'grc' is already in the list.");

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '1bad code!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add language' }));
    await screen.findByText('Codes use 2-12 characters: a-z, 0-9 and dashes.');

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'tok' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add language' }));
    await screen.findByText('A display name is required.');

    expect(window.electronAPI.saveConfig).not.toHaveBeenCalled();
  });

  it('removes a custom language and resets a matching default target', async () => {
    mockApi({
      config: baseConfig({ defaultTarget: 'grc', customLanguages: [{ code: 'grc', name: 'Ancient Greek' }] }),
    });
    render(<TranslationSection />);
    await screen.findByText('Ancient Greek');
    fireEvent.click(screen.getByRole('button', { name: 'Remove custom language grc' }));
    await waitFor(() => {
      expect(window.electronAPI.saveConfig).toHaveBeenCalledWith({
        translation: expect.objectContaining({ customLanguages: [], defaultTarget: null }),
      });
    });
  });
});

describe('TranslationSection providers', () => {
  it('lists providers and shows a successful test result', async () => {
    mockApi({ providers: [providerView()] });
    render(<TranslationSection />);
    await screen.findByText('Local LibreTranslate');
    fireEvent.click(screen.getByRole('button', { name: 'Test Local LibreTranslate' }));
    await screen.findByText(/OK \(Hola, 12ms\)/);
    expect(window.electronAPI.testTranslationProvider).toHaveBeenCalledWith('srv-1');
  });

  it('surfaces main-side save errors inline (DeepL without a key)', async () => {
    mockApi({
      saveProvider: vi.fn(async () => {
        throw new Error('DeepL needs an API key.');
      }),
    });
    render(<TranslationSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add service' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Provider name'), { target: { value: 'DeepL Main' } });
    fireEvent.change(screen.getByLabelText('Service type'), { target: { value: 'deepl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));
    await screen.findByText('DeepL needs an API key.');
  });

  it('requires a server URL client-side for LibreTranslate', async () => {
    mockApi();
    render(<TranslationSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add service' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Provider name'), { target: { value: 'Local LT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));
    await screen.findByText('A server URL is required for LibreTranslate.');
    expect(window.electronAPI.saveTranslationProvider).not.toHaveBeenCalled();
  });
});

describe('TranslationSection axe scan', () => {
  it('has no axe violations with content and a provider row', async () => {
    mockApi({
      config: baseConfig({ defaultTarget: 'el', customLanguages: [{ code: 'grc', name: 'Ancient Greek' }] }),
      providers: [providerView({ keyHint: 'abcd…' }), providerView({ id: 'srv-2', name: 'DeepL Main', type: 'deepl', enabled: false })],
    });
    const { container } = render(<TranslationSection />);
    await screen.findByText('DeepL Main');
    const results = await axe.run(container);
    const summary = results.violations
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
      .join('\n');
    expect(summary).toBe('');
  });
});
