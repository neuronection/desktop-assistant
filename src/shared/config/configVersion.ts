export const CONFIG_SCHEMA_VERSION = 1;

type RawConfig = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Transient config upgrades keyed by the version they produce. Deleted at
 * each flatten, exactly like the database ladder (plan 36 D4).
 */
const CONFIG_UPGRADES: Record<number, (config: RawConfig) => RawConfig> = {
  1: (config) => config,
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
