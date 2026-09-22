import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '@shared/config/AppConfig';
import type { LLMProvider } from '@shared/types';
import {
  DECISION_ENGINE_KINDS,
  DECISION_ENGINE_NAMES,
  type DecisionEngineStatus,
  type DecisionNeedleState,
  type DecisionSettingsState,
  type DecisionStatusLite,
  type DecisionTestRun,
} from '@shared/ai/decisions';
import type { DecisionStatus } from './index';
import { runDecision } from './index';
import {
  decisionEngineCapabilities,
  engineReadiness,
  getDecisionEngineRegistration,
  resolveDecisionEngine,
} from './registry';
import { NEEDLE_WEIGHTS_BYTES } from './needle/pins';
import { downloadWeights, locateVerifiedWeights, needleWeightsPath } from './needle/weights';

export interface DecisionSettingsDeps {
  config(): AppConfig;
  userDataDir(): string;
  resourceDir(): string;
  getApiKey(provider: LLMProvider): Promise<string | null>;
  getJevKey?(): Promise<string | null>;
  fetchImpl?: typeof fetch;
  createStructuredModel?: import('../chat-models').StructuredModelFactory;
}

const DEMO_TOOLS = [
  {
    name: 'light_turn_on',
    description: 'Turn on a light in the home. brightness_pct is optional (0-100). entity_id uses the light.living_room / light.kitchen / light.bedroom format.',
    parameters: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'Light entity id, e.g. light.living_room' },
        brightness_pct: { type: 'integer', description: 'Brightness percent 0-100' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'light_turn_off',
    description: 'Turn off a light in the home. entity_id uses the light.living_room / light.kitchen / light.bedroom format.',
    parameters: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'Light entity id, e.g. light.living_room' },
      },
      required: ['entity_id'],
    },
  },
];

function toLite(status: DecisionStatus): DecisionStatusLite {
  if (status.status !== 'decided') {
    return status;
  }
  return {
    status: 'decided',
    engine: status.outcome.engine,
    confidence: status.outcome.confidence,
    band: status.band,
    calls: status.outcome.calls.map((call) => ({ tool: call.tool })),
  };
}

/**
 * Settings surface for decision engines (plan 20 S5): weights state +
 * user-initiated download (single-flight, cancellable, progress polled
 * via getState) + a no-execution engine test.
 */
export class DecisionSettingsController {
  private downloadState: { controller: AbortController; receivedBytes: number } | null = null;

  constructor(private readonly deps: DecisionSettingsDeps) {}

  async getState(): Promise<DecisionSettingsState> {
    const needle: DecisionNeedleState = this.downloadState
      ? {
          runtimePresent: this.runtimePresent(),
          weightsPresent: false,
          downloading: true,
          receivedBytes: this.downloadState.receivedBytes,
          totalBytes: NEEDLE_WEIGHTS_BYTES,
        }
      : {
          runtimePresent: this.runtimePresent(),
          weightsPresent: (await locateVerifiedWeights(this.deps.userDataDir())) !== null,
          downloading: false,
          receivedBytes: 0,
          totalBytes: NEEDLE_WEIGHTS_BYTES,
        };
    return { engines: await this.engineStatuses(), needle };
  }

  /** Generic readiness per engine (plan 24 S2) — no engine-specific branching here. */
  private async engineStatuses(): Promise<DecisionEngineStatus[]> {
    const config = this.deps.config();
    const deps = {
      getApiKey: (provider: LLMProvider) => this.deps.getApiKey(provider),
      ...(this.deps.getJevKey ? { getJevKey: this.deps.getJevKey } : {}),
      ...(this.deps.createStructuredModel ? { createStructuredModel: this.deps.createStructuredModel } : {}),
      needle: {
        userDataDir: async () => this.deps.userDataDir(),
        resourceDir: async () => this.deps.resourceDir(),
      },
    };
    const statuses: DecisionEngineStatus[] = [];
    for (const kind of DECISION_ENGINE_KINDS) {
      const registration = getDecisionEngineRegistration(kind);
      const readiness = registration.readiness
        ? await registration.readiness(config, deps)
        : engineReadiness(await resolveDecisionEngine({ ...config.decision, engine: kind }, config, deps));
      statuses.push({
        kind,
        name: DECISION_ENGINE_NAMES[kind],
        capabilities: [...decisionEngineCapabilities(kind)],
        readiness,
      });
    }
    return statuses;
  }

  private runtimePresent(): boolean {
    return (
      existsSync(path.join(this.deps.resourceDir(), 'host.cjs')) &&
      existsSync(path.join(this.deps.resourceDir(), 'needle.js')) &&
      existsSync(path.join(this.deps.resourceDir(), 'needle.wasm'))
    );
  }

  async downloadWeights(): Promise<{ ok: boolean; error?: string }> {
    if (this.downloadState) {
      return { ok: false, error: 'A download is already in progress.' };
    }
    if (await locateVerifiedWeights(this.deps.userDataDir())) {
      return { ok: true };
    }
    const controller = new AbortController();
    this.downloadState = { controller, receivedBytes: 0 };
    console.log('[needle] weights download started');
    try {
      await downloadWeights(
        { ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}) },
        {
          targetPath: needleWeightsPath(this.deps.userDataDir()),
          signal: controller.signal,
          onProgress: (progress) => {
            if (this.downloadState) {
              this.downloadState.receivedBytes = progress.receivedBytes;
            }
          },
        }
      );
      console.log('[needle] weights download complete and verified');
      return { ok: true };
    } catch (error) {
      const message = String((error as Error)?.message ?? error).slice(0, 300);
      console.error(`[needle] weights download failed: ${message}`);
      return { ok: false, error: message };
    } finally {
      this.downloadState = null;
    }
  }

  cancelDownload(): boolean {
    if (!this.downloadState) {
      return false;
    }
    this.downloadState.controller.abort();
    return true;
  }

  async test(input: string): Promise<DecisionTestRun> {
    const startedAt = Date.now();
    const status = await runDecision(
      {
        getApiKey: (provider) => this.deps.getApiKey(provider),
        ...(this.deps.getJevKey ? { getJevKey: this.deps.getJevKey } : {}),
        ...(this.deps.createStructuredModel ? { createStructuredModel: this.deps.createStructuredModel } : {}),
        ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
      },
      {
        config: this.deps.config(),
        input,
        tools: DEMO_TOOLS,
      }
    );
    return { result: toLite(status), durationMs: Date.now() - startedAt };
  }
}
