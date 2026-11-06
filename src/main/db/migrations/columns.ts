import type { PrismaClient } from 'generated/prisma/client';

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

export async function addColumnIfMissing(
  prisma: PrismaClient,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  if (!IDENTIFIER.test(table) || !IDENTIFIER.test(column)) {
    throw new Error(`Unsafe schema identifier: ${table}.${column}`);
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}");`);
  if (rows.some((row) => row.name === column)) {
    return;
  }
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition};`);
}
