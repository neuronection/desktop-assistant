import type { PrismaClient } from 'generated/prisma/client';
import { estimateCost, type ModelPricing, type UsageCallRow, type UsageModelRow, type UsageReport, type UsageTotals } from '@shared/usage';

const ZERO: UsageTotals = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpricedCalls: 0, partialTokenCalls: 0 };

type CallRow = {
  id: string;
  task: string;
  providerId: string | null;
  model: string;
  resolvedModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  outcome: string;
  createdAt: Date;
};

function costOf(row: CallRow, pricing: readonly ModelPricing[], localProviders: ReadonlySet<string>): number | null {
  if (row.providerId && localProviders.has(row.providerId)) {
    return 0;
  }
  if (row.inputTokens === null || row.outputTokens === null) {
    return null;
  }
  const usage = { inputTokens: row.inputTokens, outputTokens: row.outputTokens };
  const primary = estimateCost(usage, row.resolvedModel ?? row.model, pricing);
  if (primary !== null || !row.resolvedModel) {
    return primary;
  }
  return estimateCost(usage, row.model, pricing);
}

function totals(rows: readonly CallRow[], pricing: readonly ModelPricing[], localProviders: ReadonlySet<string>): UsageTotals {
  if (rows.length === 0) {
    return { ...ZERO };
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let priced = 0;
  let partialTokenCalls = 0;
  for (const row of rows) {
    inputTokens += row.inputTokens ?? 0;
    outputTokens += row.outputTokens ?? 0;
    if (row.inputTokens === null || row.outputTokens === null) {
      partialTokenCalls += 1;
    }
    const cost = costOf(row, pricing, localProviders);
    if (cost === null) {
      continue;
    }
    priced += 1;
    costUsd += cost;
  }
  return {
    calls: rows.length,
    inputTokens,
    outputTokens,
    costUsd: priced > 0 ? costUsd : null,
    unpricedCalls: rows.length - priced,
    partialTokenCalls,
  };
}

export async function getUsageReport(
  client: PrismaClient | null,
  pricing: readonly ModelPricing[],
  localProviders: ReadonlySet<string> = new Set(),
  now = new Date()
): Promise<UsageReport> {
  if (!client) {
    return { today: { ...ZERO }, month: { ...ZERO }, byModel: [], recent: [], pricing: [...pricing] };
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
      entry = { model, providerId: row.providerId, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, unpricedCalls: 0, partialTokenCalls: 0 };
      byModel.set(key, entry);
    }
    const cost = costOf(row, pricing, localProviders);
    entry.calls += 1;
    entry.inputTokens += row.inputTokens ?? 0;
    entry.outputTokens += row.outputTokens ?? 0;
    if (row.inputTokens === null || row.outputTokens === null) {
      entry.partialTokenCalls += 1;
    }
    if (cost === null) {
      entry.unpricedCalls += 1;
    } else {
      entry.costUsd = (entry.costUsd ?? 0) + cost;
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
    costUsd: costOf(row, pricing, localProviders),
    outcome: row.outcome,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    today: totals(rows.filter((row) => row.createdAt >= dayStart), pricing, localProviders),
    month: totals(rows, pricing, localProviders),
    byModel: [...byModel.values()].sort((left, right) => right.calls - left.calls),
    recent,
    pricing: [...pricing],
  };
}
