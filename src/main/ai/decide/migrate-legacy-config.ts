import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { LLMProvider, Model } from '@shared/types';
import { LLMProviderType } from '@shared/types';
import { JEV_MODEL_ID, decisionSlot, SYSTEMONE_DECISION_CAPS } from '@shared/ai/decisions';
import { JEV_BASE_URLS } from './legacy-endpoints';

/**
 * The pre-plan-26 keyring key id that backed the Jev engine — the retired
 * secret this migration copies to `provider:<id>` and then deletes (D8).
 * Not a live decision-secret id: it names the thing being removed, exists
 * only for the one-time copy-then-verify-then-delete, and R7 holds that no
 * decision secret may live under anything but `provider:<id>`.
 */
const RETIRED_JEV_KEYRING_KEY = 'openrouter:key';

export interface LegacyDecisionMigrationDeps {
  configPath(): string;
  userDataDir(): string;
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
  keyHint(value: string): string;
}

export interface LegacyDecisionMigrationResult {
  /** True when the stored config still carried pre-plan-26 decision fields. */
  migrated: boolean;
  /** True when the legacy `openrouter:key` secret was migrated and deleted. */
  secretMigrated: boolean;
  /** True when the retired local-engine cache was removed from userData. */
  needleCacheRemoved: boolean;
  /** The transformed raw config (the input object when `migrated` is false). */
  config: Record<string, unknown>;
}

function jevDecisionModel(providerId: string, providerType: LLMProviderType, modelId: string): Model {
  return {
    id: modelId,
    name: 'Jev (latest)',
    providerType,
    providerId,
    caps: ['decision'],
    decisionTransport: 'systemone',
  };
}

function providerForEndpoint(
  endpoint: string,
  customBaseUrl: string,
  providers: LLMProvider[],
  keyHint: string | undefined
): LLMProvider {
  if (endpoint === 'openrouter') {
    const existing = providers.find(
      (provider) => provider.presetKey === 'openrouter' || (provider.type === LLMProviderType.OPENAI && provider.apiBase === 'https://openrouter.ai/api/v1')
    );
    if (existing) {
      return { ...existing, ...(keyHint ? { apiKeyHint: keyHint } : {}) };
    }
    return {
      id: uuidv4(),
      name: 'OpenRouter',
      type: LLMProviderType.OPENAI,
      apiKey: '',
      ...(keyHint ? { apiKeyHint: keyHint } : {}),
      apiBase: 'https://openrouter.ai/api/v1',
      presetKey: 'openrouter',
      timeout: 120000,
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: 'You are a helpful assistant.',
      availableModels: [],
      customModels: [],
    };
  }
  if (endpoint === 'typesafe') {
    const existing = providers.find(
      (provider) => provider.presetKey === 'typesafe' || (provider.type === LLMProviderType.DECISION && provider.apiBase === JEV_BASE_URLS.typesafe)
    );
    if (existing) {
      return { ...existing, ...(keyHint ? { apiKeyHint: keyHint } : {}) };
    }
    return {
      id: uuidv4(),
      name: 'TypeSafe',
      type: LLMProviderType.DECISION,
      apiKey: '',
      ...(keyHint ? { apiKeyHint: keyHint } : {}),
      apiBase: JEV_BASE_URLS.typesafe,
      presetKey: 'typesafe',
      timeout: 120000,
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: 'You are a helpful assistant.',
      availableModels: [],
      customModels: [],
    };
  }
  const base = customBaseUrl.trim().replace(/\/+$/, '');
  const existing = providers.find((provider) => provider.type === LLMProviderType.DECISION && provider.apiBase === base);
  if (existing) {
    return { ...existing, ...(keyHint ? { apiKeyHint: keyHint } : {}) };
  }
  return {
    id: uuidv4(),
    name: 'Decision endpoint',
    type: LLMProviderType.DECISION,
    apiKey: '',
    ...(keyHint ? { apiKeyHint: keyHint } : {}),
    apiBase: base,
    timeout: 120000,
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: 'You are a helpful assistant.',
    availableModels: [],
    customModels: [],
  };
}

