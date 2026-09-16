import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from 'generated/client';
import {
  getGraphNodeRunStats,
  pruneGraphNodeRuns,
  recordGraphNodeRun,
} from '@main/ai/audit';
import { TurnManager, type TurnManagerDeps } from '@main/turns/TurnManager';
import type { AssistantRunner, AssistantEvent } from '@main/ai/graphs/assistant';
import { setAiAuditClientProvider } from '@main/ai/audit';
import { MessageRole } from '@shared/database-types';
import type { Message } from '@shared/database-types';
import type { LLMProvider } from '@shared/types';
import type { TurnEvent } from '@shared/turns';

let dataDir: string;
const clients: PrismaClient[] = [];

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  await rm(dataDir, { recursive: true, force: true });
});

async function makeClient(): Promise<PrismaClient> {
  if (!dataDir) {
    dataDir = await mkdtemp(join(tmpdir(), 'da-node-runs-'));
  }
  const client = new PrismaClient({ datasources: { db: { url: `file:${join(dataDir, `nr-${Math.random().toString(36).slice(2)}.db`)}` } } });
  clients.push(client);
  await client.$connect();
  await client.$executeRawUnsafe(
    `CREATE TABLE "GraphNodeRun" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "flow" TEXT NOT NULL,
      "threadId" TEXT NOT NULL,
      "node" TEXT NOT NULL,
      "outcome" TEXT NOT NULL,
      "durationMs" INTEGER NOT NULL,
      "resumed" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`
  );
  return client;
}

const provider = {
  id: 'p1',
  systemPrompt: '',
  availableModels: [{ id: 'test-model', name: 'Test Model', providerType: 'openai', providerId: 'p1' }],
} as unknown as LLMProvider;

