import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from 'generated/prisma/client';
import { bootDatabase, openDatabase, runRetentionPrune } from '@main/db';
import type { RetentionSettings } from '@shared/types';

const SCHEMA_SQL = await readFile(join(process.cwd(), 'src/main/resources/schema.sql'), 'utf8');
const DAY = 86_400_000;

const RETENTION: RetentionSettings = {
  checkpointsDays: 7,
  graphNodeRunsDays: 7,
  notificationsDays: 30,
  toolResultsDays: 7,
  aiCallsDays: null,
  toolCallsDays: null,
  commandInvocationsDays: null,
};

describe('boot retention pass (plan 36 S4, D6)', () => {
  let dir: string | null = null;
  let client: PrismaClient | null = null;

  afterEach(async () => {
    await client?.$disconnect();
    client = null;
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  async function seeded(): Promise<PrismaClient> {
    dir = await mkdtemp(join(tmpdir(), 'db-retention-'));
    client = await openDatabase(join(dir, 'conversations.db'));
    await bootDatabase(client, SCHEMA_SQL);
    const now = Date.now();
    const old = new Date(now - 40 * DAY);
    const fresh = new Date(now - DAY);
    await client.conversation.create({
      data: { id: 't', title: 'fresh owner', createdAt: fresh, updatedAt: fresh, isArchived: false },
    });
    await client.checkpoint.create({
      data: { threadId: 't', checkpointId: 'old', checkpoint: Buffer.from('x'), createdAt: old },
    });
    await client.checkpoint.create({
      data: { threadId: 't', checkpointId: 'fresh', checkpoint: Buffer.from('x'), createdAt: fresh },
    });
    await client.checkpointWrite.create({
      data: { threadId: 't', checkpointId: 'old', taskId: 'task', idx: 0, channel: 'c', createdAt: old },
    });
    await client.graphNodeRun.createMany({
      data: [
        { flow: 'assistant', threadId: 't', node: 'old', outcome: 'done', durationMs: 1, createdAt: old },
        { flow: 'assistant', threadId: 't', node: 'fresh', outcome: 'done', durationMs: 1, createdAt: fresh },
      ],
    });
    await client.notification.createMany({
      data: [
        { kind: 'system', severity: 'info', title: 'old', body: '', payload: {}, clickAction: 'none', dedupeKey: 'old', createdAt: old },
        { kind: 'system', severity: 'info', title: 'fresh', body: '', payload: {}, clickAction: 'none', dedupeKey: 'fresh', createdAt: fresh },
      ],
    });
    await client.aiCall.create({
      data: { task: 'chat', model: 'm', durationMs: 1, outcome: 'ok', createdAt: old },
    });
    await client.toolCall.create({
      data: { tool: 't', argsHash: 'h', outcome: 'ok', durationMs: 1, approvedBy: 'user', createdAt: old },
    });
    await client.commandInvocation.create({
      data: { commandId: 'c', kind: 'builtin', source: 'palette', outcome: 'ok', createdAt: old },
    });
    return client;
  }

  it('prunes only the configured windows and keeps null-window audit rows', async () => {
    const db = await seeded();
    const pruneToolResults = vi.fn(async () => undefined);
    await runRetentionPrune({ client: db, retention: RETENTION, pruneToolResults });

    expect((await db.checkpoint.findMany()).map((row) => row.checkpointId)).toEqual(['fresh']);
    expect(await db.checkpointWrite.count()).toBe(0);
    expect((await db.graphNodeRun.findMany()).map((row) => row.node)).toEqual(['fresh']);
    expect((await db.notification.findMany()).map((row) => row.title)).toEqual(['fresh']);
    expect(await db.aiCall.count()).toBe(1);
    expect(await db.toolCall.count()).toBe(1);
    expect(await db.commandInvocation.count()).toBe(1);
    expect(pruneToolResults).toHaveBeenCalledOnce();
  });

  it('follows both checkpoint thread forms with conversation ownership', async () => {
    const db = await seeded();
    const now = new Date();
    const stale = new Date(Date.now() - 40 * DAY);
    await db.conversation.create({
      data: { id: 'stale', title: 'stale owner', createdAt: stale, updatedAt: stale, isArchived: false },
    });
    await db.conversation.create({
      data: { id: 'live', title: 'live owner', createdAt: now, updatedAt: now, isArchived: false },
    });
    for (const threadId of ['stale', 'stale:tip', 'live', 'live:tip']) {
      await db.checkpoint.create({
        data: { threadId, checkpointId: `${threadId}-new`, checkpoint: Buffer.from('x'), createdAt: now },
      });
    }

    await runRetentionPrune({ client: db, retention: RETENTION });

    const threads = [...new Set((await db.checkpoint.findMany()).map((row) => row.threadId))].sort();
    expect(threads).toEqual(expect.arrayContaining(['live', 'live:tip', 't']));
    expect(threads).not.toContain('stale');
    expect(threads).not.toContain('stale:tip');
  });

  it('does nothing when every window is off', async () => {
    const db = await seeded();
    const off: RetentionSettings = {
      checkpointsDays: null,
      graphNodeRunsDays: null,
      notificationsDays: null,
      toolResultsDays: null,
      aiCallsDays: null,
      toolCallsDays: null,
      commandInvocationsDays: null,
    };
    const pruneToolResults = vi.fn(async () => undefined);
    const result = await runRetentionPrune({ client: db, retention: off, pruneToolResults });
    expect(result).toMatchObject({ checkpoints: 0, graphNodeRuns: 0, notifications: 0, toolResults: 0 });
    expect(pruneToolResults).not.toHaveBeenCalled();
    expect(await db.checkpoint.count()).toBe(2);
    expect(await db.graphNodeRun.count()).toBe(2);
  });

  it('prunes audit tables when the owner turns their windows on', async () => {
    const db = await seeded();
    await runRetentionPrune({
      client: db,
      retention: { ...RETENTION, aiCallsDays: 30, toolCallsDays: 30, commandInvocationsDays: 30 },
    });
    expect(await db.aiCall.count()).toBe(0);
    expect(await db.toolCall.count()).toBe(0);
    expect(await db.commandInvocation.count()).toBe(0);
  });
});
