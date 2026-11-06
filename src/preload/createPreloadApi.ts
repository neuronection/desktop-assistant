import { ipcRenderer } from 'electron';
import { IPC_REGISTRY } from '@shared/ipc/registry';

/**
 * The preload surface is derived from the registry: one method per bridge
 * descriptor, with direction deciding invoke / send / subscribe. Feature
 * code never touches raw channel strings.
 */
export function createPreloadApi(): Record<string, unknown> {
  const api: Record<string, unknown> = {};
  for (const entry of IPC_REGISTRY) {
    const bridge = entry.bridge;
    if (!bridge) {
      continue;
    }
    if (bridge.kind === 'on') {
      api[bridge.method] = (callback: (payload?: unknown) => void) => {
        const handler = (_event: unknown, payload: unknown): void => callback(payload);
        ipcRenderer.on(entry.channel, handler);
        return () => {
          ipcRenderer.removeListener(entry.channel, handler);
        };
      };
    } else if (bridge.kind === 'send') {
      api[bridge.method] = (...args: unknown[]) => ipcRenderer.send(entry.channel, ...args);
    } else {
      api[bridge.method] = (...args: unknown[]) => ipcRenderer.invoke(entry.channel, ...args);
    }
  }
  return api;
}
