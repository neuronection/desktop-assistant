import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { IpcDescriptor, IpcWindowScope } from '@shared/ipc/registry';
import { formatIpcError, type IpcErrorCode } from '@shared/ipc/errors';

export class IpcCallError extends Error {
  readonly code: IpcErrorCode;

  constructor(code: IpcErrorCode, message: string) {
    super(formatIpcError({ code, message }));
    this.name = 'IpcCallError';
    this.code = code;
  }
}

export interface IpcRegistrarIpc {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  removeHandler(channel: string): void;
  removeAllListeners(channel: string): void;
}

export interface IpcRegistrar {
  register(entry: IpcDescriptor, handler: (event: any, ...args: any[]) => unknown): void;
  removeAll(): void;
}

export interface IpcRegistrarOptions {
  ipc?: IpcRegistrarIpc;
  scopeOf?: (event: unknown) => IpcWindowScope;
}

/**
 * Window scope is derived from the sender URL, never from renderer-supplied
 * data. Development URLs and packaged file:// URLs both carry the entry page.
 */
export function scopeFromUrl(url: string): IpcWindowScope {
  if (url.includes('settings.html')) {
    return 'settings';
  }
  if (url.includes('pack-window.html')) {
    return 'pack';
  }
  if (url.includes('result-viewer.html')) {
    return 'result';
  }
  if (/[?&]mode=desktop(?:&|$)/.test(url)) {
    return 'desktop';
  }
  return 'launcher';
}

export function scopeFromEvent(event: unknown): IpcWindowScope {
  const sender = (event as { sender?: { getURL?: () => string } })?.sender;
  return scopeFromUrl(sender?.getURL?.() ?? '');
}

function assertScope(entry: IpcDescriptor, event: unknown, scopeOf: (event: unknown) => IpcWindowScope): void {
  if (entry.scope.includes('all')) {
    return;
  }
  const scope = scopeOf(event);
  if (entry.scope.includes(scope)) {
    return;
  }
  throw new IpcCallError(
    'scope_denied',
    `'${entry.channel}' is not available to the ${scope} window (allowed: ${entry.scope.join(', ')})`
  );
}

function parseArgs(entry: IpcDescriptor, args: unknown[]): unknown[] {
  const parsed = entry.request.safeParse(args);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`)
      .join('; ');
    throw new IpcCallError('invalid_args', `Invalid arguments for '${entry.channel}': ${detail}`);
  }
  return parsed.data as unknown[];
}

export function createIpcRegistrar(options: IpcRegistrarOptions = {}): IpcRegistrar {
  const ipc = options.ipc ?? (ipcMain as unknown as IpcRegistrarIpc);
  const scopeOf = options.scopeOf ?? scopeFromEvent;
  const registered: string[] = [];

  const register = (entry: IpcDescriptor, handler: (event: any, ...args: any[]) => unknown): void => {
    if (entry.direction === 'event') {
      throw new Error(`'${entry.channel}' is a main→renderer event and cannot be registered as a handler.`);
    }
    registered.push(entry.channel);
    if (entry.direction === 'send') {
      ipc.on(entry.channel, (event, ...raw) => {
        try {
          assertScope(entry, event, scopeOf);
          handler(event, ...parseArgs(entry, raw));
        } catch (error) {
          // IPC send cannot return an error to the caller; keep the typed
          // shape in the main log instead of silently swallowing it.
          console.error(`[ipc] ${entry.channel}:`, error);
        }
      });
      return;
    }
    ipc.handle(entry.channel, async (event, ...raw) => {
      assertScope(entry, event, scopeOf);
      const args = parseArgs(entry, raw);
      try {
        return await handler(event, ...args);
      } catch (error) {
        if (error instanceof IpcCallError) {
          throw error;
        }
        throw new IpcCallError('handler_error', error instanceof Error ? error.message : String(error));
      }
    });
  };

  return {
    register,
    removeAll(): void {
      for (const channel of registered) {
        ipc.removeHandler(channel);
        ipc.removeAllListeners(channel);
      }
      registered.length = 0;
    },
  };
}

const productionRegistrar = createIpcRegistrar();

export const register = productionRegistrar.register;
export const removeAllIpcHandlers = productionRegistrar.removeAll;
