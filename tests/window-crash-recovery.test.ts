import { describe, it, expect, vi } from 'vitest';
import { attachRenderCrashRecovery } from '@main/windowCrash';

vi.mock('@main/services/NotificationService', () => ({
  notifyUser: vi.fn(async () => ({ record: null, deduped: false, suppressed: false })),
}));

import { notifyUser } from '@main/services/NotificationService';

interface FakeWindow {
  fire: (details: { reason: string; exitCode: number }) => void;
  setDestroyed: () => void;
}

describe('attachRenderCrashRecovery (plan 46 S1)', () => {
  it('recreates a persistent window and notifies the user per crash', async () => {
    const recreate = vi.fn(async () => undefined);
    const { fire } = recoverable({ role: 'launcher', recreate });
    fire({ reason: 'crashed', exitCode: -1 });
    await vi.waitFor(() => expect(recreate).toHaveBeenCalledTimes(1));
    expect(notifyUser).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'system',
      severity: 'error',
      dedupeKey: 'renderer-crash:launcher',
    }));
  });

  it('does not recreate or notify transient windows', () => {
    const { fire } = recoverable({ role: 'result' });
    fire({ reason: 'crashed', exitCode: -1 });
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('is inert when the window object is already destroyed', () => {
    const recreate = vi.fn();
    const { fire, setDestroyed } = recoverable({ role: 'settings', recreate });
    setDestroyed();
    fire({ reason: 'crashed', exitCode: -1 });
    expect(recreate).not.toHaveBeenCalled();
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('logs the role, reason and exit code', () => {
    const errors: unknown[][] = [];
    const { fire } = recoverable({ role: 'desktop' }, { error: (...args: unknown[]) => errors.push(args) });
    fire({ reason: 'oom', exitCode: 137 });
    const line = String(errors[0]?.[0] ?? '');
    expect(line).toContain('[render-process-gone:desktop]');
    expect(line).toContain('oom');
    expect(line).toContain('137');
  });

  it('a failing recreation is caught and logged, never thrown', async () => {
    const errors: unknown[][] = [];
    const recreate = vi.fn(async () => {
      throw new Error('recreate boom');
    });
    const { fire } = recoverable({ role: 'launcher', recreate }, { error: (...args: unknown[]) => errors.push(args) });
    fire({ reason: 'crashed', exitCode: -1 });
    await vi.waitFor(() => expect(errors.some((entry) => String(entry[0]).includes('recreation failed'))).toBe(true));
  });
});

function recoverable(
  options: Parameters<typeof attachRenderCrashRecovery>[1],
  log?: Pick<Console, 'error'>
): FakeWindow {
  let handler: ((event: unknown, details: { reason: string; exitCode: number }) => void) | null = null;
  const state = { isDestroyed: false };
  const webContents = {
    on: (_event: string, registered: (event: unknown, details: { reason: string; exitCode: number }) => void) => {
      handler = registered;
    },
  };
  const browserWindow = {
    isDestroyed: () => state.isDestroyed,
    webContents,
  } as never;
  attachRenderCrashRecovery(browserWindow, { ...options, log: log ?? { error: () => undefined } });
  return {
    fire: (details) => handler?.(null, details),
    setDestroyed: () => {
      state.isDestroyed = true;
    },
  };
}
