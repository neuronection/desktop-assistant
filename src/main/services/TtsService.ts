import { MainConfigService } from '@main/services/ConfigService';
import { SecretService, providerSecretKey } from '@main/services/SecretService';
import { beginAudioOp, endAudioOp, isAbortError } from '@main/ai/audioOps';
import { resolveTaskModel } from '@shared/ai/tasks';
import { isKeylessBaseUrl } from '@shared/ai/local';
import { resolveVoiceProfile } from '@shared/ai/voices';
import { AiTask, LLMProviderType } from '@shared/types';
import { synthesizeSpeech, type TtsAudio } from '@main/ai/tts';

/** Voice-affecting target resolved ONCE per utterance (plan 58 §4.4). */
export interface SpeechTarget {
  providerId: string;
  providerType: LLMProviderType;
  apiBase: string;
  modelId: string;
  apiKey: string;
  voice: string;
  speed?: number;
  timeout?: number;
}

export interface SpeechTargetOverrides {
  voice?: string;
  speed?: number;
}

export interface ResolvedSpeechParams extends SpeechTarget {
  text: string;
  requestId?: string;
}

/**
 * Task-assignment-backed TTS host: resolves the `tts` task (provider +
 * model + keyring secret) and synthesizes. Returns null when the task
 * is unassigned — speaking is opt-in twice (toggle + assignment).
 */
export class TtsService {
  private configService: MainConfigService;

  constructor() {
    this.configService = MainConfigService.getInstance();
  }

  /**
   * `requireToggle=true` is the auto-play path (Settings gate); explicit
   * per-reply/selection speaks pass false — only the tts assignment is
   * required there. `requestId` names the op on the audioOps seam so the
   * renderer can cancel it; a cancelled synthesis returns null (silent —
   * never an error notice).
   */
  async speak(text: string, requireToggle = true, requestId?: string): Promise<TtsAudio | null> {
    const config = this.configService.getConfig();
    if (requireToggle && !config.voice?.speakReplies) {
      return null;
    }
    if (!text.trim()) {
      return null;
    }
    const target = await this.resolveTarget();
    if (!target) {
      return null;
    }
    return this.speakResolved({ ...target, text, requestId });
  }

  /**
   * Resolves provider/model/voice/speed/key once, so a config edit between
   * key computation and synthesis can never write voice-B audio under a
   * voice-A cache key (plan 58 D4).
   *
   * `overrides` exists only for the Settings voice preview: the draft
   * voice/speed is auditioned without saving config.
   */
  async resolveTarget(overrides: SpeechTargetOverrides = {}): Promise<SpeechTarget | null> {
    const config = this.configService.getConfig();
    const resolution = resolveTaskModel(config, AiTask.TTS);
    if (!resolution) {
      return null;
    }
    const apiKey =
      (await SecretService.getInstance().getSecret(providerSecretKey(resolution.providerId))) ??
      resolution.provider.apiKey ??
      '';
    const keyless =
      resolution.provider.type === LLMProviderType.OLLAMA ||
      isKeylessBaseUrl(resolution.provider.apiBase);
    if (!apiKey && !keyless) {
      return null;
    }
    const profile = resolveVoiceProfile({
      providerType: resolution.provider.type,
      modelId: resolution.modelId,
      apiBase: resolution.provider.apiBase,
    });
    const requestedVoice = overrides.voice ?? config.voice?.speechVoice;
    const requestedSpeed = overrides.speed ?? config.voice?.speechSpeed;
    const speedUnsupported =
      profile.supportsSpeed === 'no' ||
      typeof requestedSpeed !== 'number' ||
      !Number.isFinite(requestedSpeed);
    const speed = speedUnsupported ? undefined : requestedSpeed;

    return {
      providerId: resolution.providerId,
      providerType: resolution.provider.type,
      apiBase: resolution.provider.apiBase,
      modelId: resolution.modelId,
      apiKey,
      voice: requestedVoice?.trim() || profile.defaultVoice,
      speed,
      timeout: typeof resolution.provider.timeout === 'number' ? resolution.provider.timeout : undefined,
    };
  }

  async speakResolved(params: ResolvedSpeechParams): Promise<TtsAudio | null> {
    if (!params.text.trim()) {
      return null;
    }
    const signal = beginAudioOp(params.requestId);
    try {
      return await synthesizeSpeech({
        apiKey: params.apiKey,
        apiBase: params.apiBase,
        model: params.modelId,
        text: params.text,
        voice: params.voice,
        speed: params.speed,
        providerType: params.providerType,
        providerId: params.providerId,
        signal,
        timeout: params.timeout,
      });
    } catch (error) {
      if (isAbortError(error)) {
        return null;
      }
      throw error;
    } finally {
      endAudioOp(params.requestId);
    }
  }
}
