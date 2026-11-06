import { randomUUID } from 'node:crypto';
import type { PrismaClient } from 'generated/prisma/client';
import type { NotifyRateSettings } from '@shared/types';
import type {
  NotificationClickAction,
  NotificationKind,
  NotificationSeverity,
} from '@shared/schema/vocab';
import { validateNotificationPayload } from '@shared/schema/notificationPayload';

export interface NotificationInput {
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  sourceRef?: string | null;
  clickAction?: NotificationClickAction;
  dedupeKey?: string;
  at?: number;
}

export interface NotificationRecord {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  sourceRef: string | null;
  clickAction: NotificationClickAction;
  dedupeKey: string;
  readAt: number | null;
  createdAt: number;
}

export interface NotificationResult {
  record: NotificationRecord | null;
  deduped: boolean;
  suppressed: boolean;
}

export interface NotificationRouteTarget {
  action: NotificationClickAction;
  sourceRef: string | null;
}

export interface NotificationRouteHandlers {
  openConversation(conversationId: string): void;
  openSettings(target: string | null): void;
  openPackReport(packId: string, runId: string): void;
  openPath(path: string): void;
}

export interface NotificationChange {
  reason: 'created' | 'deduped' | 'read' | 'cleared';
  record: NotificationRecord | null;
}

export interface NotificationServiceDeps {
  client(): PrismaClient;
  rate(): NotifyRateSettings;
  showToast?(record: NotificationRecord): void | Promise<void>;
  /** Broadcast seam (plan 42 S2): every create/dedupe/read/clear. */
  onChange?(change: NotificationChange): void;
  /** OS-toast click seam — routes through the one click router (D2). */
  onClick?(record: NotificationRecord): void;
  now?(): number;
  newId?(): string;
}

function toRecord(row: {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  payload: unknown;
  sourceRef: string | null;
  clickAction: string;
  dedupeKey: string;
  readAt: Date | null;
  createdAt: Date;
}): NotificationRecord {
  const payload = validateNotificationPayload(row.payload);
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    severity: row.severity as NotificationSeverity,
    title: row.title,
    body: row.body,
    payload,
    sourceRef: row.sourceRef,
    clickAction: row.clickAction as NotificationClickAction,
    dedupeKey: row.dedupeKey,
    readAt: row.readAt ? row.readAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
  };
}

export class NotificationService {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: NotificationServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? (() => randomUUID());
  }

  async notify(input: NotificationInput): Promise<NotificationResult> {
    const client = this.deps.client();
    const rate = this.deps.rate();
    const at = input.at ?? this.now();
    const clickAction = input.clickAction ?? 'none';
    const dedupeKey = input.dedupeKey?.trim() || `${input.kind}:${this.newId()}`;
    const payload = validateNotificationPayload({ ...(input.payload ?? {}), count: 1 });

    const existing = await client.notification.findUnique({ where: { dedupeKey } });
    if (existing) {
      const age = at - existing.createdAt.getTime();
      if (age <= rate.dedupeWindowMs) {
        const current = validateNotificationPayload(existing.payload);
        const count = typeof current.count === 'number' ? current.count : 1;
        const updated = await client.notification.update({
          where: { id: existing.id },
          data: {
            payload: validateNotificationPayload({ ...current, ...(input.payload ?? {}), count: count + 1 }) as never,
            readAt: null,
          },
        });
        const record = toRecord(updated);
        this.emit({ reason: 'deduped', record });
        return { record, deduped: true, suppressed: false };
      }
      await client.notification.delete({ where: { id: existing.id } });
    }

    const windowStart = new Date(at - rate.windowMs);
    const recent = await client.notification.count({
      where: {
        kind: input.kind,
        createdAt: { gte: windowStart },
        ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
      },
    });
    if (recent >= rate.maxPerWindow) {
      return { record: null, deduped: false, suppressed: true };
    }

    const row = await client.notification.create({
      data: {
        id: this.newId(),
        kind: input.kind,
        severity: input.severity,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 2000),
        payload: payload as never,
        sourceRef: input.sourceRef ?? null,
        clickAction,
        dedupeKey,
        createdAt: new Date(at),
      },
    });
    const record = toRecord(row);
    await this.show(record);
    this.emit({ reason: 'created', record });
    return { record, deduped: false, suppressed: false };
  }

  private emit(change: NotificationChange): void {
    this.deps.onChange?.(change);
  }

  private async show(record: NotificationRecord): Promise<void> {
    if (this.deps.showToast) {
      await this.deps.showToast(record);
      return;
    }
    try {
      const { Notification } = await import('electron');
      if (Notification.isSupported()) {
        const notification = new Notification({ title: record.title, body: record.body });
        notification.on('click', () => this.deps.onClick?.(record));
        notification.show();
      }
    } catch (error) {
      console.error('Notification display failed:', error);
    }
  }

  async list(limit = 50): Promise<NotificationRecord[]> {
    const rows = await this.deps.client().notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map(toRecord);
  }

  async get(id: string): Promise<NotificationRecord | null> {
    const row = await this.deps.client().notification.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async markRead(id: string): Promise<boolean> {
    const result = await this.deps.client().notification.updateMany({
      where: { id, readAt: null },
      data: { readAt: new Date(this.now()) },
    });
    if (result.count > 0) {
      this.emit({ reason: 'read', record: null });
    }
    return result.count > 0;
  }

  async markAllRead(): Promise<number> {
    const result = await this.deps.client().notification.updateMany({
      where: { readAt: null },
      data: { readAt: new Date(this.now()) },
    });
    if (result.count > 0) {
      this.emit({ reason: 'read', record: null });
    }
    return result.count;
  }

  /** Delete the whole inbox history (plan 42 S2 "clear"). */
  async clear(): Promise<number> {
    const result = await this.deps.client().notification.deleteMany({});
    this.emit({ reason: 'cleared', record: null });
    return result.count;
  }

  /** Unread `warn`/`error` rows — exactly what the tray badge counts (D3). */
  async unreadBadgeCount(): Promise<number> {
    return this.deps.client().notification.count({
      where: { readAt: null, severity: { in: ['warn', 'error'] } },
    });
  }
}

export function resolveNotificationRoute(record: Pick<NotificationRecord, 'clickAction' | 'sourceRef'>): NotificationRouteTarget {
  return { action: record.clickAction, sourceRef: record.sourceRef };
}

export function routeNotification(
  record: Pick<NotificationRecord, 'clickAction' | 'sourceRef'>,
  handlers: NotificationRouteHandlers
): boolean {
  const source = record.sourceRef;
  switch (record.clickAction) {
    case 'open-conversation':
      if (!source) return false;
      handlers.openConversation(source);
      return true;
    case 'open-settings':
      handlers.openSettings(source);
      return true;
    case 'open-pack-report': {
      if (!source) return false;
      try {
        const parsed = JSON.parse(source) as { packId?: unknown; runId?: unknown };
        if (typeof parsed.packId === 'string' && typeof parsed.runId === 'string') {
          handlers.openPackReport(parsed.packId, parsed.runId);
          return true;
        }
      } catch {
        return false;
      }
      return false;
    }
    case 'open-path':
      if (!source) return false;
      handlers.openPath(source);
      return true;
    default:
      return false;
  }
}

let shared: NotificationService | null = null;

export function setNotificationServiceProvider(service: NotificationService | null): void {
  shared = service;
}

export async function notifyUser(input: NotificationInput): Promise<NotificationResult | null> {
  return shared ? shared.notify(input) : null;
}
