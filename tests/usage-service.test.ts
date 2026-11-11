import { describe, expect, it } from 'vitest';
import type { PrismaClient } from 'generated/prisma/client';
import { getUsageReport } from '@main/services/UsageService';
import type { ModelPricing } from '@shared/usage';

const pricing: ModelPricing[] = [{ model: 'priced-model', inputPerMillion: 2, outputPerMillion: 8 }];
const now = new Date('2026-11-11T12:00:00');
const today = new Date('2026-11-11T09:00:00');
const month = new Date('2026-11-02T09:00:00');

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'c1',
    task: 'chat',
    providerId: 'p1',
    model: 'priced-model',
    resolvedModel: null,
    inputTokens: 1_000_000,
    outputTokens: 0,
    outcome: 'ok',
    createdAt: today,
    ...overrides,
  };
}

function clientWith(rows: Record<string, unknown>[]): PrismaClient {
  return {
    aiCall: { findMany: async () => rows },
  } as unknown as PrismaClient;
}

describe('getUsageReport', () => {
  it('separates today from the month and prices known models', async () => {
    const report = await getUsageReport(
      clientWith([
        row({ id: 'a', inputTokens: 1_000_000, outputTokens: 500_000 }),
        row({ id: 'b', createdAt: month, model: 'other-model', inputTokens: 10, outputTokens: 5 }),
      ]),
      pricing,
      new Set(),
      now
    );
    expect(report.today).toMatchObject({ calls: 1, inputTokens: 1_000_000, outputTokens: 500_000, costUsd: 6, unpricedCalls: 0 });
    expect(report.month.calls).toBe(2);
    expect(report.month.unpricedCalls).toBe(1);
    expect(report.byModel.map((row) => row.model).sort()).toEqual(['other-model', 'priced-model']);
    expect(report.recent).toHaveLength(2);
  });

  it('leaves a partial-token call unpriced', async () => {
    const report = await getUsageReport(
      clientWith([row({ id: 'partial', inputTokens: null, outputTokens: 200 })]),
      pricing,
      new Set(),
      now
    );
    expect(report.today).toMatchObject({ calls: 1, inputTokens: 0, outputTokens: 200, costUsd: null, unpricedCalls: 1, partialTokenCalls: 1 });
  });

  it('prices a loopback provider at zero without a price row', async () => {
    const report = await getUsageReport(
      clientWith([row({ id: 'local', providerId: 'ollama', inputTokens: 500, outputTokens: 100 })]),
      [],
      new Set(['ollama']),
      now
    );
    expect(report.today).toMatchObject({ costUsd: 0, unpricedCalls: 0 });
  });

  it('returns zeros without a client', async () => {
    const report = await getUsageReport(null, pricing, new Set(), now);
    expect(report.today.calls).toBe(0);
    expect(report.month.costUsd).toBe(0);
  });
});
