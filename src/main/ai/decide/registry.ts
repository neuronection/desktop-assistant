import { AiTask, type LLMProvider } from '@shared/types';
import type { AppConfig } from '@shared/config/AppConfig';
import { resolveTaskModel } from '@shared/ai/tasks';
import {
  DECISION_ENGINE_NAMES,
  JEV_MODEL_ID,
  type DecisionCapability,
  type DecisionEngineKind,
  type DecisionSettings,
  type EngineReadiness,
} from '@shared/ai/decisions';
import type { StructuredModelFactory } from '../chat-models';
import type { DecisionEngine, RuntimeEngineKind } from './types';
import { LlmDecisionEngine } from './llm';
import { JevDecisionEngine } from './jev/engine';
import { NEEDLE_MODEL_ID } from './needle/pins';
import { locateVerifiedWeights } from './needle/weights';
import { NeedleDecisionEngine } from './needle/engine';
import type { NeedleTransportFactory } from './needle/transport';

export interface NeedleContext {
  userDataDir(): Promise<string>;
  resourceDir(): Promise<string>;
  createTransport?: NeedleTransportFactory;
  locateWeights?: (userDataDir: string) => Promise<string | null>;
}

export interface DecisionEngineDeps {
  getApiKey(provider: LLMProvider): Promise<string | null>;
  createStructuredModel?: StructuredModelFactory;
  needle?: NeedleContext;
  /** TypeSafe (Jev) keyring secret; absent → the jev engine is unavailable. */
  getJevKey?: () => Promise<string | null>;
  /** Injectable transport for the jev engine (tests / proxies). */
  fetchImpl?: typeof fetch;
}

export type DecisionEngineResolution =
  | { kind: 'off' }
  | { kind: 'unconfigured'; reason: string }
  | { kind: 'unavailable'; reason: string; engine?: RuntimeEngineKind }
  | { kind: 'llm-engine'; provider: LLMProvider; modelId: string }
  | { kind: 'needle-engine'; weightsPath: string; resourceDir: string; createTransport?: NeedleTransportFactory }
  | { kind: 'jev-engine'; apiKey: string };

/**
 * One registration per engine (plan 24 D2). Adding an engine is one file
 * plus one entry here; callers never switch on engine kind.
 */
export interface DecisionEngineRegistration {
  kind: RuntimeEngineKind;
  capabilities: ReadonlySet<DecisionCapability>;
  displayName: string;
  resolve(config: AppConfig, deps: DecisionEngineDeps): Promise<DecisionEngineResolution>;
  create(resolution: DecisionEngineResolution, deps: DecisionEngineDeps): Promise<DecisionEngine>;
  audit(resolution: DecisionEngineResolution): { providerId?: string; model: string } | null;
}

const llmRegistration: DecisionEngineRegistration = {
  kind: 'llm',
  capabilities: new Set<DecisionCapability>(['tool-dispatch']),
  displayName: DECISION_ENGINE_NAMES.llm,
  async resolve(config) {
    const resolution = resolveTaskModel(config, AiTask.INTENT) ?? resolveTaskModel(config, AiTask.CHAT);
    if (!resolution) {
      return { kind: 'unconfigured', reason: 'No model is assigned for decisions or chat in settings.' };
    }
    return { kind: 'llm-engine', provider: resolution.provider, modelId: resolution.modelId };
  },
  async create(resolution, deps) {
    if (resolution.kind !== 'llm-engine') {
      throw new Error('llm registration received a non-llm resolution');
    }
    const apiKey = (await deps.getApiKey(resolution.provider)) ?? '';
    return new LlmDecisionEngine({
      provider: resolution.provider,
      modelId: resolution.modelId,
      apiKey,
      ...(deps.createStructuredModel ? { createModel: deps.createStructuredModel } : {}),
    });
  },
  audit(resolution) {
    return resolution.kind === 'llm-engine'
      ? { providerId: resolution.provider.id, model: resolution.modelId }
      : null;
  },
};

const defaultNeedleContext: NeedleContext = {
  async userDataDir() {
    return (await import('./needle/context')).needleUserDataDir();
  },
  async resourceDir() {
    return (await import('./needle/context')).needleResourceDir();
  },
};

