/**
 * Tier-2 sandboxed code packs (ADR-0030, capability-rpc/1): the shared
 * wire shapes and the host policy knobs. Charter-derived caps are
 * constants the host may tighten, never loosen; timeouts, memory and
 * rates are user config with defaults (`config.miniApps.sandbox`).
 */

export type SandboxOutcome =
  | 'completed'
  | 'crashed'
  | 'watchdog'
  | 'protocol-violation'
  | 'identity'
  | 'digest-drift'
  | 'killed'
  | 'interrupted';

export const SANDBOX_DISABLE_REASON_PREFIX = 'sandbox: ';

export const SANDBOX_PROTOCOL = 'capability-rpc/1';

/** Charter hard caps (extension-charter.json limits) — tighten only. */
export const SANDBOX_HARD_LIMITS = {
  rpcLineMaxBytes: 1_048_576,
  stateMaxBytes: 262_144,
  errorDetailMaxChars: 500,
  itemsPerCallMax: 256,
  itemJsonMaxBytes: 32 * 1024,
  outputMaxBytes: 1_048_576,
  inputMaxBytes: 256 * 1024,
  entryMaxBytes: 256 * 1024,
  contentTotalMaxBytes: 2 * 1024 * 1024,
  secretSlotsMax: 16,
  invokeOpMaxChars: 64,
} as const;

/** Host policy knobs (`config.miniApps.sandbox`) with safe defaults. */
export interface SandboxLimits {
  callTimeoutMs: number;
  spawnTimeoutMs: number;
  disposeTimeoutMs: number;
  memoryMb: number;
  maxConcurrent: number;
  callsPerMinute: number;
  maxCallsPerInvoke: number;
  bytesPerDay: number;
  eventsPerInvoke: number;
  itemsPerInvokeMax: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  callTimeoutMs: 30_000,
  spawnTimeoutMs: 10_000,
  disposeTimeoutMs: 5_000,
  memoryMb: 256,
  maxConcurrent: 4,
  callsPerMinute: 120,
  maxCallsPerInvoke: 120,
  bytesPerDay: 2 * 1024 * 1024,
  eventsPerInvoke: 200,
  itemsPerInvokeMax: 300,
};

const clampPositive = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

/** Config → effective limits; unknown or non-positive values fall back to defaults. */
export function resolveSandboxLimits(raw: unknown): SandboxLimits {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    callTimeoutMs: clampPositive(source.callTimeoutMs, DEFAULT_SANDBOX_LIMITS.callTimeoutMs),
    spawnTimeoutMs: clampPositive(source.spawnTimeoutMs, DEFAULT_SANDBOX_LIMITS.spawnTimeoutMs),
    disposeTimeoutMs: clampPositive(source.disposeTimeoutMs, DEFAULT_SANDBOX_LIMITS.disposeTimeoutMs),
    memoryMb: clampPositive(source.memoryMb, DEFAULT_SANDBOX_LIMITS.memoryMb),
    maxConcurrent: clampPositive(source.maxConcurrent, DEFAULT_SANDBOX_LIMITS.maxConcurrent),
    callsPerMinute: clampPositive(source.callsPerMinute, DEFAULT_SANDBOX_LIMITS.callsPerMinute),
    maxCallsPerInvoke: clampPositive(source.maxCallsPerInvoke, DEFAULT_SANDBOX_LIMITS.maxCallsPerInvoke),
    bytesPerDay: clampPositive(source.bytesPerDay, DEFAULT_SANDBOX_LIMITS.bytesPerDay),
    eventsPerInvoke: clampPositive(source.eventsPerInvoke, DEFAULT_SANDBOX_LIMITS.eventsPerInvoke),
    itemsPerInvokeMax: clampPositive(source.itemsPerInvokeMax, DEFAULT_SANDBOX_LIMITS.itemsPerInvokeMax),
  };
}

/** One sandboxed invoke's full result — data only, never pack code. */
export interface SandboxInvokeResult {
  output: Record<string, unknown>;
  items: unknown[];
  progressEvents: { percent?: number; messageKey?: string }[];
  logEvents: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }[];
  eventsDropped: number;
  callsServed: number;
  runId: string;
}
