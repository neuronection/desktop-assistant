import { MODEL_PRICING_COMPILED, MODEL_PRICING_ROWS, type ModelPricingRow } from './ai/modelPricing.generated';

export type PriceMetering = 'tokens' | 'input_only' | 'output_only';

/** A user-maintained override. `provider` blank means any non-local provider. */
export interface UserPriceRow {
  provider?: string | null;
  model: string;
  match?: 'exact' | 'prefix';
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
  metering?: PriceMetering;
}

export interface PriceResolution {
  source: 'user' | 'builtin' | 'local';
  row: ModelPricingRow | UserPriceRow | null;
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
  metering: PriceMetering;
  costMicros: number | null;
  priceVersion: string | null;
  reviewedAt: string | null;
  matchedModel: string | null;
}

export interface ResolvePriceOptions {
  providerKey: string | null;
  model: string;
  resolvedModel?: string | null;
  isLocalEndpoint?: boolean;
  userRows?: readonly UserPriceRow[];
  inputTokens?: number | null;
  outputTokens?: number | null;
  includeRetired?: boolean;
  /** Optional deterministic row hash (sha256 hex). The renderer omits it. */
  hashRow?: (row: unknown) => string;
  /** Fixture/test hook; production uses the generated table. */
  builtinRows?: readonly ModelPricingRow[];
  /** Fixture/test hook; production uses the generated compiled date. */
  compiled?: string;
}

const DELIMITERS = new Set(['-', '.', '/', ':', '@', '_']);
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

function trim(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text.length > 0 ? text : null;
}

function prefixMatches(candidate: string, prefix: string): boolean {
  if (!candidate.startsWith(prefix)) {
    return false;
  }
  if (candidate.length === prefix.length) {
    return true;
  }
  const next = candidate[prefix.length];
  return DELIMITERS.has(next) || DELIMITERS.has(prefix[prefix.length - 1]);
}

function rowMatch(row: ModelPricingRow | UserPriceRow, candidate: string): { rank: number; length: number } | null {
  const builtinMatch = (row as ModelPricingRow).match;
  if (!builtinMatch || typeof builtinMatch !== 'object') {
    const userMatch = (row as UserPriceRow).match ?? 'exact';
    if (userMatch === 'prefix') {
      return prefixMatches(candidate, (row as UserPriceRow).model) ? { rank: 1, length: (row as UserPriceRow).model.length } : null;
    }
    return candidate === (row as UserPriceRow).model ? { rank: 2, length: (row as UserPriceRow).model.length } : null;
  }
  const match = builtinMatch;
  let best: { rank: number; length: number } | null = null;
  for (const value of [...match.exact, ...match.aliases]) {
    if (candidate === value) {
      best = { rank: 2, length: value.length };
    }
  }
  for (const prefix of match.prefix) {
    if (prefixMatches(candidate, prefix)) {
      const current = { rank: 1, length: prefix.length };
      if (!best || current.rank > best.rank || (current.rank === best.rank && current.length > best.length)) {
        best = current;
      }
    }
  }
  return best;
}

function meteringOf(row: ModelPricingRow | UserPriceRow): PriceMetering {
  return row.metering ?? 'tokens';
}

function costMicros(
  row: ModelPricingRow | UserPriceRow,
  inputTokens: number | null,
  outputTokens: number | null
): number | null {
  const metering = meteringOf(row);
  let input = inputTokens;
  let output = outputTokens;
  if (metering === 'input_only') {
    output = 0;
  } else if (metering === 'output_only') {
    input = 0;
  }
  if (input === null || output === null || input < 0 || output < 0) {
    return null;
  }
  const numerator = input * row.inputMicrosPerMillion + output * row.outputMicrosPerMillion;
  if (!Number.isSafeInteger(numerator) || numerator < 0 || numerator > MAX_SAFE_INTEGER - 500_000) {
    return null;
  }
  return Math.floor((numerator + 500_000) / 1_000_000);
}

function versionFor(
  row: ModelPricingRow | UserPriceRow,
  compiled: string,
  hashRow?: (row: unknown) => string
): string | null {
  if (!hashRow) {
    return null;
  }
  return `model-pricing/1:${compiled}:${hashRow(row)}`;
}

