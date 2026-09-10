import { BaseCheckpointSaver } from '@langchain/langgraph';
import type { Checkpoint, CheckpointMetadata, CheckpointPendingWrite, CheckpointTuple } from '@langchain/langgraph-checkpoint';
import type { PendingWrite } from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { PrismaClient } from 'generated/client';

const DEFAULT_PRUNE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CheckpointerClientProvider {
  (): PrismaClient | null;
}

/**
 * LangGraph checkpointer backed by the app's own SQLite database
 * (ai-features §4: the file IS the app — no extra storage, no native
 * module). Enables resume-after-approval and turn recovery across app
 * restarts; checkpoints are pruned on boot and by age.
 */
export class PrismaCheckpointSaver extends BaseCheckpointSaver {
  private readonly getClient: CheckpointerClientProvider;

  private setupPromise: Promise<void> | null = null;

  constructor(getClient: CheckpointerClientProvider) {
    super();
    this.getClient = getClient;
  }

  private client(): PrismaClient {
    const client = this.getClient();
    if (!client) {
      throw new Error('Checkpointer is not available: database is not initialized.');
    }
    return client;
  }

  /** Idempotent table bootstrap — safe to call on every boot and lazily. */
  async setup(): Promise<void> {
    if (!this.setupPromise) {
      this.setupPromise = (async () => {
        await this.client().$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Checkpoint" (
          "threadId" TEXT NOT NULL,
          "checkpointNs" TEXT NOT NULL DEFAULT '',
          "checkpointId" TEXT NOT NULL,
          "parentCheckpointId" TEXT,
          "type" TEXT,
          "checkpoint" BLOB NOT NULL,
          "metadata" BLOB,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("threadId", "checkpointNs", "checkpointId")
        );`);
        await this.client().$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CheckpointWrite" (
          "threadId" TEXT NOT NULL,
          "checkpointNs" TEXT NOT NULL DEFAULT '',
          "checkpointId" TEXT NOT NULL,
          "taskId" TEXT NOT NULL,
          "taskPath" TEXT NOT NULL DEFAULT '',
          "idx" INTEGER NOT NULL,
          "channel" TEXT NOT NULL,
          "type" TEXT,
          "blob" BLOB,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("threadId", "checkpointNs", "checkpointId", "taskId", "idx")
        );`);
      })().catch((error) => {
        this.setupPromise = null;
        throw error;
      });
    }
    return this.setupPromise;
  }

  /** Scheduled pruning (ai-features §4): drop checkpoints older than the age cap. */
  async prune(maxAgeMs: number = DEFAULT_PRUNE_MAX_AGE_MS): Promise<void> {
    await this.setup();
    const cutoff = new Date(Date.now() - maxAgeMs);
    const client = this.client();
    await client.$executeRawUnsafe(`DELETE FROM "CheckpointWrite" WHERE "createdAt" < ?`, cutoff);
    await client.$executeRawUnsafe(`DELETE FROM "Checkpoint" WHERE "createdAt" < ?`, cutoff);
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.setup();
    const client = this.client();
    await client.$executeRawUnsafe(`DELETE FROM "CheckpointWrite" WHERE "threadId" = ?`, threadId);
    await client.$executeRawUnsafe(`DELETE FROM "Checkpoint" WHERE "threadId" = ?`, threadId);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    await this.setup();
    const { thread_id: threadId, checkpoint_ns: checkpointNs = '', checkpoint_id: checkpointId } =
      config.configurable ?? {};
    if (!threadId) {
      return undefined;
    }
    const client = this.client();
    const row = checkpointId
      ? await client.$queryRawUnsafe<
          { checkpointId: string; parentCheckpointId: string | null; type: string; checkpoint: Buffer; metadata: Buffer | null }[]
        >(
          `SELECT "checkpointId", "parentCheckpointId", "type", "checkpoint", "metadata"
           FROM "Checkpoint" WHERE "threadId" = ? AND "checkpointNs" = ? AND "checkpointId" = ?`,
          threadId,
          checkpointNs,
          checkpointId
        )
      : await client.$queryRawUnsafe<
          { checkpointId: string; parentCheckpointId: string | null; type: string; checkpoint: Buffer; metadata: Buffer | null }[]
        >(
          `SELECT "checkpointId", "parentCheckpointId", "type", "checkpoint", "metadata"
           FROM "Checkpoint" WHERE "threadId" = ? AND "checkpointNs" = ? ORDER BY "checkpointId" DESC LIMIT 1`,
          threadId,
          checkpointNs
        );
    if (row.length === 0) {
      return undefined;
    }
    const found = row[0];
    const checkpoint = (await this.serde.loadsTyped(found.type ?? 'json', new Uint8Array(found.checkpoint))) as Checkpoint;
    const metadata = found.metadata
      ? ((await this.serde.loadsTyped('json', new Uint8Array(found.metadata))) as CheckpointMetadata)
      : undefined;
    const writeRows = await client.$queryRawUnsafe<
      { taskId: string; channel: string; type: string | null; blob: Buffer | null }[]
    >(
      `SELECT "taskId", "channel", "type", "blob" FROM "CheckpointWrite"
       WHERE "threadId" = ? AND "checkpointNs" = ? AND "checkpointId" = ? ORDER BY "taskPath", "idx"`,
      threadId,
      checkpointNs,
      found.checkpointId
    );
    const pendingWrites: CheckpointPendingWrite[] = [];
    for (const write of writeRows) {
      if (write.type === null || write.blob === null) {
        continue;
      }
      pendingWrites.push([
        write.taskId,
        write.channel,
        await this.serde.loadsTyped(write.type, new Uint8Array(write.blob)),
      ]);
    }
    const tupleConfig: RunnableConfig = {
      configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: found.checkpointId },
    };
    return {
      config: tupleConfig,
      checkpoint,
      metadata,
      parentConfig: found.parentCheckpointId
        ? {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
              checkpoint_id: found.parentCheckpointId,
            },
          }
        : undefined,
      pendingWrites: pendingWrites.length ? pendingWrites : undefined,
    };
  }

  async *list(config: RunnableConfig): AsyncGenerator<CheckpointTuple> {
    await this.setup();
    const { thread_id: threadId, checkpoint_ns: checkpointNs = '' } = config.configurable ?? {};
    if (!threadId) {
      return;
    }
    const rows = await this.client().$queryRawUnsafe<{ checkpointId: string }[]>(
      `SELECT "checkpointId" FROM "Checkpoint" WHERE "threadId" = ? AND "checkpointNs" = ? ORDER BY "checkpointId" DESC`,
      threadId,
      checkpointNs
    );
    for (const row of rows) {
      const tuple = await this.getTuple({
        configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: row.checkpointId },
      });
      if (tuple) {
        yield tuple;
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: Record<string, number | string>
  ): Promise<RunnableConfig> {
    await this.setup();
    const { thread_id: threadId, checkpoint_ns: checkpointNs = '' } = config.configurable ?? {};
    if (!threadId) {
      throw new Error('Cannot store a checkpoint without a thread_id.');
    }
    const [type, bytes] = await this.serde.dumpsTyped(checkpoint);
    const [, metadataBytes] = await this.serde.dumpsTyped(metadata);
    const parentCheckpointId = config.configurable?.checkpoint_id as string | undefined;
    await this.client().$executeRawUnsafe(
      `INSERT OR REPLACE INTO "Checkpoint"
        ("threadId", "checkpointNs", "checkpointId", "parentCheckpointId", "type", "checkpoint", "metadata", "createdAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      threadId,
      checkpointNs,
      checkpoint.id,
      parentCheckpointId ?? null,
      type,
      Buffer.from(bytes),
      Buffer.from(metadataBytes),
      new Date()
    );
    return {
      configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: checkpoint.id },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    await this.setup();
    const { thread_id: threadId, checkpoint_ns: checkpointNs = '', checkpoint_id: checkpointId } =
      config.configurable ?? {};
    if (!threadId || !checkpointId) {
      throw new Error('Cannot store writes without a thread_id and checkpoint_id.');
    }
    const client = this.client();
    let idx = 0;
    for (const [channel, value] of writes) {
      const [type, bytes] = await this.serde.dumpsTyped(value);
      await client.$executeRawUnsafe(
        `INSERT OR REPLACE INTO "CheckpointWrite"
          ("threadId", "checkpointNs", "checkpointId", "taskId", "taskPath", "idx", "channel", "type", "blob", "createdAt")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        threadId,
        checkpointNs,
        checkpointId,
        taskId,
        '',
        idx,
        channel,
        type,
        Buffer.from(bytes),
        new Date()
      );
      idx += 1;
    }
  }
}
