// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { GeneralTab } from '@renderer/settings-react/tabs/GeneralTab';
import { ApiTab } from '@renderer/settings-react/tabs/ApiTab';
import { HotkeysTab } from '@renderer/settings-react/tabs/HotkeysTab';
import { SettingsApp } from '@renderer/settings-react/SettingsApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { ThemeType } from '@shared/constants/themes';
import { LLMProviderType } from '@shared/types';

afterEach(cleanup);

const config = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  ...DEFAULT_CONFIG,
  ...overrides,
});

describe('GeneralTab', () => {
  it('renders themes and reports theme changes', () => {
    const onChange = vi.fn();
    const onThemeChange = vi.fn();
    const { getByDisplayValue } = render(
      <GeneralTab config={config({ theme: ThemeType.DARK })} onChange={onChange} onThemeChange={onThemeChange} />
    );
    expect(getByDisplayValue('Dark')).toBeTruthy();
    fireEvent.change(getByDisplayValue('Dark'), { target: { value: ThemeType.ROSE } });
    expect(onChange).toHaveBeenCalledWith({ theme: ThemeType.ROSE });
    expect(onThemeChange).toHaveBeenCalledWith(ThemeType.ROSE);
  });

  it('toggles autostart', () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <GeneralTab config={config()} onChange={onChange} onThemeChange={vi.fn()} />
    );
    fireEvent.click(getByLabelText(/Launch Desktop Assistant on system startup/));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ preferences: expect.objectContaining({ autostart: true }) })
    );
  });

  it('toggles turn trace details', () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <GeneralTab config={config()} onChange={onChange} onThemeChange={vi.fn()} />
    );
    fireEvent.click(getByLabelText(/Show turn trace details/));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: expect.objectContaining({ traceDetails: true }) })
    );
  });

  it('toggles window transparency', () => {
    const onChange = vi.fn();
    const opaque = { ...DEFAULT_CONFIG.window, transparent: false };
    const { getByLabelText } = render(
      <GeneralTab config={{ ...DEFAULT_CONFIG, window: opaque }} onChange={onChange} onThemeChange={vi.fn()} />
    );
    fireEvent.click(getByLabelText(/Transparent window/));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ window: expect.objectContaining({ transparent: true }) })
    );
  });
});

describe('ApiTab', () => {
  const provider = {
    ...DEFAULT_CONFIG.providers[0],
    availableModels: [{ id: 'gpt-x', name: 'gpt-x', providerType: LLMProviderType.OPENAI, providerId: DEFAULT_CONFIG.providers[0].id }],
  };

  it('edits the voice input section', () => {
    const onChange = vi.fn();
    const cfg = config({ providers: [provider] });
    render(<ApiTab config={cfg} onChange={onChange} />);

    expect(screen.getByRole('heading', { name: 'Voice Input' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Enable voice input'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ voice: expect.objectContaining({ enabled: false }) })
    );

    fireEvent.change(screen.getByLabelText('Transcription language'), { target: { value: 'de' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ voice: expect.objectContaining({ language: 'de' }) })
    );

    fireEvent.change(screen.getByLabelText('Phrase pause'), { target: { value: '1000' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ voice: expect.objectContaining({ phraseGapMs: 1000 }) })
    );

    fireEvent.click(screen.getByLabelText('Live interim transcript'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ voice: expect.objectContaining({ liveTranscript: false }) })
    );

    fireEvent.click(screen.getByLabelText('Auto-send completed phrases'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ voice: expect.objectContaining({ autoSend: true }) })
    );

    fireEvent.change(screen.getByLabelText('Send every'), { target: { value: '10000' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ voice: expect.objectContaining({ maxSegmentMs: 10000 }) })
    );

    fireEvent.change(screen.getByLabelText('Mic gain'), { target: { value: '1.5' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ voice: expect.objectContaining({ gain: 1.5 }) })
    );

    fireEvent.click(screen.getByLabelText('Fix text'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ voice: expect.objectContaining({ autoFix: true }) })
    );

    fireEvent.click(screen.getByLabelText('Formatting'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ voice: expect.objectContaining({ formatting: true }) })
    );

    fireEvent.change(screen.getByLabelText('Custom instructions'), { target: { value: 'Always write K8s.' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ voice: expect.objectContaining({ customPrompt: 'Always write K8s.' }) })
    );

    fireEvent.click(screen.getByLabelText('Attach recent context'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ voice: expect.objectContaining({ attachContext: true }) })
    );
  });

  it('lists providers and disables delete for the last one', () => {
    const { getAllByText, getByText } = render(<ApiTab config={config({ providers: [provider] })} onChange={vi.fn()} />);
    expect(getAllByText(provider.name).length).toBeGreaterThan(0);
    expect((getByText('Delete') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens the edit modal and keeps the stored-key hint', () => {
    const withHint = { ...provider, apiKeyHint: '••••9999' };
    const { getAllByText, getByText } = render(
      <ApiTab config={config({ providers: [withHint, { ...provider, id: 'p2', name: 'Second' }] })} onChange={vi.fn()} />
    );
    fireEvent.click(getAllByText('Edit')[0]);
    expect(getByText(/leave empty to keep/)).toBeTruthy();
  });
});

