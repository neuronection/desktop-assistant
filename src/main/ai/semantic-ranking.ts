import { createHash } from 'node:crypto';
import type { PrismaClient } from 'generated/prisma/client';
import { resolveTaskModel } from '@shared/ai/tasks';
import type { AppConfig } from '@shared/config/AppConfig';
import { AiTask, type LLMProvider } from '@shared/types';
import { EmbeddingService, type EmbeddingStore } from './embeddings';
import type { SelectionApp } from './tools/app-selection';

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * `Embedding`-table adapter (plan 36 substrate). Prisma `Bytes` is a
 * `Uint8Array`; packed floats are the source of truth on every dialect.
 */
export function createEmbeddingStore(client: PrismaClient): EmbeddingStore {
  return {
    async find(kind, refId, model) {
      const row = await client.embedding.findUnique({
        where: { kind_refId_model: { kind, refId, model } },
      });
      if (!row) {
        return null;
      }
      return {
        kind: row.kind,
        refId: row.refId,
        model: row.model,
        dims: row.dims,
        contentHash: row.contentHash,
        vector: row.vector,
      };
    },
    async upsert(row) {
      await client.embedding.upsert({
        where: { kind_refId_model: { kind: row.kind, refId: row.refId, model: row.model } },
        create: {
          kind: row.kind,
          refId: row.refId,
          model: row.model,
          dims: row.dims,
          contentHash: row.contentHash,
          vector: row.vector,
        },
        update: { dims: row.dims, contentHash: row.contentHash, vector: row.vector },
      });
    },
    async deleteWhereModelNot(model) {
      const result = await client.embedding.deleteMany({ where: { model: { not: model } } });
      return result.count;
    },
  };
}

export interface SemanticRanking {
  queryVector(text: string): Promise<number[] | null>;
  profileVector(app: SelectionApp): Promise<number[] | null>;
  pruneOnModelChange(): Promise<number>;
}

export interface SemanticRankingGateway {
  embed(request: {
    provider: LLMProvider;
    modelId: string;
    apiKey: string;
    texts: string[];
    task?: string;
  }): Promise<number[][]>;
}

/**
 * Task-assignment-backed semantic ranking (plan 41 S3): resolves the
 * `embed` task each call (no cached resolution — a settings change takes
 * effect on the next turn) and delegates to the audited
 * `AiGateway.embed`. Unassigned = feature off, lexical order untouched.
 */
export function createSemanticRanking(deps: {
  gateway: SemanticRankingGateway;
  getConfig(): AppConfig;
  resolveKey(providerId: string, fallback: string): Promise<string>;
  store: EmbeddingStore;
}): SemanticRanking {
  const service = new EmbeddingService({
    store: deps.store,
    hash: sha256Hex,
    resolveModel: () => {
      const resolution = resolveTaskModel(deps.getConfig(), AiTask.EMBED);
      if (!resolution) {
        return null;
      }
      return {
        modelId: `${resolution.providerId}:${resolution.modelId}`,
        embed: async (texts) => {
          const apiKey = await deps.resolveKey(resolution.providerId, resolution.provider.apiKey ?? '');
          return deps.gateway.embed({
            provider: resolution.provider,
            modelId: resolution.modelId,
            apiKey,
            texts,
            task: AiTask.EMBED,
          });
        },
      };
    },
  });
  return {
    queryVector: (text) => service.queryVector(text),
    profileVector: (app) => service.profileVector(app),
    pruneOnModelChange: () => service.pruneOnModelChange(),
  };
}
