import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from 'generated/client';
import { getToolUsageStats, setAiAuditClientProvider } from '@main/ai/audit';

const clients: PrismaClient[] = [];
let dataDir: string;

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  await rm(dataDir, { recursive: true, force: true });
});

async function makeClient(): Promise<PrismaClient> {
  if (!dataDir) {
    dataDir = await mkdtemp(join(tmpdir(), 'da-usage-'));
  }
  const client = new PrismaClient({ datasources: { db: { url: `file:${join(dataDir, `usage-${Math.random().toString(36).slice(2)}.db`)}` } } });
  clients.push(client);
  await client.$connect();
  await client.$executeRawUnsafe(
    `CREATE TABLE "ToolCall" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "conversationId" TEXT,
      "messageId" TEXT,
      "tool" TEXT NOT NULL,
      "argsHash" TEXT NOT NULL,
      "outcome" TEXT NOT NULL,
      "durationMs" INTEGER NOT NULL,
      "approvedBy" TEXT NOT NULL,
      "mcpServer" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`
  );
  return client;
}

describe('getToolUsageStats (real SQLite audit table)', () => {
  it('aggregates per-tool counts, approvals, denials, durations and windowing', async () => {
    const client = await makeClient();
    setAiAuditClientProvider(() => client);
    const now = Date.now();
    const seed: { tool: string; outcome: string; approvedBy: string; durationMs: number; ageDays: number }[] = [
      { tool: 'web_fetch', outcome: 'ok', approvedBy: 'auto', durationMs: 120, ageDays: 1 },
      { tool: 'web_fetch', outcome: 'ok', approvedBy: 'auto', durationMs: 80, ageDays: 2 },
      { tool: 'web_fetch', outcome: 'error', approvedBy: 'once', durationMs: 300, ageDays: 2 },
      { tool: 'run_shell', outcome: 'ok', approvedBy: 'always', durationMs: 40, ageDays: 40 },
      { tool: 'run_shell', outcome: 'denied', approvedBy: 'denied', durationMs: 0, ageDays: 41 },
      { tool: 'file_delete', outcome: 'denied', approvedBy: 'timeout', durationMs: 5, ageDays: 3 },
    ];
    for (const row of seed) {
      await client.toolCall.create({
        data: {
          tool: row.tool,
          argsHash: 'hash',
          outcome: row.outcome,
          durationMs: row.durationMs,
          approvedBy: row.approvedBy,
          createdAt: new Date(now - row.ageDays * 86_400_000),
        },
      });
    }

    const all = await getToolUsageStats(null);
    expect(all.total).toBe(6);
    const fetchRow = all.rows.find((row) => row.tool === 'web_fetch');
    expect(fetchRow).toMatchObject({ total: 3, ok: 2, errors: 1, denied: 0, avgDurationMs: 167 });
    expect(fetchRow?.approvals).toEqual({ auto: 2, once: 1 });
    const shellRow = all.rows.find((row) => row.tool === 'run_shell');
    expect(shellRow?.denied).toBe(1);

    const week = await getToolUsageStats(7);
    expect(week.total).toBe(4); // ages 1, 2, 2, 3 days — both run_shell rows fall outside
    expect(week.rows.find((row) => row.tool === 'run_shell')).toBeUndefined();
    expect(week.recentFailures.length).toBe(2);
    expect(week.recentFailures.map((failure) => failure.tool)).toEqual(['web_fetch', 'file_delete']);
  });

  it('returns an empty snapshot without a wired client', async () => {
    setAiAuditClientProvider(() => null);
    const stats = await getToolUsageStats(7);
    expect(stats).toEqual({ windowDays: 7, total: 0, rows: [], recentFailures: [] });
  });
});
