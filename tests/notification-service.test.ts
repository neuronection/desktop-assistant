import { describe, expect, it, vi } from 'vitest';
import {
  NotificationService,
  type NotificationRecord,
  routeNotification,
} from '@main/services/NotificationService';
import type { NotifyRateSettings } from '@shared/types';

interface Row {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  sourceRef: string | null;
  clickAction: string;
  dedupeKey: string;
  readAt: Date | null;
  createdAt: Date;
}

function fakeClient() {
  const rows = new Map<string, Row>();
  let ids = 0;
  const client = {
    notification: {
      findUnique: vi.fn(async ({ where }: { where: { dedupeKey: string } }) =>
        [...rows.values()].find((row) => row.dedupeKey === where.dedupeKey) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Omit<Row, 'readAt'> & { readAt?: Date | null } }) => {
        const row = { ...data, readAt: data.readAt ?? null };
        rows.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const current = rows.get(where.id)!;
        const next = { ...current, ...data };
        rows.set(where.id, next);
        return next;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        rows.delete(where.id);
      }),
      count: vi.fn(async ({ where }: { where: { kind: string; sourceRef?: string; createdAt: { gte: Date } } }) =>
        [...rows.values()].filter(
          (row) =>
            row.kind === where.kind &&
            (where.sourceRef === undefined || row.sourceRef === where.sourceRef) &&
            row.createdAt >= where.createdAt.gte
        ).length
      ),
      findMany: vi.fn(async () => [...rows.values()]),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return { client: client as never, rows, nextId: () => `n-${++ids}` };
}

const RATE: NotifyRateSettings = { windowMs: 60_000, maxPerWindow: 2, dedupeWindowMs: 300_000 };

function makeService(at = 1_000_000) {
  const db = fakeClient();
  let now = at;
  const showToast = vi.fn(() => undefined);
  const service = new NotificationService({
    client: () => db.client,
    rate: () => RATE,
    showToast,
    now: () => now,
    newId: db.nextId,
  });
  return { service, db, showToast, setNow: (next: number) => (now = next) };
}

describe('NotificationService (plan 42 S1)', () => {
  it('dedupes one key inside the window and bumps count', async () => {
    const h = makeService();
    const first = await h.service.notify({ kind: 'system', severity: 'info', title: 'A', body: 'B', dedupeKey: 'k' });
    expect(first.deduped).toBe(false);
    const second = await h.service.notify({ kind: 'system', severity: 'info', title: 'A', body: 'B', dedupeKey: 'k' });
    expect(second.deduped).toBe(true);
    expect(h.db.rows.size).toBe(1);
    expect([...h.db.rows.values()][0].payload.count).toBe(2);
    expect(h.showToast).toHaveBeenCalledTimes(1);
  });

  it('starts a new row after the dedupe window and resets count', async () => {
    const h = makeService();
    await h.service.notify({ kind: 'system', severity: 'info', title: 'A', body: 'B', dedupeKey: 'k' });
    h.setNow(1_000_000 + RATE.dedupeWindowMs + 1);
    const second = await h.service.notify({ kind: 'system', severity: 'info', title: 'A', body: 'B', dedupeKey: 'k' });
    expect(second.deduped).toBe(false);
    expect(h.db.rows.size).toBe(1);
    expect([...h.db.rows.values()][0].payload.count).toBe(1);
  });

  it('rate-limits per source and never inserts the suppressed row', async () => {
    const h = makeService();
    await h.service.notify({ kind: 'pack-run', severity: 'info', title: 'A', body: 'B', sourceRef: 'pack:1' });
    await h.service.notify({ kind: 'pack-run', severity: 'info', title: 'A', body: 'B', sourceRef: 'pack:1' });
    const third = await h.service.notify({ kind: 'pack-run', severity: 'info', title: 'A', body: 'B', sourceRef: 'pack:1' });
    expect(third.suppressed).toBe(true);
    expect(third.record).toBeNull();
    expect(h.db.rows.size).toBe(2);
    expect(h.showToast).toHaveBeenCalledTimes(2);
  });

  it('routes the closed click-action table', () => {
    const handlers = {
      openConversation: vi.fn(),
      openSettings: vi.fn(),
      openPackReport: vi.fn(),
      openPath: vi.fn(),
    };
    const record = (clickAction: NotificationRecord['clickAction'], sourceRef: string | null = null) =>
      ({ clickAction, sourceRef }) as Pick<NotificationRecord, 'clickAction' | 'sourceRef'>;

    expect(routeNotification(record('none'), handlers)).toBe(false);
    expect(routeNotification(record('open-conversation', 'conv-1'), handlers)).toBe(true);
    expect(handlers.openConversation).toHaveBeenCalledWith('conv-1');
    expect(routeNotification(record('open-settings', 'apps'), handlers)).toBe(true);
    expect(handlers.openSettings).toHaveBeenCalledWith('apps');
    expect(routeNotification(record('open-pack-report', JSON.stringify({ packId: 'p', runId: 'r' })), handlers)).toBe(true);
    expect(handlers.openPackReport).toHaveBeenCalledWith('p', 'r');
    expect(routeNotification(record('open-path', '/tmp/file'), handlers)).toBe(true);
    expect(handlers.openPath).toHaveBeenCalledWith('/tmp/file');
    expect(routeNotification(record('open-conversation', null), handlers)).toBe(false);
    expect(routeNotification(record('open-pack-report', '{bad'), handlers)).toBe(false);
  });
});
