import type { JSX } from 'react';
import { AppConfig } from '@shared/config/AppConfig';
import { TEXT, interpolate } from '@shared/constants/text';
import { Field } from './fields';

export interface VoiceSectionProps {
  config: AppConfig;
  onChange: (updates: Partial<AppConfig>) => void;
}

const inputClass = 'w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-3 py-2 text-sm';

const LANGUAGE_CODES = [
  'en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'uk',
  'tr', 'el', 'ar', 'he', 'hi', 'zh', 'ja', 'ko', 'sv', 'da',
  'nb', 'fi', 'cs', 'ro', 'hu',
];

const GAP_OPTIONS = [400, 700, 1000, 1500];
const MAX_SEGMENT_OPTIONS = [0, 5000, 10000, 15000, 30000];

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function secondsLabel(text: string, ms: number): string {
  if (ms === 0) {
    return TEXT.VOICE_MAX_SEGMENT_OFF;
  }
  return interpolate(text, { seconds: (ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1) });
}

export function VoiceSection({ config, onChange }: VoiceSectionProps): JSX.Element {
  const voice = config.voice;

  const patch = (updates: Partial<AppConfig['voice']>): void => {
    onChange({ voice: { ...voice, ...updates } });
  };

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{TEXT.VOICE_SECTION_TITLE}</h3>
        <p className="text-sm opacity-60">{TEXT.VOICE_SECTION_SUBTITLE}</p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={voice.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
        {TEXT.VOICE_ENABLE}
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={TEXT.VOICE_LANGUAGE} htmlFor="voice-language-select" hint={TEXT.VOICE_LANGUAGE_HINT}>
          <select
            id="voice-language-select"
            className={inputClass}
            value={voice.language}
            onChange={(e) => patch({ language: e.target.value })}
          >
            <option value="auto">{TEXT.VOICE_LANGUAGE_AUTO}</option>
            {LANGUAGE_CODES.map((code) => (
              <option key={code} value={code}>{`${languageName(code)} (${code})`}</option>
            ))}
          </select>
        </Field>

        <Field label={TEXT.VOICE_PHRASE_GAP} htmlFor="voice-gap-select" hint={TEXT.VOICE_PHRASE_GAP_HINT}>
          <select
            id="voice-gap-select"
            className={inputClass}
            value={String(voice.phraseGapMs)}
            onChange={(e) => patch({ phraseGapMs: Number(e.target.value) })}
            disabled={!voice.liveTranscript || !voice.enabled}
          >
            {GAP_OPTIONS.map((ms) => (
              <option key={ms} value={String(ms)}>{secondsLabel(TEXT.VOICE_GAP_SECONDS, ms)}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={TEXT.VOICE_MAX_SEGMENT} htmlFor="voice-max-segment-select" hint={TEXT.VOICE_MAX_SEGMENT_HINT}>
          <select
            id="voice-max-segment-select"
            className={inputClass}
            value={String(voice.maxSegmentMs)}
            onChange={(e) => patch({ maxSegmentMs: Number(e.target.value) })}
            disabled={!voice.liveTranscript || !voice.enabled}
          >
            {MAX_SEGMENT_OPTIONS.map((ms) => (
              <option key={ms} value={String(ms)}>{secondsLabel(TEXT.VOICE_GAP_SECONDS, ms)}</option>
            ))}
          </select>
        </Field>

        <Field label={TEXT.VOICE_GAIN} htmlFor="voice-gain-slider" hint={TEXT.VOICE_GAIN_HINT}>
          <div className="flex items-center gap-2">
            <input
              id="voice-gain-slider"
              type="range"
              min={0.5}
              max={4}
              step={0.25}
              value={voice.gain}
              disabled={!voice.enabled}
              onChange={(e) => patch({ gain: Number(e.target.value) })}
              className="h-1.5 w-full accent-[var(--as-primary)]"
            />
            <span className="w-12 text-right text-xs opacity-70">{interpolate(TEXT.VOICE_GAIN_TIMES, { gain: voice.gain.toFixed(2).replace(/\.?0+$/, '') })}</span>
          </div>
        </Field>
      </div>

      <label className={`flex items-center gap-2 text-sm ${voice.enabled ? '' : 'opacity-50'}`}>
        <input
          type="checkbox"
          checked={voice.liveTranscript}
          disabled={!voice.enabled}
          onChange={(e) => patch({ liveTranscript: e.target.checked })}
        />
        {TEXT.VOICE_LIVE_TRANSCRIPT}
      </label>
      <p className="text-xs opacity-50">{TEXT.VOICE_LIVE_HINT}</p>

      <label className={`flex items-center gap-2 text-sm ${voice.enabled ? '' : 'opacity-50'}`}>
        <input
          type="checkbox"
          checked={voice.autoSend}
          disabled={!voice.enabled}
          onChange={(e) => patch({ autoSend: e.target.checked })}
        />
        {TEXT.VOICE_AUTO_SEND}
      </label>
      <p className="text-xs opacity-50">{TEXT.VOICE_AUTO_SEND_HINT}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={`flex items-center gap-2 text-sm ${voice.enabled ? '' : 'opacity-50'}`}>
          <input
            type="checkbox"
            checked={voice.autoFix}
            disabled={!voice.enabled}
            onChange={(e) => patch({ autoFix: e.target.checked })}
          />
          {TEXT.VOICE_AUTO_FIX}
        </label>

        <label className={`flex items-center gap-2 text-sm ${voice.enabled ? '' : 'opacity-50'}`}>
          <input
            type="checkbox"
            checked={voice.formatting}
            disabled={!voice.enabled}
            onChange={(e) => patch({ formatting: e.target.checked })}
          />
          {TEXT.VOICE_FORMATTING}
        </label>
      </div>
      <p className="text-xs opacity-50">{TEXT.VOICE_AUTO_FIX_HINT}</p>

      <label className={`flex items-center gap-2 text-sm ${voice.enabled ? '' : 'opacity-50'}`}>
        <input
          type="checkbox"
          checked={voice.attachContext}
          disabled={!voice.enabled}
          onChange={(e) => patch({ attachContext: e.target.checked })}
        />
        {TEXT.VOICE_ATTACH_CONTEXT}
      </label>
      <p className="text-xs opacity-50">{TEXT.VOICE_ATTACH_CONTEXT_HINT}</p>

      <Field
        label={TEXT.VOICE_CUSTOM_PROMPT}
        htmlFor="voice-custom-prompt"
        hint={TEXT.VOICE_CUSTOM_PROMPT_HINT}
      >
        <textarea
          id="voice-custom-prompt"
          rows={2}
          className={inputClass}
          placeholder={TEXT.VOICE_CUSTOM_PROMPT_PLACEHOLDER}
          value={voice.customPrompt}
          disabled={!voice.enabled}
          onChange={(e) => patch({ customPrompt: e.target.value })}
        />
      </Field>
    </section>
  );
}
