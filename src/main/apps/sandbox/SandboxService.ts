import { randomUUID } from 'node:crypto';
import {
  SANDBOX_HARD_LIMITS,
  SANDBOX_PROTOCOL,
  type SandboxInvokeResult,
  type SandboxLimits,
  type SandboxOutcome,
} from '@shared/app-pack';
import type { PackError } from '@shared/app-pack';
import { CapabilitySeam, QuotaExhausted, type SandboxCallRecord, type SandboxStateStore } from './capabilities';
import {
  CAP_METHODS,
  ERROR_CODES,
  MAX_PROTOCOL_VIOLATIONS,
  RPC_VERSION,
  encodeFrame,
  errorEnvelope,
  jsonDetail,
  validateFrame,
  type RpcErrorEnvelope,
} from './protocol';

export class SandboxDied extends Error {
  constructor(
    readonly outcome: SandboxOutcome,
    readonly reason: string
  ) {
    super(reason);
    this.name = 'SandboxDied';
  }
}

export class InvokeFailed extends Error {
  constructor(
    readonly envelope: RpcErrorEnvelope
  ) {
    super(`invoke failed: ${envelope.code}`);
    this.name = 'InvokeFailed';
  }
}

export interface SandboxSpawnOptions {
  modulePath: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  execArgv: string[];
}

export interface SandboxProcess {
  pid: number;
  send(message: Record<string, unknown>): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
}

export type SandboxSpawn = (options: SandboxSpawnOptions) => SandboxProcess;

export interface SandboxRunRow {
  id: string;
  packId: string;
  digest: string;
  pid: number;
  op: string;
  outcome: SandboxOutcome;
  reason: string | null;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export interface SandboxStore {
  createRun(row: SandboxRunRow): Promise<void>;
  closeRun(id: string, outcome: SandboxOutcome, reason: string | null, finishedAt: number): Promise<void>;
  openRuns(): Promise<SandboxRunRow[]>;
  appendCall(record: SandboxCallRecord): Promise<void>;
}

export interface SandboxTarget {
  packId: string;
  manifest: Record<string, unknown>;
  contentPath: string;
  manifestDigest: string;
  contentDigest: string;
  config: Record<string, unknown>;
}

export type SandboxInvokeOutcome =
  | { ok: true; result: SandboxInvokeResult }
  | { ok: false; fatal: false; error: PackError }
  | { ok: false; fatal: true; outcome: SandboxOutcome; reason: string };

export interface SandboxServiceDeps {
  spawn: SandboxSpawn;
  childPath(): string;
  workdir(packId: string): string;
  resolveTarget(packId: string): SandboxTarget | null;
  selfDisable(packId: string, reason: string): Promise<void>;
  store: SandboxStore;
  stateStore: SandboxStateStore;
  secretGet(packId: string, slot: string): Promise<string | null>;
  limits(): SandboxLimits;
  now(): number;
  sha256(input: string): string;
}

interface PendingCall {
  resolve(value: Record<string, unknown>): void;
  reject(error: Error): void;
}

/** The child's own exit codes map onto the typed outcomes (digest drift is never a run). */
function exitOutcome(code: number | null): [SandboxOutcome, string] {
  switch (code) {
    case 2:
      return ['digest-drift', 'the sandbox refused the pinned content (manifest or content digest drift): exited 2'];
    case 3:
      return ['protocol-violation', 'the sandbox recycled itself after repeated protocol violations: exited 3'];
    case 5:
      return ['identity', 'the sandbox refused the protocol version: exited 5'];
    default:
      return ['crashed', `sandbox exited ${code ?? 'abruptly'}`];
  }
}

/**
 * One live sandbox: the message router (every frame schema-validated
 * against the vendored capability-rpc schema), the violation counter,
 * the per-invoke and per-capability-call watchdogs, and the teardown.
 */
class SandboxSession {
  readonly runId = randomUUID();
  private readonly seam: CapabilitySeam;
  private readonly pending = new Map<number | string, PendingCall>();
  private readonly exitWaiters: ((code: number | null) => void)[] = [];
  private violations = 0;
  private death: SandboxDied | null = null;
  private killedByUser = false;
  private disposed = false;
  private identityRefused = false;
  private invokeTimer: ReturnType<typeof setTimeout> | null = null;
  private callTimer: ReturnType<typeof setTimeout> | null = null;
  private exited = false;
  private exitCode: number | null = null;
  private nextId = 0;

