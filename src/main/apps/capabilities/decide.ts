import type { AppConfig } from '@shared/config/AppConfig';
import type { DecisionAnswer, DecisionQuestion, DecisionUsage } from '@shared/ai/decisions';
import { runDecision, type DecisionEngineDeps } from '@main/ai/decide';
import type { PackError } from '@shared/app-pack';

export interface PackAskSuccess {
  engine: string;
  confidence: number;
  answers: Record<string, DecisionAnswer>;
  usage?: DecisionUsage;
}

export type PackAskResult = { ok: true; value: PackAskSuccess } | { ok: false; error: PackError };

export interface PackDecideDeps {
  config(): AppConfig;
  engineDeps: DecisionEngineDeps;
}

function failure(code: PackError['code'], detail: Record<string, unknown>): { ok: false; error: PackError } {
  return { ok: false, error: { code, detail } };
}

const RATE_LIMIT_PATTERN = /\b429\b|\brate[ _-]?limit/i;

/**
 * The decide bridge (plan 26 S2): typed questions through the EXISTING
 * decision funnel — registry resolution, task binding, one AiCall audit
 * row per call, budgets. The pack never names a provider, model or SDK;
 * `net` never exists here (only the AI-layer engine transport leaves the
 * device). All failures map onto the contract's typed error model.
 */
export class PackDecideBridge {
  constructor(private readonly deps: PackDecideDeps) {}

  async ask(input: string, questions: DecisionQuestion[]): Promise<PackAskResult> {
    const config = this.deps.config();
    const status = await runDecision(this.deps.engineDeps, {
      config,
      input,
      tools: [],
      questions,
      priority: 'background',
    });
    if (status.status === 'decided') {
      return {
        ok: true,
        value: {
          engine: status.outcome.engine,
          confidence: status.outcome.confidence,
          answers: status.outcome.answers ?? {},
          ...(status.outcome.usage ? { usage: status.outcome.usage } : {}),
        },
      };
    }
    if (status.status === 'error') {
      const code: PackError['code'] = RATE_LIMIT_PATTERN.test(status.reason) ? 'rate-limited' : 'provider';
      return failure(code, { reason: status.reason, engine: status.engine });
    }
    if (status.status === 'off') {
      return failure('not-ready', { reason: 'decision engine is off' });
    }
    if (status.status === 'unavailable' && status.engine === 'jev') {
      return failure('needs-secret', { reason: status.reason, engine: 'jev' });
    }
    return failure('not-ready', { reason: status.reason });
  }
}
