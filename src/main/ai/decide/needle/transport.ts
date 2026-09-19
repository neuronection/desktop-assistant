import { utilityProcess } from 'electron';
import path from 'node:path';

export interface NeedleTransport {
  load(weightsPath: string): Promise<void>;
  init(systemPrompt: string, toolsJson: string): Promise<void>;
  complete(input: string, maxNewTokens?: number): Promise<string>;
  reset(): Promise<void>;
  dispose(): void;
}

export type NeedleTransportFactory = (resourceDir: string) => NeedleTransport;

type HostMessage = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ForkedHost {
  on(event: 'exit', listener: (code: number) => void): void;
  on(event: 'message', listener: (message: HostMessage) => void): void;
  postMessage(message: unknown): void;
  kill(): boolean;
}

export type ForkImpl = (modulePath: string) => ForkedHost;

const OP_TIMEOUT_MS = 30_000;

/**
 * The one engine instance is process-global and non-thread-safe in the
 * host, so every op is serialized through `queue` and every request has
 * a wall-clock timeout (D3; a wedged host never blocks a turn — the
 * caller falls through to the agent path).
 */
export class UtilityNeedleTransport implements NeedleTransport {
  private readonly child: ForkedHost;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private exited = false;
  private disposed = false;

  constructor(
    resourceDir: string,
    forkImpl: ForkImpl = (modulePath) => utilityProcess.fork(modulePath) as unknown as ForkedHost
  ) {
    this.child = forkImpl(path.join(resourceDir, 'host.cjs'));
    this.child.on('message', (message) => {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error(message.error));
      }
    });
    this.child.on('exit', (code) => {
      this.exited = true;
      if (!this.disposed) {
        console.error(`[needle] host process exited unexpectedly (code ${code})`);
      }
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Needle host process exited'));
      }
      this.pending.clear();
    });
  }

  private request(op: string, payload: Record<string, unknown>, timeoutMs = OP_TIMEOUT_MS): Promise<unknown> {
    const run = () =>
      new Promise<unknown>((resolve, reject) => {
        if (this.exited) {
          reject(new Error('Needle host process exited'));
          return;
        }
        const id = this.nextId++;
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Needle op ${op} timed out`));
        }, timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        this.child.postMessage({ id, op, payload });
      });
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  load(weightsPath: string): Promise<void> {
    return this.request('load', { weightsPath }) as Promise<void>;
  }

  init(systemPrompt: string, toolsJson: string): Promise<void> {
    return this.request('init', { systemPrompt, toolsJson }) as Promise<void>;
  }

  complete(input: string, maxNewTokens?: number): Promise<string> {
    return this.request('complete', { input, maxNewTokens }) as Promise<string>;
  }

  reset(): Promise<void> {
    return this.request('reset', {}) as Promise<void>;
  }

  dispose(): void {
    this.disposed = true;
    this.exited = true;
    this.child.kill();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Needle transport disposed'));
    }
    this.pending.clear();
  }
}

export const createUtilityNeedleTransport: NeedleTransportFactory = (resourceDir) =>
  new UtilityNeedleTransport(resourceDir);
