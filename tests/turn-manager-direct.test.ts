import { describe, it, expect, vi } from 'vitest';
import { resolve } from 'path';
import { join } from 'path';
import { TurnManager, type TurnManagerDeps, type TurnManagerTools } from '@main/turns/TurnManager';
import { setToolCallAuditSink, type ToolCallRecord } from '@main/ai/audit';
import type { ToolRiskClass } from '@shared/turns';

function makeTools(catalog: Record<string, { risk: ToolRiskClass; run: (args: Record<string, unknown>) => string }>): TurnManagerTools {
  return {
    riskFor: (name) => catalog[name]?.risk,
    summarizeFor: (name, args) => `${name}: ${JSON.stringify(args)}`,
    editableArgs: () => false,
    executeDirect: async (name, args) => {
      const entry = catalog[name];
      if (!entry) {
        return { ok: false, text: `Unknown tool '${name}'.`, durationMs: 1 };
      }
      return { ok: true, text: entry.run(args), durationMs: 5 };
    },
  };
}

function makeDeps(tools: TurnManagerTools, overrides: Partial<TurnManagerDeps> = {}) {
  const events: TurnEvent2[] = [];
  const messages: { content: string; role: string; conversationId: string; error?: string; metadata?: unknown }[] = [];
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
      async createMessage(content, _role, conversationId, _attachments?, error?, metadata?) {
        const recorded = { content, role: String(_role), conversationId, error, metadata };
        messages.push(recorded);
        return recorded;
      },
      async getMessagesByConversation() {
        return [];
      },
    },
    getConfig: () => ({ providers: [] }) as unknown as TurnManagerDeps['getConfig'] extends () => infer R ? R : never,
    resolveKey: async () => 'sk-test',
    gateway: {
      async *chatStream() {
        yield 'unused';
      },
    },
    broadcast: (event: TurnEvent2) => {
      events.push(event);
    },
    tools,
    ...overrides,
  };
  return { deps, events, messages };
}

type TurnEvent2 = Parameters<TurnManagerDeps['broadcast']>[0];

const baseRequest = {
  conversationId: 'conv_existing',
  content: '/shell ls -la',
  modelId: '',
  providerId: '',
};

const directRequest = { ...baseRequest, directTool: { name: 'run_shell', args: { command: 'ls -la' } } };

