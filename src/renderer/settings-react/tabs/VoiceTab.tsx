import { useEffect, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { SegmentedTabs } from '@neuronection/assistant-ui/segmented-tabs';
import { AppConfig, } from '@shared/config/AppConfig';
import { AiTask } from '@shared/types';
import { findModel } from '@shared/ai/tasks';
import type { DecisionSettingsState } from '@shared/ai/decisions';
import { DECISION_ENGINE_NAMES } from '@shared/ai/decisions';
import { TEXT, interpolate } from '@shared/constants/text';
import { Field, SelectField } from './fields';

export interface VoiceTabProps {
  config: AppConfig;
  onChange: (updates: Partial<AppConfig>) => void;
  onOpenTasks: () => void;
  /** Jump to Tools → Decision (engine / scope / rules). */
  onOpenDecision?: () => void;
}

const inputClass = 'w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-3 py-2 text-sm';

const LANGUAGE_CODES = [
  'en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'uk',
  'tr', 'el', 'ar', 'he', 'hi', 'zh', 'ja', 'ko', 'sv', 'da',
  'nb', 'fi', 'cs', 'ro', 'hu',
];

const GAP_OPTIONS = [400, 700, 1000, 1500];
const MAX_SEGMENT_OPTIONS = [0, 5000, 10000, 15000, 30000];

export type VoiceSection = 'input' | 'replies';

const VOICE_SECTIONS: { id: VoiceSection; label: string }[] = [
  { id: 'input', label: TEXT.VOICE_TAB_INPUT },
  { id: 'replies', label: TEXT.VOICE_TAB_REPLIES },
];

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

function assignedModelLabel(config: AppConfig, task: AiTask): string {
  const modelId = config.taskAssignments?.[task];
  if (!modelId) {
    return TEXT.VOICE_MODEL_UNASSIGNED;
  }
  const found = findModel(config, modelId);
  if (!found) {
    return modelId;
  }
  return `${found.model.name} — ${found.provider.name}`;
}

export function VoiceTab({ config, onChange, onOpenTasks, onOpenDecision }: VoiceTabProps): JSX.Element {
  const voice = config.voice;
  const [section, setSection] = useState<VoiceSection>('input');
  const [decisionState, setDecisionState] = useState<DecisionSettingsState | null>(null);

  useEffect(() => {
    const fetchState = window.electronAPI?.getDecisionState;
    if (!fetchState) {
      return;
    }
    void Promise.resolve(fetchState.call(window.electronAPI))
      .then(setDecisionState)
      .catch(() => setDecisionState(null));
  }, []);

  const decisionEngine = decisionState?.engines?.find((engine) => engine.kind === config.decision.engine);
  const decisionReady = decisionEngine?.readiness.state === 'ready';

  const patch = (updates: Partial<AppConfig['voice']>): void => {
    onChange({ voice: { ...voice, ...updates } });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h3 className="text-base font-semibold">{TEXT.VOICE_PAGE_TITLE}</h3>
        <p className="text-sm opacity-60">{TEXT.VOICE_PAGE_SUBTITLE}</p>
      </section>

      <SegmentedTabs
        ariaLabel={TEXT.VOICE_TABS_ARIA}
        items={VOICE_SECTIONS.map((entry) => ({ value: entry.id, label: entry.label }))}
        value={section}
        onValueChange={(next) => setSection(next as VoiceSection)}
      />

      {section === 'input' && (
        <div role="tabpanel" aria-label={TEXT.VOICE_TAB_INPUT} className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={voice.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            {TEXT.VOICE_ENABLE}
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="voice-language-select"
              label={TEXT.VOICE_LANGUAGE}
              hint={TEXT.VOICE_LANGUAGE_HINT}
              value={voice.language}
              onChange={(value) => patch({ language: value })}
              options={[
                { value: 'auto', label: TEXT.VOICE_LANGUAGE_AUTO },
                ...LANGUAGE_CODES.map((code) => ({ value: code, label: `${languageName(code)} (${code})` })),
              ]}
            />

            <SelectField
              id="voice-gap-select"
              label={TEXT.VOICE_PHRASE_GAP}
              hint={TEXT.VOICE_PHRASE_GAP_HINT}
              value={String(voice.phraseGapMs)}
              onChange={(value) => patch({ phraseGapMs: Number(value) })}
              disabled={!voice.liveTranscript || !voice.enabled}
              options={GAP_OPTIONS.map((ms) => ({ value: String(ms), label: secondsLabel(TEXT.VOICE_GAP_SECONDS, ms) }))}
            />

            <SelectField
              id="voice-live-gap-select"
              label={TEXT.VOICE_LIVE_PHRASE_GAP}
              hint={TEXT.VOICE_LIVE_PHRASE_GAP_HINT}
              value={String(voice.livePhraseGapMs)}
              onChange={(value) => patch({ livePhraseGapMs: Number(value) })}
              disabled={!voice.liveTranscript || !voice.enabled}
              options={GAP_OPTIONS.map((ms) => ({ value: String(ms), label: secondsLabel(TEXT.VOICE_GAP_SECONDS, ms) }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="voice-max-segment-select"
              label={TEXT.VOICE_MAX_SEGMENT}
              hint={TEXT.VOICE_MAX_SEGMENT_HINT}
              value={String(voice.maxSegmentMs)}
              onChange={(value) => patch({ maxSegmentMs: Number(value) })}
              disabled={!voice.liveTranscript || !voice.enabled}
              options={MAX_SEGMENT_OPTIONS.map((ms) => ({ value: String(ms), label: secondsLabel(TEXT.VOICE_GAP_SECONDS, ms) }))}
            />

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
          {voice.autoSend && (
            <>
              <SelectField
                id="voice-auto-send-engine"
                label={TEXT.VOICE_AUTO_SEND_ENGINE_LABEL}
                value={voice.autoSendEngine ?? 'decision'}
                disabled={!voice.enabled}
                onChange={(value) => patch({ autoSendEngine: value as 'decision' | 'task' })}
                options={[
                  { value: 'decision', label: TEXT.VOICE_AUTO_SEND_ENGINE_DECISION },
                  { value: 'task', label: TEXT.VOICE_AUTO_SEND_ENGINE_TASK },
                ]}
              />
              <p className="text-xs opacity-50">
                {voice.autoSendEngine === 'task' ? (
                  <span>{TEXT.VOICE_AUTO_SEND_ENGINE_TASK_DETAIL}</span>
                ) : config.decision.engine === 'off' ? (
                  <span>{TEXT.VOICE_AUTO_SEND_ENGINE_OFF}</span>
                ) : (
                  <span className={decisionReady ? '' : 'opacity-70'}>
                    {interpolate(TEXT.VOICE_AUTO_SEND_ENGINE_USING, {
                      engine: DECISION_ENGINE_NAMES[config.decision.engine],
                    })}
                    {decisionReady ? '' : ` — ${TEXT.DECISION_ENGINE_STATUS_NEEDS_KEY}`}
                  </span>
                )}{' '}
                <button
                  type="button"
                  className="font-medium text-[var(--as-primary)] underline underline-offset-2"
                  onClick={() => onOpenDecision?.()}
                >
                  {TEXT.VOICE_AUTO_SEND_ENGINE_LINK}
                </button>
              </p>
            </>
          )}

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

          <div className="flex items-center justify-between gap-2 border-t border-[var(--as-border)] pt-3 text-sm">
            <span className="opacity-70">{TEXT.API_TASK_STT}</span>
            <span className={config.taskAssignments?.stt ? '' : 'opacity-50'}>
              {assignedModelLabel(config, AiTask.STT)}
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={onOpenTasks}>{TEXT.VOICE_CONFIGURE_MODELS}</Button>
        </div>
      )}

      {section === 'replies' && (
        <div role="tabpanel" aria-label={TEXT.VOICE_TAB_REPLIES} className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={voice.speakReplies}
              onChange={(e) => patch({ speakReplies: e.target.checked })}
            />
            {TEXT.VOICE_SPEAK_REPLIES}
          </label>
          <p className="text-xs opacity-60">{TEXT.VOICE_SPEAK_REPLIES_HINT}</p>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={voice.speakOnRequest}
              onChange={(e) => patch({ speakOnRequest: e.target.checked })}
            />
            {TEXT.VOICE_SPEAK_ON_REQUEST}
          </label>
          <p className="text-xs opacity-60">{TEXT.VOICE_SPEAK_ON_REQUEST_HINT}</p>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={voice.liveShowIgnored}
              onChange={(e) => patch({ liveShowIgnored: e.target.checked })}
            />
            {TEXT.VOICE_LIVE_SHOW_IGNORED}
          </label>
          <p className="text-xs opacity-60">{TEXT.VOICE_LIVE_SHOW_IGNORED_HINT}</p>
          <label className="flex items-center gap-2 text-sm font-medium">
            {TEXT.VOICE_LIVE_TURN_CAP}
            <input
              type="number"
              min={0}
              value={voice.liveTurnCap}
              onChange={(e) => patch({ liveTurnCap: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              className="w-20 rounded-md border border-[var(--as-border)] bg-[var(--as-surface)] px-2 py-1 text-sm"
            />
          </label>
          <p className="text-xs opacity-60">{TEXT.VOICE_LIVE_TURN_CAP_HINT}</p>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={voice.bargeInOnSpeakers}
              onChange={(e) => patch({ bargeInOnSpeakers: e.target.checked })}
            />
            {TEXT.VOICE_BARGE_IN_ON_SPEAKERS}
          </label>
          <p className="text-xs opacity-60">{TEXT.VOICE_BARGE_IN_ON_SPEAKERS_HINT}</p>
          <p className="text-xs opacity-60">
            {TEXT.VOICE_SPEAK_RULE_HINT}{' '}
            <button
              type="button"
              className="font-medium text-[var(--as-primary)] underline underline-offset-2"
              onClick={() => void window.electronAPI.onSettingsOpen({ tab: 'tools', section: 'decisions' })}
            >
              {TEXT.VOICE_SPEAK_RULE_LINK}
            </button>
          </p>
          <p className="text-xs opacity-60">{TEXT.VOICE_SPEAK_MODEL_HINT}</p>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--as-border)] pt-3 text-sm">
            <span className="opacity-70">{TEXT.API_TASK_TTS}</span>
            <span className={config.taskAssignments?.tts ? '' : 'opacity-50'}>
              {assignedModelLabel(config, AiTask.TTS)}
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={onOpenTasks}>{TEXT.VOICE_CONFIGURE_MODELS}</Button>
        </div>
      )}
    </div>
  );
}
