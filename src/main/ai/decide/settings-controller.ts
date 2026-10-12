import type { AppConfig } from '@shared/config/AppConfig';
import type { LLMProvider } from '@shared/types';
import {
  DECISION_SLOTS,
  decisionSlotCapability,
  DECISION_TRANSPORT_NAMES,
  type DecisionSettingsState,
  type DecisionSlotStatus,
  type DecisionStatusLite,
  type DecisionTestRun,
} from '@shared/ai/decisions';
import type { DecisionStatus } from './index';
import { runDecision } from './index';
import { engineReadiness, resolveDecision, type DecisionEngineDeps } from './registry';
import { ruleForCall } from './points/tool-dispatch';

export interface DecisionSettingsDeps extends DecisionEngineDeps {
  config(): AppConfig;
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
 * Settings surface for decision models (plan 20 S5 → plan 26 S1): per-slot
 * readiness over the shared resolver + a no-execution engine test. Setup
 * (provider/model/assignment) lives in API settings; this reports state.
 */
export class DecisionSettingsController {
  constructor(private readonly deps: DecisionSettingsDeps) {}

  async getState(): Promise<DecisionSettingsState> {
    const config = this.deps.config();
    const slots: DecisionSlotStatus[] = [];
    for (const slot of DECISION_SLOTS) {
      const capability = decisionSlotCapability(slot);
      if (!capability) {
        continue;
      }
      const resolution = await resolveDecision(capability, config, {
        getApiKey: (provider: LLMProvider) => this.deps.getApiKey(provider),
        ...(this.deps.configRevision ? { configRevision: () => this.deps.configRevision!() } : {}),
      });
      slots.push({
        slot,
        capability,
        transport: 'systemone',
        transportName: DECISION_TRANSPORT_NAMES.systemone,
        assignedModelId: config.taskAssignments?.[slot] ?? null,
        fallbackModelId: config.taskFallbackAssignments?.[slot] ?? null,
        readiness: engineReadiness(resolution),
      });
    }
    return { slots };
  }

  async test(input: string): Promise<DecisionTestRun> {
    const startedAt = Date.now();
    const config = this.deps.config();
    const status = await runDecision(
      {
        getApiKey: (provider) => this.deps.getApiKey(provider),
        ...(this.deps.configRevision ? { configRevision: () => this.deps.configRevision!() } : {}),
        ...(this.deps.observeResolvedModel ? { observeResolvedModel: this.deps.observeResolvedModel } : {}),
        ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
      },
      {
        config,
        input,
        tools: DEMO_TOOLS,
      }
    );
    const picked = status.status === 'decided' ? status.outcome.calls[0]?.tool : undefined;
    const rule = picked ? ruleForCall(config.decision.rules, picked) : undefined;
    return {
      result: toLite(status),
      durationMs: Date.now() - startedAt,
      ...(rule ? { rule: { id: rule.id, action: rule.action, ...(rule.text ? { text: rule.text } : {}) } } : {}),
    };
  }
}
