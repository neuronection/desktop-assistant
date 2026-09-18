import { describe, it, expect, vi } from 'vitest';
import { TurnManager, type TurnManagerDeps, type TurnManagerTools, type TurnManagerDecision } from '@main/turns/TurnManager';
import { setToolCallAuditSink, type ToolCallRecord } from '@main/ai/audit';
import type { DecisionToolSchema } from '@shared/ai/decisions';
import type { DecisionStatus } from '@main/ai/decide';
import type { ToolRiskClass, TurnStartRequest } from '@shared/turns';
import { mergeWithDefaults } from '@shared/config/AppConfig';
import { LLMProviderType } from '@shared/types';

const tools: TurnManagerTools = {
  riskFor: (name) => (name === 'light_turn_on' ? 'state-changing' : 'read-only'),
  summarizeFor: (name, args) => `${name}: ${JSON.stringify(args)}`,
  editableArgs: () => false,
  executeDirect: vi.fn(async (name: string) => ({ ok: true, text: `${name} dispatched`, images: [], durationMs: 5 })),
};

function decided(overrides: Partial<Extract<DecisionStatus, { status: 'decided' }>> = {}): DecisionStatus {
  return {
    status: 'decided',
    band: 'act',
    outcome: { engine: 'needle', calls: [{ tool: 'light_turn_on', args: { entity_id: 'light.living_room' } }], confidence: 0.93 },
    ...overrides,
  };
}

function makeDeps(overrides: {
  decision?: TurnManagerDecision;
  chatStream?: () => AsyncGenerator<string>;
} = {}) {
  const events: Parameters<TurnManagerDeps['broadcast']>[0][] = [];
  const messages: { content: string; role: string; metadata?: unknown; error?: string }[] = [];
  const chatStream = overrides.chatStream ?? (async function* () { yield 'agent reply'; });
  const deps: TurnManagerDeps = {
    conversations: {
      async createConversation() { return { id: 'conv_created' }; },
      async conversationExists(id: string) { return id === 'conv_existing'; },
    },
    messages: {
      async createMessage(content: string, role: string, _conversationId: string, _attachments?: unknown, error?: string, metadata?: unknown) {
        const recorded = { content, role, metadata, error };
        messages.push(recorded);
        return recorded;
      },
      async getMessagesByConversation() { return []; },
    } as never,
    getConfig: () =>
      mergeWithDefaults({
        providers: [
          {
            id: 'provider-1',
            name: 'Test',
            type: LLMProviderType.OPENAI,
            apiKey: '',
            apiBase: 'https://api.example.com/v1',
            timeout: 1000,
            temperature: 0.7,
            maxTokens: 1000,
            systemPrompt: '',
            availableModels: [
              { id: 'model-mini', name: 'Model Mini', providerType: LLMProviderType.OPENAI, providerId: 'provider-1' },
            ],
            customModels: [],
          },
        ],
        defaultProviderId: 'provider-1',
        defaultChatModelId: 'model-mini',
        decision: { engine: 'needle', actThreshold: 0.85, confirmThreshold: 0.5 },
      }) as never,
    resolveKey: async () => 'sk-test',
    gateway: { chatStream: () => chatStream() } as never,
    broadcast: (event) => { events.push(event); },
    tools,
    ...(overrides.decision ? { decision: overrides.decision } : {}),
  };
  return { deps, events, messages, chatStream };
}

const baseRequest: TurnStartRequest = {
  conversationId: 'conv_existing',
  content: 'dim the living room to 30',
};

const DECISION_SURFACE: DecisionToolSchema[] = [
  { name: 'light_turn_on', description: 'Turn on a light.', keywordTags: ['dim', 'lights'] },
];

