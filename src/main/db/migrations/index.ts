import type { PrismaClient } from 'generated/prisma/client';
import { migration001 } from './001-baseline-lift';
import { migration002 } from './002-connector-audit';

export interface Migration {
  version: number;
  name: string;
  notes?: Readonly<Record<string, string>>;
  statements?: readonly string[];
  run?: (prisma: PrismaClient) => Promise<void>;
}

/**
 * Schema policy (owner decision 2026-11-06): the head is the only shape a
 * fresh profile is created with, and existing profiles are lifted to it by
 * the migration ladder — never refused while a contiguous ladder exists.
 *
 *   v1 (v0.10.0) → v2: MiniAppRun.execution + ConnectorAudit
 *   v0 (v0.9.0, no head) → v2: the v0.9→v0.10 additive delta, then v1→v2
 *
 * The v0.9 lift is additive (tables, nullable/defaulted columns, indexes)
 * and idempotent, so a partially applied lift can be retried. A database
 * above the head is still refused.
 */
export const SCHEMA_VERSION = 2;

export const MIGRATIONS: readonly Migration[] = [migration001, migration002];
