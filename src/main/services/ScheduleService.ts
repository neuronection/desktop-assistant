import type { Schedule } from '@prisma/client';
import {
  computeNextRun,
  isValidScheduleSpec,
  isValidTimezone,
  scheduleRowToView,
  type ScheduleInput,
  type ScheduleSpec,
  type ScheduleView,
} from '@shared/schedules';

export type { ScheduleInput, ScheduleView };

export interface ScheduleStore {
  findMany(): Promise<Schedule[]>;
  findUnique(id: string): Promise<Schedule | null>;
  create(data: { name: string; prompt: string; spec: ScheduleSpec; timezone: string; enabled: boolean }): Promise<Schedule>;
  update(
    id: string,
    data: Partial<{
      name: string;
      prompt: string;
      spec: ScheduleSpec;
      timezone: string;
      enabled: boolean;
      lastRunAt: Date | null;
      lastOutcome: string | null;
      conversationId: string | null;
    }>
  ): Promise<Schedule>;
  remove(id: string): Promise<void>;
}

export interface ScheduleServiceDeps {
  store: ScheduleStore;
  /** Fires a scheduled prompt; resolves to the conversation it ran in. */
  runTurn(prompt: string, conversationId: string | null, scheduleId: string): Promise<string | null>;
  createConversation(title: string): Promise<{ id: string }>;
  /** Injectable clock (tests). */
  now?(): number;
  /** Injectable timer — mirrors setTimeout semantics (tests). */
  setTimer?(callback: () => void, ms: number): unknown;
  clearTimer?(timer: unknown): void;
  /** Injectable inter-turn wait for the busy retry loop (tests). */
  delay?(ms: number): Promise<void>;
  /** True while the main TurnManager is mid-turn (schedules wait their turn). */
  isBusy?(): boolean;
}

const BUSY_RETRY_MS = 2_000;
const BUSY_RETRY_CAP = 150;

/**
 * Main-process scheduler (plan 12 §4): CRUD over the `Schedule` table
 * plus a single-timer wheel. Missed runs fire ONCE on boot (or on the
 * next tick) — never a catch-up burst. The model has no schedule tools
 * (D4): only this service and the Settings UI create or edit rows.
 */
export class ScheduleService {
  private timer: unknown = null;
  private running = false;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(private readonly deps: ScheduleServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.delay = deps.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async list(): Promise<ScheduleView[]> {
    const rows = await this.deps.store.findMany();
    const nowMs = this.now();
    return rows.map((row) => scheduleRowToView(row, nowMs));
  }

  async create(input: ScheduleInput): Promise<ScheduleView> {
    this.assertValid(input);
    const created = await this.deps.store.create({
      name: input.name.trim() || input.prompt.slice(0, 40),
      prompt: input.prompt,
      spec: input.spec,
      timezone: input.timezone,
      enabled: input.enabled ?? true,
    });
    const view = scheduleRowToView(created, this.now());
    this.scheduleNext();
    return view;
  }

  async update(id: string, patch: Partial<ScheduleInput> & { enabled?: boolean }): Promise<ScheduleView> {
    const existing = await this.deps.store.findUnique(id);
    if (!existing) {
      throw new Error(`Schedule '${id}' does not exist.`);
    }
    const merged: ScheduleInput = {
      name: patch.name ?? existing.name,
      prompt: patch.prompt ?? existing.prompt,
      spec: (patch.spec ?? existing.spec) as ScheduleSpec,
      timezone: patch.timezone ?? existing.timezone,
    };
    this.assertValid(merged);
    const updated = await this.deps.store.update(id, {
      ...merged,
      enabled: patch.enabled ?? existing.enabled,
      lastRunAt: patch.spec || patch.timezone ? null : existing.lastRunAt,
    });
    const view = scheduleRowToView(updated, this.now());
    this.scheduleNext();
    return view;
  }

  async remove(id: string): Promise<void> {
    await this.deps.store.remove(id);
    this.scheduleNext();
  }

  /** Manual run-now: does not touch lastRunAt (schedule math unaffected). */
  async runNow(id: string): Promise<boolean> {
    const row = await this.deps.store.findUnique(id);
    if (!row) {
      throw new Error(`Schedule '${id}' does not exist.`);
    }
    void this.fire(row, { recordRun: false });
    return true;
  }

  start(): void {
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private assertValid(input: ScheduleInput): void {
    if (!input.prompt.trim()) {
      throw new Error('A schedule needs a prompt.');
    }
    if (!isValidScheduleSpec(input.spec)) {
      throw new Error('Invalid schedule specification.');
    }
    if (!isValidTimezone(input.timezone)) {
      throw new Error(`Unknown timezone: ${input.timezone}`);
    }
  }

  /** One scheduler pass: fire everything due exactly once, re-arm the wheel. */
  async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const rows = await this.deps.store.findMany();
      const nowMs = this.now();
      for (const row of rows) {
        if (!row.enabled || !isValidScheduleSpec(row.spec as unknown as ScheduleSpec)) {
          continue;
        }
        const spec = row.spec as unknown as ScheduleSpec;
        const anchor = row.lastRunAt?.getTime() ?? row.createdAt.getTime();
        const due = computeNextRun(spec, row.timezone, anchor);
        if (due !== null && due <= nowMs) {
          await this.deps.store.update(row.id, { lastRunAt: new Date(nowMs), lastOutcome: 'queued' });
          void this.fire({ ...row, lastRunAt: new Date(nowMs) }, { recordRun: true });
        }
      }
    } finally {
      this.running = false;
      this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    this.stop();
    void this.arm();
  }

  private async arm(): Promise<void> {
    try {
      const rows = await this.deps.store.findMany();
      const nowMs = this.now();
      let nearest = Number.POSITIVE_INFINITY;
      for (const row of rows) {
        if (!row.enabled) {
          continue;
        }
        const spec = row.spec as unknown as ScheduleSpec;
        if (!isValidScheduleSpec(spec)) {
          continue;
        }
        const next = computeNextRun(spec, row.timezone, row.lastRunAt?.getTime() ?? nowMs);
        if (next !== null && next < nearest) {
          nearest = next;
        }
      }
      if (nearest !== Number.POSITIVE_INFINITY) {
        this.timer = this.setTimer(() => void this.tick(), Math.max(0, nearest - nowMs));
      }
    } catch (error) {
      console.error('Schedule wheel failed to arm:', error);
    }
  }

  private async fire(row: Schedule, options: { recordRun: boolean }): Promise<void> {
    try {
      let conversationId = row.conversationId;
      if (!conversationId) {
        conversationId = (await this.deps.createConversation(`Schedule — ${row.name}`)).id;
        await this.deps.store.update(row.id, { conversationId });
      }
      await this.waitForIdle();
      await this.deps.runTurn(row.prompt, conversationId, row.id);
      await this.deps.store.update(row.id, { lastOutcome: 'ok' });
    } catch (error) {
      console.error(`Scheduled run for '${row.name}' failed:`, error);
      await this.deps.store.update(row.id, { lastOutcome: `failed: ${(error as Error).message}`.slice(0, 200) }).catch(() => undefined);
    } finally {
      if (options.recordRun) {
        this.scheduleNext();
      }
    }
  }

  /** One turn at a time: wait until the main TurnManager is idle. */
  private async waitForIdle(): Promise<void> {
    for (let attempt = 0; attempt < BUSY_RETRY_CAP && (this.deps.isBusy?.() ?? false); attempt += 1) {
      await this.delay(BUSY_RETRY_MS);
    }
  }
}
