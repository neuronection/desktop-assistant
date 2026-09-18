import { MainConfigService } from '@main/services/ConfigService';
import { SecretService, providerSecretKey } from '@main/services/SecretService';
import { resolveTaskModel } from '@shared/ai/tasks';
import { AiTask, LLMProviderType } from '@shared/types';
import type { LLMProvider } from '@shared/types';
import { resolveLanguage } from '@shared/languages';
import type { LanguageEntry } from '@shared/languages';
import type {
  TranslationProviderConfig,
  TranslationProviderSaveInput,
  TranslationProviderTestResult,
  TranslationProviderView,
} from '@shared/translation';
import { translationProviderRequiresKey } from '@shared/translation';
import { assertHttpUrl } from './search-providers';
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

export const TRANSLATION_DEFAULT_TIMEOUT_MS = 10_000;
export const TRANSLATION_MAX_TIMEOUT_MS = 30_000;

function effectiveTimeout(config: TranslationProviderConfig): number {
  const n = Math.round(config.timeoutMs ?? TRANSLATION_DEFAULT_TIMEOUT_MS);
  return Math.min(TRANSLATION_MAX_TIMEOUT_MS, Math.max(1_000, Number.isFinite(n) ? n : TRANSLATION_DEFAULT_TIMEOUT_MS));
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
  configService: Pick<MainConfigService, 'getConfig' | 'updateConfig'>;
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
    const customLanguages = translation?.customLanguages ?? [];
    const rawTarget = request.target ?? translation?.defaultTarget ?? null;
    if (!rawTarget) {
      throw new Error('No target language given and no default target is set. Use /tr <language> <text> or pick a default in settings.');
    }
    const targetEntry = resolveLanguage(rawTarget, customLanguages);
    if (!targetEntry) {
      throw new Error(`Unknown target language '${rawTarget}'.`);
    }
    let sourceEntry: LanguageEntry | undefined;
    if (request.source) {
      sourceEntry = resolveLanguage(request.source, customLanguages) ?? undefined;
      if (!sourceEntry) {
        throw new Error(`Unknown source language '${request.source}'.`);
      }
    }
    const target = targetEntry.code;
    const source = sourceEntry?.code;

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
          : await this.runLlm(step, llm, { text, targetEntry, sourceEntry });
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

  // ---------------------------------------------------------------------------
  // Provider CRUD (plan 19 S2 — mirrors SearchService; keys keyring-only)
  // ---------------------------------------------------------------------------

  private providers(): TranslationProviderConfig[] {
    return this.deps.configService.getConfig().translation?.providers ?? [];
  }

  private async persist(providers: TranslationProviderConfig[]): Promise<void> {
    const current = this.deps.configService.getConfig().translation;
    await this.deps.configService.updateConfig({
      translation: {
        mode: current?.mode ?? 'auto',
        defaultTarget: current?.defaultTarget ?? null,
        customLanguages: current?.customLanguages ?? [],
        providers,
      },
    });
  }

  private view(config: TranslationProviderConfig): TranslationProviderView {
    return { config, hasKey: Boolean(config.keyHint) };
  }

  listProviders(): TranslationProviderView[] {
    return this.providers().map((config) => this.view(config));
  }

  async saveProvider(input: TranslationProviderSaveInput): Promise<TranslationProviderView> {
    const { key, ...config } = input;
    if (!config.name?.trim()) {
      throw new Error('Provider name is required.');
    }
    if (config.type === 'libretranslate') {
      if (!config.apiBase?.trim()) {
        throw new Error('LibreTranslate needs a server URL.');
      }
      assertHttpUrl(config.apiBase.trim(), 'Server URL');
    } else if (config.apiBase?.trim()) {
      assertHttpUrl(config.apiBase.trim(), 'API base URL');
    }
    if (key !== undefined) {
      const secretService = SecretService.getInstance();
      if (key.trim() === '') {
        await secretService.deleteSecret(translationProviderSecretKey(config.id));
        config.keyHint = undefined;
      } else {
        await secretService.setSecret(translationProviderSecretKey(config.id), key.trim());
        config.keyHint = SecretService.keyHint(key.trim());
      }
    }
    if (translationProviderRequiresKey(config.type) && !config.keyHint) {
      throw new Error('DeepL needs an API key.');
    }
    const providers = this.providers().filter((provider) => provider.id !== config.id);
    providers.push(config);
    await this.persist(providers);
    return this.view(config);
  }

  async deleteProvider(providerId: string): Promise<boolean> {
    if (!this.providers().some((provider) => provider.id === providerId)) {
      return false;
    }
    await this.persist(this.providers().filter((provider) => provider.id !== providerId));
    await SecretService.getInstance().deleteSecret(translationProviderSecretKey(providerId));
    return true;
  }

  async setProviderEnabled(providerId: string, enabled: boolean): Promise<boolean> {
    if (!this.providers().some((provider) => provider.id === providerId)) {
      return false;
    }
    await this.persist(this.providers().map((provider) => (provider.id === providerId ? { ...provider, enabled } : provider)));
    return true;
  }

  async moveProvider(providerId: string, direction: 'up' | 'down'): Promise<boolean> {
    const providers = [...this.providers()];
    const index = providers.findIndex((provider) => provider.id === providerId);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= providers.length) {
      return false;
    }
    [providers[index], providers[target]] = [providers[target], providers[index]];
    await this.persist(providers);
    return true;
  }

  async testProvider(providerId: string, fetchImpl?: typeof fetch): Promise<TranslationProviderTestResult> {
    const provider = this.providers().find((candidate) => candidate.id === providerId);
    if (!provider) {
      return { ok: false, error: 'Unknown translation provider.' };
    }
    const fetcher = TRANSLATION_FETCHERS[provider.type];
    if (!fetcher) {
      return { ok: false, error: `Translation service type '${provider.type}' is not available.` };
    }
    const startedAt = Date.now();
    const defaultTarget = this.deps.configService.getConfig().translation?.defaultTarget ?? null;
    const target = resolveLanguage(defaultTarget ?? 'en')?.code ?? 'en';
    const controller = new AbortController();
    const timeoutMs = effectiveTimeout(provider);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const key = provider.keyHint
        ? ((await this.deps.getSecret(translationProviderSecretKey(provider.id))) ?? null)
        : null;
      const outcome = await fetcher({
        config: provider,
        key,
        text: 'hello',
        target,
        signal: controller.signal,
        ...(fetchImpl ? { fetchImpl } : {}),
      });
      return { ok: true, latencyMs: Date.now() - startedAt, translation: outcome.text };
    } catch (error) {
      const message =
        (error as Error).name === 'AbortError'
          ? `timed out after ${Math.round(timeoutMs / 1000)}s.`
          : ((error as Error).message ?? String(error)).slice(0, 200);
      return { ok: false, latencyMs: Date.now() - startedAt, error: message };
    } finally {
      clearTimeout(timer);
    }
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
    const timeoutMs = effectiveTimeout(step.provider);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (input.signal) {
      if (input.signal.aborted) {
        controller.abort();
      } else {
        input.signal.addEventListener('abort', onExternalAbort);
      }
    }
    try {
      const key = step.provider.keyHint
        ? ((await this.deps.getSecret(translationProviderSecretKey(step.provider.id))) ?? null)
        : null;
      return await fetcher({
        config: step.provider,
        key,
        text: input.text,
        target: input.target,
        ...(input.source ? { source: input.source } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        if (input.signal?.aborted) {
          throw error;
        }
        throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  private async runLlm(
    _step: Extract<EngineStep, { kind: 'llm' }>,
    llm: Awaited<ReturnType<TranslateService['resolveLlm']>>,
    input: { text: string; targetEntry: LanguageEntry; sourceEntry?: LanguageEntry }
  ): Promise<TranslationOutcome> {
    if (!llm) {
      throw new Error('No translation model is assigned in settings.');
    }
    return translateWithLlm(this.deps.gateway, {
      provider: llm.provider,
      modelId: llm.modelId,
      apiKey: llm.apiKey,
      text: input.text,
      target: { code: input.targetEntry.code, name: input.targetEntry.name },
      ...(input.sourceEntry ? { source: { code: input.sourceEntry.code, name: input.sourceEntry.name } } : {}),
    });
  }
}
