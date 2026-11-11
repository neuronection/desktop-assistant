import { describe, expect, it } from 'vitest';
import type { PrismaClient } from 'generated/prisma/client';
import { getUsageReport } from '@main/services/UsageService';

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
    costMicros: 2_000_000,
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
  it('sums recorded call-time micros and separates today from the month', async () => {
    const report = await getUsageReport(
      clientWith([
        row({ id: 'a', costMicros: 6_000_000 }),
        row({ id: 'b', createdAt: month, model: 'other-model', costMicros: null }),
      ]),
      now
    );
    expect(report.today).toMatchObject({ calls: 1, inputTokens: 1_000_000, outputTokens: 0, costMicros: 6_000_000, unpricedCalls: 0 });
    expect(report.month.calls).toBe(2);
    expect(report.month.costMicros).toBe(6_000_000);
    expect(report.month.unpricedCalls).toBe(1);
    expect(report.byModel.map((entry) => entry.model).sort()).toEqual(['other-model', 'priced-model']);
    expect(report.recent).toHaveLength(2);
  });

  it('keeps a partial-token call unpriced', async () => {
    const report = await getUsageReport(
      clientWith([row({ id: 'partial', inputTokens: null, outputTokens: 200, costMicros: null })]),
      now
    );
    expect(report.today).toMatchObject({ calls: 1, inputTokens: 0, outputTokens: 200, costMicros: null, unpricedCalls: 1, partialTokenCalls: 1 });
  });

  it('keeps a recorded local zero', async () => {
    const report = await getUsageReport(
      clientWith([row({ id: 'local', providerId: 'ollama', inputTokens: 500, outputTokens: 100, costMicros: 0 })]),
      now
    );
    expect(report.today).toMatchObject({ costMicros: 0, unpricedCalls: 0 });
  });

  it('returns zeros without a client', async () => {
    const report = await getUsageReport(null, now);
    expect(report.today.calls).toBe(0);
    expect(report.month.costMicros).toBe(0);
  });
});
