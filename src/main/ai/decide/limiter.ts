/**
 * The ONE decision concurrency limiter (plan 26 S3, directive: wrap the
 * funnel — never a second limiter beside it). Every `runDecision` caller
 * — interactive (tool dispatch, gates) and background (mini-app runs) —
 * shares these slots; interactive requests are served first when a slot
 * frees, so background assessment runs yield to chat/voice.
 */

export type DecisionPriority = 'interactive' | 'background';

interface Waiter {
  priority: DecisionPriority;
  release: () => void;
}

export class DecisionLimiter {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(readonly slots: number) {}

  get activeCount(): number {
    return this.active;
  }

  get waitingCount(): number {
    return this.waiters.length;
  }

  private takeIfFree(): boolean {
    if (this.active < this.slots) {
      this.active += 1;
      return true;
    }
    return false;
  }

  private serveNext(): void {
    if (this.active >= this.slots || this.waiters.length === 0) {
      return;
    }
    const index = this.waiters.findIndex((waiter) => waiter.priority === 'interactive');
    const next = this.waiters.splice(index >= 0 ? index : 0, 1)[0];
    this.active += 1;
    next.release();
  }

  acquire(priority: DecisionPriority): Promise<() => void> {
    if (this.takeIfFree()) {
      return Promise.resolve(() => this.releaseOne());
    }
    return new Promise((resolve) => {
      this.waiters.push({
        priority,
        release: () => resolve(() => this.releaseOne()),
      });
    });
  }

  private releaseOne(): void {
    this.active = Math.max(0, this.active - 1);
    this.serveNext();
  }
}

const DEFAULT_SLOTS = 4;

const defaultLimiter = new DecisionLimiter(DEFAULT_SLOTS);

export async function withDecisionSlot<T>(priority: DecisionPriority, run: () => Promise<T>): Promise<T> {
  const release = await defaultLimiter.acquire(priority);
  try {
    return await run();
  } finally {
    release();
  }
}

/** The funnel's slot count — callers derive their concurrency from the ONE limiter (plan 28 D3). */
export function decisionSlots(): number {
  return defaultLimiter.slots;
}
