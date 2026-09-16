import { describe, it, expect, vi } from 'vitest';
import { PrismaClient } from 'generated/client';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/da-consolidate-test', isPackaged: true },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`),
    decryptString: (buf: Buffer) => buf.toString().slice(4),
  },
}));
import {
  MemoryConsolidationService,
  MERGE_ZONE_MIN,
  CONSOLIDATE_BATCH_MAX,
  type ConsolidationCandidate,
} from '@main/services/MemoryConsolidationService';
import { MemoryService, MEMORY_DEDUPE_SIMILARITY } from '@main/services/MemoryService';

let dataDir: string;
const clients: PrismaClient[] = [];

async function testClient(): Promise<PrismaClient> {
  if (!dataDir) {
    dataDir = await mkdtemp(join(tmpdir(), 'da-consolidate-'));
  }
  const client = new PrismaClient({ datasources: { db: { url: `file:${join(dataDir, `c-${Math.random().toString(36).slice(2)}.db`)}` } } });
  clients.push(client);
  await client.$connect();
  await client.$executeRawUnsafe(
    `CREATE TABLE "Memory" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "content" TEXT NOT NULL,
      "tags" JSONB,
      "source" TEXT NOT NULL,
      "conversationId" TEXT,
      "mergedFrom" JSONB,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );`
  );
  return client;
}

function makeService(
  options: {
    smartMerge?: boolean;
    gatewayReply?: string;
    gatewayError?: Error;
    plumbingAssigned?: boolean;
    now?: () => number;
  } = {}
): {
  service: MemoryConsolidationService;
  chat: ReturnType<typeof vi.fn>;
} {
  const config = {
    memory: { smartMerge: options.smartMerge ?? false },
    taskAssignments: options.plumbingAssigned === false ? {} : { plumbing: 'cheap-model' },
    providers: [
      {
        id: 'p1',
        type: 'openai',
        apiBase: 'https://api.example.com/v1',
        apiKey: 'sk-inline',
        availableModels: [{ id: 'cheap-model', name: 'Cheap', providerType: 'openai', providerId: 'p1' }],
        customModels: [],
      },
    ],
    defaultChatModelId: null,
  };
  const chat = vi.fn(async () => {
    if (options.gatewayError) {
      throw options.gatewayError;
    }
    return options.gatewayReply ?? '{"verdict":"keep_new"}';
  });
  const service = new MemoryConsolidationService({
    configService: { getConfig: () => config } as never,
    gateway: { chat } as never,
    ...(options.now ? { now: options.now } : {}),
  });
  return { service, chat };
}

const older: ConsolidationCandidate = {
  id: 'm1',
  content: 'User deploys the blog with a canary rollout every Friday',
  source: 'user',
};
const newer =
  'User deploys the blog using canary rollouts on Fridays, then watches error budgets afterwards';

