// src/main/services/SttService.ts

import { MainConfigService } from '@main/services/ConfigService';
import { SecretService, providerSecretKey } from '@main/services/SecretService';
import { beginAudioOp, endAudioOp, isAbortError } from '@main/ai/audioOps';
import { resolveTaskModel } from '@shared/ai/tasks';
import { AiTask } from '@shared/types';
import { sanitizeTranscript, transcribeAudio } from '@main/ai/stt';

export class SttService {
  private configService: MainConfigService;

  constructor() {
    this.configService = MainConfigService.getInstance();
  }

  /**
   * `requestId` names the op on the audioOps seam so the renderer can
   * cancel it; a cancelled transcription returns null (silent — the
   * caller already treats null as "no transcript").
   */
  async transcribe(audioBuffer: Buffer, requestId?: string): Promise<string | null> {
    const config = this.configService.getConfig();
    const voice = config.voice;
    if (voice && !voice.enabled) {
      throw new Error('Voice input is disabled in settings.');
    }

    const resolution = resolveTaskModel(config, AiTask.STT);
    if (!resolution) {
      throw new Error('No transcription model is assigned in settings.');
    }

    const apiKey =
      (await SecretService.getInstance().getSecret(providerSecretKey(resolution.providerId))) ??
      resolution.provider.apiKey ??
      '';

    const signal = beginAudioOp(requestId);
    try {
      const raw = await transcribeAudio({
        apiKey: apiKey || 'local-server',
        apiBase: resolution.provider.apiBase,
        model: resolution.modelId,
        audio: audioBuffer,
        language: voice?.language && voice.language !== 'auto' ? voice.language : undefined,
        signal,
        timeout: typeof resolution.provider.timeout === 'number' ? resolution.provider.timeout : undefined,
      });
      return sanitizeTranscript(raw);
    } catch (error) {
      if (isAbortError(error)) {
        return null;
      }
      console.error('Error calling STT API:', error);
      throw new Error(`STT request failed: ${(error as Error).message}`);
    } finally {
      endAudioOp(requestId);
    }
  }
}
