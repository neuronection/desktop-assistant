import { contextBridge } from 'electron';
import type { ElectronAPI } from '@shared/types';
import { createPreloadApi } from './createPreloadApi';

// The renderer-facing bridge is derived from the shared IPC registry; the
// registry is the only place a channel string may live.
const electronAPI = createPreloadApi() as unknown as ElectronAPI;

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
