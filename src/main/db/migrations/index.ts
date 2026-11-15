import type { PrismaClient } from 'generated/prisma/client';
import { migration001 } from './001-baseline-lift';
import { migration002 } from './002-connector-audit';
import { migration003 } from './003-file-snapshots';
import { migration004 } from './004-ai-call-cost';
import { migration005 } from './005-ai-call-turn';
import { migration006 } from './006-clipboard';
import { migration007 } from './007-message-chain';

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
 *   v2 → v3: FileSnapshot
 *   v3 → v4: AiCall cost provenance (costMicros, usageSource, price fields)
 *   v4 → v5: AiCall turn context (conversationId, messageId)
 *   v5 → v6: ClipboardEntry (encrypted history)
 *   v6 → v7: pre-branching message chains (data only — no schema change)
 *   v0 (v0.9.0, no head) → v7: the v0.9→v0.10 additive delta, then the ladder
 *
 * The v0.9 lift is additive (tables, nullable/defaulted columns, indexes)
 * and idempotent, so a partially applied lift can be retried. A database
 * above the head is still refused.
 */
export const SCHEMA_VERSION = 7;

export const MIGRATIONS: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
];