describe('TurnManager direct tool turns (slash commands)', () => {
  it('runs a read-only tool immediately and persists the result', async () => {
    const audit: ToolCallRecord[] = [];
    setToolCallAuditSink(async (record) => {
      audit.push(record);
    });
    const tools = makeTools({
      screen_capture: { risk: 'read-only', run: () => 'Screenshot captured of the primary display.' },
    });
    const { deps, events, messages } = makeDeps(tools);
    const manager = new TurnManager(deps);
    await manager.start({ ...baseRequest, content: '/screenshot', directTool: { name: 'screen_capture', args: {} } });

    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('finished');
    });
    expect(events.map((event) => event.phase)).toEqual(['queued', 'tool_call', 'tool_result', 'finished']);
    expect(messages[1]?.content).toBe('Screenshot captured of the primary display.');
    await vi.waitFor(() => {
      expect(audit[0]).toMatchObject({ tool: 'screen_capture', outcome: 'ok', approvedBy: 'auto' });
    });
  });

  it('gates a state-changing tool behind an approval interrupt and resumes', async () => {
    const policy = new (await import('@main/ai/tools/policy')).ToolPolicyEngine(() => ({
      toolGrants: {},
      disabledTools: [],
      grantedRoots: [],
    }));
    const tools = makeTools({
      open_app: { risk: 'state-changing', run: (args) => `Launched ${String(args.name)}` },
    });
    const { deps, events, messages } = makeDeps(tools, { policy });
    const manager = new TurnManager(deps);
    await manager.start({
      ...baseRequest,
      content: '/open firefox',
      directTool: { name: 'open_app', args: { name: 'firefox' } },
    });

    await vi.waitFor(() => {
      expect(events.some((event) => event.phase === 'interrupt')).toBe(true);
    });
    expect(manager.resolveApproval({ decisions: [{ type: 'approve' }], grant: 'session' })).toBe(true);

    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('finished');
    });
    expect(messages[1]?.content).toBe('Launched firefox');
    expect(policy.grantSource('open_app', 'state-changing')).toBe('session');
  });

  it('finishes with a denial message when the user denies', async () => {
    const audit: ToolCallRecord[] = [];
    setToolCallAuditSink(async (record) => {
      audit.push(record);
    });
    const policy = new (await import('@main/ai/tools/policy')).ToolPolicyEngine(() => ({
      toolGrants: {},
      disabledTools: [],
      grantedRoots: [],
    }));
    const tools = makeTools({
      run_shell: { risk: 'destructive', run: () => 'should not run' },
    });
    const { deps, events, messages } = makeDeps(tools, { policy });
    const manager = new TurnManager(deps);
    await manager.start(directRequest);

    await vi.waitFor(() => {
      expect(events.some((event) => event.phase === 'interrupt')).toBe(true);
    });
    expect(manager.resolveApproval({ decisions: [{ type: 'reject', message: 'Denied by the user.' }] })).toBe(true);

    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('finished');
    });
    expect(messages[1]?.content).toBe('The request was denied.');
    await vi.waitFor(() => {
      expect(audit[0]).toMatchObject({ tool: 'run_shell', outcome: 'denied', approvedBy: 'denied' });
    });
  });

  it('marks disabled tools as failed without executing', async () => {
    const tools = makeTools({
      run_shell: { risk: 'destructive', run: () => 'never' },
    });
    const { deps, events } = makeDeps(tools, {
      policy: new (await import('@main/ai/tools/policy')).ToolPolicyEngine(() => ({
        toolGrants: {},
        disabledTools: ['run_shell'],
        grantedRoots: [],
      })),
    });
    const manager = new TurnManager(deps);
    await manager.start(directRequest);

    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('failed');
    });
    expect(events.at(-1)?.error).toContain('disabled');
  });

  it('fails unknown tools', async () => {
    const { deps, events } = makeDeps(makeTools({}));
    const manager = new TurnManager(deps);
    await manager.start({
      ...baseRequest,
      content: '/shell ls',
      directTool: { name: 'run_shell', args: { command: 'ls' } },
    });
    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('failed');
    });
    expect(events.at(-1)?.error).toContain('Unknown tool');
  });

  it('cancelled during approval ends the turn cancelled and audits the denial', async () => {
    const audit: ToolCallRecord[] = [];
    setToolCallAuditSink(async (record) => {
      audit.push(record);
    });
    const policy = new (await import('@main/ai/tools/policy')).ToolPolicyEngine(() => ({
      toolGrants: {},
      disabledTools: [],
      grantedRoots: [],
    }));
    const tools = makeTools({
      run_shell: { risk: 'destructive', run: () => 'never' },
    });
    const { deps, events, messages } = makeDeps(tools, { policy });
    const manager = new TurnManager(deps);
    await manager.start(directRequest);

    await vi.waitFor(() => {
      expect(events.some((event) => event.phase === 'interrupt')).toBe(true);
    });
    expect(manager.cancel()).toBe(true);
    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('cancelled');
    });
    await vi.waitFor(() => {
      expect(audit.some((record) => record.outcome === 'denied' && record.approvedBy === 'denied')).toBe(true);
    });
  });

  it('auto-denies after the timeout and persists the denial', async () => {
    vi.useFakeTimers();
    try {
      const policy = new (await import('@main/ai/tools/policy')).ToolPolicyEngine(() => ({
        toolGrants: {},
        disabledTools: [],
        grantedRoots: [],
      }));
      const tools = makeTools({
        run_shell: { risk: 'destructive', run: () => 'never' },
      });
      const { deps, events, messages } = makeDeps(tools, { policy });
      const manager = new TurnManager(deps);
      const started = manager.start(directRequest);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      await started;
      await vi.waitFor(() => {
        expect(events.at(-1)?.phase).toBe('finished');
      });
      expect(messages[1]?.content).toBe('The request was denied.');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('direct-tool access requests (HITL)', () => {
  it('interrupts a read-only tool on an ungranted path and grants the root on session approval', async () => {
    const { ToolPolicyEngine } = await import('@main/ai/tools/policy');
    const { mkdtempSync } = await import('fs');
    const { tmpdir } = await import('os');
    const grantDir = mkdtempSync(join(tmpdir(), 'da-direct-access-'));
    const policy = new ToolPolicyEngine(
      () => ({ toolGrants: {}, disabledTools: [], grantedRoots: [] }),
      undefined,
      async () => undefined
    );
    const seenRoots: string[][] = [];
    const tools: TurnManagerTools = {
      ...makeTools({
        read_file: { risk: 'read-only', run: () => 'file content' },
      }),
      requestedRoots: (name, args) =>
        policy.rootsNeedingGrant(['path'], args),
      executeDirect: async (_name, _args, ctx) => {
        seenRoots.push(ctx.grantedRoots ?? []);
        return { ok: true, text: 'file content', durationMs: 1 };
      },
    };
    const { deps, events } = makeDeps(tools, { policy });
    const manager = new TurnManager(deps);
    await manager.start({
      ...baseRequest,
      directTool: { name: 'read_file', args: { path: join(grantDir, 'todo.md') } },
    });

    await vi.waitFor(() => {
      expect(events.some((event) => event.phase === 'interrupt')).toBe(true);
    });
    const payload = events.find((event) => event.phase === 'interrupt')?.interrupt;
    expect(payload?.requests[0]).toMatchObject({ toolName: 'read_file', risk: 'read-only' });

    manager.resolveApproval({ decisions: [{ type: 'approve' }], grant: 'session' });
    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('finished');
    });
    expect(seenRoots[0]).toContain(grantDir);
    expect(policy.grantedRoots()).toContain(grantDir);
  });

  it('adds nothing when the path is already inside a granted root', async () => {
    const { ToolPolicyEngine } = await import('@main/ai/tools/policy');
    const root = resolve('/home/user/project');
    const policy = new ToolPolicyEngine(() => ({
      toolGrants: {},
      disabledTools: [],
      grantedRoots: [root],
    }));
    const tools: TurnManagerTools = {
      ...makeTools({
        read_file: { risk: 'read-only', run: () => 'file content' },
      }),
      requestedRoots: (name, args) => policy.rootsNeedingGrant(['path'], args),
    };
    const { deps, events } = makeDeps(tools, { policy });
    const manager = new TurnManager(deps);
    await manager.start({
      ...baseRequest,
      directTool: { name: 'read_file', args: { path: join(root, 'src.ts') } },
    });

    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('finished');
    });
    expect(events.some((event) => event.phase === 'interrupt')).toBe(false);
  });
});
