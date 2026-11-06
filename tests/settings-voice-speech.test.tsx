// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { VoiceTab } from '@renderer/settings-react/tabs/VoiceTab';
import { DEFAULT_CONFIG, type AppConfig } from '@shared/config/AppConfig';
import { LLMProviderType } from '@shared/types';
import { TEXT, interpolate } from '@shared/constants/text';
import { chooseOption } from './combobox';

afterEach(cleanup);

const STATS = {
  enabled: true,
  available: true,
  utterances: 4,
  bytes: 6.5 * 1024 * 1024,
};

function installApi() {
  const api = {
    getSpeechCacheStats: vi.fn(async () => ({ ...STATS })),
    clearSpeechCache: vi.fn(async () => true),
    previewSpeech: vi.fn(async () => 'started'),
    onSpeechState: vi.fn(() => () => undefined),
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
  return api;
}

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

const googleProvider = {
  ...DEFAULT_CONFIG.providers[0],
  id: 'g1',
  name: 'Google',
  type: LLMProviderType.GOOGLE,
  availableModels: [{ id: 'gemini-tts', name: 'gemini-tts', providerType: LLMProviderType.GOOGLE, providerId: 'g1' }],
};

const openAiProvider = {
  ...DEFAULT_CONFIG.providers[0],
  id: 'o1',
  name: 'OpenAI',
  type: LLMProviderType.OPENAI,
  availableModels: [{ id: 'tts-1', name: 'tts-1', providerType: LLMProviderType.OPENAI, providerId: 'o1' }],
};

function ttsConfig(provider = openAiProvider, model = 'tts-1'): AppConfig {
  return config({
    providers: [provider],
    taskAssignments: { ...DEFAULT_CONFIG.taskAssignments, tts: model },
  });
}

const RULE_EXCLUSIONS: Record<string, string> = {};

async function expectNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations
    .filter((violation) => !(RULE_EXCLUSIONS[violation.id] && violation.impact !== 'critical'))
    .map((violation) => `${violation.id} (${violation.impact})`)
    .join('\n');
  expect(summary).toBe('');
}

beforeEach(() => {
  installApi();
});

describe('Voice → Selection speech (plan 58 S5)', () => {
  it('shows cache usage and clears it', async () => {
    const api = installApi();
    const onChange = vi.fn();
    const { container } = render(<VoiceTab config={config()} onChange={onChange} onOpenTasks={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: TEXT.VOICE_TAB_SPEECH }));

    const usage = interpolate(TEXT.VOICE_SPEECH_CACHE_USAGE, { utterances: 4, size: '6.5 MB' });
    await waitFor(() => expect(screen.getByText(usage)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: TEXT.VOICE_SPEECH_CACHE_CLEAR }));
    await waitFor(() => expect(api.clearSpeechCache).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.getSpeechCacheStats).toHaveBeenCalledTimes(2));
    await expectNoViolations(container);
  });

  it('reports an unavailable cache honestly', async () => {
    const api = installApi();
    api.getSpeechCacheStats.mockResolvedValue({ ...STATS, available: false, utterances: 0, bytes: 0 });
    render(<VoiceTab config={config()} onChange={vi.fn()} onOpenTasks={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: TEXT.VOICE_TAB_SPEECH }));
    await waitFor(() => expect(screen.getByText(TEXT.VOICE_SPEECH_CACHE_UNAVAILABLE)).toBeTruthy());
    expect(
      (screen.getByRole('button', { name: TEXT.VOICE_SPEECH_CACHE_CLEAR }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('patches the flat speech keys without dropping siblings', () => {
    const onChange = vi.fn();
    render(<VoiceTab config={config()} onChange={onChange} onOpenTasks={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: TEXT.VOICE_TAB_SPEECH }));

    fireEvent.click(screen.getByLabelText(TEXT.VOICE_SPEECH_CACHE));
    const patch = onChange.mock.calls.at(-1)?.[0] as AppConfig;
    expect(patch.voice.speechCache).toBe(false);
    expect(patch.voice.language).toBe(DEFAULT_CONFIG.voice.language);
    expect(patch.voice.speechHudPosture).toBe('auto');
  });

  it('gates the speed knob for a GOOGLE-flavoured speech provider', async () => {
    const cfg = config({ providers: [googleProvider], taskAssignments: { ...DEFAULT_CONFIG.taskAssignments, tts: 'gemini-tts' } });
    render(<VoiceTab config={cfg} onChange={vi.fn()} onOpenTasks={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: TEXT.VOICE_TAB_SPEECH }));
    const slider = screen.getByLabelText(new RegExp(TEXT.VOICE_SPEECH_SPEED)) as HTMLInputElement;
    expect(slider.disabled).toBe(true);
    expect(screen.getByText(TEXT.VOICE_SPEECH_SPEED_GATED)).toBeTruthy();
  });

  it('keeps the speed knob enabled for non-GOOGLE providers', () => {
    const cfg = config({
      taskAssignments: { ...DEFAULT_CONFIG.taskAssignments, tts: DEFAULT_CONFIG.providers[0].id },
    });
    const provider = {
      ...DEFAULT_CONFIG.providers[0],
      availableModels: [
        { id: 'tts-1', name: 'tts-1', providerType: LLMProviderType.OPENAI, providerId: DEFAULT_CONFIG.providers[0].id },
      ],
    };
    render(
      <VoiceTab config={{ ...cfg, providers: [provider] }} onChange={vi.fn()} onOpenTasks={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('tab', { name: TEXT.VOICE_TAB_SPEECH }));
    const slider = screen.getByLabelText(new RegExp(TEXT.VOICE_SPEECH_SPEED)) as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    expect(screen.getByText(TEXT.VOICE_SPEECH_SPEED_HINT)).toBeTruthy();
  });

  it('edits the selection limit', () => {
    const onChange = vi.fn();
    render(<VoiceTab config={config()} onChange={onChange} onOpenTasks={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: TEXT.VOICE_TAB_SPEECH }));
    fireEvent.change(screen.getByLabelText(TEXT.VOICE_SELECTION_MAX_CHARS), { target: { value: '12000' } });
    expect(onChange.mock.calls.at(-1)?.[0].voice.selectionMaxChars).toBe(12000);
  });
});

