import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePrice } from '@shared/modelPricing';

interface FixtureCase {
  id: string;
  input: {
    provider: string;
    resolvedModel?: string | null;
    model: string;
    isLocal: boolean;
    inputTokens?: number | null;
    outputTokens?: number | null;
    includeRetired?: boolean;
    userRows?: unknown[];
  };
  expect: unknown;
}

const fixtures = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'model-pricing.fixtures.json'), 'utf8')
) as {
  compiled: string;
  models: unknown[];
  cases: FixtureCase[];
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function rowHash(row: unknown): string {
  return createHash('sha256').update(canonical(row)).digest('hex').slice(0, 8);
}

describe('model-pricing fixtures', () => {
  for (const fixture of fixtures.cases) {
    it(fixture.id, () => {
      const actual = resolvePrice({
        providerKey: fixture.input.provider,
        model: fixture.input.model,
        resolvedModel: fixture.input.resolvedModel ?? null,
        isLocalEndpoint: fixture.input.isLocal,
        inputTokens: fixture.input.inputTokens ?? null,
        outputTokens: fixture.input.outputTokens ?? null,
        includeRetired: fixture.input.includeRetired,
        userRows: (fixture.input.userRows ?? []) as never,
        builtinRows: fixtures.models as never,
        compiled: fixtures.compiled,
        hashRow: rowHash,
      });
      expect(actual).toEqual(fixture.expect);
    });
  }
});
