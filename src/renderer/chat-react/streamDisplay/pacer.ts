import { completeWordUnits } from '@shared/text/segment';

export interface StreamSegment {
  id: number;
  text: string;
}

export interface StreamPacerOptions {
  /** Commit cadence window — the display never commits faster than this. */
  tickMs?: number;
  /** Backlog budget; a burst beyond it commits larger units to shed lag. */
  lagBudgetMs?: number;
  charsPerWord?: number;
  now?: () => number;
}

const DEFAULT_LAG_BUDGET_MS = 300;
const DEFAULT_CHARS_PER_WORD = 5.5;
const MAX_UNITS_PER_COMMIT = 6;
const MAX_UNITS_PER_LAG_COMMIT = 8;
const MIN_LAG_BUDGET_CHARS = 24;

export const TICK_MS = 100;

/**
 * Turn raw stream text into paced display units (plan 56 V2). Deltas arrive
 * at provider-token granularity and are never displayed as such: they buffer
 * until complete word units form, and commits release them at a bounded
 * cadence in word→phrase units sized by the observed arrival rate. The
 * invariant `committed + pending === received` holds at all times (lossless),
 * and `flush` releases the remainder at stream end.
 */
export class StreamPacer {
  private readonly tickMs: number;
  private readonly lagBudgetMs: number;
  private readonly charsPerWord: number;
  private readonly now: () => number;
  private receivedText = '';
  private committedText = '';
  private segmentId = 0;
  private arrivalRate = 0.05;
  private lastArrivalAt: number | null = null;

  constructor(options: StreamPacerOptions = {}) {
    this.tickMs = options.tickMs ?? TICK_MS;
    this.lagBudgetMs = options.lagBudgetMs ?? DEFAULT_LAG_BUDGET_MS;
    this.charsPerWord = options.charsPerWord ?? DEFAULT_CHARS_PER_WORD;
    this.now = options.now ?? Date.now;
  }

  get received(): string {
    return this.receivedText;
  }

  get committed(): string {
    return this.committedText;
  }

  get pending(): string {
    return this.receivedText.slice(this.committedText.length);
  }

  get rateCharsPerMs(): number {
    return this.arrivalRate;
  }

  reset(): void {
    this.receivedText = '';
    this.committedText = '';
    this.segmentId = 0;
    this.arrivalRate = 0.05;
    this.lastArrivalAt = null;
  }

  /** Feed the full accumulated stream text; only the new suffix is buffered. */
  push(value: string): void {
    if (!value.startsWith(this.receivedText)) {
      this.reset();
    }
    const delta = value.slice(this.receivedText.length);
    if (!delta) {
      return;
    }
    const at = this.now();
    if (this.lastArrivalAt !== null && this.receivedText.length > 0) {
      const elapsed = Math.max(1, at - this.lastArrivalAt);
      const instant = delta.length / elapsed;
      this.arrivalRate = this.arrivalRate * 0.8 + instant * 0.2;
    }
    this.lastArrivalAt = at;
    this.receivedText = value;
  }

  /** Commit at most one paced unit of complete words; [] when nothing is due. */
  tick(): StreamSegment[] {
    const scan = completeWordUnits(this.pending);
    if (scan.complete.length === 0) {
      return [];
    }
    const wordsPerSecond = (this.arrivalRate * 1000) / this.charsPerWord;
    const wordsPerTick = wordsPerSecond * (this.tickMs / 1000);
    let take = Math.min(MAX_UNITS_PER_COMMIT, Math.max(1, Math.ceil(wordsPerTick)));
    const lagBudget = Math.max(MIN_LAG_BUDGET_CHARS, this.arrivalRate * this.lagBudgetMs);
    if (this.pending.length > lagBudget) {
      take = Math.min(MAX_UNITS_PER_LAG_COMMIT, take * 2);
    }
    return this.commit(scan.complete.slice(0, take).join(''));
  }

  /** Release the remainder (including a partial trailing word) at stream end. */
  flush(): StreamSegment[] {
    return this.commit(this.pending);
  }

  private commit(text: string): StreamSegment[] {
    if (!text) {
      return [];
    }
    this.committedText += text;
    this.segmentId += 1;
    return [{ id: this.segmentId, text }];
  }
}