  constructor(
    readonly process: SandboxProcess,
    private readonly deps: SandboxServiceDeps,
    private readonly target: SandboxTarget,
    private readonly limits: SandboxLimits
  ) {
    this.seam = new CapabilitySeam({
      packId: target.packId,
      digest: target.manifestDigest,
      manifest: target.manifest,
      config: target.config,
      limits,
      stateStore: deps.stateStore,
      secretGet: (slot) => deps.secretGet(target.packId, slot),
      audit: (record) => deps.store.appendCall(record),
      now: deps.now,
      sha256: deps.sha256,
    });
    process.onMessage((message) => this.onMessage(message));
    process.onExit((code) => this.onExit(code));
  }

  private armInvokeWatchdog(ms: number, phase: string): void {
    this.clearInvokeWatchdog();
    this.invokeTimer = setTimeout(() => {
      this.die('watchdog', `wall-clock watchdog killed the sandbox during ${phase} (${ms}ms)`);
      this.process.kill();
    }, ms);
  }

  private clearInvokeWatchdog(): void {
    if (this.invokeTimer) {
      clearTimeout(this.invokeTimer);
      this.invokeTimer = null;
    }
  }

  private die(outcome: SandboxOutcome, reason: string): SandboxDied {
    this.death ??= new SandboxDied(outcome, reason.slice(0, 1000));
    this.clearInvokeWatchdog();
    this.clearCallWatchdog();
    for (const [id, pending] of [...this.pending.entries()]) {
      pending.reject(this.death);
      this.pending.delete(id);
    }
    this.flushExit();
    return this.death;
  }

  private onExit(code: number | null): void {
    this.exited = true;
    this.exitCode = code;
    if (this.killedByUser) {
      this.die('killed', 'the pack kill switch killed the sandbox');
    } else if (!this.death && !(this.disposed && code === 0)) {
      this.die(...exitOutcome(code));
    }
    this.flushExit();
  }

  private flushExit(): void {
    if (!this.exited) {
      return;
    }
    const waiters = this.exitWaiters.splice(0);
    for (const waiter of waiters) {
      waiter(this.exitCode);
    }
  }

  private violation(detail: string): void {
    this.violations += 1;
    if (this.violations >= MAX_PROTOCOL_VIOLATIONS) {
      this.die('protocol-violation', `recycled after ${this.violations} protocol violations (last: ${detail})`);
      this.process.kill();
    }
  }

  private send(message: Record<string, unknown>): void {
    try {
      encodeFrame(message);
    } catch {
      this.die('crashed', 'host framing bug: outbound message exceeds rpcLineMaxBytes');
      return;
    }
    if (!this.death) {
      this.process.send(message);
    }
  }

  private call(method: string, params: Record<string, unknown>, timeoutMs: number, phase: string): Promise<Record<string, unknown>> {
    if (this.death) {
      return Promise.reject(this.death);
    }
    this.nextId += 1;
    const id = `host-${this.nextId}`;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.send({ v: RPC_VERSION, type: 'call', id, method, params });
    this.armInvokeWatchdog(timeoutMs, phase);
    return promise;
  }

  private onMessage(raw: unknown): void {
    if (this.death) {
      return;
    }
    if (typeof raw !== 'object' || raw === null) {
      this.violation('message is not a JSON object');
      return;
    }
    const doc = raw as Record<string, unknown>;
    if (encodeFrame(doc).length > SANDBOX_HARD_LIMITS.rpcLineMaxBytes) {
      this.violation('line exceeds rpcLineMaxBytes');
      return;
    }
    if (doc.v !== RPC_VERSION) {
      this.identityRefused = true;
      this.die('identity', `protocol version mismatch: ${JSON.stringify(doc.v)} (host speaks ${SANDBOX_PROTOCOL})`);
      this.process.kill();
      return;
    }
    let message;
    try {
      message = validateFrame(doc);
    } catch (error) {
      this.violation(error instanceof Error ? error.message : 'message fails the capability-rpc schema');
      return;
    }
    if (message.type === 'call') {
      void this.serve(message);
      return;
    }
    if (message.type === 'event') {
      void this.seam.handle(message.method ?? '', message.params ?? {}).catch(() => undefined);
      return;
    }
    const pending = this.pending.get(message.id);
    if (pending) {
      this.pending.delete(message.id);
      pending.resolve(message);
      return;
    }
    this.violation(`unsolicited ${message.type} with unknown id`);
  }

  private clearCallWatchdog(): void {
    if (this.callTimer) {
      clearTimeout(this.callTimer);
      this.callTimer = null;
    }
  }

