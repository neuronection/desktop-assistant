import { APP_PRESETS } from '@shared/app-presets';
import { AiTask } from '@shared/types';
import type { EntityScope, ToolAppSaveInput, ToolAppView } from '@shared/apps';
import type { ToolRiskClass } from '@shared/turns';
import { resolveTaskModel } from '@shared/ai/tasks';
import { supportsProviderToolSearch } from '@main/ai/chat-models';
import { entityAllowedByScope, extractEntityIds } from '@main/ai/tools/app-selection';
import { getAppUsageStats } from '@main/ai/audit';
import type { MainConfigService } from '@main/services/ConfigService';
import type { ToolAppService } from '@main/services/ToolAppService';
import type { McpManager } from '@main/ai/tools/mcp';
import type { ContextDigestService } from '@main/ai/tools/apps/context-digests';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface AppsIpcDeps {
  configService: MainConfigService;
  appService: ToolAppService;
  mcpManager: McpManager;
  contextDigests: ContextDigestService;
}

export function registerAppsIpc(deps: AppsIpcDeps): void {
  const { configService, appService, mcpManager, contextDigests } = deps;

  register(IPC['apps:usage-stats'], async (_event, windowDays: number | null) => {
    const days = windowDays === 7 || windowDays === 30 ? windowDays : null;
    return getAppUsageStats(days, (tool, mcpServer) => appService.appDisplayNameForTool(tool, mcpServer));
  });

  register(IPC['apps:get-state'], async (): Promise<{ apps: ToolAppView[]; deferredSupported: boolean; nativeToolCount: number }> => {
    const chatModel = resolveTaskModel(configService.getConfig(), AiTask.CHAT);
    const deferredSupported = chatModel
      ? supportsProviderToolSearch(chatModel.provider, chatModel.modelId)
      : false;
    return { apps: await appService.getState(), deferredSupported, nativeToolCount: appService.nativeToolCount() };
  });

  register(IPC['apps:get-content'], async (_event, appId: string) => {
    return appService.getContent(appId);
  });

  register(IPC['apps:context-digest-stats'], async () => {
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

  register(IPC['apps:list-presets'], async () => {
    return APP_PRESETS;
  });

  register(IPC['apps:preview-scope'], async (_event, appId: string, rules: { rules: EntityScope['rules'] }[]) => {
    const scopeRules = rules.find((entry) => Array.isArray(entry.rules))?.rules ?? [];
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

  register(IPC['apps:save-app'], async (_event, input: ToolAppSaveInput) => {
    return appService.saveApp(input);
  });

  register(IPC['apps:remove-app'], async (_event, appId: string): Promise<boolean> => {
    const result = await appService.removeApp(appId);
    return result.ok;
  });

  register(IPC['apps:set-enabled'], async (_event, appId: string | null, enabled: boolean) => {
    if (appId === null) {
      return appService.setMasterEnabled(enabled);
    }
    return appService.setAppEnabled(appId, enabled);
  });

  register(IPC['apps:set-tool-state'], async (_event, appId: string, toolName: string, patch: { enabled?: boolean; keywordTags?: string[]; riskOverride?: ToolRiskClass } | null) => {
    return appService.setToolState(appId, toolName, patch);
  });

  register(IPC['apps:set-entity-scope'], async (_event, appId: string, scope: EntityScope | null) => {
    return appService.setEntityScope(appId, scope);
  });

  register(IPC['apps:test-connection'], async (_event, appId: string) => {
    return appService.testConnection(appId);
  });
}
