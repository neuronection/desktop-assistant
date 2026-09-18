import type { DecisionOutcome } from '@shared/ai/decisions';
import { NEEDLE_MAX_NEW_TOKENS_DEFAULT } from './pins';
import { parseNeedleOutput, toolsToNeedleJson } from './parse';
import type { DecisionEngine, DecisionRequest } from '../types';
import type { NeedleTransport, NeedleTransportFactory } from './transport';

export const NEEDLE_DEFAULT_SYSTEM_PROMPT = 'You are a local tool-dispatch engine for a desktop assistant.';

export interface NeedleEngineParams {
  weightsPath: string;
  resourceDir: string;
  createTransport?: NeedleTransportFactory;
  maxNewTokens?: number;
}

export class NeedleDecisionEngine implements DecisionEngine {
  readonly kind = 'needle' as const;

  private readonly params: NeedleEngineParams;
  private bootPromise: Promise<NeedleTransport> | null = null;

  constructor(params: NeedleEngineParams) {
    this.params = params;
  }

  private boot(): Promise<NeedleTransport> {
    if (!this.bootPromise) {
      this.bootPromise = (async () => {
        const createTransport = this.params.createTransport ?? (await import('./transport')).createUtilityNeedleTransport;
        const transport = createTransport(this.params.resourceDir);
        await transport.load(this.params.weightsPath);
        return transport;
      })();
      this.bootPromise.catch(() => {
        this.bootPromise = null;
      });
    }
    return this.bootPromise;
  }

  async decide(request: DecisionRequest): Promise<DecisionOutcome> {
    const transport = await this.boot();
    await transport.reset();
    await transport.init(request.systemPrompt ?? NEEDLE_DEFAULT_SYSTEM_PROMPT, toolsToNeedleJson(request.tools));
    const raw = await transport.complete(request.input, this.params.maxNewTokens ?? NEEDLE_MAX_NEW_TOKENS_DEFAULT);
    return parseNeedleOutput(raw, request.tools);
  }

  dispose(): void {
    const promise = this.bootPromise;
    this.bootPromise = null;
    promise
      ?.then((transport) => transport.dispose())
      .catch(() => undefined);
  }
}
