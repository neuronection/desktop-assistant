import { ipcMain } from 'electron';
import { APP_PRESETS } from '@shared/app-presets';
import { AiTask } from '@shared/types';
import type { EntityScope, ToolAppSaveInput, ToolAppView } from '@shared/apps';
import type { ToolRiskClass } from '@shared/turns';
import { resolveTaskModel } from '@shared/ai/tasks';
import { supportsProviderToolSearch } from '@main/ai/chat-models';
import { entityAllowedByScope, extractEntityIds } from '@main/ai/tools/app-selection';
import { getAppUsageStats } from '@main/ai/audit';
import type { MainConfigService } from '@main/services/ConfigService';
import type { AppService } from '@main/services/AppService';
import type { McpManager } from '@main/ai/tools/mcp';
import type { ContextDigestService } from '@main/ai/tools/apps/context-digests';

/** Every channel this module registers (the teardown list consumes this). */
export const APPS_IPC_CHANNELS: string[] = [
  'apps:get-state', 'apps:context-digest-stats', 'apps:list-presets', 'apps:preview-scope',
  'apps:save-app', 'apps:remove-app', 'apps:set-enabled', 'apps:set-tool-state',
  'apps:set-entity-scope', 'apps:test-connection', 'apps:usage-stats',
];

export interface AppsIpcDeps {
  configService: MainConfigService;
  appService: AppService;
  mcpManager: McpManager;
  contextDigests: ContextDigestService;
}

export function registerAppsIpc(deps: AppsIpcDeps): void {
  const { configService, appService, mcpManager, contextDigests } = deps;

  ipcMain.handle('apps:usage-stats', async (_event, windowDays: number | null) => {
    const days = windowDays === 7 || windowDays === 30 ? windowDays : null;
    return getAppUsageStats(days, (tool, mcpServer) => appService.appDisplayNameForTool(tool, mcpServer));
  });

  ipcMain.handle('apps:get-state', async (): Promise<{ apps: ToolAppView[]; deferredSupported: boolean; nativeToolCount: number }> => {
    const chatModel = resolveTaskModel(configService.getConfig(), AiTask.CHAT);
    const deferredSupported = chatModel
      ? supportsProviderToolSearch(chatModel.provider, chatModel.modelId)
      : false;
    return { apps: await appService.getState(), deferredSupported, nativeToolCount: appService.nativeToolCount() };
  });

  ipcMain.handle('apps:context-digest-stats', async () => {
    const stats: Record<string, { entities: number; ageMinutes: number }> = {};
    if (configService.getConfig().behavior?.appContext === false) {
      return stats;
    }
    for (const app of appService.listEnabled()) {
      const mcp = app.sources.find((source) => source.kind === 'mcp');
      if (!mcp || !contextDigests.hasProvider(app.presetId)) {
        continue;
      }
      const stat = contextDigests.peek(mcp.server.id);
      if (stat) {
        stats[app.id] = stat;
      }
    }
    return stats;
  });

  ipcMain.handle('apps:list-presets', async () => {
    return APP_PRESETS;
  });

  ipcMain.handle('apps:preview-scope', async (_event, appId: unknown, rules: unknown) => {
    if (typeof appId !== 'string' || appId.length === 0 || appId.length > 200) {
      return { entities: [] };
    }
    if (!Array.isArray(rules) || rules.some((rule) => typeof rule !== 'object' || rule === null || !Array.isArray((rule as EntityScope).rules))) {
      return { entities: [] };
    }
    const scopeRules = ((rules as { rules: EntityScope }[]).find((entry) => Array.isArray(entry.rules))?.rules ?? []) as EntityScope['rules'];
    const server = appService.serverConfigFor(appId);
    const namespaced = appService.firstDiscoveryTool(appId);
    if (!server || !namespaced) {
      return { entities: [] };
    }
    try {
      const wrapped = (await mcpManager.getToolsForServer(server, { isDisabled: () => false })).find(
        (tool) => tool.name === namespaced
      );
      if (!wrapped) {
        return { entities: [] };
      }
      const result = await wrapped.tool.invoke({});
      const text = typeof result === 'string' ? result : JSON.stringify(result);
      const entities = extractEntityIds(text);
      return {
        entities: entities.map((id) => ({ id, allowed: entityAllowedByScope(id, scopeRules) })),
      };
    } catch {
      return { entities: [] };
    }
  });

  ipcMain.handle('apps:save-app', async (_event, input: ToolAppSaveInput) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'Invalid app payload.' };
    }
    return appService.saveApp(input);
  });

  ipcMain.handle('apps:remove-app', async (_event, appId: unknown): Promise<boolean> => {
    if (typeof appId !== 'string' || appId.length === 0 || appId.length > 200) {
      return false;
    }
    const result = await appService.removeApp(appId);
    return result.ok;
  });

  ipcMain.handle('apps:set-enabled', async (_event, appId: unknown, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return { ok: false, error: 'Invalid enabled flag.' };
    }
    if (appId === null) {
      return appService.setMasterEnabled(enabled);
    }
    if (typeof appId !== 'string' || appId.length === 0 || appId.length > 200) {
      return { ok: false, error: 'Invalid app id.' };
    }
    return appService.setAppEnabled(appId, enabled);
  });

  ipcMain.handle('apps:set-tool-state', async (_event, appId: unknown, toolName: unknown, patch: unknown) => {
    if (typeof appId !== 'string' || appId.length === 0 || appId.length > 200) {
      return { ok: false, error: 'Invalid app id.' };
    }
    if (typeof toolName !== 'string' || toolName.length === 0 || toolName.length > 300) {
      return { ok: false, error: 'Invalid tool name.' };
    }
    if (patch !== null && (typeof patch !== 'object' || Array.isArray(patch))) {
      return { ok: false, error: 'Invalid tool-state patch.' };
    }
    return appService.setToolState(appId, toolName, patch as { enabled?: boolean; keywordTags?: string[]; riskOverride?: ToolRiskClass } | null);
  });

  ipcMain.handle('apps:set-entity-scope', async (_event, appId: unknown, scope: unknown) => {
    if (typeof appId !== 'string' || appId.length === 0 || appId.length > 200) {
      return { ok: false, error: 'Invalid app id.' };
    }
    if (scope !== null && (typeof scope !== 'object' || Array.isArray(scope) || !Array.isArray((scope as EntityScope).rules))) {
      return { ok: false, error: 'Invalid entity scope.' };
    }
    return appService.setEntityScope(appId, scope as EntityScope | null);
  });

  ipcMain.handle('apps:test-connection', async (_event, appId: unknown) => {
    if (typeof appId !== 'string' || appId.length === 0 || appId.length > 200) {
      return { ok: false, error: 'Invalid app id.' };
    }
    return appService.testConnection(appId);
  });
}
