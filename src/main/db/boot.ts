import type { PrismaClient } from 'generated/prisma/client';
import { TEXT, interpolate } from '@shared/constants/text';
import { MIGRATIONS, SCHEMA_VERSION } from './migrations';
import { splitStatements } from './sql';

export type BootPath = 'fresh' | 'upgraded';

export async function readUserVersion(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ user_version: number | bigint }>>('PRAGMA user_version;');
  return Number(rows[0]?.user_version ?? 0);
}

async function runStatements(
  prisma: PrismaClient,
  statements: readonly string[],
  version: number
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const statement of statements) {
      await tx.$executeRawUnsafe(statement);
    }
    await tx.$executeRawUnsafe(`PRAGMA user_version = ${version};`);
  });
}

export async function bootDatabase(prisma: PrismaClient, schemaSql: string): Promise<BootPath> {
  const existing = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='Conversation';`
  );
  if (existing.length === 0) {
    await runStatements(prisma, splitStatements(schemaSql), SCHEMA_VERSION);
    return 'fresh';
  }

  const current = await readUserVersion(prisma);
  if (current > SCHEMA_VERSION) {
    throw new Error(interpolate(TEXT.DB_SCHEMA_TOO_NEW, { version: current, head: SCHEMA_VERSION }));
  }
  if (current < SCHEMA_VERSION) {
    throw new Error(interpolate(TEXT.DB_SCHEMA_UNSUPPORTED, { version: current, head: SCHEMA_VERSION }));
  }
  const pending = MIGRATIONS.filter((migration) => migration.version > current).sort(
    (a, b) => a.version - b.version
  );
  let at = current;
  for (const migration of pending) {
    if (migration.version !== at + 1) {
      throw new Error(`Migration ladder gap: expected ${at + 1}, found ${migration.version}.`);
    }
    await runStatements(prisma, migration.statements, migration.version);
    at = migration.version;
  }
  if (at !== SCHEMA_VERSION) {
    throw new Error(`Database schema stopped at version ${at}, expected ${SCHEMA_VERSION}.`);
  }
  return 'upgraded';
}
