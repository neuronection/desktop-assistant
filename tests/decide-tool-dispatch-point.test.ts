import { describe, it, expect } from 'vitest';
import { LLMProviderType, type LLMProvider } from '@shared/types';
import { mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import type { DecisionToolSchema, DecisionRouteTool } from '@shared/ai/decisions';
import type { DecisionStatus } from '@main/ai/decide';
import {
  runToolDispatchPoint,
  TOOL_DISPATCH_POINT,
  type ToolDispatchDecision,
  type ToolDispatchInput,
} from '@main/ai/decide/points/tool-dispatch';

const provider: LLMProvider = {
  id: 'provider-1',
  name: 'Test',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://api.example.com/v1',
  timeout: 1000,
  temperature: 0.7,
  maxTokens: 1000,
  systemPrompt: '',
  availableModels: [{ id: 'model-mini', name: 'Mini', providerType: LLMProviderType.OPENAI, providerId: 'provider-1' }],
  customModels: [],
};

const TOOLS: DecisionToolSchema[] = [{ name: 'light_turn_on', description: 'Turn on a light.' }];

function config(routeTools: DecisionRouteTool[] = []): AppConfig {
  return mergeWithDefaults({
    providers: [provider],
    defaultProviderId: provider.id,
    defaultChatModelId: 'model-mini',
    decision: { engine: 'llm', actThreshold: 0.85, confirmThreshold: 0.5, routeTools },
  });
}

function decided(overrides: Partial<Extract<DecisionStatus, { status: 'decided' }>> = {}): DecisionStatus {
  return {
    status: 'decided',
    band: 'act',
    outcome: { engine: 'llm', calls: [{ tool: 'light_turn_on', args: { entity_id: 'light.office' } }], confidence: 0.95 },
    ...overrides,
  };
}

function input(status: DecisionStatus, overrides: Partial<ToolDispatchInput> = {}): ToolDispatchInput {
  const decision: ToolDispatchDecision = {
    tools: async () => TOOLS,
    run: async () => status,
  };
  return { config: config(), decision, content: 'turn on the light', hasAttachments: false, hasFlow: false, ...overrides };
}

describe('tool-dispatch decision point (plan 24 S3)', () => {
  it('describes a blocking pre-model point owning dispatch + route', () => {
    expect(TOOL_DISPATCH_POINT).toMatchObject({
      id: 'tool-dispatch',
      capability: 'tool-dispatch',
      phase: 'pre-model',
      mode: 'blocking',
      domains: ['dispatch', 'route'],
    });
  });

  it('dispatches a confident single call directly', async () => {
    const verdict = await runToolDispatchPoint(input(decided()));
    expect(verdict).toMatchObject({
      type: 'direct',
      request: { name: 'light_turn_on', args: { entity_id: 'light.office' } },
      provenance: { engine: 'llm', band: 'act', confidence: 0.95 },
    });
    expect(verdict && 'request' in verdict ? verdict.request.forceApproval : undefined).toBeUndefined();
  });

  it('forces approval for the confirm band', async () => {
    const verdict = await runToolDispatchPoint(input(decided({ band: 'confirm' })));
    expect(verdict).toMatchObject({ type: 'direct', request: { forceApproval: true } });
  });

  it('hands off to a route tool when the picked name is a route', async () => {
    const routeTools: DecisionRouteTool[] = [
      { name: 'light_turn_on', description: 'Route it.', modelId: 'gemini-pro' },
    ];
    const verdict = await runToolDispatchPoint(input(decided(), { config: config(routeTools) }));
    expect(verdict).toMatchObject({ type: 'route', modelId: 'gemini-pro' });
  });

  it('falls through on the refuse band', async () => {
    const verdict = await runToolDispatchPoint(input(decided({ band: 'refuse' })));
    expect(verdict).toMatchObject({ type: 'fallThrough', reason: 'low confidence' });
  });

  it('falls through on a compound (multi-call) decision', async () => {
    const status: DecisionStatus = {
      status: 'decided',
      band: 'act',
      outcome: {
        engine: 'llm',
        confidence: 0.9,
        calls: [
          { tool: 'light_turn_on', args: {} },
          { tool: 'light_turn_on', args: {} },
        ],
      },
    };
    const verdict = await runToolDispatchPoint(input(status));
    expect(verdict).toMatchObject({ type: 'fallThrough', reason: 'compound request', calls: 2 });
  });

  it('falls through when the engine returned no actionable call', async () => {
    const status: DecisionStatus = {
      status: 'decided',
      band: 'act',
      outcome: { engine: 'llm', confidence: 0.9, calls: [] },
    };
    expect(await runToolDispatchPoint(input(status))).toMatchObject({ type: 'fallThrough', reason: 'no actionable call' });
  });

  it('falls through with provenance when the engine reports an error status', async () => {
    const verdict = await runToolDispatchPoint(input({ status: 'error', reason: 'engine down', engine: 'llm' }));
    expect(verdict).toMatchObject({ type: 'fallThrough', reason: 'engine down', provenance: { engine: 'llm' } });
  });

  it('returns null when the engine throws (fail-open)', async () => {
    const decision: ToolDispatchDecision = {
      tools: async () => TOOLS,
      run: async () => {
        throw new Error('boom');
      },
    };
    expect(await runToolDispatchPoint({ config: config(), decision, content: 'turn on the light', hasAttachments: false, hasFlow: false })).toBeNull();
  });

  it('is not applicable for flows, attachments, long input, or empty candidates', async () => {
    expect(await runToolDispatchPoint(input(decided(), { hasFlow: true }))).toBeNull();
    expect(await runToolDispatchPoint(input(decided(), { hasAttachments: true }))).toBeNull();
    expect(await runToolDispatchPoint(input(decided(), { content: 'x'.repeat(201) }))).toBeNull();
    expect(await runToolDispatchPoint(input(decided(), { content: 'hello there' }))).toBeNull();
  });

  it('returns null when the engine is off', async () => {
    expect(await runToolDispatchPoint(input({ status: 'off' }))).toBeNull();
  });
});
