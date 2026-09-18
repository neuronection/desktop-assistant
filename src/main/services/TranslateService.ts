import { MainConfigService } from '@main/services/ConfigService';
import { SecretService, providerSecretKey } from '@main/services/SecretService';
import { resolveTaskModel } from '@shared/ai/tasks';
import { AiTask, LLMProviderType } from '@shared/types';
import type { LLMProvider } from '@shared/types';
import { findLanguage } from '@shared/languages';
import { aiGateway } from '@main/ai/gateway';
import {
  MAX_TRANSLATE_INPUT_CHARS,
  TRANSLATION_FETCHERS,
  planEngines,
  translateWithLlm,
  type EngineStep,
  type LlmTranslateDeps,
  type TranslationOutcome,
} from '@main/ai/translate';

export function translationProviderSecretKey(providerId: string): string {
  return `translation:${providerId}:key`;
}

export interface TranslateRequest {
  text: string;
  target?: string;
  source?: string;
}

export interface TranslateResult {
  text: string;
  engine: string;
  source?: string;
}

export interface TranslateCallOptions {
  signal?: AbortSignal;
}

export interface TranslateServiceDeps {
  configService: Pick<MainConfigService, 'getConfig'>;
  gateway: LlmTranslateDeps;
  getSecret(key: string): Promise<string | null>;
}

function defaultDeps(): TranslateServiceDeps {
  return {
    configService: MainConfigService.getInstance(),
    gateway: { invoke: (request) => aiGateway.chat(request) },
    getSecret: (key) => SecretService.getInstance().getSecret(key),
  };
}

function errorText(error: unknown): string {
  return ((error as Error).message ?? String(error)).slice(0, 200);
}

export class TranslateService {
  private static instance: TranslateService;

  static getInstance(): TranslateService {
    if (!TranslateService.instance) {
      TranslateService.instance = new TranslateService();
    }
    return TranslateService.instance;
  }

  constructor(private readonly deps: TranslateServiceDeps = defaultDeps()) {}

  async translate(request: TranslateRequest, options: TranslateCallOptions = {}): Promise<TranslateResult> {
    const config = this.deps.configService.getConfig();
    const text = request.text?.trim();
    if (!text) {
      throw new Error('No text to translate.');
    }
    if (text.length > MAX_TRANSLATE_INPUT_CHARS) {
      throw new Error(`Text is too long to translate (max ${MAX_TRANSLATE_INPUT_CHARS} characters).`);
    }

    const translation = config.translation;
    const rawTarget = request.target ?? translation?.defaultTarget ?? null;
    if (!rawTarget) {
      throw new Error('No target language given and no default target is set. Use /tr <language> <text> or pick a default in settings.');
    }
    const targetEntry = findLanguage(rawTarget);
    if (!targetEntry) {
      throw new Error(`Unknown target language '${rawTarget}'.`);
    }
    const target = targetEntry.code;
    let source: string | undefined;
    if (request.source) {
      const sourceEntry = findLanguage(request.source);
      if (!sourceEntry) {
        throw new Error(`Unknown source language '${request.source}'.`);
      }
      source = sourceEntry.code;
    }

    const llm = await this.resolveLlm(config.taskAssignments?.[AiTask.TRANSLATE] ?? null);
    const plan = planEngines(translation?.mode ?? 'auto', translation?.providers ?? [], llm !== null);
    if (plan.steps.length === 0) {
      throw new Error(plan.errors[0] ?? 'Translation is not configured.');
    }

    const errors: string[] = [];
    for (const step of plan.steps) {
      try {
        const outcome = step.kind === 'service'
          ? await this.runService(step, { text, target, source, signal: options.signal })
          : await this.runLlm(step, llm, { text, target, source });
        return outcome;
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          throw error;
        }
        errors.push(step.kind === 'service' ? `${step.provider.name}: ${errorText(error)}` : `Translation model: ${errorText(error)}`);
      }
    }
    throw new Error(`Translation failed. ${errors.join(' ')}`);
  }

  private async resolveLlm(assignedModelId: string | null): Promise<{
    providerId: string;
    modelId: string;
    apiKey: string;
    provider: LLMProvider;
  } | null> {
    if (!assignedModelId) {
      return null;
    }
    const config = this.deps.configService.getConfig();
    const resolution = resolveTaskModel(config, AiTask.TRANSLATE, null);
    if (!resolution) {
      return null;
    }
    const apiKey =
      (await this.deps.getSecret(providerSecretKey(resolution.providerId))) ?? resolution.provider.apiKey ?? '';
    if (!apiKey && resolution.provider.type !== LLMProviderType.OLLAMA) {
      return null;
    }
    return {
      providerId: resolution.providerId,
      modelId: resolution.modelId,
      apiKey: apiKey || 'local-server',
      provider: resolution.provider,
    };
  }

  private async runService(
    step: Extract<EngineStep, { kind: 'service' }>,
    input: { text: string; target: string; source?: string; signal?: AbortSignal }
  ): Promise<TranslationOutcome> {
    const fetcher = TRANSLATION_FETCHERS[step.provider.type];
    if (!fetcher) {
      throw new Error(`translation service type '${step.provider.type}' is not available.`);
    }
    const key = step.provider.keyHint
      ? ((await this.deps.getSecret(translationProviderSecretKey(step.provider.id))) ?? null)
      : null;
    return fetcher({
      config: step.provider,
      key,
      text: input.text,
      target: input.target,
      ...(input.source ? { source: input.source } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  private async runLlm(
    _step: Extract<EngineStep, { kind: 'llm' }>,
    llm: Awaited<ReturnType<TranslateService['resolveLlm']>>,
    input: { text: string; target: string; source?: string }
  ): Promise<TranslationOutcome> {
    if (!llm) {
      throw new Error('No translation model is assigned in settings.');
    }
    return translateWithLlm(this.deps.gateway, {
      provider: llm.provider,
      modelId: llm.modelId,
      apiKey: llm.apiKey,
      text: input.text,
      target: input.target,
      ...(input.source ? { source: input.source } : {}),
    });
  }
}
