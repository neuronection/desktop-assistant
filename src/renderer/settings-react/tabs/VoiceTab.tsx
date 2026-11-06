import { useEffect, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { Combobox } from '@neuronection/assistant-ui/combobox';
import { SegmentedTabs } from '@neuronection/assistant-ui/segmented-tabs';
import { AppConfig, } from '@shared/config/AppConfig';
import { AiTask } from '@shared/types';
import type { SpeechCacheStats, SpeechSnapshot } from '@shared/speech';
import { findModel } from '@shared/ai/tasks';
import { resolveVoiceProfile } from '@shared/ai/voices';
import type { DecisionSettingsState } from '@shared/ai/decisions';
import { TEXT, interpolate } from '@shared/constants/text';
import { pickLanguages } from '@shared/languages';
import { Field, Label, SelectField } from './fields';

export interface VoiceTabProps {
  config: AppConfig;
  onChange: (updates: Partial<AppConfig>) => void;
  onOpenTasks: () => void;
  /** Jump to Tools → Decision (engine / scope / rules). */
  onOpenDecision?: () => void;
  /** Jump to Settings → Hub (appearance, actions, Studio). */
  onOpenHub?: () => void;
}

const inputClass = 'w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-3 py-2 text-sm';

/** STT source languages, same curated set and order as before, sliced from the shared catalog (ADR-0024). */
const STT_LANGUAGES = pickLanguages([
  'en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'uk',
  'tr', 'el', 'ar', 'he', 'hi', 'zh', 'ja', 'ko', 'sv', 'da',
  'nb', 'fi', 'cs', 'ro', 'hu',
]);

const GAP_OPTIONS = [400, 700, 1000, 1500];
const MAX_SEGMENT_OPTIONS = [0, 5000, 10000, 15000, 30000];
const IDLE_OPTIONS = [0, 30_000, 60_000, 120_000, 300_000];
const SPOKEN_OPTIONS = [0, 1000, 2000, 4000, 8000];

export type VoiceSection = 'input' | 'replies' | 'live' | 'speech';

const VOICE_SECTIONS: { id: VoiceSection; label: string }[] = [
  { id: 'input', label: TEXT.VOICE_TAB_INPUT },
  { id: 'replies', label: TEXT.VOICE_TAB_REPLIES },
  { id: 'live', label: TEXT.VOICE_TAB_LIVE },
  { id: 'speech', label: TEXT.VOICE_TAB_SPEECH },
];

function cacheSizeLabel(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return interpolate(TEXT.VOICE_SPEECH_CACHE_SIZE, { size: mb < 10 ? mb.toFixed(1) : Math.round(mb) });
}

function languageName(code: string): string {
  try {
    // 'en' mirrors the app UI language (English-only today); follow the app UI
    // language per plan-18 decision #2 if a UI language setting ever lands.
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

function durationLabel(ms: number): string {
  if (ms <= 0) {
    return TEXT.VOICE_OFF;
  }
  if (ms < 60_000) {
    return interpolate(TEXT.VOICE_GAP_SECONDS, { seconds: ms / 1000 });
  }
  return interpolate(TEXT.VOICE_MINUTES, { minutes: ms / 60_000 });
}

function charLabel(chars: number): string {
  return chars <= 0 ? TEXT.VOICE_UNLIMITED : interpolate(TEXT.VOICE_CHARS, { count: chars });
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

export function VoiceTab({ config, onChange, onOpenTasks, onOpenDecision, onOpenHub }: VoiceTabProps): JSX.Element {
  const voice = config.voice;
  const [section, setSection] = useState<VoiceSection>('input');
  const [decisionState, setDecisionState] = useState<DecisionSettingsState | null>(null);
  const [cacheStats, setCacheStats] = useState<SpeechCacheStats | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const refreshCacheStats = (): void => {
    const api = window.electronAPI;
    if (!api?.getSpeechCacheStats) {
      return;
    }
    void Promise.resolve(api.getSpeechCacheStats())
      .then(setCacheStats)
      .catch(() => setCacheStats(null));
  };

  useEffect(() => {
    if (section === 'speech') {
      refreshCacheStats();
    }
  }, [section]);

  useEffect(() => {
    const fetchState = window.electronAPI?.getDecisionState;
    if (!fetchState) {
      return;
    }
    void Promise.resolve(fetchState.call(window.electronAPI))
      .then(setDecisionState)
      .catch(() => setDecisionState(null));
  }, []);

  const gateSlot = decisionState?.slots.find((slot) => slot.capability === 'boolean-gate');
  const decisionReady = gateSlot?.readiness.state === 'ready';
  const decisionConfigured = Boolean(gateSlot?.assignedModelId ?? gateSlot?.fallbackModelId);
  const decisionModelLabel = gateSlot?.assignedModelId ?? gateSlot?.fallbackModelId ?? null;

  const patch = (updates: Partial<AppConfig['voice']>): void => {
    onChange({ voice: { ...voice, ...updates } });
  };

  useEffect(() => {
    const subscribe = window.electronAPI?.onSpeechState;
    if (!subscribe) {
      return;
    }
    return subscribe((snapshot: SpeechSnapshot) => {
      if (!previewing) {
        return;
      }
      if (snapshot.source === 'preview' && snapshot.state !== 'idle') {
        setPreviewError(snapshot.lastError);
        return;
      }
      if (snapshot.state === 'idle') {
        setPreviewing(false);
        setPreviewError(snapshot.lastError);
        return;
      }
      if (snapshot.source !== 'preview') {
        setPreviewing(false);
      }
    });
  }, [previewing]);

  const ttsAssignment = config.taskAssignments?.[AiTask.TTS];
  const ttsTarget = ttsAssignment ? findModel(config, ttsAssignment) : null;
  const voiceProfile = ttsTarget
    ? resolveVoiceProfile({
        providerType: ttsTarget.provider.type,
        modelId: ttsTarget.model.id,
        apiBase: ttsTarget.provider.apiBase,
      })
    : null;
  const speedGated = voiceProfile?.supportsSpeed === 'no';
  const storedVoice = voice.speechVoice.trim();
  const isCustomVoice =
    storedVoice.length > 0 && !(voiceProfile?.voices.some((option) => option.id === storedVoice) ?? false);
  const voiceOptions = voiceProfile
    ? [
        {
          value: '',
          label: interpolate(TEXT.VOICE_SPEAK_VOICE_DEFAULT, { voice: voiceProfile.defaultVoice }),
        },
        ...voiceProfile.voices.map((option) => ({
          value: option.id,
          label: option.label,
          description: option.hint,
          group: interpolate(TEXT.VOICE_SPEAK_VOICE_PROFILE, { profile: voiceProfile.label }),
        })),
        ...(isCustomVoice
          ? [{ value: storedVoice, label: storedVoice, description: TEXT.VOICE_SPEAK_VOICE_CUSTOM }]
          : []),
      ]
    : [];

  const previewVoice = async (): Promise<void> => {
    const api = window.electronAPI;
    if (!api?.previewSpeech) {
      return;
    }
    setPreviewError(null);
    setPreviewing(true);
    try {
      const outcome = await api.previewSpeech({ voice: voice.speechVoice, speed: voice.speechSpeed });
      if (outcome === 'live_busy') {
        setPreviewing(false);
        setPreviewError(TEXT.VOICE_SPEAK_VOICE_LIVE_BUSY);
      } else if (outcome === 'ignored') {
        setPreviewing(false);
        setPreviewError(TEXT.VOICE_SPEAK_VOICE_UNAVAILABLE);
      }
    } catch (error) {
      setPreviewing(false);
      setPreviewError(
        interpolate(TEXT.VOICE_SPEAK_VOICE_FAILED, {
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
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
                ...STT_LANGUAGES.map((entry) => ({
                  value: entry.code,
                  label: entry.flag ? `${entry.flag} ${languageName(entry.code)} (${entry.code})` : `${languageName(entry.code)} (${entry.code})`,
                })),
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
                ) : !decisionConfigured ? (
                  <span>{TEXT.VOICE_AUTO_SEND_ENGINE_OFF}</span>
                ) : (
                  <span className={decisionReady ? '' : 'opacity-70'}>
                    {interpolate(TEXT.VOICE_AUTO_SEND_ENGINE_USING, {
                      engine: decisionModelLabel ?? '',
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
          <div className="space-y-1 border-t border-[var(--as-border)] pt-3">
            <Label htmlFor="voice-speak-voice">{TEXT.VOICE_SPEAK_VOICE}</Label>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Combobox
                  id="voice-speak-voice"
                  hideLabel
                  label={TEXT.VOICE_SPEAK_VOICE}
                  options={voiceOptions}
                  value={voice.speechVoice}
                  onChange={(value) => patch({ speechVoice: value })}
                  disabled={!voiceProfile}
                  allowCreate
                  createLabel={(term) => interpolate(TEXT.VOICE_SPEAK_VOICE_USE, { voice: term })}
                  placeholder={
                    voiceProfile
                      ? interpolate(TEXT.VOICE_SPEAK_VOICE_DEFAULT, { voice: voiceProfile.defaultVoice })
                      : TEXT.VOICE_SPEAK_VOICE_UNAVAILABLE
                  }
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!voiceProfile || previewing}
                onClick={() => void previewVoice()}
              >
                {previewing ? TEXT.VOICE_SPEAK_VOICE_PREVIEWING : TEXT.VOICE_SPEAK_VOICE_PREVIEW}
              </Button>
            </div>
            <p className="text-xs opacity-60">{TEXT.VOICE_SPEAK_VOICE_HINT}</p>
            {isCustomVoice && (
              <p className="text-xs text-[var(--as-warning)]">
                <span>{TEXT.VOICE_SPEAK_VOICE_MISMATCH}</span>{' '}
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  onClick={() => patch({ speechVoice: '' })}
                >
                  {TEXT.VOICE_SPEAK_VOICE_RESET}
                </button>
              </p>
            )}
            {previewError && (
              <p role="alert" className="text-xs text-[var(--as-danger)]">
                {previewError}
              </p>
            )}
          </div>
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

      {section === 'live' && (
        <div role="tabpanel" aria-label={TEXT.VOICE_TAB_LIVE} className="space-y-3">
          <p className="text-xs opacity-60">{TEXT.VOICE_LIVE_SECTION_HINT}</p>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={voice.bargeInOnSpeakers}
              onChange={(e) => patch({ bargeInOnSpeakers: e.target.checked })}
            />
            {TEXT.VOICE_BARGE_IN_ON_SPEAKERS}
          </label>
          <p className="text-xs opacity-60">{TEXT.VOICE_BARGE_IN_ON_SPEAKERS_HINT}</p>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={voice.liveShowIgnored}
              onChange={(e) => patch({ liveShowIgnored: e.target.checked })}
            />
            {TEXT.VOICE_LIVE_SHOW_IGNORED}
          </label>
          <p className="text-xs opacity-60">{TEXT.VOICE_LIVE_SHOW_IGNORED_HINT}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="voice-live-gap-select"
              label={TEXT.VOICE_LIVE_PHRASE_GAP}
              hint={TEXT.VOICE_LIVE_PHRASE_GAP_HINT}
              value={String(voice.livePhraseGapMs)}
              onChange={(value) => patch({ livePhraseGapMs: Number(value) })}
              disabled={!voice.liveTranscript || !voice.enabled}
              options={GAP_OPTIONS.map((ms) => ({ value: String(ms), label: secondsLabel(TEXT.VOICE_GAP_SECONDS, ms) }))}
            />
            <SelectField
              id="voice-live-idle-select"
              label={TEXT.VOICE_LIVE_IDLE_TIMEOUT}
              hint={TEXT.VOICE_LIVE_IDLE_TIMEOUT_HINT}
              value={String(voice.liveIdleTimeoutMs)}
              onChange={(value) => patch({ liveIdleTimeoutMs: Number(value) })}
              options={IDLE_OPTIONS.map((ms) => ({ value: String(ms), label: durationLabel(ms) }))}
            />
            <SelectField
              id="voice-live-spoken-select"
              label={TEXT.VOICE_LIVE_SPOKEN_MAX}
              hint={TEXT.VOICE_LIVE_SPOKEN_MAX_HINT}
              value={String(voice.liveSpokenMaxChars)}
              onChange={(value) => patch({ liveSpokenMaxChars: Number(value) })}
              options={SPOKEN_OPTIONS.map((chars) => ({ value: String(chars), label: charLabel(chars) }))}
            />
          </div>
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
        </div>
      )}

      {section === 'speech' && (
        <div role="tabpanel" aria-label={TEXT.VOICE_TAB_SPEECH} className="space-y-4">
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={voice.speechCache}
                onChange={(e) => patch({ speechCache: e.target.checked })}
              />
              {TEXT.VOICE_SPEECH_CACHE}
            </label>
            <p className="text-xs opacity-60">{TEXT.VOICE_SPEECH_CACHE_HINT}</p>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--as-border)] px-3 py-2 text-xs">
              <span className="opacity-70">
                {cacheStats === null
                  ? '—'
                  : cacheStats.available
                    ? interpolate(TEXT.VOICE_SPEECH_CACHE_USAGE, {
                        utterances: cacheStats.utterances,
                        size: cacheSizeLabel(cacheStats.bytes),
                      })
                    : TEXT.VOICE_SPEECH_CACHE_UNAVAILABLE}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!cacheStats?.available || cacheStats.utterances === 0}
                onClick={() => {
                  void Promise.resolve(window.electronAPI?.clearSpeechCache?.())
                    .then(() => refreshCacheStats())
                    .catch(() => refreshCacheStats());
                }}
              >
                {TEXT.VOICE_SPEECH_CACHE_CLEAR}
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--as-border)] px-3 py-2">
            <div>
              <p className="text-sm font-medium">{TEXT.VOICE_SPEECH_HUD}</p>
              <p className="text-xs opacity-60">{TEXT.SETTINGS_NAV_HUB_DESCRIPTION}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => onOpenHub?.()}>
              {TEXT.HUB_SETTINGS_LINK}
            </Button>
          </div>

          <div className="space-y-1">
            <label htmlFor="voice-speech-speed" className="text-sm font-medium">
              {TEXT.VOICE_SPEECH_SPEED}{' '}
              <span className="font-normal tabular-nums opacity-70">
                {interpolate(TEXT.VOICE_SPEECH_SPEED_VALUE, { value: voice.speechSpeed.toFixed(2) })}
              </span>
            </label>
            <input
              id="voice-speech-speed"
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={voice.speechSpeed}
              disabled={speedGated}
              onChange={(e) => patch({ speechSpeed: Number(e.target.value) })}
              className="w-full accent-[var(--as-primary)]"
            />
            <p className="text-xs opacity-60">{speedGated ? TEXT.VOICE_SPEECH_SPEED_GATED : TEXT.VOICE_SPEECH_SPEED_HINT}</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="voice-selection-max" className="text-sm font-medium">
              {TEXT.VOICE_SELECTION_MAX_CHARS}
            </label>
            <input
              id="voice-selection-max"
              type="number"
              min={500}
              max={20_000}
              step={500}
              value={voice.selectionMaxChars}
              onChange={(e) => patch({ selectionMaxChars: Number(e.target.value) })}
              className={inputClass}
            />
            <p className="text-xs opacity-60">{TEXT.VOICE_SELECTION_MAX_CHARS_HINT}</p>
          </div>
        </div>
      )}
    </div>
  );
}
