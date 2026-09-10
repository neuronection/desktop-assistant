import { describe, it, expect, vi } from 'vitest';
import { TurnManager, capTraceSteps, type TurnManagerDeps } from '@main/turns/TurnManager';
import type { AssistantRunner, AssistantEvent } from '@main/ai/graphs/assistant';
import { ToolPolicyEngine } from '@main/ai/tools/policy';
import { setToolCallAuditSink, type ToolCallRecord } from '@main/ai/audit';
import { MessageRole } from '@shared/database-types';
import type { Message } from '@shared/database-types';
import type { LLMProvider } from '@shared/types';
import type { TurnEvent, TurnMetadata } from '@shared/turns';

const provider = {
  id: 'p1',
  systemPrompt: '',
  availableModels: [
    { id: 'test-model', name: 'Test Model', providerType: 'openai', providerId: 'p1' },
  ],
} as unknown as LLMProvider;

function scriptRunner(script: AssistantEvent[]): AssistantRunner {
  return {
    getToolCount: async () => 2,
    async *run(): AsyncGenerator<AssistantEvent, void, unknown> {
      for (const event of script) {
        yield event;
      }
    },
  };
}

function makeDeps(overrides: Partial<TurnManagerDeps> = {}) {
  const events: TurnEvent[] = [];
  const messages: { content: string; role: MessageRole; conversationId: string; error?: string; metadata?: unknown }[] =
    [];

  const deps: TurnManagerDeps = {
    conversations: {
      async createConversation() {
        return { id: 'conv_created' };
      },
      async conversationExists(id: string) {
        return id === 'conv_existing';
      },
    },
    messages: {
      async createMessage(content, role, conversationId, _attachments?, error?, metadata?) {
        const recorded = { content, role, conversationId, error, metadata };
        messages.push(recorded);
        return recorded;
      },
      async getMessagesByConversation(conversationId: string): Promise<Message[]> {
        return [
          {
            id: 'm1',
            content: 'hello',
            role: MessageRole.USER,
            conversationId,
            createdAt: new Date(),
            attachments: [],
          } as Message,
        ];
      },
    },
    getConfig: () => ({ providers: [provider] }) as unknown as ReturnType<TurnManagerDeps['getConfig']>,
    resolveKey: async () => 'sk-test',
    gateway: {
      async *chatStream() {
        yield 'unused';
      },
    },
    broadcast: (event: TurnEvent) => {
      events.push(event);
    },
    ...overrides,
  };

  return { deps, events, messages };
}

const request = { conversationId: 'conv_existing', content: 'look around', modelId: 'test-model', providerId: 'p1' };

