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
const V090_SQL = await readFile(path.resolve(__dirname, 'fixtures/schema-v0.9.0.sql'), 'utf8');

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

  it('lifts a v0.9.0 profile (no head) to the schema head and keeps its data', async () => {
    const legacyDir = await mkdtemp(path.join(tmpdir(), 'db-v090-lift-'));
    dir = legacyDir;
    try {
      const legacy = await openDatabase(path.join(legacyDir, 'conversations.db'));
      await executeScript(legacy, V090_SQL);
      await legacy.$executeRawUnsafe(
        `INSERT INTO "Conversation" ("id","title","updatedAt") VALUES ('conv-legacy','Before the head',CURRENT_TIMESTAMP);`
      );
      await legacy.$executeRawUnsafe(
        `INSERT INTO "Message" ("id","content","role","conversationId") VALUES ('msg-legacy','Kept across the lift','user','conv-legacy');`
      );
      await legacy.$disconnect();

      const reopened = await openDatabase(path.join(legacyDir, 'conversations.db'));
      expect(await bootDatabase(reopened, SCHEMA_SQL)).toBe('upgraded');
      expect(await readUserVersion(reopened)).toBe(SCHEMA_VERSION);
      expect(await reopened.conversation.count()).toBe(1);
      expect(await reopened.message.count()).toBe(1);
      expect(await reopened.conversation.findUnique({ where: { id: 'conv-legacy' } })).toMatchObject({
        title: 'Before the head',
        activeRootId: null,
      });
      expect(await reopened.message.findUnique({ where: { id: 'msg-legacy' } })).toMatchObject({
        content: 'Kept across the lift',
        parentId: null,
        activeChildId: null,
      });

      const tables = await reopened.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`
      );
      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          'MiniAppRun',
          'MiniAppRunItem',
          'MiniAppWindow',
          'MiniAppSandboxRun',
          'Embedding',
          'Notification',
          'AppInstanceStatus',
          'Automation',
          'ConnectorAccount',
          'ConnectorAudit',
        ])
      );
      const runColumns = await reopened.$queryRawUnsafe<Array<{ name: string }>>(
        'PRAGMA table_info("MiniAppRun");'
      );
      expect(runColumns.map((column) => column.name)).toContain('execution');
      const scheduleColumns = await reopened.$queryRawUnsafe<Array<{ name: string }>>(
        'PRAGMA table_info("Schedule");'
      );
      expect(scheduleColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(['kind', 'packId', 'rootPath'])
      );
      await reopened.$disconnect();
    } finally {
      await rm(legacyDir, { recursive: true, force: true });
    }
  });

  it('lifts an unstamped pre-plan-36 profile instead of refusing it', async () => {
    const oldDir = await mkdtemp(path.join(tmpdir(), 'db-old-lift-'));
    dir = oldDir;
    try {
      const old = await openDatabase(path.join(oldDir, 'conversations.db'));
      await executeScript(old, BEFORE_PLAN36_SQL);
      await old.$disconnect();

      const reopened = await openDatabase(path.join(oldDir, 'conversations.db'));
      expect(await bootDatabase(reopened, SCHEMA_SQL)).toBe('upgraded');
      expect(await readUserVersion(reopened)).toBe(SCHEMA_VERSION);
      const conversationColumns = await reopened.$queryRawUnsafe<Array<{ name: string }>>(
        'PRAGMA table_info("Conversation");'
      );
      expect(conversationColumns.map((column) => column.name)).toContain('activeRootId');
      await reopened.$disconnect();
    } finally {
      await rm(oldDir, { recursive: true, force: true });
    }
  });

  it('upgrades a previous-version (v1) database and keeps its data', async () => {
    const oldDir = await mkdtemp(path.join(tmpdir(), 'db-v1-upgrade-'));
    dir = oldDir;
    try {
      const db = await openDatabase(path.join(oldDir, 'conversations.db'));
      await bootDatabase(db, SCHEMA_SQL);
      await db.$executeRawUnsafe(
        `INSERT INTO "Conversation" ("id","title","updatedAt") VALUES ('conv-v1','On the previous head',CURRENT_TIMESTAMP);`
      );
      await db.$executeRawUnsafe(`ALTER TABLE "MiniAppRun" DROP COLUMN "execution";`);
      await db.$executeRawUnsafe(`DROP TABLE "ConnectorAudit";`);
      await db.$executeRawUnsafe(`PRAGMA user_version = ${SCHEMA_VERSION - 1};`);
      await db.$disconnect();

      const reopened = await openDatabase(path.join(oldDir, 'conversations.db'));
      expect(await bootDatabase(reopened, SCHEMA_SQL)).toBe('upgraded');
      expect(await readUserVersion(reopened)).toBe(SCHEMA_VERSION);
      expect(await reopened.conversation.count()).toBe(1);
      const runColumns = await reopened.$queryRawUnsafe<Array<{ name: string }>>(
        'PRAGMA table_info("MiniAppRun");'
      );
      expect(runColumns.map((column) => column.name)).toContain('execution');
      const tables = await reopened.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`
      );
      expect(tables.map((table) => table.name)).toContain('ConnectorAudit');
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

describe('DatabaseService service wrapper (plan 46 S2)', () => {
  let dir: string | null = null;

  afterEach(async () => {
    delete process.env.DESKTOP_ASSISTANT_DATA_DIR;
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it('initialize opens the client once; a second call is a no-op', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'db-service-'));
    process.env.DESKTOP_ASSISTANT_DATA_DIR = dir;
    const { DatabaseService: FreshDatabaseService } = await import('@main/services/DatabaseService');
    const database = new FreshDatabaseService();
    const initLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await database.initialize();
    expect(database.isReady()).toBe(true);
    const client = database.getClient();
    await database.initialize();
    expect(database.getClient()).toBe(client);
    expect(initLog).toHaveBeenCalledTimes(1);
    initLog.mockRestore();
  });

  it('getClient refuses before initialize and cleanup resets readiness', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'db-service-'));
    process.env.DESKTOP_ASSISTANT_DATA_DIR = dir;
    const { DatabaseService: FreshDatabaseService } = await import('@main/services/DatabaseService');
    const database = new FreshDatabaseService();
    expect(() => database.getClient()).toThrow('Database not initialized');
    await database.initialize();
    await database.cleanup();
    expect(database.isReady()).toBe(false);
    expect(() => database.getClient()).toThrow('Database not initialized');
  });

  it('the booted client serves writes through the wrapper (retention-adjacent smoke)', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'db-service-'));
    process.env.DESKTOP_ASSISTANT_DATA_DIR = dir;
    const { DatabaseService: FreshDatabaseService } = await import('@main/services/DatabaseService');
    const database = new FreshDatabaseService();
    await database.initialize();
    const client = database.getClient();
    const conversation = await client.conversation.create({
      data: { title: 'wrapper smoke', createdAt: new Date(), updatedAt: new Date() },
    });
    expect(conversation.id).toBeTruthy();
    const count = await client.conversation.count();
    expect(count).toBe(1);
  });
});
