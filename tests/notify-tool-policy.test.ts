import { describe, expect, it } from 'vitest';
import { notifyTool } from '@main/ai/tools/native/notify';
import {
  NotificationService,
  setNotificationServiceProvider,
} from '@main/services/NotificationService';
import { ToolPolicyEngine } from '@main/ai/tools/policy';
import type { NotifyRateSettings } from '@shared/types';

const RATE: NotifyRateSettings = { windowMs: 60_000, maxPerWindow: 10, dedupeWindowMs: 300_000 };

function service(): NotificationService {
  let id = 0;
  return new NotificationService({
    client: () =>
      ({
        notification: {
          findUnique: async () => null,
          create: async ({ data }: { data: Record<string, unknown> }) => ({
            ...data,
            readAt: null,
          }),
          update: async () => null,
          delete: async () => undefined,
          count: async () => 0,
          findMany: async () => [],
          updateMany: async () => ({ count: 0 }),
        },
      }) as never,
    rate: () => RATE,
    showToast: () => undefined,
    now: () => 1_000_000,
    newId: () => `notify-${++id}`,
  });
}

function policy(disabledTools: string[] = []): ToolPolicyEngine {
  return new ToolPolicyEngine(() => ({
    toolGrants: {},
    disabledTools,
    grantedRoots: [],
    toolSettings: {},
    classDefaults: {},
  }));
}

describe('notify tool policy mapping (plan 42 S3)', () => {
  it('is informational — read-only, so it runs with no approval card', () => {
    expect(notifyTool.risk).toBe('read-only');
    expect(policy().decision('notify', notifyTool.risk)).toBe('run');
    expect(policy().needsApproval('notify', notifyTool.risk)).toBe(false);
  });

  it('is kill-switchable like every tool', () => {
    expect(policy(['notify']).decision('notify', notifyTool.risk)).toBe('deny');
  });

  it('executes through NotificationService and reports the record id', async () => {
    setNotificationServiceProvider(service());
    try {
      const output = await notifyTool.exec({ title: 'Heads up', body: 'The build is done.' });
      expect(output).toMatch(/Notification shown \(id: notify-\d+\)\./);
    } finally {
      setNotificationServiceProvider(null);
    }
  });
});
