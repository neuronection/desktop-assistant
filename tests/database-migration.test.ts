import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => process.cwd() },
}));

const { DatabaseService } = await import('@main/services/DatabaseService');

describe('DatabaseService additive column migration (plan 24 follow-up)', () => {
  let dir: string | null = null;

  afterEach(async () => {
    delete process.env.DESKTOP_ASSISTANT_DATA_DIR;
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it('adds inputTokens/outputTokens to a pre-existing AiCall table', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'db-migrate-'));
    process.env.DESKTOP_ASSISTANT_DATA_DIR = dir;

    // 1. First boot creates the schema (with the new columns).
    const first = new DatabaseService();
    await first.initialize();
    const legacyClient = first.getClient();
    // Simulate a legacy DB whose AiCall predates the token columns.
    await legacyClient.$executeRawUnsafe('DROP TABLE "AiCall";');
    await legacyClient.$executeRawUnsafe(`CREATE TABLE "AiCall" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "task" TEXT NOT NULL,
      "providerId" TEXT,
      "model" TEXT NOT NULL,
      "durationMs" INTEGER NOT NULL,
      "outcome" TEXT NOT NULL,
      "error" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
    await legacyClient.$executeRawUnsafe(
      `INSERT INTO "AiCall" ("id","task","model","durationMs","outcome") VALUES ('legacy-1','intent','legacy',1,'ok');`
    );
    const before = await legacyClient.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("AiCall");');
    expect(before.map((column) => column.name)).not.toContain('inputTokens');

    // 2. Re-open in a fresh service: setup() must add the missing columns.
    const upgraded = new DatabaseService();
    await upgraded.initialize();
    const client = upgraded.getClient();
    const after = await client.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("AiCall");');
    expect(after.map((column) => column.name)).toEqual(
      expect.arrayContaining(['inputTokens', 'outputTokens'])
    );

    // The legacy row survives, and the new columns accept writes.
    const rows = await client.aiCall.findMany();
    expect(rows.some((row) => row.model === 'legacy')).toBe(true);
    await expect(
      client.aiCall.create({
        data: { task: 'intent', model: 'fresh', durationMs: 2, outcome: 'ok', inputTokens: 5, outputTokens: 7 },
      })
    ).resolves.toMatchObject({ inputTokens: 5, outputTokens: 7 });
  });
});
