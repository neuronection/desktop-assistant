import type { AppConfig } from '@shared/config/AppConfig';
import type { SpeechSnapshot } from '@shared/speech';
import type { LiveSnapshot } from '@shared/live';
import {
  HUB_ACTIONS,
  type HubBusy,
  type HubActionId,
  type HubActionView,
  type HubResult,
} from '@shared/hub';
import { TEXT, interpolate } from '@shared/constants/text';
import type { SelectionResult } from '@main/services/DesktopContextService';
import type { TranslationRunResult } from '@shared/translation';
import type { SpeechSpeakOutcome } from '@shared/speech';

export type HubFixedAction =
  | 'speech-toggle'
  | 'speech-stop'
  | 'live-interrupt'
  | 'live-end';

export type HubActionRequest = HubActionId | HubFixedAction;

export interface HubServiceDeps {
  getConfig: () => AppConfig;
  getSpeech: () => SpeechSnapshot;
  getLive: () => LiveSnapshot;
  readSelection: () => Promise<SelectionResult>;
  readClipboard: () => string | Promise<string>;
  translate: (text: string, target: string) => Promise<TranslationRunResult>;
  speakSelection: () => Promise<SpeechSpeakOutcome>;
  speakClipboard: () => Promise<SpeechSpeakOutcome>;
  speechControl: (action: 'pause' | 'resume' | 'stop') => void;
  liveInterrupt: () => void;
  liveEnd: () => void;
  startLive: () => void;
  endLive: () => void;
  openAssistant: () => void;
  hideHub: () => void;
  openSettings: () => void;
  startDictation: () => void;
  sendResult: (result: HubResult) => void;
  openResult: (text: string) => void;
  sendBusy: (busy: HubBusy) => void;
  sendSelection: (state: { available: boolean }) => void;
}

const FIXED_ACTIONS: readonly HubFixedAction[] = [
  'speech-toggle',
  'speech-stop',
  'live-interrupt',
  'live-end',
];

function isFixed(id: string): id is HubFixedAction {
  return (FIXED_ACTIONS as readonly string[]).includes(id);
}

function isConfigured(id: string): id is HubActionId {
  return Object.prototype.hasOwnProperty.call(HUB_ACTIONS, id);
}

/**
 * Curated hub actions (plan 65). Everything runs in main: selection reads,
 * translation through the audited service, speech/live controls and the
 * curated app actions. The renderer never receives provider endpoints.
 */
export class HubService {
  private lastResult: HubResult | null = null;

  constructor(private readonly deps: HubServiceDeps) {}

  private emitResult(result: HubResult): void {
    this.lastResult = result;
    this.deps.sendResult(result);
  }

  /** Open the launcher with the last readable result (dock text / result button). */
  public activateResult(): void {
    if (!this.lastResult || this.lastResult.kind === 'error') {
      return;
    }
    const text = this.lastResult.text.trim();
    if (text) {
      this.deps.openResult(text);
    }
  }

  private async textTarget(): Promise<{ text: string; source: 'selection' | 'clipboard' } | null> {
    const selection = await this.deps.readSelection().catch(() => ({ ok: false } as SelectionResult));
    const selected = selection.ok === true ? selection.text?.trim() : '';
    if (selected) {
      return { text: selected, source: 'selection' };
    }
    const clipboard = (await this.deps.readClipboard()).trim();
    return clipboard ? { text: clipboard, source: 'clipboard' } : null;
  }

  public async checkSelection(): Promise<void> {
    this.deps.sendSelection({ available: (await this.textTarget()) !== null });
  }

  async actions(): Promise<HubActionView[]> {
    const config = this.deps.getConfig();
    const live = this.deps.getLive();
    const hasSelection = (await this.textTarget()) !== null;
    const liveActive = live.state !== 'idle' && live.state !== 'error';
    return config.voice.hubQuickActions
      .filter(isConfigured)
      .map((id) => {
        const def = HUB_ACTIONS[id];
        if (id === 'translate-selection' || id === 'speak-selection') {
          return {
            ...def,
            enabled: hasSelection,
            ...(hasSelection ? {} : { reason: TEXT.HUB_SELECTION_REQUIRED }),
          };
        }
        if (id === 'live-toggle') {
          return { ...def, enabled: true, active: liveActive };
        }
        return { ...def, enabled: true };
      });
  }

