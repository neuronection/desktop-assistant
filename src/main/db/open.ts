import { PrismaClient } from 'generated/prisma/client';
import type { Prisma } from 'generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

export async function openDatabase(databasePath: string, log?: Prisma.LogLevel[]): Promise<PrismaClient> {
  const adapter = new PrismaLibSql({ url: `file:${databasePath}` });
  const prisma = new PrismaClient({ adapter, ...(log ? { log } : {}) });
  await prisma.$connect();
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;');
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys=ON;');
  await prisma.$executeRawUnsafe('PRAGMA busy_timeout=5000;');
  return prisma;
}
