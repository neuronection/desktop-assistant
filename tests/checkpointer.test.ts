import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import { PrismaClient } from 'generated/client';
import { PrismaCheckpointSaver } from '@main/ai/checkpointer';
import { ToolRegistry } from '@main/ai/tools/registry';
import { ToolPolicyEngine } from '@main/ai/tools/policy';
import { createAssistantRunner, type AssistantEvent } from '@main/ai/graphs/assistant';
import type { NativeToolDefinition } from '@main/ai/tools/types';
import type { LLMProvider } from '@shared/types';
import { ScriptedChatModel } from './helpers/scripted-model';

let dataDir: string;
const clients: PrismaClient[] = [];

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  await rm(dataDir, { recursive: true, force: true });
});

const riskyDef: NativeToolDefinition<{ target: string }> = {
  name: 'risky',
  description: 'A state-changing tool.',
  schema: z.object({ target: z.string() }),
  risk: 'state-changing',
  summarize: (args) => `Risk: ${args.target}`,
  exec: async (args) => `Touched ${args.target}`,
};

const provider = { id: 'p1', systemPrompt: '' } as unknown as LLMProvider;

async function collect(run: AsyncGenerator<AssistantEvent, void, unknown>): Promise<AssistantEvent[]> {
  const events: AssistantEvent[] = [];
  for await (const event of run) {
    events.push(event);
  }
  return events;
}

function makePolicy(): ToolPolicyEngine {
  return new ToolPolicyEngine(() => ({ toolGrants: {}, disabledTools: [], grantedRoots: [] }));
}

const toolCallScript = (): AIMessage[] => [
  new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'risky', args: { target: '/tmp/x' } }] }),
  new AIMessage({ content: 'All done.' }),
];

describe('PrismaCheckpointSaver', () => {
  it('persists checkpoints in the app database and resumes an approval after a restart', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'da-checkpoint-'));
    const dbFile = join(dataDir, 'conversations.db');
    const clientA = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
    clients.push(clientA);
    await clientA.$connect();

    const saverA = new PrismaCheckpointSaver(() => clientA);
    const registry = new ToolRegistry();
    registry.register(riskyDef);
    const policy = makePolicy();

    const runnerA = createAssistantRunner({
      registry,
      policy,
      checkpointer: saverA,
      createModel: () => new ScriptedChatModel(toolCallScript()),
    });

    const threadId = 'conv_1:turn_resume';
    const first = await collect(
      runnerA.run({
        provider,
        modelId: 'test-model',
        apiKey: 'sk-test',
        history: [{ role: 'user', content: 'go' }],
        threadId,
      })
    );
    expect(first.some((event) => event.type === 'interrupt')).toBe(true);
    expect(first.some((event) => event.type === 'final')).toBe(false);

    // "restart": brand-new client connection + saver instance on the same database file
    const clientB = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
    clients.push(clientB);
    await clientB.$connect();
    const saverB = new PrismaCheckpointSaver(() => clientB);
    const stored = await saverB.getTuple({ configurable: { thread_id: threadId } });
    expect(stored).toBeDefined();
    expect(stored?.checkpoint.id).toBeTruthy();

    const runnerB = createAssistantRunner({
      registry,
      policy,
      checkpointer: saverB,
      createModel: () => new ScriptedChatModel([new AIMessage({ content: 'All done.' })]),
    });
    const second = await collect(
      runnerB.run({
        provider,
        modelId: 'test-model',
        apiKey: 'sk-test',
        history: [{ role: 'user', content: 'go' }],
        threadId,
        resume: [{ type: 'approve' }],
      })
    );

    const results = second
      .filter((event): event is Extract<AssistantEvent, { type: 'tool_results' }> => event.type === 'tool_results')
      .flatMap((event) => event.results);
    expect(results).toEqual([{ id: 'call_1', summary: 'Touched /tmp/x', isError: false, content: 'Touched /tmp/x' }]);
    expect(second.at(-1)).toMatchObject({ type: 'final', text: 'All done.' });
  }, 60_000);

  it('lists threads newest-first and deletes them wholesale', async () => {
    dataDir = dataDir ?? (await mkdtemp(join(tmpdir(), 'da-checkpoint-')));
    const dbFile = join(dataDir, 'list.db');
    const client = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
    clients.push(client);
    await client.$connect();
    const saver = new PrismaCheckpointSaver(() => client);

    const policy = makePolicy();
    const registry = new ToolRegistry();
    registry.register(riskyDef);
    const runner = createAssistantRunner({
      registry,
      policy,
      checkpointer: saver,
      createModel: () => new ScriptedChatModel(toolCallScript()),
    });

    await collect(
      runner.run({ provider, modelId: 'm', apiKey: 'k', history: [], threadId: 'conv_2:turn_a' })
    );
    await collect(
      runner.run({ provider, modelId: 'm', apiKey: 'k', history: [], threadId: 'conv_2:turn_b' })
    );

    const ids = [];
    for await (const tuple of saver.list({ configurable: { thread_id: 'conv_2:turn_a' } })) {
      ids.push(tuple.checkpoint.id);
    }
    expect(ids.length).toBeGreaterThan(0);
    expect([...ids]).toEqual([...ids].sort().reverse());

    await saver.deleteThread('conv_2:turn_a');
    const afterDelete = await saver.getTuple({ configurable: { thread_id: 'conv_2:turn_a' } });
    expect(afterDelete).toBeUndefined();
    expect(await saver.getTuple({ configurable: { thread_id: 'conv_2:turn_b' } })).toBeDefined();
  }, 60_000);

  it('prunes checkpoints older than the retention window', async () => {
    dataDir = dataDir ?? (await mkdtemp(join(tmpdir(), 'da-checkpoint-')));
    const dbFile = join(dataDir, 'prune.db');
    const client = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
    clients.push(client);
    await client.$connect();
    const saver = new PrismaCheckpointSaver(() => client);

    const policy = makePolicy();
    const registry = new ToolRegistry();
    registry.register(riskyDef);
    const runner = createAssistantRunner({
      registry,
      policy,
      checkpointer: saver,
      createModel: () => new ScriptedChatModel(toolCallScript()),
    });
    await collect(runner.run({ provider, modelId: 'm', apiKey: 'k', history: [], threadId: 'conv_3:turn_old' }));
    expect(await saver.getTuple({ configurable: { thread_id: 'conv_3:turn_old' } })).toBeDefined();

    await client.$executeRawUnsafe(
      `UPDATE "Checkpoint" SET "createdAt" = (CAST(strftime('%s','now') AS INTEGER) - 30*86400) * 1000`
    );
    await client.$executeRawUnsafe(
      `UPDATE "CheckpointWrite" SET "createdAt" = (CAST(strftime('%s','now') AS INTEGER) - 30*86400) * 1000`
    );

    await saver.prune();

    expect(await saver.getTuple({ configurable: { thread_id: 'conv_3:turn_old' } })).toBeUndefined();
  }, 60_000);
});