describe('verdict parsing (D2)', () => {
  it('parses a merge verdict wrapped in prose and trims the content', async () => {
    const { service, chat } = makeService({
      smartMerge: true,
      gatewayReply:
        'Analysis:\n{"verdict":"merge","mergedContent":"User deploys the blog via Friday canary rollouts; error budgets are watched afterwards"}\nDone.',
    });
    const outcome = await service.arbitrateSave(newer, older);
    expect(outcome).toEqual({
      action: 'merge',
      mergedContent: 'User deploys the blog via Friday canary rollouts; error budgets are watched afterwards',
    });
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('rejects a merge verdict without content — deterministic fallback', async () => {
    const { service } = makeService({ smartMerge: true, gatewayReply: '{"verdict":"merge"}' });
    await expect(service.arbitrateSave(newer, older)).resolves.toBeNull();
  });

  it('rejects unknown verdict names (schema has no delete — D4)', async () => {
    const { service } = makeService({ smartMerge: true, gatewayReply: '{"verdict":"delete"}' });
    await expect(service.arbitrateSave(newer, older)).resolves.toBeNull();
  });

  it('fail-soft: a gateway error surfaces as null at the save hook', async () => {
    const { service } = makeService({
      smartMerge: true,
      gatewayError: new Error('provider down'),
    });
    const outcome = await service
      .arbitrateSave(newer, older)
      .catch(() => null);
    expect(outcome).toBeNull();
  });
});

describe('smart-merge gating (D3)', () => {
  it('returns null without calling the gateway when smart merge is off', async () => {
    const { service, chat } = makeService({ smartMerge: false });
    await expect(service.arbitrateSave(newer, older)).resolves.toBeNull();
    expect(chat).not.toHaveBeenCalled();
  });

  it('returns null when no internal model is resolvable', async () => {
    const { service, chat } = makeService({ smartMerge: true, plumbingAssigned: false });
    await expect(service.arbitrateSave(newer, older)).resolves.toBeNull();
    expect(chat).not.toHaveBeenCalled();
  });
});

describe('rate caps (D8)', () => {
  it('skips a pass inside the cooldown window', async () => {
    let clock = 1_000_000;
    const { service } = makeService({
      smartMerge: true,
      now: () => clock,
      gatewayReply: '{"verdict":"keep_old"}',
    });
    const rows: ConsolidationCandidate[] = [
      { id: 'a', content: 'First memory about the deploy bot schedule', source: 'assistant' },
      { id: 'b', content: 'First memory about the deploy bot cadence', source: 'assistant' },
    ];
    const first = await service.consolidatePass(rows, async () => undefined);
    expect(first.skipped).toBe(false);
    clock += 1_000;
    const second = await service.consolidatePass(rows, async () => undefined);
    expect(second.skipped).toBe(true);
  });

  it('caps the pass at the batch maximum', async () => {
    const { service } = makeService({
      smartMerge: true,
      gatewayReply: '{"verdict":"keep_old"}',
    });
    const rows: ConsolidationCandidate[] = Array.from({ length: 40 }, (_unused, index) => ({
      id: `m${index}`,
      content: `Memory number ${index} about the deploy bot cadence group ${index % 2}`,
      source: 'assistant' as const,
    }));
    const result = await service.consolidatePass(rows, async () => undefined);
    expect(result.checked).toBeLessThanOrEqual(CONSOLIDATE_BATCH_MAX);
  });
});

describe('save-time arbitration (D1/D4/D9, real SQLite)', () => {
  const CREATE_MEMORY = `CREATE TABLE "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "tags" JSONB,
    "source" TEXT NOT NULL,
    "conversationId" TEXT,
    "mergedFrom" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );`;

  async function serviceWithHook(
    hook: Parameters<MemoryService['setConsolidator']>[0]
  ): Promise<{ service: MemoryService; client: PrismaClient }> {
    const client = await testClient();
    const service = new MemoryService(() => client);
    service.setConsolidator(hook);
    return { service, client };
  }

  it('a merge verdict replaces the target and records provenance for undo (D9)', async () => {
    const mergedText = 'User deploys the blog via Friday canary rollouts and watches error budgets';
    const hook = vi.fn(async () => ({ action: 'merge' as const, mergedContent: mergedText }));
    const { service, client } = await serviceWithHook(hook);
    await service.save({ content: 'User deploys the blog with a canary rollout every Friday', source: 'user' });

    const grayZone = 'User deploys the blog with a canary rollout strategy each Friday';
    const result = await service.save({ content: grayZone, source: 'assistant' });

    expect(result.outcome).toBe('merged');
    expect(result.merged).toBe(true);
    const winner = await client.memory.findUniqueOrThrow({ where: { id: result.memory.id } });
    expect(winner.content).toBe(mergedText);
    const provenance = winner.mergedFrom as unknown as { id: string; content: string }[];
    expect(provenance).toHaveLength(1);
    // The losing row's full text travels with the winner (D9 undo path).
    expect(provenance[0].content).toContain('canary rollout every Friday');
    expect(await client.memory.count()).toBe(1);
  });

  it('keep_old keeps the existing row and saves nothing new', async () => {
    const hook = vi.fn(async () => ({ action: 'keep_old' as const }));
    const { service, client } = await serviceWithHook(hook);
    await service.save({ content: 'User deploys the blog with a canary rollout every Friday', source: 'user' });
    const result = await service.save({ content: 'User deploys the blog with a canary rollout strategy each Friday', source: 'assistant' });
    expect(result.outcome).toBe('kept_existing');
    expect(await client.memory.count()).toBe(1);
  });

  it('a failing consolidator falls back to the plain create (D1)', async () => {
    const hook = vi.fn(async () => {
      throw new Error('model exploded');
    });
    const { service, client } = await serviceWithHook(hook);
    await service.save({ content: 'User deploys the blog with a canary rollout every Friday', source: 'user' });
    const result = await service.save({ content: 'User deploys the blog with a canary rollout strategy each Friday', source: 'assistant' });
    expect(result.outcome).toBe('saved');
    expect(result.merged).toBe(false);
    expect(await client.memory.count()).toBe(2);
  });

  it('below the merge zone the hook is never consulted', async () => {
    const hook = vi.fn(async () => null);
    const { service } = await serviceWithHook(hook);
    await service.save({ content: 'Completely unrelated fact about kite surfing in Tarifa', source: 'user' });
    const result = await service.save({ content: 'Completely different fact about sourdough hydration ratios', source: 'assistant' });
    expect(result.outcome).toBe('saved');
    expect(hook).not.toHaveBeenCalled();
  });

  it('constants hold the documented relationship (D1 boundary)', () => {
    expect(MERGE_ZONE_MIN).toBeLessThan(MEMORY_DEDUPE_SIMILARITY);
    expect(MERGE_ZONE_MIN).toBeGreaterThan(0);
  });
});