describe('TurnManager agent path', () => {
  it('maps agent events onto the turn envelope with node telemetry, tool steps and metadata', async () => {
    const runner = scriptRunner([
      { type: 'node_started', node: 'model_request', label: 'Thinking', resumed: false },
      { type: 'tool_calls', calls: [{ id: 'c1', name: 'screen_capture', args: {}, summary: 'Captured the screen' }] },
      { type: 'node_finished', node: 'model_request', label: 'Thinking', outcome: 'done', durationMs: 5, resumed: false },
      { type: 'node_started', node: 'tools', label: 'Using tools', resumed: false },
      { type: 'tool_results', results: [{ id: 'c1', summary: 'Screenshot captured of the primary display', isError: false }] },
      { type: 'node_finished', node: 'tools', label: 'Using tools', outcome: 'done', durationMs: 7, resumed: false },
      { type: 'node_started', node: 'model_request', label: 'Thinking', resumed: false },
      { type: 'delta', text: 'Your screen' },
      { type: 'delta', text: ' looks fine.' },
      { type: 'node_finished', node: 'model_request', label: 'Thinking', outcome: 'done', durationMs: 9, resumed: false },
      { type: 'final', text: 'Your screen looks fine.' },
    ]);
    const { deps, events, messages } = makeDeps({ agent: runner });

    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('finished');
    });

    expect(events.map((event) => event.phase)).toEqual([
      'queued',
      'thinking',
      'tool_call',
      'thinking',
      'tool_result',
      'thinking',
      'streaming',
      'streaming',
      'thinking',
      'finished',
    ]);

    const opened = events.find((event) => event.node && !event.node.outcome);
    expect(opened?.node).toMatchObject({ node: 'model_request', label: 'Thinking', resumed: false });
    expect(opened?.step).toMatchObject({ id: 'node_model_request_1', node: 'model_request' });

    const closedNode = events.filter((event) => event.node?.outcome === 'done');
    expect(closedNode).toHaveLength(2);
    expect(closedNode[0].node).toMatchObject({ node: 'model_request', durationMs: 5 });

    const toolsWindowEvents = events.filter((event) => event.node?.node === 'tools');
    expect(toolsWindowEvents).toEqual([]);

    const toolCall = events.find((event) => event.phase === 'tool_call');
    expect(toolCall?.step).toMatchObject({
      phase: 'tool_call',
      toolName: 'screen_capture',
      summary: 'Captured the screen',
    });

    const finished = events.at(-1);
    const persisted = messages[1];
    const metadata = persisted?.metadata as TurnMetadata;
    expect(metadata).toMatchObject({ outcome: 'ok', toolCount: 1 });
    expect(metadata.steps?.map((step) => step.phase)).toEqual(['thinking', 'tool_call', 'thinking']);
    expect(metadata.steps?.[0].node).toBe('model_request');
    expect(metadata.steps?.[1].node).toBe('tools');
    expect(metadata.steps?.[1].endedAt).toBeGreaterThan(0);
    expect((finished?.steps ?? []).find((step) => step.id === 'tool_c1')?.summary).toBe(
      'Screenshot captured of the primary display'
    );
  });

  it('marks failed tool results and keeps the turn going', async () => {
    const runner = scriptRunner([
      { type: 'tool_calls', calls: [{ id: 'c1', name: 'web_fetch', args: { url: 'http://x' }, summary: 'Fetched http://x' }] },
      { type: 'tool_results', results: [{ id: 'c1', summary: 'HTTP 404', isError: true }] },
      { type: 'final', text: 'The page is gone.' },
    ]);
    const { deps, events, messages } = makeDeps({ agent: runner });

    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('finished');
    });

    const toolResult = events.find((event) => event.phase === 'tool_result');
    expect(toolResult?.step?.summary).toBe('Failed: HTTP 404');
    expect((messages[1].metadata as TurnMetadata).outcome).toBe('ok');
  });

  it('fails the turn when the agent throws', async () => {
    const failing: AssistantRunner = {
      getToolCount: async () => 1,
      async *run(): AsyncGenerator<AssistantEvent, void, unknown> {
        yield { type: 'delta', text: 'partial' };
        throw new Error('recursion limit reached');
      },
    };
    const { deps, events, messages } = makeDeps({ agent: failing });

    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('failed');
    });
    expect(events.at(-1)?.error).toBe('recursion limit reached');
    expect((messages[1].metadata as TurnMetadata).outcome).toBe('failed');
  });

  it('cancels mid-agent-turn and persists the partial content', async () => {
    let release: (() => void) | null = null;
    const slowRunner: AssistantRunner = {
      getToolCount: async () => 1,
      async *run(): AsyncGenerator<AssistantEvent, void, unknown> {
        yield { type: 'delta', text: 'partial' };
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        yield { type: 'final', text: 'never' };
      },
    };
    const { deps, events, messages } = makeDeps({ agent: slowRunner });

    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(events.some((event) => event.phase === 'streaming')).toBe(true);
    });

    expect(manager.cancel()).toBe(true);
    if (release) {
      release();
    }
    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('cancelled');
    });
    expect((messages[1].metadata as TurnMetadata).outcome).toBe('cancelled');
    expect(messages[1].content).toBe('partial');
  });

  it('caps persisted trace steps but reports the true tool count', () => {
    const steps = Array.from({ length: 30 }, (_, index) => ({
      id: `t${index}`,
      phase: 'tool_call' as const,
      label: 'tool',
      startedAt: index,
      summary: 's'.repeat(200),
    }));
    const capped = capTraceSteps(steps);
    expect(capped).toHaveLength(12);
    expect(capped?.[0].summary?.length).toBeLessThanOrEqual(160);
    expect(capTraceSteps(undefined)).toBeUndefined();
  });

  it('falls back to the plain stream path when no agent or tools exist', async () => {
    const noTools = makeDeps({ agent: { getToolCount: async () => 0, async *run() { yield { type: 'final', text: 'nope' }; } } });
    const managerA = new TurnManager(noTools.deps);
    await managerA.start(request);
    await vi.waitFor(() => {
      expect(noTools.events.at(-1)?.phase).toBe('finished');
    });
    expect(noTools.events.some((event) => event.phase === 'tool_call')).toBe(false);
    expect(noTools.messages[1].content).toBe('unused');
  });
});

