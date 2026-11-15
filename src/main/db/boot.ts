import type { PrismaClient } from 'generated/prisma/client';
import { copyFileSync, existsSync } from 'fs';
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

async function setUserVersion(prisma: PrismaClient, version: number): Promise<void> {
  await prisma.$executeRawUnsafe(`PRAGMA user_version = ${version};`);
}

/**
 * A lift mutates the user's only database. Keep the pre-lift bytes beside it
 * (`conversations.db.v<n>.bak`) so a failed or wrong lift is recoverable:
 * a disk-full or interrupted ladder otherwise strands the profile.
 */
async function backupBeforeLift(
  prisma: PrismaClient,
  databasePath: string,
  fromVersion: number
): Promise<void> {
  const target = `${databasePath}.v${fromVersion}.bak`;
  if (existsSync(target)) {
    return;
  }
  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);');
  copyFileSync(databasePath, target);
  console.log(`Database backup written before lift: ${target}`);
}

export async function bootDatabase(
  prisma: PrismaClient,
  schemaSql: string,
  databasePath?: string
): Promise<BootPath> {
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

  const pending = MIGRATIONS.filter((migration) => migration.version > current).sort(
    (a, b) => a.version - b.version
  );
  const expected = Array.from({ length: SCHEMA_VERSION - current }, (_, index) => current + index + 1);
  const covered =
    pending.length === expected.length &&
    pending.every((migration, index) => migration.version === expected[index]);

  // Back up before ANY write to the profile — including the gap path below,
  // whose message promises the copy.
  if (current < SCHEMA_VERSION && databasePath) {
    await backupBeforeLift(prisma, databasePath, current);
  }

  if (!covered) {
    throw new Error(interpolate(TEXT.DB_SCHEMA_UNSUPPORTED, { version: current, head: SCHEMA_VERSION }));
  }

  for (const migration of pending) {
    if (migration.run) {
      await migration.run(prisma);
      await setUserVersion(prisma, migration.version);
    } else if (migration.statements) {
      await runStatements(prisma, migration.statements, migration.version);
    } else {
      throw new Error(`Migration ${migration.version} (${migration.name}) has no statements or run step.`);
    }
  }

  return 'upgraded';
}