  private async serve(message: { id: number | string; method?: string; params?: Record<string, unknown> }): Promise<void> {
    const method = message.method ?? '';
    if (!(CAP_METHODS as readonly string[]).includes(method)) {
      this.send({
        v: RPC_VERSION,
        type: 'error',
        id: message.id,
        method,
        error: errorEnvelope('unsupported', jsonDetail({ method: method || 'unknown' })),
      });
      return;
    }
    this.callTimer = setTimeout(() => {
      this.die('watchdog', `wall-clock watchdog killed the sandbox during ${method} (${this.limits.callTimeoutMs}ms)`);
      this.process.kill();
    }, this.limits.callTimeoutMs);
    try {
      const result = await this.seam.handle(method, message.params ?? {});
      this.send({ v: RPC_VERSION, type: 'result', id: message.id, result });
    } catch (error) {
      if (this.death) {
        return;
      }
      if (error instanceof QuotaExhausted) {
        this.send({
          v: RPC_VERSION,
          type: 'error',
          id: message.id,
          method,
          error: errorEnvelope('budget', error.message, 'after-config-change'),
        });
        return;
      }
      const envelope =
        error instanceof Error && 'envelope' in error
          ? (error as { envelope: RpcErrorEnvelope }).envelope
          : errorEnvelope('provider', jsonDetail({ seam: 'unexpected' }));
      this.send({ v: RPC_VERSION, type: 'error', id: message.id, method, error: envelope });
    } finally {
      this.clearCallWatchdog();
    }
  }

  /** Handshake → invoke; resolves with the invoke output or throws SandboxDied / InvokeFailed. */
  async run(op: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const handshake = await this.call('ext.invoke', { op: 'hello', input: {} }, this.limits.spawnTimeoutMs, 'handshake');
    if (this.death) {
      throw this.death;
    }
    const identity = (((handshake as { result?: { output?: unknown } }).result?.output ?? {}) as Record<string, unknown>);
    if (
      identity.id !== this.target.manifest.id ||
      identity.version !== this.target.manifest.version ||
      identity.digest !== this.target.manifestDigest
    ) {
      this.identityRefused = true;
      this.die('identity', `handshake identity mismatch — the sandbox did not come up as the pinned pack (declared ${jsonDetail(identity)})`);
      this.process.kill();
      throw this.death;
    }
    if (identity.loadError !== undefined) {
      const loadError = identity.loadError as { code?: string; detail?: string };
      this.die('crashed', `the pack failed to load: ${loadError.code ?? 'invalid'} ${loadError.detail ?? ''}`);
      this.process.kill();
      throw this.death;
    }
    const reply = await this.call('ext.invoke', { op, input }, this.limits.callTimeoutMs, op);
    if (this.death) {
      throw this.death;
    }
    if ('error' in reply) {
      const envelope = (reply as { error: RpcErrorEnvelope }).error;
      throw new InvokeFailed({
        ...envelope,
        code: envelope.code && ERROR_CODES.has(envelope.code) ? envelope.code : 'provider',
      });
    }
    return (((reply as { result?: { output?: unknown } }).result?.output ?? {}) as Record<string, unknown>);
  }

  /** Graceful dispose (protocol §5): best-effort reply, then SIGKILL. */
  async dispose(): Promise<void> {
    try {
      await this.call('ext.dispose', {}, this.limits.disposeTimeoutMs, 'dispose');
    } catch {
      // the dispose reply is best-effort; teardown continues either way
    }
    this.clearInvokeWatchdog();
    this.disposed = true;
    this.process.kill();
  }

  killByUser(): void {
    this.killedByUser = true;
    this.process.kill();
  }

  waitForExit(): Promise<number | null> {
    if (this.exited) {
      return Promise.resolve(this.exitCode);
    }
    return new Promise((resolve) => {
      this.exitWaiters.push(resolve);
    });
  }

  collect(): SandboxInvokeResult {
    return {
      output: {},
      items: [...this.seam.items],
      progressEvents: [...this.seam.progressEvents],
      logEvents: [...this.seam.logEvents],
      eventsDropped: this.seam.eventsDropped,
      callsServed: this.seam.callsServed,
      runId: this.runId,
    };
  }
}

/**
 * The Tier-2 sandbox spine (ADR-0030 clause 1): one sandboxed process per
 * imported code pack, spawned ONLY from digest-pinned installed content
 * (never in-repo), wall-clock + memory watchdogs per call and lifecycle,
 * a concurrent-sandbox cap, per-pack kill, and sandbox death ⇒ the pack
 * self-disables with the surfaced reason (never app failure).
 */
export class SandboxService {
  private readonly liveByPack = new Map<string, SandboxSession>();
  private liveCount = 0;

