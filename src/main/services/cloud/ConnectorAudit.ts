import type { PrismaClient } from 'generated/prisma/client';
import type { ConnectorErrorCode } from './ConnectorStore';

// External-mutation audit law (ADR-0052 §8): every state-changing calendar
// call writes ONE row — the action, its outcome as a typed code, a duration
// and a count. NEVER the event title, attendees, provider text or any token
// material; the row is safe to export by construction.

export type ConnectorMutationAction = 'create' | 'move';

export interface ConnectorMutationRecord {
  accountId: string;
  action: ConnectorMutationAction;
  /** `ok` or the typed ConnectorErrorCode the failure stopped with. */
  outcome: 'ok' | ConnectorErrorCode;
  durationMs: number;
}

export type ConnectorAuditSink = (record: ConnectorMutationRecord) => Promise<void>;

type ClientProvider = () => PrismaClient | null;

let clientProvider: ClientProvider = () => null;

export function setConnectorAuditClientProvider(provider: ClientProvider): void {
  clientProvider = provider;
}

const dbSink: ConnectorAuditSink = async (record) => {
  const client = clientProvider();
  if (!client) {
    return;
  }
  await client.connectorAudit.create({
    data: {
      accountId: record.accountId,
      action: record.action,
      outcome: record.outcome,
      durationMs: record.durationMs,
    },
  });
};

let sink: ConnectorAuditSink = dbSink;

/** Test seam — the custody tests assert the row, never a real DB. */
export function setConnectorAuditSink(replacement: ConnectorAuditSink): void {
  sink = replacement;
}

export async function recordConnectorMutation(record: ConnectorMutationRecord): Promise<void> {
  try {
    await sink(record);
  } catch (error) {
    // The audit write never breaks the action and never logs secret material —
    // the message carries only the typed code.
    console.warn(`[calendar] audit write failed (${record.action} → ${record.outcome}).`);
    void error;
  }
}
