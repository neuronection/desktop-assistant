export const CONFIG_SCHEMA_VERSION = 2;

type RawConfig = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toMicros(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(Math.max(0, value) * 1_000_000);
}

function upgradeUsagePricing(raw: unknown): RawConfig {
  const usage = isPlainObject(raw) ? raw : {};
  const rows = Array.isArray(usage.pricing) ? usage.pricing : [];
  const pricing = rows.flatMap((entry) => {
    if (!isPlainObject(entry)) {
      return [];
    }
    const model = typeof entry.model === 'string' ? entry.model.trim() : '';
    if (!model) {
      return [];
    }
    const input =
      typeof entry.inputMicrosPerMillion === 'number'
        ? Math.max(0, Math.round(entry.inputMicrosPerMillion))
        : toMicros(entry.inputPerMillion);
    const output =
      typeof entry.outputMicrosPerMillion === 'number'
        ? Math.max(0, Math.round(entry.outputMicrosPerMillion))
        : toMicros(entry.outputPerMillion);
    if (input === null || output === null) {
      return [];
    }
    // A bare 0/0 row from the v1 shape was the old "Add model" default, not a free claim.
    if (
      entry.inputMicrosPerMillion === undefined &&
      entry.outputMicrosPerMillion === undefined &&
      input === 0 &&
      output === 0
    ) {
      return [];
    }
    const row: RawConfig = { model, inputMicrosPerMillion: input, outputMicrosPerMillion: output };
    if (typeof entry.provider === 'string' && entry.provider.trim()) {
      row.provider = entry.provider.trim();
    }
    if (entry.match === 'prefix' || entry.match === 'exact') {
      row.match = entry.match;
    }
    if (entry.metering === 'tokens' || entry.metering === 'input_only' || entry.metering === 'output_only') {
      row.metering = entry.metering;
    }
    return [row];
  });
  return { ...usage, pricing: pricing.slice(0, 200) };
}

/**
 * Transient config upgrades keyed by the version they produce. Deleted at
 * each flatten, exactly like the database ladder (plan 36 D4).
 */
const CONFIG_UPGRADES: Record<number, (config: RawConfig) => RawConfig> = {
  1: (config) => config,
  2: (config) => ({ ...config, usage: upgradeUsagePricing(config.usage) }),
};

export function upgradeConfig(raw: unknown): RawConfig {
  let config: RawConfig = isPlainObject(raw) ? { ...raw } : {};
  const version =
    typeof config.schemaVersion === 'number' && Number.isInteger(config.schemaVersion)
      ? config.schemaVersion
      : 0;
  let at = Math.min(version, CONFIG_SCHEMA_VERSION);
  while (at < CONFIG_SCHEMA_VERSION) {
    const upgrade = CONFIG_UPGRADES[at + 1];
    if (!upgrade) {
      throw new Error(`Missing config upgrade for schema version ${at + 1}.`);
    }
    config = upgrade(config);
    at += 1;
    config.schemaVersion = at;
  }
  return config;
}

/**
 * Shape-strip unknown keys against the defaults. Fixed objects are
 * stripped recursively; arrays and empty-object maps are domain data
 * (providers, packs, custom commands) and pass through untouched.
 */
export function stripUnknownKeys(defaultValue: unknown, value: unknown): unknown {
  if (Array.isArray(defaultValue)) {
    return value;
  }
  if (isPlainObject(defaultValue) && isPlainObject(value)) {
    const keys = Object.keys(defaultValue);
    if (keys.length === 0) {
      return value;
    }
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (key in value) {
        result[key] = stripUnknownKeys(defaultValue[key], value[key]);
      }
    }
    return result;
  }
  return value;
}