const needleRegistration: DecisionEngineRegistration = {
  kind: 'needle',
  capabilities: new Set<DecisionCapability>(['tool-dispatch']),
  displayName: DECISION_ENGINE_NAMES.needle,
  async resolve(_config, deps) {
    const needle = deps.needle ?? defaultNeedleContext;
    const userDataDir = await needle.userDataDir();
    const weightsPath = needle.locateWeights
      ? await needle.locateWeights(userDataDir)
      : await locateVerifiedWeights(userDataDir);
    if (!weightsPath) {
      return {
        kind: 'unavailable',
        reason: 'Needle weights are not downloaded yet (download from Settings).',
        engine: 'needle',
      };
    }
    return {
      kind: 'needle-engine',
      weightsPath,
      resourceDir: await needle.resourceDir(),
      ...(needle.createTransport ? { createTransport: needle.createTransport } : {}),
    };
  },
  async create(resolution) {
    if (resolution.kind !== 'needle-engine') {
      throw new Error('needle registration received a non-needle resolution');
    }
    return new NeedleDecisionEngine(resolution);
  },
  audit(resolution) {
    return resolution.kind === 'needle-engine' ? { model: NEEDLE_MODEL_ID } : null;
  },
};

const jevRegistration: DecisionEngineRegistration = {
  kind: 'jev',
  capabilities: new Set<DecisionCapability>(['tool-dispatch', 'boolean-gate', 'choice', 'score']),
  displayName: DECISION_ENGINE_NAMES.jev,
  async resolve(_config, deps) {
    const apiKey = await deps.getJevKey?.();
    if (!apiKey) {
      return { kind: 'unavailable', reason: 'TypeSafe (Jev) API key is not set.', engine: 'jev' };
    }
    return { kind: 'jev-engine', apiKey };
  },
  async create(resolution, deps) {
    if (resolution.kind !== 'jev-engine') {
      throw new Error('jev registration received a non-jev resolution');
    }
    return new JevDecisionEngine({
      apiKey: resolution.apiKey,
      ...(deps.fetchImpl ? { fetcher: deps.fetchImpl } : {}),
    });
  },
  audit(resolution) {
    return resolution.kind === 'jev-engine' ? { model: JEV_MODEL_ID } : null;
  },
};

const REGISTRATIONS: Record<DecisionEngineKind, DecisionEngineRegistration> = {
  llm: llmRegistration,
  needle: needleRegistration,
  jev: jevRegistration,
};

/** The engine kind behind a runnable resolution — the one resolution switch. */
export function resolutionEngineKind(resolution: DecisionEngineResolution): DecisionEngineKind | null {
  if (resolution.kind === 'llm-engine') {
    return 'llm';
  }
  if (resolution.kind === 'needle-engine') {
    return 'needle';
  }
  if (resolution.kind === 'jev-engine') {
    return 'jev';
  }
  return null;
}

export function getDecisionEngineRegistration(kind: DecisionEngineKind): DecisionEngineRegistration {
  return REGISTRATIONS[kind];
}

export function decisionEngineCapabilities(kind: DecisionEngineKind): ReadonlySet<DecisionCapability> {
  return REGISTRATIONS[kind].capabilities;
}

export function decisionEngineDisplayName(kind: DecisionEngineKind): string {
  return REGISTRATIONS[kind].displayName;
}

/**
 * The model id a decision is attributed to in the turn trace (plan 24 S2):
 * local engines report their own model, remote engines report the chat
 * model that produced the decision. The one place that knows this.
 */
export function decisionEngineTraceModel(kind: DecisionEngineKind, fallback: string): string {
  if (kind === 'needle') {
    return NEEDLE_MODEL_ID;
  }
  if (kind === 'jev') {
    return JEV_MODEL_ID;
  }
  return fallback;
}

/**
 * Single async resolution (plan 24 S1): replaces the old sync/async split.
 * `off` is handled here, never inside an engine.
 */
export async function resolveDecisionEngine(
  settings: DecisionSettings,
  config: AppConfig,
  deps: DecisionEngineDeps
): Promise<DecisionEngineResolution> {
  if (settings.engine === 'off') {
    return { kind: 'off' };
  }
  return REGISTRATIONS[settings.engine].resolve(config, deps);
}

/** Maps a resolution to the generic settings readiness (plan 24 D7). */
export function engineReadiness(resolution: DecisionEngineResolution): EngineReadiness {
  if (resolution.kind === 'llm-engine' || resolution.kind === 'needle-engine' || resolution.kind === 'jev-engine') {
    return { state: 'ready' };
  }
  if (resolution.kind === 'off') {
    return { state: 'unavailable', reason: 'Decision engine is off.' };
  }
  return { state: 'unavailable', reason: resolution.reason };
}