describe('Voice → Replies: speaking voice (plan 60)', () => {
  it('offers the provider default and presets, and stores the picked voice', () => {
    const onChange = vi.fn();
    render(<VoiceTab config={ttsConfig()} onChange={onChange} onOpenTasks={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: TEXT.VOICE_TAB_REPLIES }));

    const trigger = screen.getByRole('combobox', { name: TEXT.VOICE_SPEAK_VOICE });
    fireEvent.click(trigger);
    expect(
      screen.getAllByText(interpolate(TEXT.VOICE_SPEAK_VOICE_DEFAULT, { voice: 'alloy' })).length
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Nova'));
    expect(onChange.mock.calls.at(-1)?.[0].voice.speechVoice).toBe('nova');
  });

  it('accepts a manual voice name through the create row', () => {
    const onChange = vi.fn();
    render(<VoiceTab config={ttsConfig()} onChange={onChange} onOpenTasks={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: TEXT.VOICE_TAB_REPLIES }));

    fireEvent.click(screen.getByRole('combobox', { name: TEXT.VOICE_SPEAK_VOICE }));
    const search = screen.getByRole('combobox', { name: 'Search options' });
    fireEvent.change(search, { target: { value: 'af_sky+af_bella' } });
    fireEvent.click(
      screen.getByText(interpolate(TEXT.VOICE_SPEAK_VOICE_USE, { voice: 'af_sky+af_bella' }))
    );
    expect(onChange.mock.calls.at(-1)?.[0].voice.speechVoice).toBe('af_sky+af_bella');
  });

  it('shows a mismatch warning with a reset for an out-of-profile voice', () => {
    const onChange = vi.fn();
    render(
      <VoiceTab
        config={{ ...ttsConfig(), voice: { ...ttsConfig().voice, speechVoice: 'af_sky+af_bella' } }}
        onChange={onChange}
        onOpenTasks={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: TEXT.VOICE_TAB_REPLIES }));
    expect(screen.getByText(TEXT.VOICE_SPEAK_VOICE_MISMATCH)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.VOICE_SPEAK_VOICE_RESET }));
    expect(onChange.mock.calls.at(-1)?.[0].voice.speechVoice).toBe('');
  });

  it('previews the draft voice and speed through main', () => {
    const api = installApi();
    render(
      <VoiceTab
        config={{ ...ttsConfig(), voice: { ...ttsConfig().voice, speechVoice: 'nova', speechSpeed: 1.25 } }}
        onChange={vi.fn()}
        onOpenTasks={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: TEXT.VOICE_TAB_REPLIES }));
    fireEvent.click(screen.getByRole('button', { name: TEXT.VOICE_SPEAK_VOICE_PREVIEW }));
    expect(api.previewSpeech).toHaveBeenCalledWith({ voice: 'nova', speed: 1.25 });
  });

  it('disables the voice control and preview until a speech model is assigned', () => {
    render(<VoiceTab config={config()} onChange={vi.fn()} onOpenTasks={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: TEXT.VOICE_TAB_REPLIES }));
    expect(
      (screen.getByRole('combobox', { name: TEXT.VOICE_SPEAK_VOICE }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: TEXT.VOICE_SPEAK_VOICE_PREVIEW }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
