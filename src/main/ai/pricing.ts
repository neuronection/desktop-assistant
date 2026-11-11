import { createHash } from 'node:crypto';
import type { AppConfig } from '@shared/config/AppConfig';
import { isLocalApiBase } from '@shared/usage';
import { presetKeyForProvider } from '@shared/ai/providerPresets';
import { resolvePrice } from '@shared/modelPricing';
import type { AiCallPrice, AiCallPriceResolver, AiCallRecord } from './audit';

const PRICED_TASKS = new Set([
  'chat',
  'titles',
  'voiceEndpoint',
  'plumbing',
  'vision',
  'embed',
]);

function isPricedTask(task: string): boolean {
  return PRICED_TASKS.has(task) || task.startsWith('chat.');
}

function usageSource(record: AiCallRecord, pricedTask: boolean): AiCallPrice['usageSource'] {
  if (!pricedTask) {
    return 'unknown';
  }
  if (record.inputTokens !== undefined && record.outputTokens !== undefined) {
    return 'provider';
  }
  if (record.inputTokens !== undefined || record.outputTokens !== undefined) {
    return 'partial';
  }
  return 'unknown';
}

/** Canonical JSON for the row hash (mirrors the dev checker's sha256). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function rowHash(row: unknown): string {
  return createHash('sha256').update(canonical(row)).digest('hex').slice(0, 8);
}

export function createAiCallPriceResolver(getConfig: () => AppConfig): AiCallPriceResolver {
  return (record) => {
    const pricedTask = isPricedTask(record.task);
    const source = usageSource(record, pricedTask);
    if (!pricedTask || !record.providerId) {
      return { costMicros: null, usageSource: source, priceSource: 'unknown', priceVersion: null };
    }
    const config = getConfig();
    const provider = config.providers?.find((entry) => entry.id === record.providerId);
    if (!provider) {
      return { costMicros: null, usageSource: source, priceSource: 'unknown', priceVersion: null };
    }
    const resolved = resolvePrice({
      providerKey: presetKeyForProvider(provider),
      resolvedModel: record.resolvedModel ?? null,
      model: record.model,
      isLocalEndpoint: isLocalApiBase(provider.apiBase),
      userRows: config.usage?.pricing ?? [],
      inputTokens: record.inputTokens ?? null,
      outputTokens: record.outputTokens ?? null,
      hashRow: rowHash,
    });
    if (!resolved) {
      return { costMicros: null, usageSource: source, priceSource: 'unknown', priceVersion: null };
    }
    return {
      costMicros: resolved.costMicros,
      usageSource: source,
      priceSource: resolved.source,
      priceVersion: resolved.priceVersion,
    };
  };
}
