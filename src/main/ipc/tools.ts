import { ipcMain, BrowserWindow, dialog } from 'electron';
import type { ToolCatalogEntry, ToolClassDefaults, ToolVerificationSettings } from '@shared/turns';
import { NATIVE_TOOL_CATALOG } from '@main/ai/tools/native';
import { nativeCatalogEntries } from '@main/ai/tools/catalog';
import { downloads } from '@main/ai/tools/downloads';
import { getToolResultService } from '@main/services/ToolResultService';
import { getToolUsageStats } from '@main/ai/audit';
import type { MainConfigService } from '@main/services/ConfigService';
import type { ToolPolicyEngine } from '@main/ai/tools/policy';
import type { AppService } from '@main/services/AppService';
import type { McpManager } from '@main/ai/tools/mcp';
import type { WindowManager } from '@main/window';

/** Every channel this module registers (the teardown list consumes this). */
export const TOOLS_IPC_CHANNELS: string[] = [
  'tools:usage-stats', 'tools:get-catalog', 'tools:cancel-download', 'tools:get-result',
  'tools:open-result-viewer', 'tools:set-verification', 'tools:set-tool-grant',
  'tools:set-class-defaults', 'tools:set-tool-enabled', 'tools:revoke-tool-grant',
  'tools:pick-root', 'tools:remove-root',
];

export interface ToolsIpcDeps {
  configService: MainConfigService;
  toolPolicy: ToolPolicyEngine;
  appService: AppService;
  mcpManager: McpManager;
  windowManager: WindowManager;
}

export function registerToolsIpc(deps: ToolsIpcDeps): void {
  const { configService, toolPolicy, appService, mcpManager, windowManager } = deps;

  ipcMain.handle('tools:usage-stats', async (_event, windowDays: number | null) => {
    const days = windowDays === 7 || windowDays === 30 ? windowDays : null;
    return getToolUsageStats(days);
  });

  ipcMain.handle('tools:get-catalog', async () => {
    const nativeRows = nativeCatalogEntries(NATIVE_TOOL_CATALOG, toolPolicy.snapshot());
    const appRows: ToolCatalogEntry[] = [];
    for (const app of appService.listEnabled()) {
      const source = app.sources[0];
      if (source.kind !== 'mcp') {
        continue;
      }
      const state = mcpManager.statusFor(source.server.id).state;
      for (const info of mcpManager.cachedToolsFor(source.server.id)) {
        const override = app.toolState[info.rawName];
        appRows.push({
          name: info.namespaced,
          description: info.description,
          risk: info.risk,
          category: 'integrations',
          editableArgs: false,
          enabled: override?.enabled !== false && state === 'connected',
          granted: false,
          source: 'mcp',
          parameters: info.parameters,
          verification: info.verification,
          verificationCustom: false,
          appName: app.name,
        });
      }
    }
    return [...nativeRows, ...appRows];
  });

  ipcMain.handle('tools:cancel-download', async (_event, downloadId: string) => {
    if (typeof downloadId !== 'string' || downloadId.length === 0 || downloadId.length > 80) {
      return false;
    }
    return downloads.cancel(downloadId);
  });

  ipcMain.handle('tools:get-result', async (_event, callId: string) => {
    if (typeof callId !== 'string' || callId.length > 200) {
      return null;
    }
    return getToolResultService().get(callId);
  });

  ipcMain.handle('tools:open-result-viewer', async (_event, callId: string) => {
    if (typeof callId !== 'string' || callId.length > 200 || !(await getToolResultService().has(callId))) {
      return false;
    }
    await windowManager.showResultWindow(callId);
    return true;
  });

  ipcMain.handle('tools:set-verification', async (_event, name: string, settings: ToolVerificationSettings | null) => {
    const config = configService.getConfig();
    const toolSettings = { ...config.tools.toolSettings };
    if (settings === null || settings.mode === 'standard') {
      delete toolSettings[name];
    } else {
      toolSettings[name] = settings.mode === 'conditions' ? settings : { mode: settings.mode };
    }
    await configService.updateConfig({ tools: { ...config.tools, toolSettings } });
    return true;
  });

  ipcMain.handle('tools:set-tool-grant', async (_event, name: string, granted: boolean) => {
    const config = configService.getConfig();
    const toolGrants = { ...config.tools.toolGrants };
    if (granted) {
      toolGrants[name] = 'always';
    } else {
      delete toolGrants[name];
    }
    await configService.updateConfig({ tools: { ...config.tools, toolGrants } });
    return true;
  });

  ipcMain.handle('tools:set-class-defaults', async (_event, defaults: ToolClassDefaults) => {
    const config = configService.getConfig();
    await configService.updateConfig({ tools: { ...config.tools, classDefaults: defaults ?? {} } });
    return true;
  });

  ipcMain.handle('tools:set-tool-enabled', async (_event, name: string, enabled: boolean) => {
    const config = configService.getConfig();
    const disabledTools = enabled
      ? config.tools.disabledTools.filter((tool) => tool !== name)
      : [...new Set([...config.tools.disabledTools, name])];
    await configService.updateConfig({ tools: { ...config.tools, disabledTools } });
    return true;
  });

  ipcMain.handle('tools:revoke-tool-grant', async (_event, name: string) => {
    const config = configService.getConfig();
    const { [name]: _removed, ...toolGrants } = config.tools.toolGrants;
    await configService.updateConfig({ tools: { ...config.tools, toolGrants } });
    return true;
  });

  ipcMain.handle('tools:pick-root', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return null;
    }
    const result = await dialog.showOpenDialog(window, {
      title: 'Grant folder access',
      message: 'The assistant will only be able to read and write files inside this folder.',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const root = result.filePaths[0];
    const config = configService.getConfig();
    if (!config.tools.grantedRoots.includes(root)) {
      await configService.updateConfig({
        tools: { ...config.tools, grantedRoots: [...config.tools.grantedRoots, root] },
      });
    }
    return root;
  });

  ipcMain.handle('tools:remove-root', async (_event, root: string) => {
    const config = configService.getConfig();
    await configService.updateConfig({
      tools: { ...config.tools, grantedRoots: config.tools.grantedRoots.filter((existing) => existing !== root) },
    });
    return true;
  });
}
