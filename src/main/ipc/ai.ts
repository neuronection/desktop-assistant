import { LLMProviderType, type IPCResponse, type LLMProvider, type Model, type ProviderTestResult } from '@shared/types';
import type { ApprovalResolution, TurnStartRequest } from '@shared/turns';
import { compactTtsError } from '@main/ai/tts';
import { FAIL_VERDICT, type UtteranceVerdict } from '@main/ai/utterance';
import { probeDecisionProvider } from '@main/ai/decide/systemone/probe';
import { ALL_PROVIDER_PRESETS, presetKeyForProvider } from '@shared/ai/providerPresets';
import { TEXT } from '@shared/constants/text';
import { SecretService, providerSecretKey } from '@main/services/SecretService';
import type { AIService } from '@main/services/AIService';
import type { SttService } from '@main/services/SttService';
import type { TtsService } from '@main/services/TtsService';
import type { TurnManager } from '@main/turns/TurnManager';
import type { LiveSessionService } from '@main/services/LiveSessionService';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface AiIpcDeps {
  aiService: AIService;
  ttsService: TtsService;
  sttService: SttService;
  turnManager: TurnManager;
  liveSession: () => LiveSessionService | null;
  evaluateUtterance: (text: string, conversationId?: string) => Promise<UtteranceVerdict>;
}

export function registerAiIpc(deps: AiIpcDeps): void {
  const { aiService, ttsService, sttService, turnManager } = deps;

  register(IPC['ai:tts-synthesize'], async (_event, text: string, requireToggle?: boolean) => {
    try {
      return await ttsService.speak(text, requireToggle !== false);
    } catch (error) {
      console.error('TTS synthesis failed:', error);
      throw new Error(compactTtsError(error));
    }
  });

  register(IPC['voice:evaluate-utterance'], async (_event, text: string, conversationId?: string) => {
    try {
      return await deps.evaluateUtterance(text, conversationId);
    } catch (error) {
      console.error('IPC Handler Error [voice:evaluate-utterance]:', error);
      return FAIL_VERDICT;
    }
  });

  register(IPC['stt:transcribe'], async (_event, audioData: Uint8Array) => {
    try {
      const audioBuffer = Buffer.from(audioData);

      const transcription = await sttService.transcribe(audioBuffer);
      return transcription;
    } catch (error) {
      console.error('IPC Handler Error [stt:transcribe]:', error);
      throw error;
    }
  });

  register(IPC['ai:turn-start'], async (event, request: TurnStartRequest) => {
    try {
      return await turnManager.start(request);
    } catch (error) {
      console.error('Failed to start turn:', error);
      throw error;
    }
  });

  register(IPC['ai:turn-cancel'], async () => {
    return turnManager.cancel();
  });

  register(IPC['ai:turn-resume'], async (_event, resolution: ApprovalResolution) => {
    const resolved = await turnManager.resolveApproval(resolution);
    if (resolved) {
      deps.liveSession()?.approvalResolved();
    }
    return resolved;
  });

  register(IPC['ai:fetch-models'], async (event, provider: LLMProvider): Promise<IPCResponse<Model[]>> => {
    if (provider.type === LLMProviderType.DECISION) {
      return { success: true, data: [] };
    }
    try {
      const models = await aiService.fetchAvailableModels(provider);
      return { success: true, data: models };
    } catch (error) {
      console.error('Failed to fetch AI models via IPC:', error);
      return { success: false, error: (error as Error).message, data: [] };
    }
  });

  register(IPC['ai:test-provider'], async (event, provider: LLMProvider): Promise<ProviderTestResult> => {
    const startedAt = Date.now();
    if (provider.type === LLMProviderType.DECISION) {
      // §15 single-source: a key-only probe derives its model id from the
      // provider's preset stamp in the canonical data — never a code
      // literal. No models and no derivable preset → honest failure with
      // an actionable message instead of an invented id.
      const probeModel =
        (provider.availableModels ?? []).find((model) => (model.caps ?? []).includes('decision')) ??
        (provider.availableModels ?? [])[0];
      if (probeModel) {
        const key =
          provider.apiKey ||
          (await SecretService.getInstance().getSecret(providerSecretKey(provider.id))) ||
          '';
        const probe = await probeDecisionProvider({ provider, model: probeModel, apiKey: key });
        return { ok: probe.ok, latencyMs: probe.latencyMs, modelCount: probe.ok ? 1 : 0, error: probe.error ?? null };
      }
      const presetKey = presetKeyForProvider(provider);
      const preset = presetKey ? ALL_PROVIDER_PRESETS[presetKey] : undefined;
      const probeId = preset?.decisionDefault ?? preset?.decisionModels?.[0]?.modelId ?? '';
      if (!probeId) {
        return {
          ok: false,
          latencyMs: 0,
          modelCount: 0,
          error: TEXT.DECISION_TEST_NEEDS_MODEL,
        };
      }
      const key =
        provider.apiKey ||
        (await SecretService.getInstance().getSecret(providerSecretKey(provider.id))) ||
        '';
      const probe = await probeDecisionProvider({
        provider,
        model: { id: probeId, name: probeId, providerType: provider.type, providerId: provider.id },
        apiKey: key,
      });
      return { ok: probe.ok, latencyMs: probe.latencyMs, modelCount: probe.ok ? 1 : 0, error: probe.error ?? null };
    }
    try {
      const models = await aiService.fetchAvailableModels(provider);
      const latencyMs = Date.now() - startedAt;
      if (models.length === 0) {
        return { ok: false, latencyMs, modelCount: 0, error: 'No models reachable (check the API key).' };
      }
      return { ok: true, latencyMs, modelCount: models.length, error: null };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - startedAt, modelCount: 0, error: (error as Error).message };
    }
  });
}