/**
 * Resolve the price for one call or display row.
 *
 * Truth table: explicit user row → loopback/mDNS = 0 → built-in → null.
 * Within a class: exact/alias > longest delimiter-aware prefix; then
 * `resolvedModel` before the requested `model`. A built-in dated match
 * never outranks a user row on the requested base id.
 */
export function resolvePrice(options: ResolvePriceOptions): PriceResolution | null {
  const model = trim(options.model);
  const resolved = trim(options.resolvedModel);
  if (!model) {
    return null;
  }
  const candidates = [resolved, model].filter((value): value is string => value !== null);
  const providerKey = options.providerKey;
  const isLocal = options.isLocalEndpoint === true;
  const userRows = options.userRows ?? [];
  const inputTokens = options.inputTokens ?? null;
  const outputTokens = options.outputTokens ?? null;
  const compiled = options.compiled ?? MODEL_PRICING_COMPILED;
  const builtinRows = options.builtinRows ?? MODEL_PRICING_ROWS;

  type Candidate = { rank: number; length: number; providerSpecific: number; row: ModelPricingRow | UserPriceRow; candidate: string };
  let best: Candidate | null = null;

  const consider = (row: ModelPricingRow | UserPriceRow, sourceRank: number, providerSpecific: number) => {
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const match = rowMatch(row, candidate);
      if (!match) {
        continue;
      }
      const rank = match.rank * 10 + sourceRank * 1;
      const current = { rank, length: match.length, providerSpecific, row, candidate };
      if (
        !best ||
        current.rank > best.rank ||
        (current.rank === best.rank && current.length > best.length) ||
        (current.rank === best.rank && current.length === best.length && current.providerSpecific > best.providerSpecific) ||
        (current.rank === best.rank &&
          current.length === best.length &&
          current.providerSpecific === best.providerSpecific &&
          index < candidates.indexOf(best.candidate))
      ) {
        best = current;
      }
    }
  };

  // Tier 1: explicit user rows. Blank provider applies only to non-local.
  for (const row of userRows) {
    if (row.provider && row.provider !== providerKey) {
      continue;
    }
    if (!row.provider && isLocal) {
      continue;
    }
    consider(row, 3, row.provider ? 1 : 0);
  }
  if (best) {
    const result = best as Candidate;
    return {
      source: 'user',
      row: result.row,
      inputMicrosPerMillion: result.row.inputMicrosPerMillion,
      outputMicrosPerMillion: result.row.outputMicrosPerMillion,
      metering: meteringOf(result.row),
      costMicros: costMicros(result.row, inputTokens, outputTokens),
      priceVersion: versionFor(result.row, compiled, options.hashRow),
      reviewedAt: null,
      matchedModel: result.candidate,
    };
  }

  // Tier 2: locality, unless an explicit user row won.
  if (isLocal) {
    return {
      source: 'local',
      row: null,
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
      metering: 'tokens',
      costMicros: 0,
      priceVersion: null,
      reviewedAt: null,
      matchedModel: null,
    };
  }

  // Tier 3: built-in, provider-scoped.
  for (const row of builtinRows) {
    if (!providerKey || row.provider !== providerKey) {
      continue;
    }
    if (row.retiredAt && !options.includeRetired) {
      continue;
    }
    consider(row, 2, 1);
  }
  if (!best) {
    return null;
  }
  const result = best as Candidate;
  return {
    source: 'builtin',
    row: result.row,
    inputMicrosPerMillion: result.row.inputMicrosPerMillion,
    outputMicrosPerMillion: result.row.outputMicrosPerMillion,
    metering: meteringOf(result.row),
    costMicros: costMicros(result.row, inputTokens, outputTokens),
    priceVersion: versionFor(result.row, compiled, options.hashRow),
    reviewedAt: 'reviewed' in result.row ? result.row.reviewed : null,
    matchedModel: result.candidate,
  };
}

export function formatCostMicros(value: number | null): string {
  if (value === null) {
    return '';
  }
  return (value / 1_000_000).toFixed(4);
}