describe('TurnManager decision fast path (plan 20 S3)', () => {
  it('dispatches a single act-band call directly with decision provenance', async () => {
    const run = vi.fn(async (): Promise<DecisionStatus> => decided());
    const { deps, events, messages } = makeDeps({ decision: { tools: () => DECISION_SURFACE, run } });
    const manager = new TurnManager(deps);
    await manager.start(baseRequest);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(run).toHaveBeenCalledWith(baseRequest.content, DECISION_SURFACE);
    expect(tools.executeDirect).toHaveBeenCalledWith('light_turn_on', { entity_id: 'light.living_room' }, expect.anything());
    const assistant = messages.find((message) => message.role === 'assistant');
    expect(assistant?.content).toContain('light_turn_on dispatched');
    expect((assistant?.metadata as { decision?: unknown })?.decision).toEqual({
      engine: 'needle',
      confidence: 0.93,
      band: 'act',
    });
    expect(events.map((event) => event.phase)).toContain('tool_result');
    const decisionStep = events.find(
      (event) => event.phase === 'thinking' && event.step?.label?.includes('Needle')
    );
    expect(decisionStep?.step?.summary).toContain('93% confident');
  });

  it('confirm band forces the approval card even without a policy', async () => {
    const run = vi.fn(async (): Promise<DecisionStatus> => decided({ band: 'confirm', outcome: { engine: 'needle', calls: [{ tool: 'light_turn_on', args: {} }], confidence: 0.6 } }));
    const { deps, events } = makeDeps({ decision: { tools: () => DECISION_SURFACE, run } });
    const manager = new TurnManager(deps);
    await manager.start(baseRequest);
    await new Promise((resolve) => setImmediate(resolve));
    expect(events.some((event) => event.phase === 'interrupt')).toBe(true);
    expect(tools.executeDirect).not.toHaveBeenCalledWith('light_turn_on', {}, expect.anything());
    const resolved = manager.resolveApproval({ decisions: [{ type: 'approve' }] });
    expect(resolved).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(tools.executeDirect).toHaveBeenCalledWith('light_turn_on', {}, expect.anything());
  });

  it('falls through to the chat turn on refuse band, multi-call, error, and off', async () => {
    for (const status of [
      decided({ band: 'refuse' }),
      decided({ outcome: { engine: 'needle', calls: [
        { tool: 'light_turn_on', args: {} },
        { tool: 'light_turn_off', args: {} },
      ], confidence: 0.99 } }),
      { status: 'error', reason: 'engine down' } as DecisionStatus,
      { status: 'off' } as DecisionStatus,
    ]) {
      const run = vi.fn(async (): Promise<DecisionStatus> => status);
      const { deps, messages } = makeDeps({ decision: { tools: () => DECISION_SURFACE, run } });
      const manager = new TurnManager(deps);
      await manager.start(baseRequest);
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      const assistant = messages.find((message) => message.role === 'assistant');
      expect(assistant?.content).toBe('agent reply');
      expect((assistant?.metadata as { decision?: unknown })?.decision).toBeUndefined();
      vi.mocked(tools.executeDirect).mockClear();
    }
  });

  it('skips the engine for attachments, long inputs, research flow, and explicit directTool', async () => {
    const run = vi.fn(async (): Promise<DecisionStatus> => decided());
    const { deps } = makeDeps({ decision: { tools: () => DECISION_SURFACE, run } });
    const manager = new TurnManager(deps);
    const settle = async () => {
      for (let i = 0; i < 4; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    };
    await manager.start({ ...baseRequest, attachments: [{ id: 'a1', type: 'pdf' } as never] });
    await settle();
    await manager.start({ ...baseRequest, content: 'x'.repeat(201) });
    await settle();
    await manager.start({ ...baseRequest, flow: 'research' }).catch(() => undefined);
    await settle();
    await manager.start({ ...baseRequest, directTool: { name: 'light_turn_on', args: {} } });
    await settle();
    expect(run).not.toHaveBeenCalled();
  });

  it('audits the dispatched tool call', async () => {
    const audit: ToolCallRecord[] = [];
    setToolCallAuditSink(async (record) => {
      audit.push(record);
    });
    const run = vi.fn(async (): Promise<DecisionStatus> => decided());
    const { deps } = makeDeps({ decision: { tools: () => DECISION_SURFACE, run } });
    const manager = new TurnManager(deps);
    await manager.start(baseRequest);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(audit.at(-1)).toMatchObject({ tool: 'light_turn_on', outcome: 'ok', approvedBy: 'auto' });
  });
});