describe('SettingsApp', () => {
  function mockApi(): void {
    window.electronAPI = {
      getAppVersion: vi.fn(async () => '0.0.0-test'),
      loadConfig: vi.fn(async () => DEFAULT_CONFIG),
      getHotkeySettings: vi.fn(async () => ({})),
    } as unknown as typeof window.electronAPI;
  }

  it('pins the sidebar layout override in settings.css', () => {
    const css = readFileSync(resolve(__dirname, '../src/renderer/styles/settings.css'), 'utf8');
    expect(css).toMatch(/\[data-as='settings-shell'\]\s*\{[^}]*grid-template-columns:\s*220px/s);
    expect(css).toMatch(/\[data-as='settings-shell'\] > nav,\s*\[data-as='settings-shell'\] > div\s*\{[^}]*grid-column:\s*span 1/s);
    expect(css).toMatch(/\[data-as='settings-shell'\] nav > div\s*\{[^}]*position:\s*sticky/s);
  });

  it('renders the nav and switches sections', async () => {
    mockApi();
    render(<SettingsApp onThemeChange={vi.fn()} />);
    const shell = await screen.findByRole('navigation', { name: /Settings sections/ });
    expect(shell).toBeTruthy();
    fireEvent.click(await within(shell).findByRole('button', { name: /Hotkeys/ }));
    await waitFor(() => expect(screen.getByText('Editable Hotkeys')).toBeTruthy());
  });

  it('renders the transcription task inside the API tab without a STT nav entry', async () => {
    mockApi();
    render(<SettingsApp onThemeChange={vi.fn()} />);
    const shell = await screen.findByRole('navigation', { name: /Settings sections/ });
    expect(within(shell).queryByRole('button', { name: /STT/ })).toBeNull();
    fireEvent.click(within(shell).getByRole('button', { name: /API Settings/ }));
    expect(await screen.findByText('Transcription (voice input)')).toBeTruthy();
  });
});

describe('HotkeysTab', () => {
  it('splits editable and fixed hotkeys', () => {
    const hotkeys = {
      'toggle-window': { action: 'toggle-window' as never, label: 'Toggle Window', accelerator: 'Alt+X', isEditable: true },
      'open-settings': { action: 'open-settings' as never, label: 'Open Settings', accelerator: 'Ctrl+S', isEditable: false },
    };
    const { getByText } = render(<HotkeysTab hotkeys={hotkeys} onHotkeysChange={vi.fn()} />);
    expect(getByText('Editable Hotkeys')).toBeTruthy();
    expect(getByText('Fixed Hotkeys')).toBeTruthy();
    expect(getByText('Alt+X')).toBeTruthy();
  });
});
