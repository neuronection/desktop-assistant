import type { PrismaClient } from 'generated/prisma/client';
import type { UsageCallRow, UsageModelRow, UsageReport, UsageTotals } from '@shared/usage';

const ZERO: UsageTotals = { calls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, unpricedCalls: 0, partialTokenCalls: 0 };

type CallRow = {
  id: string;
  task: string;
  providerId: string | null;
  model: string;
  resolvedModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number | null;
  outcome: string;
  createdAt: Date;
};

function totals(rows: readonly CallRow[]): UsageTotals {
  if (rows.length === 0) {
    return { ...ZERO };
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let costMicros = 0;
  let priced = 0;
  let partialTokenCalls = 0;
  for (const row of rows) {
    inputTokens += row.inputTokens ?? 0;
    outputTokens += row.outputTokens ?? 0;
    if (row.inputTokens === null || row.outputTokens === null) {
      partialTokenCalls += 1;
    }
    if (row.costMicros === null) {
      continue;
    }
    priced += 1;
    costMicros += row.costMicros;
  }
  return {
    calls: rows.length,
    inputTokens,
    outputTokens,
    costMicros: priced > 0 ? costMicros : null,
    unpricedCalls: rows.length - priced,
    partialTokenCalls,
  };
}

export async function getSpendMicros(
  client: PrismaClient | null,
  now = new Date()
): Promise<{ dailyMicros: number; monthlyMicros: number }> {
  if (!client) {
    return { dailyMicros: 0, monthlyMicros: 0 };
  }
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [day, month] = await Promise.all([
    client.aiCall.aggregate({
      where: { createdAt: { gte: dayStart }, costMicros: { not: null } },
      _sum: { costMicros: true },
    }),
    client.aiCall.aggregate({
      where: { createdAt: { gte: monthStart }, costMicros: { not: null } },
      _sum: { costMicros: true },
    }),
  ]);
  return { dailyMicros: day._sum.costMicros ?? 0, monthlyMicros: month._sum.costMicros ?? 0 };
}

export async function checkBudget(
  client: PrismaClient | null,
  budget: { dailyMicros: number | null; monthlyMicros: number | null },
  now = new Date()
): Promise<{ ok: true } | { ok: false; reason: 'daily' | 'monthly' }> {
  if (budget.dailyMicros === null && budget.monthlyMicros === null) {
    return { ok: true };
  }
  const spend = await getSpendMicros(client, now);
  if (budget.dailyMicros !== null && spend.dailyMicros >= budget.dailyMicros) {
    return { ok: false, reason: 'daily' };
  }
  if (budget.monthlyMicros !== null && spend.monthlyMicros >= budget.monthlyMicros) {
    return { ok: false, reason: 'monthly' };
  }
  return { ok: true };
}

export async function getUsageReport(
  client: PrismaClient | null,
  now = new Date()
): Promise<UsageReport> {
  if (!client) {
    return { today: { ...ZERO }, month: { ...ZERO }, byModel: [], recent: [] };
  }
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rows = (await client.aiCall.findMany({
    where: { createdAt: { gte: monthStart } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      task: true,
      providerId: true,
      model: true,
      resolvedModel: true,
      inputTokens: true,
      outputTokens: true,
      costMicros: true,
      outcome: true,
      createdAt: true,
    },
  })) as CallRow[];

  const byModel = new Map<string, UsageModelRow>();
  for (const row of rows) {
    const model = row.resolvedModel ?? row.model;
    const key = `${row.providerId ?? ''}:${model}`;
    let entry = byModel.get(key);
    if (!entry) {
      entry = { model, providerId: row.providerId, calls: 0, inputTokens: 0, outputTokens: 0, costMicros: null, unpricedCalls: 0, partialTokenCalls: 0 };
      byModel.set(key, entry);
    }
    entry.calls += 1;
    entry.inputTokens += row.inputTokens ?? 0;
    entry.outputTokens += row.outputTokens ?? 0;
    if (row.inputTokens === null || row.outputTokens === null) {
      entry.partialTokenCalls += 1;
    }
    if (row.costMicros === null) {
      entry.unpricedCalls += 1;
    } else {
      entry.costMicros = (entry.costMicros ?? 0) + row.costMicros;
    }
  }

  const recent: UsageCallRow[] = rows.slice(0, 50).map((row) => ({
    id: row.id,
    task: row.task,
    providerId: row.providerId,
    model: row.model,
    resolvedModel: row.resolvedModel,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costMicros: row.costMicros,
    outcome: row.outcome,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    today: totals(rows.filter((row) => row.createdAt >= dayStart)),
    month: totals(rows),
    byModel: [...byModel.values()].sort((left, right) => right.calls - left.calls),
    recent,
  };
}
