import { describe, it, expect, vi } from 'vitest';
import { ScheduleService, type ScheduleStore } from '@main/services/ScheduleService';
import { NATIVE_TOOL_CATALOG } from '@main/ai/tools/native';
import type { Schedule } from '@prisma/client';

type Row = Partial<Schedule> & {
  id: string;
  name: string;
  prompt: string;
  spec: unknown;
  timezone: string;
  enabled: boolean;
  lastRunAt: Date | null;
  lastOutcome: string | null;
  conversationId: string | null;
  createdAt: Date;
};

function row(overrides: Partial<Row>): Row {
  return {
    id: 's1',
    name: 'Briefing',
    prompt: 'Good morning — summarize my day.',
    spec: { kind: 'daily', time: '09:00' },
    timezone: 'America/New_York',
    enabled: true,
    lastRunAt: null,
    lastOutcome: null,
    conversationId: 'conv_1',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function fakeStore(initial: Row[]): { store: ScheduleStore; rows: Row[] } {
  const rows = initial;
  return {
    rows,
    store: {
      findMany: async () => rows,
      findUnique: async (id) => rows.find((candidate) => candidate.id === id) ?? null,
      create: async (data) => {
        const created = row({ id: 'new', ...data, lastRunAt: null, lastOutcome: null, createdAt: new Date() });
        rows.push(created);
        return created as Row;
      },
      update: async (id, patch) => {
        const target = rows.find((candidate) => candidate.id === id);
        if (!target) throw new Error('missing');
        Object.assign(target, patch);
        return target as Row;
      },
      remove: async (id) => {
        const index = rows.findIndex((candidate) => candidate.id === id);
        if (index !== -1) rows.splice(index, 1);
      },
    },
  };
}

interface Harness {
  service: ScheduleService;
  fired: { prompt: string; conversationId: string | null; scheduleId: string }[];
  timer: { callback: (() => void) | null; ms: number | null };
  setClock(ms: number): void;
}

function harness(initial: Row[], options: { isBusy?: () => boolean } = {}): Harness {
  const { store, rows } = fakeStore(initial);
  const fired: Harness['fired'] = [];
  const timer: Harness['timer'] = { callback: null, ms: null };
  let clock = Date.UTC(2026, 5, 15, 12, 0);
  const service = new ScheduleService({
    store,
    runTurn: async (prompt, conversationId, scheduleId) => {
      fired.push({ prompt, conversationId, scheduleId });
      return conversationId;
    },
    createConversation: async (title) => ({ id: `conv_${title}` }),
    now: () => clock,
    setTimer: (callback, ms) => {
      timer.callback = callback;
      timer.ms = ms;
      return timer;
    },
    clearTimer: () => {
      timer.callback = null;
      timer.ms = null;
    },
    delay: async () => undefined,
    isBusy: options.isBusy,
  });
  return {
    service,
    fired,
    timer,
    setClock: (ms: number) => {
      clock = ms;
    },
    ...({} as Record<string, never>),
    __rows: rows,
  } as Harness & { __rows: Row[] };
}

describe('ScheduleService wheel', () => {
  it('arms the wheel for the next due run', async () => {
    const h = harness([
      row({ createdAt: new Date(Date.UTC(2026, 5, 15, 11, 0)) }), // created an hour before the clock
    ]);
    await h.service.tick();
    // No lastRunAt → anchor is createdAt: today's 09:00 EDT (13:00Z) is still 1 h ahead.
    expect(h.timer.ms).toBe(3_600_000);
    expect(h.fired).toHaveLength(0);
  });

  it('fires a due schedule exactly once and re-arms (drift-tolerant)', async () => {
    const h = harness([row({ lastRunAt: new Date(Date.UTC(2026, 5, 15, 13, 0)) })]);
    h.setClock(Date.UTC(2026, 5, 16, 13, 0) + 5); // 5 ms past due — still fires, once.
    await h.service.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.fired).toHaveLength(1);
    expect(h.fired[0]).toMatchObject({ prompt: 'Good morning — summarize my day.', scheduleId: 's1' });
    await h.service.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.fired).toHaveLength(1);
  });

  it('run-once-on-boot: a long-offline schedule fires once, never a catch-up burst', async () => {
    const h = harness([row({ lastRunAt: new Date(Date.UTC(2026, 4, 1, 13, 0)) })]); // 6 weeks offline
    h.setClock(Date.UTC(2026, 5, 15, 12, 0));
    await h.service.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.fired).toHaveLength(1);
    const nextTick = async (): Promise<void> => {
      await h.service.tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await nextTick();
    await nextTick();
    expect(h.fired).toHaveLength(1);
  });

  it('disabled schedules never fire or arm the wheel', async () => {
    const h = harness([row({ enabled: false })]);
    await h.service.tick();
    expect(h.fired).toHaveLength(0);
    expect(h.timer.callback).toBeNull();
  });

  it('creates the dedicated conversation once and reuses it', async () => {
    const h = harness([row({ conversationId: null })]);
    h.setClock(Date.UTC(2026, 5, 16, 13, 1)); // just past due
    await h.service.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.fired[0].conversationId).toBe('conv_Schedule — Briefing');
  });

  it('waits for a busy turn manager before firing', async () => {
    let busy = true;
    const h = harness([row({})], { isBusy: () => busy });
    h.setClock(Date.UTC(2026, 5, 16, 13, 1));
    await h.service.tick();
    busy = false;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.fired).toHaveLength(1);
  });

  it('run-now does not touch lastRunAt math', async () => {
    const { service, fired } = harness([row({})]);
    await service.runNow('s1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fired).toHaveLength(1);
  });

  it('rejects invalid input on create', async () => {
    const { service } = harness([]);
    await expect(
      service.create({ name: 'x', prompt: 'p', spec: { kind: 'interval', minutes: 0 }, timezone: 'UTC' })
    ).rejects.toThrow(/Invalid schedule/);
    await expect(
      service.create({ name: 'x', prompt: 'p', spec: { kind: 'daily', time: '09:00' }, timezone: 'Bogus/Zone' })
    ).rejects.toThrow(/Unknown timezone/);
  });
});

describe('D4 — automation is user-authored only', () => {
  it('the model has no schedule tools', () => {
    const offenders = NATIVE_TOOL_CATALOG.filter(
      (tool) => tool.name.includes('schedule') || tool.name.includes('automation') || tool.category === ('automation' as never)
    );
    expect(offenders).toEqual([]);
  });
});
