import { MainConfigService } from '@main/services/ConfigService';
import { SecretService, providerSecretKey } from '@main/services/SecretService';
import { resolveTaskModel } from '@shared/ai/tasks';
import { AiTask, LLMProviderType } from '@shared/types';
import { synthesizeSpeech, type TtsAudio } from '@main/ai/tts';

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
   * required there.
   */
  async speak(text: string, requireToggle = true): Promise<TtsAudio | null> {
    const config = this.configService.getConfig();
    const voice = config.voice;
    if (requireToggle && !voice?.speakReplies) {
      return null;
    }
    const resolution = resolveTaskModel(config, AiTask.TTS);
    if (!resolution) {
      return null;
    }
    if (!text.trim()) {
      return null;
    }
    const apiKey =
      (await SecretService.getInstance().getSecret(providerSecretKey(resolution.providerId))) ??
      resolution.provider.apiKey ??
      '';
    if (!apiKey && resolution.provider.type !== LLMProviderType.OLLAMA) {
      return null;
    }
    return synthesizeSpeech({
      apiKey,
      apiBase: resolution.provider.apiBase,
      model: resolution.modelId,
      text,
      voice: voice.speakVoice || 'alloy',
      speed: voice.speakSpeed ?? 1,
      providerId: resolution.providerId,
    });
  }
}
