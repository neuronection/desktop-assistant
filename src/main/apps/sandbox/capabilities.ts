import {
  SANDBOX_HARD_LIMITS,
  type ErrorDetail,
  type SandboxLimits,
} from '@shared/app-pack';
import { capErrorDetail, errorEnvelope, stableJson, type RpcErrorEnvelope } from './protocol';

const STATE_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,127}$/;
const SLOT_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const SECRET_PLACEHOLDER = '{{secret:%s}}';
const PROGRESS_KEY_MAX_CHARS = 120;
const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

export class QuotaExhausted extends Error {
  constructor(detail: ErrorDetail | string) {
    super(capErrorDetail(detail).message ?? '');
    this.name = 'QuotaExhausted';
  }
}

export class SeamError extends Error {
  readonly envelope: RpcErrorEnvelope;
  constructor(code: string, detail: ErrorDetail | string, retryable?: RpcErrorEnvelope['retryable']) {
    const bounded = capErrorDetail(detail);
    super(bounded.message ?? '');
    this.name = 'SeamError';
    this.envelope = errorEnvelope(code, bounded, retryable);
  }
}

export interface SandboxCallRecord {
  packId: string;
  digest: string;
  method: string;
  argsHash: string;
  callNumber: number;
  ok: boolean;
  errorCode: string | null;
  durationMs: number;
  createdAt: number;
}

export interface SandboxStateStore {
  get(packId: string, key: string): Promise<unknown>;
  all(packId: string): Promise<Record<string, unknown>>;
  set(packId: string, key: string, value: unknown): Promise<void>;
}

export interface CapabilitySeamDeps {
  packId: string;
  digest: string;
  manifest: Record<string, unknown>;
  config: Record<string, unknown>;
  limits: SandboxLimits;
  stateStore: SandboxStateStore;
  secretGet(slot: string): Promise<string | null>;
  audit(record: SandboxCallRecord): Promise<void>;
  now(): number;
  sha256(input: string): string;
}

const byteSize = (value: unknown): number => {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
};

const rateRings = new Map<string, number[]>();
const dayBuckets = new Map<string, { day: string; used: number }>();

export function resetSandboxQuotaState(): void {
  rateRings.clear();
  dayBuckets.clear();
}

/**
 * The host-side capability seam (ADR-0030 clause 4, capability-rpc.md §4):
 * quota gate → per-call validation → host execution → one audit row per
 * capability call, written in `finally` either way. `net` is denied at the
 * seam in v1 (ADR-0030 clauses 4/6) — the protocol handler exists and
 * answers the typed `net-denied`.
 */
