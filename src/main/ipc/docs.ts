import { ipcMain } from 'electron';
import { getDocsIndexService } from '@main/services/DocsIndexService';
import type { MainConfigService } from '@main/services/ConfigService';

/** Every channel this module registers (the teardown list consumes this). */
export const DOCS_IPC_CHANNELS: string[] = [
  'docs:get-status', 'docs:set-indexed', 'docs:re-index',
];

export interface DocsIpcDeps {
  configService: MainConfigService;
}

export function registerDocsIpc(deps: DocsIpcDeps): void {
  const { configService } = deps;

  ipcMain.handle('docs:get-status', async () => {
    const config = configService.getConfig();
    const statuses = await getDocsIndexService().status();
    const byRoot = new Map(statuses.map((entry) => [entry.root, entry]));
    return config.tools.grantedRoots.map((root) => ({
      root,
      indexed: config.tools.indexedRoots.includes(root),
      files: byRoot.get(root)?.files ?? 0,
      chunks: byRoot.get(root)?.chunks ?? 0,
    }));
  });

  ipcMain.handle('docs:set-indexed', async (_event, root: string, on: boolean) => {
    if (typeof root !== 'string' || root.length === 0) {
      return { indexed: false, files: 0, chunks: 0 };
    }
    const config = configService.getConfig();
    const indexed = new Set(config.tools.indexedRoots);
    if (on && config.tools.grantedRoots.includes(root)) {
      indexed.add(root);
      await configService.updateConfig({ tools: { ...config.tools, indexedRoots: [...indexed] } });
      await getDocsIndexService().indexRoot(root);
    } else if (!on) {
      indexed.delete(root);
      await configService.updateConfig({ tools: { ...config.tools, indexedRoots: [...indexed] } });
      await getDocsIndexService().removeRoot(root);
    }
    const statuses = await getDocsIndexService().status();
    const entry = statuses.find((status) => status.root === root);
    return { indexed: indexed.has(root), files: entry?.files ?? 0, chunks: entry?.chunks ?? 0 };
  });

  ipcMain.handle('docs:re-index', async (_event, root: string | null) => {
    const config = configService.getConfig();
    const roots = root === null ? config.tools.indexedRoots : [root];
    let files = 0;
    let chunks = 0;
    let truncated = false;
    for (const target of roots) {
      if (!config.tools.indexedRoots.includes(target)) {
        continue;
      }
      const summary = await getDocsIndexService().indexRoot(target);
      files += summary.files;
      chunks += summary.chunks;
      truncated = truncated || summary.truncated;
    }
    return { files, chunks, truncated };
  });
}
