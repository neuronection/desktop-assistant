import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from 'generated/prisma/client';
import { bootDatabase, openDatabase } from '@main/db';

const SCHEMA_SQL = await readFile(join(process.cwd(), 'src/main/resources/schema.sql'), 'utf8');

interface ParsedSchema {
  tables: Map<string, Map<string, string>>;
  indexes: Map<string, { table: string; columns: string[]; unique: boolean }>;
}

function parseSchema(sql: string): ParsedSchema {
  const tables = new Map<string, Map<string, string>>();
  for (const match of sql.matchAll(/CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g)) {
    const columns = new Map<string, string>();
    for (const line of match[2].split('\n')) {
      const column = line.match(/^\s*"([^"]+)"\s+([A-Z]+)/);
      if (column) {
        columns.set(column[1], column[2]);
      }
    }
    tables.set(match[1], columns);
  }
  const indexes = new Map<string, { table: string; columns: string[]; unique: boolean }>();
  for (const match of sql.matchAll(/CREATE (UNIQUE )?INDEX "([^"]+)" ON "([^"]+)"\(([^)]*)\);/g)) {
    indexes.set(match[2], {
      table: match[3],
      unique: Boolean(match[1]),
      columns: [...match[4].matchAll(/"([^"]+)"/g)].map((column) => column[1]),
    });
  }
  return { tables, indexes };
}

async function runtimeSchema(client: PrismaClient): Promise<ParsedSchema> {
  const tableRows = await client.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`
  );
  const tables = new Map<string, Map<string, string>>();
  const indexes = new Map<string, { table: string; columns: string[]; unique: boolean }>();
  for (const { name } of tableRows) {
    const columns = await client.$queryRawUnsafe<Array<{ name: string; type: string }>>(`PRAGMA table_info("${name}");`);
    tables.set(name, new Map(columns.map((column) => [column.name, column.type])));
    const listed = await client.$queryRawUnsafe<Array<{ name: string; unique: number; origin: string }>>(
      `PRAGMA index_list("${name}");`
    );
    for (const index of listed) {
      if (index.origin !== 'c') {
        continue;
      }
      const info = await client.$queryRawUnsafe<Array<{ seqno: number; name: string }>>(`PRAGMA index_info("${index.name}");`);
      indexes.set(index.name, {
        table: name,
        unique: index.unique === 1,
        columns: info.sort((a, b) => a.seqno - b.seqno).map((column) => column.name),
      });
    }
  }
  return { tables, indexes };
}

describe('schema drift wall (plan 36 S4)', () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it('runtime PRAGMA introspection matches the generated schema.sql exactly', async () => {
    dir = await mkdtemp(join(tmpdir(), 'db-drift-'));
    const client = await openDatabase(join(dir, 'conversations.db'));
    try {
      await bootDatabase(client, SCHEMA_SQL);
      const expected = parseSchema(SCHEMA_SQL);
      const actual = await runtimeSchema(client);

      expect([...actual.tables.keys()].sort()).toEqual([...expected.tables.keys()].sort());
      for (const [table, columns] of expected.tables) {
        expect([...actual.tables.get(table)?.entries()].sort(), table).toEqual([...columns.entries()].sort());
      }

      expect([...actual.indexes.keys()].sort()).toEqual([...expected.indexes.keys()].sort());
      for (const [name, index] of expected.indexes) {
        expect(actual.indexes.get(name), name).toEqual(index);
      }
    } finally {
      await client.$disconnect();
    }
  });

  it('refuses a schema whose generated DDL drifted from schema.sql', async () => {
    dir = await mkdtemp(join(tmpdir(), 'db-drift-red-'));
    const client = await openDatabase(join(dir, 'conversations.db'));
    try {
      await bootDatabase(client, SCHEMA_SQL);
      const mutated = `${SCHEMA_SQL}\nCREATE TABLE "DriftProbe" (\n    "id" TEXT NOT NULL PRIMARY KEY\n);\n`;
      const expected = parseSchema(mutated);
      const actual = await runtimeSchema(client);
      expect([...actual.tables.keys()].sort()).not.toEqual([...expected.tables.keys()].sort());
    } finally {
      await client.$disconnect();
    }
  });
});