export class CapabilitySeam {
  callsServed = 0;
  readonly items: unknown[] = [];
  readonly progressEvents: { percent?: number; messageKey?: string }[] = [];
  readonly logEvents: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }[] = [];
  eventsDropped = 0;
  bytesUsed = 0;

  private readonly declaredSlots: ReadonlySet<string>;
  private readonly stateDeclared: boolean;
  private readonly secretsDeclared: boolean;
  private eventsUsed = 0;

  constructor(private readonly deps: CapabilitySeamDeps) {
    const capabilities = Array.isArray(deps.manifest.capabilities) ? (deps.manifest.capabilities as string[]) : [];
    this.stateDeclared = capabilities.includes('state');
    this.secretsDeclared = capabilities.includes('secrets');
    const slots = new Set<string>();
    if (Array.isArray(deps.manifest.secrets)) {
      for (const entry of deps.manifest.secrets as { id?: unknown }[]) {
        if (typeof entry?.id === 'string' && SLOT_PATTERN.test(entry.id)) {
          slots.add(entry.id);
        }
      }
    }
    this.declaredSlots = slots;
  }

  async handle(method: string, rawParams: unknown): Promise<Record<string, unknown>> {
    const started = this.deps.now();
    let errorCode: string | null = null;
    const params = (typeof rawParams === 'object' && rawParams !== null ? rawParams : {}) as Record<string, unknown>;
    try {
      this.quotaGate();
      return await this.dispatch(method, params);
    } catch (error) {
      if (error instanceof QuotaExhausted) {
        errorCode = 'budget';
        throw error;
      }
      if (error instanceof SeamError) {
        errorCode = error.envelope.code;
        throw error;
      }
      errorCode = 'provider';
      throw new SeamError('provider', capErrorDetail({ message: 'unexpected seam failure' }));
    } finally {
      this.callsServed += 1;
      const record: SandboxCallRecord = {
        packId: this.deps.packId,
        digest: this.deps.digest,
        method,
        argsHash: this.deps.sha256(stableJson(params)),
        callNumber: this.callsServed,
        ok: errorCode === null,
        errorCode,
        durationMs: this.deps.now() - started,
        createdAt: this.deps.now(),
      };
      try {
        await this.deps.audit(record);
      } catch {
        // The audit row must never break the seam's reply path; the row write
        // is retried by the store on the next call (best-effort, disclosed).
      }
    }
  }

  private quotaGate(): void {
    if (this.callsServed >= this.deps.limits.maxCallsPerInvoke) {
      throw new QuotaExhausted(`per-invoke call quota exhausted (${this.deps.limits.maxCallsPerInvoke} calls/invoke)`);
    }
    const ring = rateRings.get(this.deps.packId) ?? [];
    const now = this.deps.now();
    while (ring.length > 0 && now - ring[0] > 60_000) {
      ring.shift();
    }
    if (ring.length >= this.deps.limits.callsPerMinute) {
      throw new QuotaExhausted(`call rate quota exhausted (${this.deps.limits.callsPerMinute} calls/minute)`);
    }
    ring.push(now);
    rateRings.set(this.deps.packId, ring);
  }

  private chargeBytes(nbytes: number): void {
    this.bytesUsed += nbytes;
    const day = new Date(this.deps.now()).toISOString().slice(0, 10);
    const bucket = dayBuckets.get(this.deps.packId);
    const used = (bucket && bucket.day === day ? bucket.used : 0) + nbytes;
    if (used > this.deps.limits.bytesPerDay) {
      dayBuckets.set(this.deps.packId, { day, used });
      throw new QuotaExhausted(`daily byte quota exhausted (${this.deps.limits.bytesPerDay} bytes/day)`);
    }
    dayBuckets.set(this.deps.packId, { day, used });
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (method === 'cap.net.fetch') {
      return this.netFetch(params);
    }
    if (method === 'cap.state.get') {
      return this.stateGet(params);
    }
    if (method === 'cap.state.set') {
      return this.stateSet(params);
    }
    if (method === 'cap.items.emit') {
      return this.itemsEmit(params);
    }
    if (method === 'cap.secrets.need') {
      return this.secretsNeed(params);
    }
    if (method === 'evt.progress') {
      return this.progress(params);
    }
    if (method === 'evt.log') {
      return this.log(params);
    }
    throw new SeamError('unsupported', capErrorDetail({ method }));
  }

  private netFetch(_params: Record<string, unknown>): Record<string, unknown> {
    throw new SeamError(
      'net-denied',
      capErrorDetail({ message: 'desktop v1 denies net at the seam (ADR-0030 clauses 4/6) — no network path for code packs' })
    );
  }

  private async stateGet(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.stateDeclared) {
      throw new SeamError('unsupported', capErrorDetail({ message: 'state not declared in the manifest' }));
    }
    const key = this.stateKey(params);
    const value = await this.deps.stateStore.get(this.deps.packId, key);
    return { value: value ?? null };
  }

  private async stateSet(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.stateDeclared) {
      throw new SeamError('unsupported', capErrorDetail({ message: 'state not declared in the manifest' }));
    }
    const key = this.stateKey(params);
    if (!('value' in params)) {
      throw new SeamError('invalid', capErrorDetail({ field: 'value' }));
    }
    const state = await this.deps.stateStore.all(this.deps.packId);
    const before = byteSize(state);
    const next = { ...state, [key]: params.value };
    const serialized = byteSize(next);
    if (serialized > SANDBOX_HARD_LIMITS.stateMaxBytes) {
      throw new SeamError('budget', capErrorDetail({ message: 'state exceeds stateMaxBytes', used: serialized }));
    }
    this.chargeBytes(Math.max(0, serialized - before));
    await this.deps.stateStore.set(this.deps.packId, key, params.value);
    return { bytes: serialized };
  }

  private stateKey(params: Record<string, unknown>): string {
    const key = params.key;
    if (typeof key !== 'string' || !STATE_KEY_PATTERN.test(key)) {
      throw new SeamError('invalid', capErrorDetail({ field: 'key' }));
    }
    return key;
  }

  private itemsEmit(params: Record<string, unknown>): Record<string, unknown> {
    const rawItems = params.items;
    if (!Array.isArray(rawItems) || rawItems.length > SANDBOX_HARD_LIMITS.itemsPerCallMax) {
      throw new SeamError('invalid', capErrorDetail({ field: 'items' }));
    }
    if (this.items.length + rawItems.length > this.deps.limits.itemsPerInvokeMax) {
      throw new SeamError('budget', capErrorDetail({ message: 'item cap per invoke', limit: this.deps.limits.itemsPerInvokeMax }));
    }
    for (const item of rawItems) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new SeamError('invalid', capErrorDetail({ field: 'items', message: 'items must be objects' }));
      }
      const size = byteSize(item);
      if (size > SANDBOX_HARD_LIMITS.itemJsonMaxBytes) {
        throw new SeamError('invalid', capErrorDetail({ field: 'items', message: 'item exceeds the 32 KiB JSON cap' }));
      }
    }
    this.items.push(...rawItems);
    this.chargeBytes(rawItems.reduce((total, item) => total + byteSize(item), 0));
    return { accepted: rawItems.length };
  }

  private async secretsNeed(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const slot = params.slot;
    if (typeof slot !== 'string' || slot.length === 0 || slot.length > 64) {
      throw new SeamError('invalid', capErrorDetail({ field: 'slot' }));
    }
    if (!this.secretsDeclared || !this.declaredSlots.has(slot)) {
      throw new SeamError('invalid', capErrorDetail({ message: 'slot not declared in the manifest' }));
    }
    const value = await this.deps.secretGet(`${this.deps.packId}:${slot}`);
    if (!value) {
      throw new SeamError('needs-secret', capErrorDetail({ slot }), 'after-config-change');
    }
    return { resolved: true, injectedAs: SECRET_PLACEHOLDER.replace('%s', slot) };
  }

  private progress(params: Record<string, unknown>): Record<string, unknown> {
    if (!this.eventBudget()) {
      return {};
    }
    const event: { percent?: number; messageKey?: string } = {};
    const percent = params.percent;
    if (percent !== undefined && percent !== null) {
      if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 0 || percent > 100) {
        throw new SeamError('invalid', capErrorDetail({ field: 'percent' }));
      }
      event.percent = percent;
    }
    const messageKey = params.messageKey;
    if (messageKey !== undefined && messageKey !== null) {
      if (typeof messageKey !== 'string' || messageKey.length > PROGRESS_KEY_MAX_CHARS) {
        throw new SeamError('invalid', capErrorDetail({ field: 'messageKey' }));
      }
      event.messageKey = messageKey;
    }
    if (this.progressEvents.length < 32) {
      this.progressEvents.push(event);
    }
    return {};
  }

  private log(params: Record<string, unknown>): Record<string, unknown> {
    if (!this.eventBudget()) {
      return {};
    }
    const level = params.level;
    const message = params.message;
    if (typeof level !== 'string' || !LOG_LEVELS.has(level) || typeof message !== 'string') {
      throw new SeamError('invalid', capErrorDetail({ field: 'level' }));
    }
    if (this.logEvents.length < 50) {
      this.logEvents.push({ level: level as 'debug' | 'info' | 'warn' | 'error', message: message.slice(0, 500) });
    }
    return {};
  }

  private eventBudget(): boolean {
    if (this.eventsUsed >= this.deps.limits.eventsPerInvoke) {
      this.eventsDropped += 1;
      return false;
    }
    this.eventsUsed += 1;
    return true;
  }
}
