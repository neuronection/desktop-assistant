import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PrismaClient } from 'generated/prisma/client';
import { bootDatabase, openDatabase, readUserVersion, SCHEMA_VERSION, splitStatements } from '@main/db';
import { TEXT, interpolate } from '@shared/constants/text';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => process.cwd() },
}));

const { DatabaseService } = await import('@main/services/DatabaseService');

const SCHEMA_SQL = await readFile(path.resolve(__dirname, '../src/main/resources/schema.sql'), 'utf8');
const BEFORE_PLAN36_SQL = await readFile(path.resolve(__dirname, 'fixtures/schema-before-plan36.sql'), 'utf8');

interface TableSnapshot {
  columns: { name: string; type: string; notnull: number; pk: number }[];
  indexes: Record<string, { unique: number; columns: string[] }>;
}

async function snapshot(client: PrismaClient): Promise<Record<string, TableSnapshot>> {
  const tables = await client.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`
  );
  const result: Record<string, TableSnapshot> = {};
  for (const { name } of tables) {
    const columns = await client.$queryRawUnsafe<TableSnapshot['columns']>(`PRAGMA table_info("${name}");`);
    const indexes = await client.$queryRawUnsafe<Array<{ name: string; unique: number }>>(
      `PRAGMA index_list("${name}");`
    );
    const indexSnapshot: TableSnapshot['indexes'] = {};
    for (const index of indexes) {
      const info = await client.$queryRawUnsafe<Array<{ seqno: number; name: string }>>(
        `PRAGMA index_info("${index.name}");`
      );
      indexSnapshot[index.name] = {
        unique: index.unique,
        columns: info.sort((a, b) => a.seqno - b.seqno).map((column) => column.name),
      };
    }
    result[name] = { columns, indexes: indexSnapshot };
  }
  return result;
}

async function executeScript(client: PrismaClient, sql: string): Promise<void> {
  for (const statement of splitStatements(sql)) {
    await client.$executeRawUnsafe(statement);
  }
}

describe('schema boot after the plan-36 flatten', () => {
  let dir: string | null = null;

  afterEach(async () => {
    delete process.env.DESKTOP_ASSISTANT_DATA_DIR;
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it('fresh boot creates the head schema and stamps user_version', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'db-fresh-'));
    process.env.DESKTOP_ASSISTANT_DATA_DIR = dir;

    const service = new DatabaseService();
    await service.initialize();
    const client = service.getClient();
    expect(await readUserVersion(client)).toBe(SCHEMA_VERSION);

    const tables = await client.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`
    );
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'Embedding',
        'Notification',
        'AppInstanceStatus',
        'Automation',
        'ConnectorAccount',
      ])
    );
    const messageColumns = await client.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("Message");');
    expect(messageColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['parentId', 'activeChildId'])
    );
    await service.cleanup();
  });

  it('an existing head database converges with a fresh boot and keeps its data', async () => {
    const freshDir = await mkdtemp(path.join(tmpdir(), 'db-fresh-converge-'));
    const existingDir = await mkdtemp(path.join(tmpdir(), 'db-existing-converge-'));
    dir = freshDir;

    try {
      const fresh = await openDatabase(path.join(freshDir, 'conversations.db'));
      await bootDatabase(fresh, SCHEMA_SQL);
      const freshSnapshot = await snapshot(fresh);
      await fresh.$disconnect();

      const existing = await openDatabase(path.join(existingDir, 'conversations.db'));
      await bootDatabase(existing, SCHEMA_SQL);
      await existing.$executeRawUnsafe(
        `INSERT INTO "Conversation" ("id","title","updatedAt") VALUES ('conv-1','After the flatten',CURRENT_TIMESTAMP);`
      );
      await existing.$executeRawUnsafe(
        `INSERT INTO "Message" ("id","content","role","conversationId") VALUES ('msg-1','Kept across restarts','user','conv-1');`
      );
      await existing.$disconnect();

      const reopened = await openDatabase(path.join(existingDir, 'conversations.db'));
      expect(await bootDatabase(reopened, SCHEMA_SQL)).toBe('upgraded');
      expect(await readUserVersion(reopened)).toBe(SCHEMA_VERSION);
      expect(await snapshot(reopened)).toEqual(freshSnapshot);
      expect(await reopened.conversation.count()).toBe(1);
      expect(await reopened.message.count()).toBe(1);
      await reopened.$disconnect();
    } finally {
      await rm(freshDir, { recursive: true, force: true });
      await rm(existingDir, { recursive: true, force: true });
    }
  });

  it('refuses a pre-plan-36 database with the typed plain-language message', async () => {
    const oldDir = await mkdtemp(path.join(tmpdir(), 'db-old-refused-'));
    dir = oldDir;
    try {
      const old = await openDatabase(path.join(oldDir, 'conversations.db'));
      await executeScript(old, BEFORE_PLAN36_SQL);
      await old.$disconnect();

      const reopened = await openDatabase(path.join(oldDir, 'conversations.db'));
      const expected = interpolate(TEXT.DB_SCHEMA_UNSUPPORTED, { version: 0, head: SCHEMA_VERSION });
      await expect(bootDatabase(reopened, SCHEMA_SQL)).rejects.toThrow(expected);
      expect(await readUserVersion(reopened)).toBe(0);
      await reopened.$disconnect();
    } finally {
      await rm(oldDir, { recursive: true, force: true });
    }
  });

  it('refuses a database written by a newer schema', async () => {
    const newerDir = await mkdtemp(path.join(tmpdir(), 'db-newer-refused-'));
    dir = newerDir;
    try {
      const newer = await openDatabase(path.join(newerDir, 'conversations.db'));
      await bootDatabase(newer, SCHEMA_SQL);
      await newer.$executeRawUnsafe(`PRAGMA user_version = ${SCHEMA_VERSION + 1};`);
      await newer.$disconnect();

      const reopened = await openDatabase(path.join(newerDir, 'conversations.db'));
      const expected = interpolate(TEXT.DB_SCHEMA_TOO_NEW, {
        version: SCHEMA_VERSION + 1,
        head: SCHEMA_VERSION,
      });
      await expect(bootDatabase(reopened, SCHEMA_SQL)).rejects.toThrow(expected);
      await reopened.$disconnect();
    } finally {
      await rm(newerDir, { recursive: true, force: true });
    }
  });
});
