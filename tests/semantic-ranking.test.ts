import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@shared/config/AppConfig';
import { LLMProviderType } from '@shared/types';
import { createSemanticRanking } from '@main/ai/semantic-ranking';
import type { EmbeddingRow, EmbeddingStore } from '@main/ai/embeddings';
import type { SelectionApp } from '@main/ai/tools/app-selection';

function memoryStore(): EmbeddingStore & { rows: Map<string, EmbeddingRow> } {
  const rows = new Map<string, EmbeddingRow>();
  return {
    rows,
    find: async (kind, refId, model) => rows.get(`${kind}:${refId}:${model}`) ?? null,
    upsert: async (row) => {
      rows.set(`${row.kind}:${row.refId}:${row.model}`, row);
    },
    deleteWhereModelNot: async (model) => {
      let removed = 0;
      for (const [key, row] of rows) {
        if (row.model !== model) {
          rows.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

function configWith(embedModelId: string | null): AppConfig {
  return {
    providers: [
      {
        id: 'p1',
        name: 'OpenAI',
        type: LLMProviderType.OPENAI,
        apiKey: '',
        apiBase: 'https://api.openai.com/v1',
        timeout: 5000,
        temperature: 0.7,
        maxTokens: 128,
        systemPrompt: '',
        availableModels: [{ id: 'embed-1' }],
        customModels: [],
      },
    ],
    taskAssignments: embedModelId ? { embed: embedModelId } : {},
  } as unknown as AppConfig;
}

const app: SelectionApp = {
  id: 'app-1',
  name: 'Alpha',
  description: 'Echo app',
  exposure: 'relevance',
  order: 0,
  tools: [{ name: 'echo_text', description: 'Echo', enabled: true, keywordTags: ['echo'] }],
};

describe('createSemanticRanking (plan 41 S3)', () => {
  it('resolves the embed task, audits through the gateway, and caches profiles by content hash', async () => {
    const requests: Record<string, unknown>[] = [];
    const ranking = createSemanticRanking({
      gateway: {
        embed: async (request) => {
          requests.push(request as unknown as Record<string, unknown>);
          return [[0.1, 0.2]];
        },
      },
      getConfig: () => configWith('embed-1'),
      resolveKey: async () => 'sk-key',
      store: memoryStore(),
    });
    expect(await ranking.queryVector('hello')).toEqual([0.1, 0.2]);
    const profile = await ranking.profileVector(app);
    expect(profile?.[0]).toBeCloseTo(0.1);
    expect(await ranking.profileVector(app)).toHaveLength(2);
    expect(requests[0]).toMatchObject({ modelId: 'embed-1', apiKey: 'sk-key', task: 'embed' });
  });

  it('degrades to null everywhere when the embed task is unassigned', async () => {
    let gatewayCalls = 0;
    const ranking = createSemanticRanking({
      gateway: {
        embed: async () => {
          gatewayCalls += 1;
          return [[1, 0]];
        },
      },
      getConfig: () => configWith(null),
      resolveKey: async () => 'sk-key',
      store: memoryStore(),
    });
    expect(await ranking.queryVector('hello')).toBeNull();
    expect(await ranking.profileVector(app)).toBeNull();
    expect(await ranking.pruneOnModelChange()).toBe(0);
    expect(gatewayCalls).toBe(0);
  });
});