  constructor(private readonly deps: SandboxServiceDeps) {}

  livePacks(): string[] {
    return [...this.liveByPack.keys()];
  }

  /** Per-pack kill switch (ADR-0030 clause 5): kills the live sandbox; a waiting invoke reports `canceled`. */
  killPack(packId: string): boolean {
    const session = this.liveByPack.get(packId);
    if (!session) {
      return false;
    }
    session.killByUser();
    return true;
  }

  /** Boot reconciliation: host-restart orphans close as `interrupted` — host death is never pack failure. */
  async reconcileBoot(): Promise<number> {
    const open = await this.deps.store.openRuns();
    for (const row of open) {
      await this.deps.store.closeRun(row.id, 'interrupted', 'host restarted while the sandbox was live', this.deps.now());
    }
    return open.length;
  }

  async invoke(packId: string, op: string, args: Record<string, unknown> = {}): Promise<SandboxInvokeOutcome> {
    const limits = this.deps.limits();
    if (this.liveCount >= limits.maxConcurrent) {
      return {
        ok: false,
        fatal: false,
        error: { code: 'budget', detail: { reason: `concurrent sandbox cap reached (${limits.maxConcurrent})` } },
      };
    }
    const target = this.deps.resolveTarget(packId);
    if (!target || (target.manifest as { id?: unknown }).id !== packId) {
      return { ok: false, fatal: false, error: { code: 'not-found', detail: { packId } } };
    }
    if (!/^[a-z][a-z0-9:._-]{0,63}$/.test(op)) {
      return { ok: false, fatal: false, error: { code: 'invalid', detail: { op } } };
    }
    const workdir = this.deps.workdir(packId);
    const entry = (target.manifest as { entry?: unknown }).entry;
    if (typeof entry !== 'string' || entry.length === 0) {
      return {
        ok: false,
        fatal: false,
        error: {
          code: 'invalid',
          detail: { reason: "Tier 2 requires a root 'entry' path; the pack is not runnable" },
        },
      };
    }
    const child = this.deps.spawn({
      modulePath: this.deps.childPath(),
      args: [
        '--protocol', SANDBOX_PROTOCOL,
        '--content-dir', target.contentPath,
        '--entry', entry,
        '--manifest-digest', target.manifestDigest,
        '--content-digest', target.contentDigest,
      ],
      cwd: workdir,
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: workdir },
      execArgv: [`--max-old-space-size=${limits.memoryMb}`],
    });
    const session = new SandboxSession(child, this.deps, target, limits);
    const row: SandboxRunRow = {
      id: session.runId,
      packId,
      digest: target.manifestDigest,
      pid: child.pid,
      op,
      outcome: 'completed',
      reason: null,
      startedAt: this.deps.now(),
      updatedAt: this.deps.now(),
      finishedAt: null,
    };
    await this.deps.store.createRun(row);
    this.liveCount += 1;
    this.liveByPack.set(packId, session);
    try {
      const output = await session.run(op, { config: target.config, args });
      await this.settle(session, row, 'completed');
      return { ok: true, result: { ...session.collect(), output } };
    } catch (error) {
      if (error instanceof InvokeFailed) {
        await this.settle(session, row, 'completed', `invoke error: ${error.envelope.code}`);
        return {
          ok: false,
          fatal: false,
          error: { code: error.envelope.code as PackError['code'], detail: { reason: error.envelope.detail, retryable: error.envelope.retryable } },
        };
      }
      const death = error instanceof SandboxDied ? error : new SandboxDied('crashed', 'the sandbox died');
      await this.settle(session, row, death.outcome, death.reason);
      if (death.outcome === 'killed') {
        return { ok: false, fatal: false, error: { code: 'canceled', detail: { reason: death.reason } } };
      }
      await this.deps.selfDisable(packId, death.reason);
      return { ok: false, fatal: true, outcome: death.outcome, reason: death.reason };
    } finally {
      this.liveCount -= 1;
      this.liveByPack.delete(packId);
    }
  }

  private async settle(session: SandboxSession, row: SandboxRunRow, outcome: SandboxOutcome, reason?: string): Promise<void> {
    if (outcome === 'completed') {
      await session.dispose();
    } else {
      session.process.kill();
    }
    await session.waitForExit().catch(() => undefined);
    await this.deps.store.closeRun(row.id, outcome, reason ?? null, this.deps.now());
  }
}
