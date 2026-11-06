import type { PrismaClient } from 'generated/prisma/client';
import type {
  AppInstanceKind,
  AppInstanceStatus,
  AppInstanceStatusView,
} from '@shared/status';

export interface AppInstanceStatusInput {
  appId: string;
  kind: AppInstanceKind;
  status: AppInstanceStatus;
  error?: string | null;
  at?: number;
}

const CONDITION_FREE = [] as const;

function toView(row: {
  status: string;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  lastError: string | null;
}): AppInstanceStatusView {
  return {
    status: row.status as AppInstanceStatus,
    lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.getTime() : null,
    lastFailureAt: row.lastFailureAt ? row.lastFailureAt.getTime() : null,
    consecutiveFailures: row.consecutiveFailures,
    lastError: row.lastError,
    conditions: [...CONDITION_FREE],
  };
}

export class AppInstanceStatusService {
  constructor(private readonly client: () => PrismaClient) {}

  async record(input: AppInstanceStatusInput): Promise<void> {
    const at = new Date(input.at ?? Date.now());
    const existing = await this.client().appInstanceStatus.findUnique({
      where: { appId_kind: { appId: input.appId, kind: input.kind } },
    });
    const base = {
      lastSuccessAt: existing?.lastSuccessAt ?? null,
      lastFailureAt: existing?.lastFailureAt ?? null,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      lastError: input.error ?? null,
    };
    if (input.status === 'ok') {
      base.lastSuccessAt = at;
      base.consecutiveFailures = 0;
      base.lastError = null;
    } else if (input.status === 'failing') {
      base.lastFailureAt = at;
      base.consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;
      base.lastError = input.error ?? existing?.lastError ?? null;
    } else if (input.error !== undefined) {
      base.lastError = input.error;
    }
    await this.client().appInstanceStatus.upsert({
      where: { appId_kind: { appId: input.appId, kind: input.kind } },
      create: { appId: input.appId, kind: input.kind, status: input.status, ...base },
      update: { status: input.status, ...base },
    });
  }

  async get(appId: string, kind: AppInstanceKind): Promise<AppInstanceStatusView | null> {
    const row = await this.client().appInstanceStatus.findUnique({
      where: { appId_kind: { appId, kind } },
    });
    return row ? toView(row) : null;
  }

  async list(kind: AppInstanceKind): Promise<Map<string, AppInstanceStatusView>> {
    const rows = await this.client().appInstanceStatus.findMany({ where: { kind } });
    return new Map(rows.map((row) => [row.appId, toView(row)]));
  }
}