async function removeNeedleCache(userDataDir: string): Promise<boolean> {
  const needleDir = path.join(userDataDir, 'needle');
  try {
    const info = await stat(needleDir);
    if (!info.isDirectory()) {
      return false;
    }
    await rm(needleDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * The one-time legacy-decision migration (plan 26 S2, owner ruling §13.8 —
 * no users, straight delete wherever nothing is stored):
 *
 * - `decision.engine: 'jev'` + `decision.jev` → provider row (TypeSafe or
 *   OpenRouter per endpoint; custom → manual `decision`-type row) +
 *   `jev-latest` model + `decision:*` assignments; the `openrouter:key`
 *   secret is copied to `provider:<id>` (copy-then-verify-then-delete).
 * - `decision.engine: 'llm' | 'needle'` → fields dropped, slots stay
 *   unassigned (byte-identical to pre-feature OFF) and the one-time
 *   deep-link notice flag is set.
 * - `taskAssignments.intent` and both legacy decision fields are dropped
 *   outright; the `userData/needle/` cache is removed.
 *
 * Idempotent: a config without legacy fields is returned untouched and no
 * backup is written. `config.json` is backed up (once) before the first
 * migration write.
 */
export async function migrateLegacyDecisionConfig(
  raw: Record<string, unknown>,
  deps: LegacyDecisionMigrationDeps
): Promise<LegacyDecisionMigrationResult> {
  const decision = (raw.decision && typeof raw.decision === 'object' ? raw.decision : {}) as {
    engine?: unknown;
    jev?: { endpoint?: unknown; baseUrl?: unknown } | null;
  };
  const legacyEngine = typeof decision.engine === 'string' ? decision.engine : null;
  const taskAssignments = (raw.taskAssignments && typeof raw.taskAssignments === 'object' ? raw.taskAssignments : {}) as Record<string, unknown>;
  const hasLegacyIntent = 'intent' in taskAssignments;
  const hasLegacyFields = Boolean(legacyEngine) || Boolean(decision.jev) || hasLegacyIntent;

  const needleCacheRemoved = await removeNeedleCache(deps.userDataDir());
  if (!hasLegacyFields) {
    return { migrated: false, secretMigrated: false, needleCacheRemoved, config: raw };
  }

  const next: Record<string, unknown> = { ...raw };
  let secretMigrated = false;

  if (legacyEngine === 'jev') {
    const endpoint = decision.jev?.endpoint === 'typesafe' || decision.jev?.endpoint === 'custom' ? decision.jev.endpoint : 'openrouter';
    const customBaseUrl = typeof decision.jev?.baseUrl === 'string' ? decision.jev.baseUrl : '';
    const providers = Array.isArray(raw.providers) ? [...(raw.providers as LLMProvider[])] : [];

    const provider = providerForEndpoint(endpoint, customBaseUrl, providers, undefined);
    const legacyKey = await deps.getSecret(RETIRED_JEV_KEYRING_KEY);
    let keyHint: string | undefined;
    if (legacyKey) {
      // copy-then-verify-then-delete (plan 26 §5): a code revert never strands a key.
      const secretId = `provider:${provider.id}`;
      await deps.setSecret(secretId, legacyKey);
      const verify = await deps.getSecret(secretId);
      if (verify === legacyKey) {
        await deps.deleteSecret(RETIRED_JEV_KEYRING_KEY);
        secretMigrated = true;
        keyHint = deps.keyHint(legacyKey);
      }
    }

    const modelId = endpoint === 'openrouter' ? 'openrouter.jev-latest' : JEV_MODEL_ID;
    const model = jevDecisionModel(provider.id, provider.type, modelId);
    const merged: LLMProvider = {
      ...provider,
      ...(keyHint ? { apiKeyHint: keyHint } : {}),
      availableModels: [
        ...(provider.availableModels ?? []).filter((existing) => existing.id !== model.id),
        model,
      ],
    };
    const providerIndex = providers.findIndex((candidate) => candidate.id === provider.id);
    if (providerIndex >= 0) {
      providers[providerIndex] = merged;
    } else {
      providers.push(merged);
    }
    next.providers = providers;
    if (!raw.defaultProviderId && providers.length === 1) {
      next.defaultProviderId = provider.id;
    }

    const assignments = { ...taskAssignments };
    delete assignments.intent;
    for (const capability of SYSTEMONE_DECISION_CAPS) {
      const slot = decisionSlot(capability);
      const current = assignments[slot];
      if (typeof current !== 'string' || current.trim().length === 0) {
        assignments[slot] = model.id;
      }
    }
    next.taskAssignments = assignments;
  } else {
    const assignments = { ...taskAssignments };
    delete assignments.intent;
    next.taskAssignments = assignments;
  }

  const nextDecision = { ...(next.decision as Record<string, unknown> | undefined ?? {}) };
  delete nextDecision.engine;
  delete nextDecision.jev;
  if (legacyEngine === 'llm' || legacyEngine === 'needle') {
    nextDecision.legacyEngineNotice = true;
  }
  next.decision = nextDecision;

  const backupPath = `${deps.configPath()}.pre-plan26`;
  if (!existsSync(backupPath)) {
    const dir = path.dirname(deps.configPath());
    await mkdir(dir, { recursive: true });
    await copyFile(deps.configPath(), backupPath);
  }

  return { migrated: true, secretMigrated, needleCacheRemoved, config: next };
}

/** Test helper: lists files under a directory (empty when missing). */
export async function listDir(target: string): Promise<string[]> {
  try {
    return await readdir(target);
  } catch {
    return [];
  }
}