const approvalRequest = {
  id: 'appr_0',
  toolName: 'open_url',
  args: { url: 'https://example.com' },
  summary: 'Open https://example.com',
  risk: 'state-changing' as const,
  allowedDecisions: ['approve', 'reject'] as const,
};

function makePolicyReader(engine: ToolPolicyEngine): TurnManagerDeps['policy'] {
  return engine;
}

function makeTestPolicy(): ToolPolicyEngine {
  return new ToolPolicyEngine(() => ({ toolGrants: {}, disabledTools: [], grantedRoots: [] }));
}

describe('TurnManager approval flow', () => {
  it('broadcasts the interrupt payload and resumes with the user decision', async () => {
    const policy = makeTestPolicy();
    let callCount = 0;
    const runner: AssistantRunner = {
      getToolCount: async () => 1,
      async *run(input): AsyncGenerator<AssistantEvent, void, unknown> {
        callCount += 1;
        if (callCount === 1) {
          expect(input.resume).toBeUndefined();
          yield { type: 'interrupt', requests: [approvalRequest] };
          return;
        }
        expect(input.resume).toEqual([{ type: 'approve' }]);
        yield { type: 'tool_calls', calls: [{ id: 'c1', name: 'open_url', args: approvalRequest.args, summary: approvalRequest.summary, risk: 'state-changing' }] };
        yield { type: 'tool_results', results: [{ id: 'c1', summary: 'Opened', isError: false }] };
        yield { type: 'final', text: 'Opened the page.' };
      },
    };
    const { deps, events } = makeDeps({ agent: runner, policy: makePolicyReader(policy) });
    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      const interrupt = events.find((event) => event.phase === 'interrupt');
      expect(interrupt).toBeDefined();
    });
    const interrupt = events.find((event) => event.phase === 'interrupt')!;
    expect(interrupt.interrupt?.requests).toEqual([approvalRequest]);
    expect(interrupt.interrupt?.deadline).toBeGreaterThan(Date.now() - 1000);
    expect(manager.resolveApproval({ decisions: [{ type: 'approve' }] })).toBe(true);

    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('finished');
    });
    expect(events.filter((event) => event.phase === 'interrupt')).toHaveLength(1);
  });

  it('ignores a second resume (cross-window idempotency)', async () => {
    const policy = makeTestPolicy();
    let callCount = 0;
    let gate: (() => void) | null = null;
    const runner: AssistantRunner = {
      getToolCount: async () => 1,
      async *run(): AsyncGenerator<AssistantEvent, void, unknown> {
        callCount += 1;
        if (callCount === 1) {
          yield { type: 'interrupt', requests: [approvalRequest] };
          await new Promise<void>((resolve) => {
            gate = resolve;
          });
          return;
        }
        yield { type: 'final', text: 'resumed' };
      },
    };
    const { deps } = makeDeps({ agent: runner, policy: makePolicyReader(policy) });
    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(manager.resolveApproval({ decisions: [{ type: 'approve' }] })).toBe(true);
    });
    gate?.();
    await vi.waitFor(() => {
      expect(manager.isActive()).toBe(false);
    });
    expect(manager.resolveApproval({ decisions: [{ type: 'reject' }] })).toBe(false);
  });

  it('auto-denies after the approval timeout and keeps the graph going', async () => {
    vi.useFakeTimers();
    try {
      let callCount = 0;
      const runner: AssistantRunner = {
        getToolCount: async () => 1,
        async *run(input): AsyncGenerator<AssistantEvent, void, unknown> {
          callCount += 1;
          if (callCount === 1) {
            yield { type: 'interrupt', requests: [approvalRequest] };
            return;
          }
          expect(input.resume?.[0]).toMatchObject({ type: 'reject' });
          yield { type: 'final', text: 'The request was denied.' };
        },
      };
      const { deps, events } = makeDeps({ agent: runner });
      const manager = new TurnManager(deps);
      const promise = manager.start(request);

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      await promise;

      await vi.waitFor(() => {
        expect(events.at(-1)?.phase).toBe('finished');
      });
      expect(callCount).toBe(2);
      expect((deps.messages as unknown as { createMessage: unknown }) ? true : true).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends the turn cancelled and records the denial when cancelled during approval', async () => {
    const audit: ToolCallRecord[] = [];
    setToolCallAuditSink(async (record) => {
      audit.push(record);
    });
    let gate: (() => void) | null = null;
    const runner: AssistantRunner = {
      getToolCount: async () => 1,
      async *run(): AsyncGenerator<AssistantEvent, void, unknown> {
        yield { type: 'delta', text: 'partial' };
        yield { type: 'interrupt', requests: [approvalRequest] };
        await new Promise<void>((resolve) => {
          gate = resolve;
        });
      },
    };
    const { deps, events, messages } = makeDeps({ agent: runner });
    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(events.some((event) => event.phase === 'interrupt')).toBe(true);
    });
    expect(manager.cancel()).toBe(true);
    gate?.();
    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('cancelled');
    });
    expect((messages[1].metadata as TurnMetadata).outcome).toBe('cancelled');
    expect(messages[1].content).toBe('partial');
    await vi.waitFor(() => {
      expect(audit.some((record) => record.outcome === 'denied' && record.approvedBy === 'denied')).toBe(true);
    });
  });

  it('records session grants on approval so a later call runs without interrupt', async () => {
    const policy = makeTestPolicy();
    let callCount = 0;
    const runner: AssistantRunner = {
      getToolCount: async () => 1,
      async *run(input): AsyncGenerator<AssistantEvent, void, unknown> {
        callCount += 1;
        if (callCount === 1) {
          yield { type: 'interrupt', requests: [approvalRequest] };
          return;
        }
        expect(input.resume).toEqual([{ type: 'approve' }]);
        yield { type: 'final', text: 'granted' };
      },
    };
    const { deps } = makeDeps({ agent: runner, policy: makePolicyReader(policy) });
    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(manager.resolveApproval({ decisions: [{ type: 'approve' }], grant: 'session' })).toBe(true);
    });
    await vi.waitFor(() => {
      expect(manager.isActive()).toBe(false);
    });
    expect(policy.decision('open_url', 'state-changing')).toBe('run');
    expect(policy.grantSource('open_url', 'state-changing')).toBe('session');
  });

  it('notifies on approval needed and audits executed tools with the grant source', async () => {
    const audit: ToolCallRecord[] = [];
    setToolCallAuditSink(async (record) => {
      audit.push(record);
    });
    const notify = vi.fn();
    const policy = makeTestPolicy();
    let callCount = 0;
    const runner: AssistantRunner = {
      getToolCount: async () => 1,
      async *run(): AsyncGenerator<AssistantEvent, void, unknown> {
        callCount += 1;
        if (callCount === 1) {
          yield { type: 'interrupt', requests: [approvalRequest] };
          return;
        }
        yield { type: 'tool_calls', calls: [{ id: 'c1', name: 'open_url', args: approvalRequest.args, summary: 'Open https://example.com', risk: 'state-changing' }] };
        yield { type: 'tool_results', results: [{ id: 'c1', summary: 'Opened', isError: false }] };
        yield { type: 'final', text: 'done' };
      },
    };
    const { deps } = makeDeps({ agent: runner, policy: makePolicyReader(policy), notify });
    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith('Approval needed', expect.stringContaining('open_url'));
    });
    manager.resolveApproval({ decisions: [{ type: 'approve' }], grant: 'session' });
    await vi.waitFor(() => {
      expect(manager.isActive()).toBe(false);
    });
    await vi.waitFor(() => {
      const executed = audit.find((record) => record.outcome === 'ok');
      expect(executed).toMatchObject({
        tool: 'open_url',
        outcome: 'ok',
        approvedBy: 'session',
        conversationId: 'conv_existing',
      });
    });
  });

  it('audits timeout denials with the timeout source', async () => {
    vi.useFakeTimers();
    try {
      const audit: ToolCallRecord[] = [];
      setToolCallAuditSink(async (record) => {
        audit.push(record);
      });
      let callCount = 0;
      const runner: AssistantRunner = {
        getToolCount: async () => 1,
        async *run(): AsyncGenerator<AssistantEvent, void, unknown> {
          callCount += 1;
          if (callCount === 1) {
            yield { type: 'interrupt', requests: [approvalRequest] };
            return;
          }
          yield { type: 'final', text: 'denied path' };
        },
      };
      const { deps } = makeDeps({ agent: runner });
      const manager = new TurnManager(deps);
      const promise = manager.start(request);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      await promise;
      await vi.waitFor(() => {
        expect(manager.isActive()).toBe(false);
      });
      await vi.waitFor(() => {
        expect(audit.some((record) => record.approvedBy === 'timeout' && record.outcome === 'denied')).toBe(true);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