function makeDeps(overrides: Partial<TurnManagerDeps> = {}): { deps: TurnManagerDeps; events: TurnEvent[] } {
  const events: TurnEvent[] = [];
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
        return recorded;
      },
      async getMessagesByConversation(conversationId: string): Promise<Message[]> {
        return [
          { id: 'm1', content: 'hello', role: MessageRole.USER, conversationId, createdAt: new Date(), attachments: [] } as Message,
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
  return { deps, events };
}

describe('graph node run persistence (plan 13 S5)', () => {
  it('persists one row per finished node with outcome, duration and resumed flag', async () => {
    const client = await makeClient();
    setAiAuditClientProvider(() => client);
    const script: AssistantEvent[] = [
      { type: 'node_started', node: 'model_request', label: 'Thinking', resumed: false },
      { type: 'node_finished', node: 'model_request', label: 'Thinking', outcome: 'done', durationMs: 120, resumed: false },
      {
        type: 'tool_calls',
        calls: [{ id: 'c1', name: 'web_fetch', args: { url: 'https://x' }, summary: 'Fetch', risk: 'read-only' }],
      },
      { type: 'node_started', node: 'tools', label: 'Using tools', resumed: false },
      {
        type: 'tool_results',
        results: [{ id: 'c1', summary: 'Fetched', isError: false }],
      },
      { type: 'node_finished', node: 'tools', label: 'Using tools', outcome: 'done', durationMs: 300, resumed: false },
      { type: 'final', text: 'Done.' },
    ];
    const runner: AssistantRunner = {
      getToolCount: async () => 1,
      async *run(): AsyncGenerator<AssistantEvent, void, unknown> {
        for (const event of script) {
          yield event;
        }
      },
    };
    const { deps, events } = makeDeps({ agent: runner });
    const persisted: { metadata?: { nodeTimeline?: unknown[]; outcome?: string } }[] = [];
    const originalCreate = deps.messages.createMessage.bind(deps.messages);
    deps.messages.createMessage = async (content, role, conversationId, attachments, error, metadata) => {
      const recorded = (await originalCreate(content, role, conversationId, attachments, error, metadata)) as {
        metadata?: { nodeTimeline?: unknown[]; outcome?: string };
      };
      persisted.push(recorded);
      return recorded;
    };
    const manager = new TurnManager(deps);
    await manager.start({ conversationId: 'conv_existing', content: 'go', modelId: 'test-model' });
    await vi.waitFor(() => {
      expect(events[events.length - 1]?.phase).toBe('finished');
    });

    // Node-run writes are fire-and-forget (audit.ts contract) — they may
    // still be in flight after the finished broadcast, so poll the table
    // itself instead of assuming the rows landed.
    const rows = await vi.waitFor(
      async () => {
        const rows = await client.graphNodeRun.findMany({ orderBy: { createdAt: 'asc' } });
        expect(rows.map((row) => row.node)).toEqual(['model_request', 'tools']);
        return rows;
      },
      { timeout: 5_000 }
    );
    expect(rows[0]).toMatchObject({ flow: 'assistant', outcome: 'done', durationMs: 120, resumed: false });

    // metadata_json carries the final node timeline (independent of the steps cap).
    const assistantRow = persisted.find((row) => row.metadata?.nodeTimeline);
    expect(assistantRow?.metadata?.nodeTimeline).toHaveLength(2);
    expect(assistantRow?.metadata?.nodeTimeline?.[0]).toMatchObject({ node: 'model_request', outcome: 'done', durationMs: 120, toolCount: 0 });
    expect(assistantRow?.metadata?.nodeTimeline?.[1]).toMatchObject({ node: 'tools', outcome: 'done', toolCount: 1 });
  });

  it('restart-read: a brand-new client on the same database sees the persisted rows', async () => {
    if (!dataDir) {
      dataDir = await mkdtemp(join(tmpdir(), 'da-node-runs-'));
    }
    const dbFile = join(dataDir, `restart-${Math.random().toString(36).slice(2)}.db`);
    const url = `file:${dbFile}`;
    const clientA = new PrismaClient({ datasources: { db: { url } } });
    clients.push(clientA);
    await clientA.$connect();
    await clientA.$executeRawUnsafe(
      `CREATE TABLE "GraphNodeRun" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "flow" TEXT NOT NULL,
        "threadId" TEXT NOT NULL,
        "node" TEXT NOT NULL,
        "outcome" TEXT NOT NULL,
        "durationMs" INTEGER NOT NULL,
        "resumed" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`
    );
    setAiAuditClientProvider(() => clientA);
    await recordGraphNodeRun({ flow: 'assistant', threadId: 't1', node: 'tools', outcome: 'done', durationMs: 42, resumed: false });

    // Simulate restart: fresh client instance on the same database file.
    const clientB = new PrismaClient({ datasources: { db: { url } } });
    clients.push(clientB);
    await clientB.$connect();
    setAiAuditClientProvider(() => clientB);
    const rows = await clientB.graphNodeRun.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ flow: 'assistant', node: 'tools', outcome: 'done', durationMs: 42 });
  });

  it('prune removes rows older than the cutoff and keeps fresh ones', async () => {
    const client = await makeClient();
    setAiAuditClientProvider(() => client);
    await client.graphNodeRun.createMany({
      data: [
        { flow: 'assistant', threadId: 't', node: 'old', outcome: 'done', durationMs: 1, resumed: false, createdAt: new Date(Date.now() - 30 * 86_400_000) },
        { flow: 'assistant', threadId: 't', node: 'fresh', outcome: 'done', durationMs: 2, resumed: false, createdAt: new Date() },
      ],
    });
    await pruneGraphNodeRuns(7 * 86_400_000);
    const rows = await client.graphNodeRun.findMany();
    expect(rows.map((row) => row.node)).toEqual(['fresh']);
  });

  it('dashboard-ready query aggregates per-node stats', async () => {
    const client = await makeClient();
    setAiAuditClientProvider(() => client);
    await client.graphNodeRun.createMany({
      data: [
        { flow: 'assistant', threadId: 't', node: 'model_request', outcome: 'done', durationMs: 100, resumed: false },
        { flow: 'assistant', threadId: 't', node: 'model_request', outcome: 'done', durationMs: 200, resumed: false },
        { flow: 'assistant', threadId: 't', node: 'model_request', outcome: 'failed', durationMs: 50, resumed: false },
        { flow: 'research', threadId: 't', node: 'synthesize', outcome: 'done', durationMs: 900, resumed: false },
      ],
    });
    const stats = await getGraphNodeRunStats('assistant', null);
    const modelRow = stats.find((row) => row.node === 'model_request');
    expect(modelRow).toMatchObject({ runs: 3, failed: 1, avgDurationMs: 117 });
    expect(stats.find((row) => row.node === 'synthesize')).toBeUndefined();
    const all = await getGraphNodeRunStats('research', null);
    expect(all[0]).toMatchObject({ node: 'synthesize', runs: 1, avgDurationMs: 900 });
  });
});
