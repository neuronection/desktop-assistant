import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createIpcRegistrar, scopeFromUrl } from '@main/ipc/register';
import type { IpcDescriptor } from '@shared/ipc/registry';
import { IPC, IPC_CHANNELS, IPC_REGISTRY } from '@shared/ipc/registry';
import { parseIpcError } from '@shared/ipc/errors';

interface Call {
  channel: string;
  listener: (event: unknown, ...args: unknown[]) => unknown;
}

function fakeIpc(): {
  ipc: {
    handle: (channel: string, listener: Call['listener']) => void;
    on: (channel: string, listener: Call['listener']) => void;
    removeHandler: (channel: string) => void;
    removeAllListeners: (channel: string) => void;
  };
  handlers: Map<string, Call['listener']>;
  listeners: Map<string, Call['listener']>;
  removed: string[];
} {
  const handlers = new Map<string, Call['listener']>();
  const listeners = new Map<string, Call['listener']>();
  const removed: string[] = [];
  return {
    ipc: {
      handle: (channel, listener) => handlers.set(channel, listener),
      on: (channel, listener) => listeners.set(channel, listener),
      removeHandler: (channel) => {
        removed.push(channel);
        handlers.delete(channel);
      },
      removeAllListeners: (channel) => {
        removed.push(channel);
        listeners.delete(channel);
      },
    },
    handlers,
    listeners,
    removed,
  };
}

const settingsEvent = { sender: { getURL: () => 'http://localhost:3300/settings.html' } };
const launcherEvent = { sender: { getURL: () => 'http://localhost:3300/' } };

describe('IPC registry + register wrapper (plan 44 S1)', () => {
  it('registers every descriptor exactly once and keeps directions explicit', () => {
    const channels = IPC_REGISTRY.map((entry) => entry.channel);
    expect(new Set(channels).size).toBe(channels.length);
    expect(IPC_CHANNELS).toHaveLength(IPC_REGISTRY.length);
    expect(Object.keys(IPC)).toHaveLength(IPC_REGISTRY.length);
    expect(IPC_REGISTRY.some((entry) => entry.direction === 'event')).toBe(true);
    expect(IPC_REGISTRY.some((entry) => entry.direction === 'send')).toBe(true);
    expect(IPC_REGISTRY.every((entry) => entry.scope.length > 0)).toBe(true);
    expect(IPC_REGISTRY.filter((entry) => entry.direction !== 'event').every((entry) => entry.bridge)).toBe(true);
  });

  it('validates args through the descriptor and rejects with the typed vocabulary', async () => {
    const { ipc, handlers } = fakeIpc();
    const registrar = createIpcRegistrar({ ipc, scopeOf: () => 'settings' });
    const entry: IpcDescriptor = {
      channel: 'test:invoke',
      direction: 'invoke',
      scope: ['all'],
      group: 'test',
      request: z.tuple([z.string().min(1)]),
      response: z.unknown(),
      summary: 'test',
    };
    const handler = vi.fn(async (_event, text: string) => `echo:${text}`);
    registrar.register(entry, handler);

    const invoke = handlers.get('test:invoke')!;
    await expect(invoke(settingsEvent, 'hello')).resolves.toBe('echo:hello');
    await expect(invoke(settingsEvent, '')).rejects.toThrow(/ipc:invalid_args/);
    await expect(invoke(settingsEvent, 42)).rejects.toThrow(/ipc:invalid_args/);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('enforces window scope at invoke time and allows the declared window', async () => {
    const { ipc, handlers } = fakeIpc();
    const registrar = createIpcRegistrar({ ipc, scopeOf: (event) => scopeFromUrl((event as typeof settingsEvent).sender.getURL()) });
    const entry: IpcDescriptor = {
      channel: 'provider:add',
      direction: 'invoke',
      scope: ['settings'],
      group: 'providers',
      request: z.tuple([]),
      response: z.unknown(),
      summary: 'test',
    };
    registrar.register(entry, async () => 'ok');
    const invoke = handlers.get('provider:add')!;
    await expect(invoke(launcherEvent)).rejects.toThrow(/ipc:scope_denied/);
    await expect(invoke(settingsEvent)).resolves.toBe('ok');
  });

  it('wraps handler failures in the same typed vocabulary', async () => {
    const { ipc, handlers } = fakeIpc();
    const registrar = createIpcRegistrar({ ipc, scopeOf: () => 'launcher' });
    const entry: IpcDescriptor = {
      channel: 'test:boom',
      direction: 'invoke',
      scope: ['all'],
      group: 'test',
      request: z.tuple([]),
      response: z.unknown(),
      summary: 'test',
    };
    registrar.register(entry, async () => {
      throw new Error('provider exploded');
    });
    const invoke = handlers.get('test:boom')!;
    await expect(invoke(launcherEvent)).rejects.toThrow(/ipc:handler_error: provider exploded/);
    try {
      await invoke(launcherEvent);
    } catch (error) {
      expect(parseIpcError((error as Error).message)).toMatchObject({ code: 'handler_error' });
    }
  });

  it('validates send-direction events without letting a bad payload reach the handler', () => {
    const { ipc, listeners } = fakeIpc();
    const registrar = createIpcRegistrar({ ipc, scopeOf: () => 'launcher' });
    const entry: IpcDescriptor = {
      channel: 'live:test-send',
      direction: 'send',
      scope: ['all'],
      group: 'live',
      request: z.tuple([z.string()]),
      response: z.unknown(),
      summary: 'test',
    };
    const handler = vi.fn();
    registrar.register(entry, handler);
    const listener = listeners.get('live:test-send')!;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    listener(launcherEvent, 42);
    expect(handler).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    listener(launcherEvent, 'ok');
    expect(handler).toHaveBeenCalledWith(launcherEvent, 'ok');
    spy.mockRestore();
  });

  it('derives the sender scope from dev and packaged URLs', () => {
    expect(scopeFromUrl('http://localhost:3300/settings.html')).toBe('settings');
    expect(scopeFromUrl('file:///app/renderer/settings.html')).toBe('settings');
    expect(scopeFromUrl('http://localhost:3300/?mode=desktop')).toBe('desktop');
    expect(scopeFromUrl('http://localhost:3300/result-viewer.html?call=x')).toBe('result');
    expect(scopeFromUrl('http://localhost:3300/pack-window.html')).toBe('pack');
    expect(scopeFromUrl('http://localhost:3300/')).toBe('launcher');
  });
});