  async run(id: string): Promise<{ ok: boolean; error?: string }> {
    if (isFixed(id)) {
      this.runFixed(id);
      return { ok: true };
    }
    if (!isConfigured(id)) {
      return { ok: false, error: `Unknown hub action: ${id}` };
    }
    const slow = id === 'translate-selection' || id === 'speak-selection';
    if (slow) {
      this.deps.sendBusy({ id, active: true });
    }
    try {
      switch (id) {
        case 'translate-selection':
          return await this.translateSelection();
        case 'speak-selection':
          return await this.speakSelection();
        case 'dictate':
          this.deps.startDictation();
          return { ok: true };
        case 'live-toggle': {
          const live = this.deps.getLive();
          if (live.state === 'idle' || live.state === 'error') {
            this.deps.startLive();
          } else {
            this.deps.endLive();
          }
          return { ok: true };
        }
        case 'open-assistant':
          this.deps.openAssistant();
          return { ok: true };
        case 'hide-hub':
          this.deps.hideHub();
          return { ok: true };
        default:
          return { ok: false, error: `Unknown hub action: ${id}` };
      }
    } finally {
      if (slow) {
        this.deps.sendBusy({ id, active: false });
      }
    }
  }

  private runFixed(id: HubFixedAction): void {
    switch (id) {
      case 'speech-toggle': {
        const speech = this.deps.getSpeech();
        this.deps.speechControl(speech.state === 'paused' ? 'resume' : 'pause');
        return;
      }
      case 'speech-stop':
        this.deps.speechControl('stop');
        return;
      case 'live-interrupt':
        this.deps.liveInterrupt();
        return;
      case 'live-end':
        this.deps.liveEnd();
        return;
    }
  }

  private async translateSelection(): Promise<{ ok: boolean; error?: string }> {
    const targetText = await this.textTarget();
    if (!targetText) {
      const error = TEXT.HUB_SELECTION_REQUIRED;
      this.emitResult({
        id: 'translate-selection',
        kind: 'error',
        title: TEXT.HUB_RESULT_TITLE_ERROR,
        text: error,
        retryable: false,
      });
      return { ok: false, error };
    }
    const config = this.deps.getConfig();
    const target = config.translation.defaultTarget ?? 'en';
    const text = targetText.text.slice(0, config.voice.selectionMaxChars);
    try {
      const result = await this.deps.translate(text, target);
      this.emitResult({
        id: 'translate-selection',
        kind: 'translation',
        title: interpolate(TEXT.HUB_RESULT_TRANSLATION, {
          source: result.source ?? 'auto',
          target: result.target ?? target,
        }),
        text: result.text,
        retryable: true,
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitResult({
        id: 'translate-selection',
        kind: 'error',
        title: TEXT.HUB_RESULT_TITLE_ERROR,
        text: interpolate(TEXT.HUB_RESULT_TRANSLATION_FAILED, { error: message }),
        retryable: true,
      });
      return { ok: false, error: message };
    }
  }

  private async speakSelection(): Promise<{ ok: boolean; error?: string }> {
    const target = await this.textTarget();
    if (!target) {
      const error = TEXT.HUB_SELECTION_REQUIRED;
      this.emitResult({
        id: 'speak-selection',
        kind: 'error',
        title: TEXT.HUB_RESULT_TITLE_ERROR,
        text: error,
        retryable: false,
      });
      return { ok: false, error };
    }
    const outcome =
      target.source === 'selection'
        ? await this.deps.speakSelection()
        : await this.deps.speakClipboard();
    if (outcome === 'started' || outcome === 'queued' || outcome === 'replaced') {
      return { ok: true };
    }
    const error = TEXT.HUB_RESULT_SPEECH_FAILED;
    this.emitResult({
      id: 'speak-selection',
      kind: 'error',
      title: TEXT.HUB_RESULT_TITLE_ERROR,
      text: error,
      retryable: false,
    });
    return { ok: false, error };
  }
}
