import { describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
const send = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();
const exposeInMainWorld = vi.fn();

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, send, on, removeListener },
}));

const { createPreloadApi } = await import('@preload/preload.generated');
const { IPC_REGISTRY } = await import('@shared/ipc/registry');

describe('preload bridge is derived from the registry (plan 44 S3)', () => {
  it('exposes every bridge method with the registry direction', () => {
    const api = createPreloadApi();
    for (const entry of IPC_REGISTRY) {
      if (!entry.bridge) {
        continue;
      }
      expect(typeof api[entry.bridge.method], entry.channel).toBe('function');
    }
  });

  it('invoke and send methods forward the channel and args', () => {
    const api = createPreloadApi();
    (api.fetchAvailableModels as (...args: unknown[]) => unknown)({ id: 'p' });
    expect(invoke).toHaveBeenCalledWith('ai:fetch-models', { id: 'p' });
    (api.livePhraseCommitted as (...args: unknown[]) => unknown)('hello');
    expect(send).toHaveBeenCalledWith('live:phrase-committed', 'hello');
  });

  it('event methods subscribe and return an unsubscribe closure', () => {
    const api = createPreloadApi();
    const callback = vi.fn();
    const unsubscribe = (api.onTurnEvent as (cb: (payload: unknown) => void) => () => void)(callback);
    expect(on).toHaveBeenCalledWith('ai:turn-event', expect.any(Function));
    const handler = on.mock.calls.at(-1)![1] as (event: unknown, payload: unknown) => void;
    handler({}, { phase: 'finished' });
    expect(callback).toHaveBeenCalledWith({ phase: 'finished' });
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith('ai:turn-event', expect.any(Function));
  });
});
