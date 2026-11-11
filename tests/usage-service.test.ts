import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from 'generated/prisma/client';
import { checkBudget, getSpendMicros, getTurnReceipt, getUsageReport } from '@main/services/UsageService';

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

describe('turn receipt', () => {
  it('reconciles model and tool rows by message id', async () => {
    const client = {
      aiCall: {
        findMany: async () => [
          { model: 'm', resolvedModel: null, providerId: 'p1', inputTokens: 100, outputTokens: 20, costMicros: 12 },
          { model: 'm', resolvedModel: null, providerId: 'p1', inputTokens: 0, outputTokens: 5, costMicros: null },
        ],
      },
      toolCall: {
        findMany: async () => [{ tool: 'file_write', outcome: 'ok', approvedBy: 'once', durationMs: 3 }],
      },
    } as unknown as PrismaClient;
    const receipt = await getTurnReceipt(client, 'msg-1', []);
    expect(receipt).toMatchObject({
      calls: 2,
      inputTokens: 100,
      outputTokens: 25,
      costMicros: 12,
      unpricedCalls: 1,
      tools: [{ tool: 'file_write', outcome: 'ok', approvedBy: 'once' }],
    });
  });

  it('returns a null cost when every call is unpriced', async () => {
    const client = {
      aiCall: { findMany: async () => [{ model: 'm', resolvedModel: null, providerId: null, inputTokens: 1, outputTokens: 1, costMicros: null }] },
      toolCall: { findMany: async () => [] },
    } as unknown as PrismaClient;
    const receipt = await getTurnReceipt(client, 'msg-2', []);
    expect(receipt.costMicros).toBeNull();
    expect(receipt.unpricedCalls).toBe(1);
  });
});

describe('budgets', () => {
  it('sums the day and month and blocks at the cap', async () => {
    const aggregate = vi
      .fn()
      .mockResolvedValueOnce({ _sum: { costMicros: 120 } })
      .mockResolvedValueOnce({ _sum: { costMicros: 900 } });
    const client = { aiCall: { aggregate } } as unknown as PrismaClient;
    await expect(getSpendMicros(client, now)).resolves.toEqual({ dailyMicros: 120, monthlyMicros: 900 });
    aggregate.mockResolvedValue({ _sum: { costMicros: 120 } });
    await expect(checkBudget(client, { dailyMicros: 120, monthlyMicros: null }, now)).resolves.toEqual({
      ok: false,
      reason: 'daily',
    });
    await expect(checkBudget(client, { dailyMicros: null, monthlyMicros: null }, now)).resolves.toEqual({ ok: true });
  });
});

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
