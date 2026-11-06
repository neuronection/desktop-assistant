import { app, BrowserWindow, clipboard, shell } from 'electron';
import { randomUUID } from 'crypto';
import { DatabaseService } from '@main/services/DatabaseService';
import { ConversationService } from '@main/services/ConversationService';
import { MessageService } from '@main/services/MessageService';
import { MainConfigService } from '@main/services/ConfigService';
import { SecretService, providerSecretKey } from '@main/services/SecretService';
import { LLMProvider } from '@shared/types';
import type { TurnEvent, ToolRiskClass } from '@shared/turns';
import type { HotkeyService } from '@main/services/HotkeyService';
import { AIService } from '@main/services/AIService';
import { AttachmentService } from '@main/services/AttachmentService';
import { SttService } from '@main/services/SttService';
import { TtsService } from '@main/services/TtsService';
import { MemoryConsolidationService } from '@main/services/MemoryConsolidationService';
import { TurnManager } from '@main/turns/TurnManager';
import { assembleDecisionPrompt } from '@main/ai/decide/prompt';
import { decisionToolSurface, type DecisionMcpToolSnapshot } from '@main/ai/decide/tool-surface';
import { DecisionSettingsController } from '@main/ai/decide/settings-controller';
import { runDecision } from '@main/ai/decide';
import { ContextDigestService } from '@main/ai/tools/apps/context-digests';
import { homeAssistantDigestProvider } from '@main/ai/tools/apps/context-providers/home-assistant';
import { McpDirectExecutor, snapshotDecisionMcpTools } from '@main/ai/tools/mcp-direct';
import type { McpServerConfig } from '@shared/mcp';
import { getToolResultService } from '@main/services/ToolResultService';
import { aiGateway } from '@main/ai/gateway';
import { createEmbeddingStore, createSemanticRanking } from '@main/ai/semantic-ranking';
import { evaluateUtterance, utteranceWantsText, type UtteranceVerdict } from '@main/ai/utterance';
import { runUtteranceGate } from '@main/ai/decide/points/utterance-gate';
import { runLiveIntentPoint } from '@main/ai/decide/points/live-intent';
import { LiveSessionService, type LiveSessionHost } from '@main/services/LiveSessionService';
import { isLiveActive, LIVE_IDLE_TIMEOUT_MS, type LiveEvent } from '@shared/live';
import { buildDefaultToolRegistry, NATIVE_TOOL_CATALOG } from '@main/ai/tools/native';
import { setMcpResourceProvider } from '@main/ai/tools/native/mcp-resource';
import { runRetentionPrune } from '@main/db';
import { ScheduleService } from '@main/services/ScheduleService';
import { createCommandHotkeyRunner } from '@main/services/commandHotkeyRunner';
import { createAssistantRunner } from '@main/ai/graphs/assistant';
import { createResearchRunner } from '@main/ai/graphs/research';
import { ToolPolicyEngine, defaultPolicySnapshot } from '@main/ai/tools/policy';
import { McpManager } from '@main/ai/tools/mcp';
import { PrismaCheckpointSaver } from '@main/ai/checkpointer';
import { ToolAppService, type ToolAppServiceDeps } from '@main/services/ToolAppService';
import { AppInstanceStatusService } from '@main/services/AppInstanceStatusService';
import { NotificationService, setNotificationServiceProvider, routeNotification, type NotificationRecord } from '@main/services/NotificationService';
import { createMiniAppStack } from '@main/apps/composition';
import { registerMiniAppIpc } from '@main/apps/ipc';
import { entityAllowedByScope } from '@main/ai/tools/app-selection';
import { fastPathEligible } from '@shared/app-presets';
import { SearchService } from '@main/services/SearchService';
import { TranslateService } from '@main/services/TranslateService';
import { getMemoryService } from '@main/services/MemoryService';
import { DesktopContextService } from '@main/services/DesktopContextService';
import { CommandService, type BuiltinActionHandlers } from '@main/services/CommandService';
import { AppDiscoveryService } from '@main/services/AppDiscoveryService';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { WindowManager } from '@main/window';
import type { TrayManager } from '@main/tray';
import { registerAiIpc } from '@main/ipc/ai';
import { registerAttachmentIpc } from '@main/ipc/attachments';
import { registerAppsIpc } from '@main/ipc/apps';
import { registerCommandsIpc } from '@main/ipc/commands';
import { registerConfigIpc } from '@main/ipc/config';
import { registerConversationsIpc } from '@main/ipc/conversations';
import { registerDecisionsIpc } from '@main/ipc/decisions';
import { registerDocsIpc } from '@main/ipc/docs';
import { registerHotkeysIpc } from '@main/ipc/hotkeys';
import { registerLiveIpc } from '@main/ipc/live';
import { registerHubIpc } from '@main/ipc/hub';
import { HubService } from '@main/hub/HubService';
import type { HubBusy, HubResult } from '@shared/hub';
import { registerMemoryIpc } from '@main/ipc/memory';
import { registerMessagesIpc } from '@main/ipc/messages';
import { registerProviderIpc } from '@main/ipc/providers';
import { registerSchedulesIpc } from '@main/ipc/schedules';
import { registerSearchIpc } from '@main/ipc/search';
import { registerSpeechIpc } from '@main/ipc/speech';
import { SpeechService } from '@main/services/SpeechService';
import { speechNoticeInput } from '@main/services/speechNotices';
import { buildLiveApprovalNotification } from '@main/liveNotifications';
import type { HotkeyConfig } from '@shared/types';
import { cancelAudioOp } from '@main/ai/audioOps';
import { broadcastSpeechState, sendToSpeechOverlays } from '@main/ipc/speechBroadcast';
import { registerSystemIpc, openValidatedPath } from '@main/ipc/system';
import { registerNotificationsIpc } from '@main/ipc/notifications';
import { registerToolsIpc } from '@main/ipc/tools';
import { registerTranslationIpc } from '@main/ipc/translation';
import { registerUpdatesIpc } from '@main/ipc/updates';
import { registerWindowIpc } from '@main/ipc/window';
import type { UpdateService } from '@main/services/updates';
import { SpeechCacheService } from '@main/services/SpeechCacheService';
import { setConnectorServiceProvider } from '@main/services/cloud/ConnectorServiceRuntime';
import { setConnectorAuditClientProvider } from '@main/services/cloud/ConnectorAudit';
import { ConnectorService } from '@main/services/cloud/ConnectorService';
import { OAuthService } from '@main/services/cloud/OAuthService';
import { createPrismaConnectorStore } from '@main/services/cloud/PrismaConnectorStore';
import { clientIdFor, clientSecretFor, loadProviderCatalog } from '@main/services/cloud/ProviderCatalog';
import { registerCalendarIpc } from '@main/ipc/calendar';
import { TEXT } from '@shared/constants/text';
import { removeAllIpcHandlers } from '@main/ipc/register';

/**
 * The IPC composition root: constructs the shared services once, hands
 * each domain registrar in `src/main/ipc/` exactly the deps it needs,
 * and owns the teardown (`removeIpcHandlers` — the union of every
 * registrar's exported channel list).
 */
export interface IpcHandlersHandle {
  speech: SpeechService;
}

export function setupIpcHandlers(
  databaseService: DatabaseService,
  windowManager: WindowManager,
  hotkeyService: HotkeyService,
  trayManager: TrayManager,
  updateService: UpdateService
): IpcHandlersHandle {
  const conversationService = new ConversationService(databaseService);
  const messageService = new MessageService(databaseService, conversationService);
  const configService = MainConfigService.getInstance();
  let routeNotificationRecord: ((record: NotificationRecord) => boolean) | null = null;
  const notificationService = new NotificationService({
    client: () => databaseService.getClient(),
    rate: () => configService.getConfig().behavior.notifyRate,
    onChange: (change) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('notifications:changed', change);
        }
      });
      void notificationService
        .unreadBadgeCount()
        .then((count) => trayManager.setUnreadBadge(count))
        .catch(() => undefined);
    },
    onClick: (record) => {
      routeNotificationRecord?.(record);
    },
  });
  setNotificationServiceProvider(notificationService);
  const attachmentService = AttachmentService.getInstance(configService.getConfig());
  const sttService = new SttService();
  const ttsService = new TtsService();

  const aiService = new AIService();

  const decisionEngineDeps = () => ({
    getApiKey: async (provider: LLMProvider) =>
      (await SecretService.getInstance().getSecret(providerSecretKey(provider.id))) ?? provider.apiKey,
    configRevision: () => configService.getRevision(),
    observeResolvedModel: async (modelId: string, resolvedModel: string) => {
      const config = configService.getConfig();
      if (config.decision.observedVersions[modelId] === resolvedModel) {
        return;
      }
      await configService.updateConfig({
        decision: {
          ...config.decision,
          observedVersions: { ...config.decision.observedVersions, [modelId]: resolvedModel },
        },
      });
    },
  });

  const recentExchangeFor = async (conversationId?: string): Promise<string | undefined> => {
    const config = configService.getConfig();
    if (!config.voice?.attachContext || !conversationId) {
      return undefined;
    }
    try {
      const conversation = await conversationService.getConversationById(conversationId);
      const messages = (conversation?.messages ?? []).filter((message) => message.content.trim());
      const lastTwo = messages.slice(-2).reverse();
      return lastTwo
        .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content.trim().slice(0, 600)}`)
        .join('\n');
    } catch (error) {
      console.warn('recent exchange load failed, continuing without context:', error);
      return undefined;
    }
  };

  const evaluateVoiceUtterance = async (
    text: string,
    conversationId?: string
  ): Promise<UtteranceVerdict> => {
    const config = configService.getConfig();
    const recentExchange = await recentExchangeFor(conversationId);
    const evaluate = (request: { text: string; wantsText: boolean; recentExchange?: string }) =>
      evaluateUtterance(
        config,
        {
          gateway: aiGateway,
          resolveKey: async (provider: LLMProvider) =>
            (await SecretService.getInstance().getSecret(providerSecretKey(provider.id))) ?? provider.apiKey,
        },
        request.text,
        { ...(request.recentExchange ? { recentExchange: request.recentExchange } : {}) }
      );
    return runUtteranceGate(
      {
        decision: {
          run: (input, questions) =>
            runDecision(decisionEngineDeps(), { config, input, tools: [], questions }),
        },
        evaluate,
      },
      {
        text,
        wantsText: utteranceWantsText(config.voice),
        engine: config.voice?.autoSendEngine === 'task' ? 'task' : 'decision',
        ...(recentExchange ? { recentExchange } : {}),
      }
    );
  };

  const toolRegistry = buildDefaultToolRegistry();
  const toolPolicy = new ToolPolicyEngine(
    () => defaultPolicySnapshot(configService.getConfig().tools),
    async (toolName) => {
      const config = configService.getConfig();
      await configService.updateConfig({
        tools: { ...config.tools, toolGrants: { ...config.tools.toolGrants, [toolName]: 'always' } },
      });
    },
    async (root) => {
      const config = configService.getConfig();
      const grantedRoots = config.tools.grantedRoots.includes(root)
        ? config.tools.grantedRoots
        : [...config.tools.grantedRoots, root];
      await configService.updateConfig({ tools: { ...config.tools, grantedRoots } });
    }
  );
  const appStatus = new AppInstanceStatusService(() => databaseService.getClient());
  routeNotificationRecord = (record) =>
    routeNotification(record, {
      openConversation: (conversationId) => {
        void windowManager.showDesktopWindow(conversationId);
      },
      openSettings: (target) => {
        if (!target) {
          windowManager.showSettingsWindow();
          return;
        }
        const [tab, section] = target.split(':');
        windowManager.showSettingsWindow({ tab, ...(section ? { section } : {}) });
      },
      openPackReport: (packId, runId) => {
        windowManager.showSettingsWindow({ tab: 'apps', miniAppsReportPackId: packId, miniAppsReportRunId: runId });
      },
      openPath: (path) => {
        void openValidatedPath(path, toolPolicy);
      },
    });
  const appServiceDeps: ToolAppServiceDeps = {
    appStatus,
    config: () => configService.getConfig(),
    updateToolApps: async (patch) => {
      const current = configService.getConfig().toolApps;
      await configService.updateConfig({ toolApps: { ...current, ...patch } });
    },
    nativeToolNames: () => toolRegistry.list().map((definition) => definition.name),
    mcpStatusFor: (serverId) => mcpManager.statusFor(serverId),
    cachedMcpToolNames: (serverId) => mcpManager.cachedToolsFor(serverId).map((tool) => tool.rawName),
    cachedMcpToolInfos: (serverId) =>
      mcpManager.cachedToolsFor(serverId).map((tool) => ({ name: tool.rawName, description: tool.description })),
    cachedMcpContent: (serverId) => mcpManager.cachedContentFor(serverId),
    listMcpContent: (server) => mcpManager.listServerContent(server),
    cacheAgeMs: (serverId) => mcpManager.cacheAgeMs(serverId),
    refreshServerTools: async (server) => {
      await mcpManager.listServerTools(server, {
        isDisabled: (name) => configService.getConfig().tools.disabledTools.includes(name),
        toolOverrides: (name) => appService.toolOverrideFor(name),
        toolVerification: (name) => configService.getConfig().tools.toolSettings[name] ?? { mode: 'standard' },
      });
    },
    testServer: async (server) => {
      const result = await mcpManager.testConnection(server);
      if (result.ok) {
        await appServiceDeps.refreshServerTools(server).catch(() => undefined);
      }
      return result;
    },
    getSecret: (key) => SecretService.getInstance().getSecret(key),
    setSecret: (key, value) => SecretService.getInstance().setSecret(key, value),
    deleteSecret: (key) => SecretService.getInstance().deleteSecret(key),
    newId: () => randomUUID(),
    resetConnections: () => mcpManager.close(),
    invalidateDigest: (serverId) => contextDigests.invalidate(serverId),
  };
  const appService = new ToolAppService(appServiceDeps);
  const miniApps = createMiniAppStack({
    configService,
    databaseService,
    conversationService,
    messageService,
    decisionEngineDeps: decisionEngineDeps,
    appStatus,
    notify: (input) => notificationService.notify(input),
  });
  miniApps.init();
  const miniAppRegistry = miniApps.registry;
  const miniAppRunService = miniApps.runService;
  void miniAppRegistry.reconcile().catch((error) => console.error('Mini-app boot reconcile failed:', error));
  const mcpManager: McpManager = new McpManager({
    listServers: () => appService.listServerConfigs(),
    toolOverrides: (name) => appService.toolOverrideFor(name),
    readSecrets: (serverId) => appService.readServerSecrets(serverId),
    onToolResult: (serverId, risk) => {
      if (risk !== 'read-only') {
        contextDigests.invalidate(serverId);
      }
    },
  });
  setMcpResourceProvider({
    listExposed: () =>
      appService.listEnabled().flatMap((app) => {
        const source = app.sources[0];
        if (source.kind !== 'mcp' || app.exposeResources !== true) {
          return [];
        }
        const resources = mcpManager.cachedContentFor(source.server.id).resources;
        return resources.length > 0
          ? [{ appId: app.id, appName: app.name, server: source.server, resources }]
          : [];
      }),
    read: async (appId, uri) => {
      const app = appService.listEnabled().find((candidate) => candidate.id === appId);
      const source = app?.sources[0];
      if (!app || !source || source.kind !== 'mcp' || app.exposeResources !== true) {
        return { ok: false, error: 'App does not expose resources.' };
      }
      try {
        const content = await mcpManager.readResource(
          source.server,
          uri,
          configService.getConfig().behavior.mcpResourceMaxBytes
        );
        return { ok: true, text: content.text, truncated: content.truncated };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
  });
  const contextDigests = new ContextDigestService({
    listTools: async (server) =>
      (await mcpManager.getToolsForServer(server, { isDisabled: () => false })).map((tool) => ({ name: tool.name })),
    invokeTool: async (server, toolName) => {
      const tool = (await mcpManager.getToolsForServer(server, { isDisabled: () => false })).find(
        (candidate) => candidate.name === toolName
      );
      return tool ? tool.tool.invoke({}) : null;
    },
  });
  contextDigests.register('home-assistant', homeAssistantDigestProvider);
  const appContextFor = async (appIds?: string[]): Promise<string | null> => {
    if (configService.getConfig().behavior?.appContext === false) {
      return null;
    }
    // Fast-path posture (plan 20 S7): ineligible apps get neither digest
    // nor skill context — dangling device lists in front of a surface
    // without their tools only teach the engine to refuse.
    const apps = appService
      .listEnabled()
      .filter((app) => (appIds ? appIds.includes(app.id) : true) && fastPathEligible(app.presetId));
    const blocks: string[] = [];
    for (const app of apps) {
      const mcp = app.sources.find((source) => source.kind === 'mcp');
      if (!mcp) {
        continue;
      }
      const rules = app.entityScope?.rules;
      const block = await contextDigests
        .digestFor({
          capability: app.presetId,
          appName: app.name,
          server: mcp.server,
          ...(rules?.length ? { entityAllowed: (entityId: string) => entityAllowedByScope(entityId, rules) } : {}),
        })
        .catch(() => null);
      if (block) {
        blocks.push(block);
      }
    }
    return blocks.length > 0 ? blocks.join('\n\n') : null;
  };
  /**
   * The decision engine resolves arguments at classification time
   * (plan 23 D9) — its prompt carries the digest of the apps that are
   * in decision scope, so a direct dispatch can emit `entity_id`
   * without any agent loop.
   */
  const decisionSystemPrompt = async (): Promise<string> => {
    const config = configService.getConfig();
    const base = assembleDecisionPrompt(config.decision);
    const scopeAppIds = config.decision.scope.apps;
    const context = scopeAppIds.length > 0 ? await appContextFor(scopeAppIds) : null;
    return context ? `${base}\n\n${context}` : base;
  };
  /**
   * Catalog ids per in-scope app (plan 24 S4b) for the decision engine's
   * grounded entity Choice — cache-only, scope-filtered, never a fetch.
   */
  const decisionCatalogEntitiesFor = (appIds: string[]): ReadonlyMap<string, readonly string[]> => {
    const catalog = new Map<string, readonly string[]>();
    for (const app of appService.listEnabled().filter((entry) => appIds.includes(entry.id) && fastPathEligible(entry.presetId))) {
      const mcp = app.sources.find((source) => source.kind === 'mcp');
      if (!mcp) {
        continue;
      }
      const rules = app.entityScope?.rules;
      const rows = contextDigests.rowsFor(
        mcp.server.id,
        rules?.length ? (entityId: string) => entityAllowedByScope(entityId, rules) : undefined
      );
      if (rows.length > 0) {
        catalog.set(app.id, rows.map((row) => row.id));
      }
    }
    return catalog;
  };
  void appService.boot().catch((error) => console.error('Tool-apps boot failed:', error));
  app.once('will-quit', () => {
    void mcpManager.close();
  });
  registerUpdatesIpc({ updateService });
  app.once('will-quit', () => updateService.stop());
  const checkpointer = new PrismaCheckpointSaver(() => {
    try {
      return databaseService.getClient();
    } catch {
      return null;
    }
  });
  void checkpointer
    .setup()
    .catch((error) => console.error('Checkpointer boot failed (in-memory fallback applies to new turns only):', error));
  const builtinActions: BuiltinActionHandlers = {
    newConversation: () => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('launcher:new-conversation');
        }
      });
    },
    toggleExpand: () => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('launcher:toggle-expand');
        }
      });
    },
    openDesktop: () => {
      windowManager.hideMainWindow();
      void windowManager.showDesktopWindow();
    },
    openSettings: () => {
      void windowManager.showSettingsWindow();
    },
    hideLauncher: () => {
      windowManager.hideMainWindow();
    },
    quit: () => {
      app.quit();
    },
  };
  const appDiscovery = new AppDiscoveryService();
  const miniAppPalettePacks = () =>
    miniAppRegistry
      .getState()
      .packs.filter((view) => (view.kind === 'assessment' || view.kind === 'surface') && !view.error)
      .map((view) => ({
        id: view.id,
        kind: view.kind,
        title: view.title,
        description: view.description ?? '',
        enabled: view.enabled,
        ...(view.kind === 'surface' && view.commands.length > 0 ? { commands: view.commands } : {}),
      }));
  const commandService = new CommandService({
    client: databaseService.isReady() ? databaseService.getClient() : null,
    config: () => configService.getConfig().commands ?? DEFAULT_CONFIG.commands,
    updateCommands: async (patch) => {
      const current = configService.getConfig().commands ?? DEFAULT_CONFIG.commands;
      await configService.updateConfig({ commands: { ...current, ...patch } });
    },
    toolCatalog: () => NATIVE_TOOL_CATALOG,
    isToolDisabled: (name) => toolPolicy.isDisabled(name),
    grantedRoots: () => toolPolicy.grantedRoots() ?? [],
    actions: builtinActions,
    apps: () => appDiscovery.getApps(),
    launchApp: (id) => appDiscovery.launch(id),
    executeDirectTool: (name, args) =>
      toolRegistry.executeDirect(name, args, { grantedRoots: toolPolicy.grantedRoots() ?? [] }),
    appTools: () => {
      const rows: { name: string; title: string; subtitle: string; risk: ToolRiskClass; slash: string; available: boolean }[] = [];
      for (const app of appService.listEnabled()) {
        const source = app.sources[0];
        if (source.kind !== 'mcp') {
          continue;
        }
        const available = mcpManager.statusFor(source.server.id).state === 'connected';
        for (const info of mcpManager.cachedToolsFor(source.server.id)) {
          const state = app.toolState[info.rawName];
          if (state?.enabled === false) {
            continue;
          }
          const risk = state?.riskOverride ?? state?.baseRisk ?? 'state-changing';
          if (risk === 'destructive') {
            continue;
          }
          rows.push({
            name: info.namespaced,
            title: info.rawName,
            subtitle: `${app.name} — ${info.description}`,
            risk,
            slash: `${source.server.name}-${info.rawName}`,
            available,
          });
        }
      }
      return rows;
    },
    promptEntries: () => {
      const rows: {
        appId: string;
        appName: string;
        name: string;
        title: string;
        description: string;
        arguments: { name: string; description?: string; required: boolean }[];
      }[] = [];
      for (const app of appService.listEnabled()) {
        const source = app.sources[0];
        if (source.kind !== 'mcp') {
          continue;
        }
        for (const prompt of mcpManager.cachedContentFor(source.server.id).prompts) {
          rows.push({
            appId: app.id,
            appName: app.name,
            name: prompt.name,
            title: prompt.title ?? prompt.name,
            description: prompt.description ?? '',
            arguments: prompt.arguments,
          });
        }
      }
      return rows;
    },
    expandPrompt: async (appId, name, args) => {
      const app = appService.listEnabled().find((candidate) => candidate.id === appId);
      const source = app?.sources[0];
      if (!app || !source || source.kind !== 'mcp') {
        return { ok: false, error: 'Prompt app is not available.' };
      }
      try {
        const content = await mcpManager.getPrompt(source.server, name, args);
        return { ok: true, text: content.messages.map((message) => message.text).join('\n\n') };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
    storeSecret: (key, value) => SecretService.getInstance().setSecret(key, value),
    resolveSecret: async (key) => await SecretService.getInstance().getSecret(key),
    deleteSecret: (key) => SecretService.getInstance().deleteSecret(key),
    miniAppPacks: () => miniApps.palettePacks(),
    startMiniAppRun: (packId) => miniApps.startRunFromPalette(packId),
    executeMiniAppCommand: (packId, commandId, args) => miniApps.executePackCommand(packId, commandId, args),
  });
  void appDiscovery
    .scan(false)
    .catch((error) => console.error('App discovery scan failed:', error));
  void (async () => {
    for (const app of appService.listEnabled()) {
      const source = app.sources[0];
      if (source.kind === 'mcp') {
        await mcpManager.listServerContent(source.server).catch(() => undefined);
      }
    }
  })();
  void commandService
    .validateStoredIntegrations()
    .catch((error) => console.error('Integration validation failed:', error));
  void runRetentionPrune({
    client: databaseService.getClient(),
    retention: configService.getConfig().behavior.retention,
    pruneToolResults: (maxAgeMs) => getToolResultService().prune(maxAgeMs),
  }).catch((error) => console.error('Retention prune failed:', error));
  const mcpManagerAdapter = {
    statusFor: (serverId: string) => mcpManager.statusFor(serverId),
    cachedToolsFor: (serverId: string) => mcpManager.cachedToolsFor(serverId),
    getToolsForServer: async (
      server: { id: string; name: string; enabled: boolean },
      policy: { isDisabled(name: string): boolean }
    ) => {
      const wrapped = await mcpManager.getToolsForServer(server as McpServerConfig, policy);
      return wrapped.map((entry) => ({
        name: entry.name,
        tool: { invoke: (args: unknown) => entry.tool.invoke(args) },
      }));
    },
    listServerTools: (server: { id: string; name: string; enabled: boolean }) =>
      mcpManager.listServerTools(server as McpServerConfig, {
        isDisabled: (name) => configService.getConfig().tools.disabledTools.includes(name),
        toolOverrides: (name) => appService.toolOverrideFor(name),
        toolVerification: (name) => configService.getConfig().tools.toolSettings[name] ?? { mode: 'standard' },
      }),
  };

  const mcpDecisionSnapshot = (): Promise<DecisionMcpToolSnapshot[]> =>
    snapshotDecisionMcpTools({ apps: () => appService.listEnabled(), manager: mcpManagerAdapter, policy: toolPolicy });

  const mcpDirect = new McpDirectExecutor({
    apps: () => appService.listEnabled(),
    manager: mcpManagerAdapter,
    policy: toolPolicy,
  });

  let liveConversationId: string | null = null;
  let liveSession: LiveSessionService | null = null;
  let liveTurnText = '';
  let liveCaptionSeq = 0;
  let liveCaptionTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingLiveCaption = '';

  const semanticRanking = createSemanticRanking({
    gateway: aiGateway,
    getConfig: () => configService.getConfig(),
    resolveKey: async (providerId, fallback) =>
      (await SecretService.getInstance().getSecret(providerSecretKey(providerId))) ?? fallback,
    store: createEmbeddingStore(databaseService.getClient()),
  });
  void semanticRanking
    .pruneOnModelChange()
    .catch((error) => console.error('Embedding prune failed:', error));

  const turnManager = new TurnManager({
    conversations: {
      createConversation: (title) => conversationService.createConversation(title),
      conversationExists: (id) => conversationService.conversationExists(id),
      getConversationById: (id) => conversationService.getConversationById(id),
      updateConversation: (id, data) => conversationService.updateConversation(id, data),
      setConversationMetadata: (id, metadata) => conversationService.setConversationMetadata(id, metadata),
    },
    messages: messageService,
    getConfig: () => configService.getConfig(),
    resolveKey: async (provider: LLMProvider) =>
      (await SecretService.getInstance().getSecret(providerSecretKey(provider.id))) ?? provider.apiKey,
    gateway: aiGateway,
    agent: createAssistantRunner({
      registry: toolRegistry,
      policy: toolPolicy,
      mcp: mcpManager,
      commands: { getAllTools: async () => commandService.buildAgentTools() },
      apps: {
        listEnabled: async () => appService.listEnabled(),
        budget: async () => configService.getConfig().toolApps.toolBudget,
        appContext: (appIds: string[]) => appContextFor(appIds),
      },
      checkpointer,
      toolFilter: (name) =>
        !name.startsWith('memory_') || configService.getConfig().behavior?.memoryContext !== false,
      semanticRanking,
    }),
    researchRunner: createResearchRunner({
      registry: toolRegistry,
      policy: toolPolicy,
      checkpointer,
    }),
    policy: toolPolicy,
    memories: {
      recall: (query, limit, charCap) => getMemoryService().recall(query, limit, charCap),
    },
    tools: {
      riskFor: async (name) => toolRegistry.riskFor(name) ?? (await mcpDirect.riskFor(name)),
      summarizeFor: async (name, args) =>
        toolRegistry.has(name) ? toolRegistry.summarizeFor(name, args) : mcpDirect.summarizeFor(name, args),
      editableArgs: (name) => toolRegistry.definition(name)?.editableArgs ?? false,
      requestedRoots: (name, args) =>
        toolPolicy.rootsNeedingGrant(toolRegistry.definition(name)?.pathArgs, args),
      executeDirect: async (name, args, ctx) =>
        toolRegistry.has(name)
          ? toolRegistry.executeDirect(name, args, { grantedRoots: toolPolicy.grantedRoots() ?? ctx.grantedRoots })
          : mcpDirect.execute(name, args as Record<string, unknown>),
    },
    decision: {
      tools: async () => {
        const config = configService.getConfig();
        return decisionToolSurface({
          native: toolRegistry.list().filter((def) => !toolPolicy.isDisabled(def.name)),
          mcp: (await mcpDecisionSnapshot()).filter((tool) => fastPathEligible(tool.appId)),
          scope: config.decision.scope,
          routeTools: config.decision.routeTools,
          knownModelIds: new Set(
            config.providers.flatMap((provider) => [
              ...(provider.availableModels ?? []),
              ...(provider.customModels ?? []),
            ]).map((model) => model.id)
          ),
          catalogEntities: decisionCatalogEntitiesFor(config.decision.scope.apps),
        });
      },
      run: async (input, tools) =>
        runDecision(decisionEngineDeps(), {
          config: configService.getConfig(),
          input,
          tools,
          systemPrompt: await decisionSystemPrompt(),
        }),
    },
    decisionSpeak: {
      run: async (input, questions) =>
        runDecision(decisionEngineDeps(), {
          config: configService.getConfig(),
          input,
          tools: [],
          questions,
        }),
    },
    broadcast: (event: TurnEvent) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('ai:turn-event', event);
        }
      });
      if (liveSession && isLiveActive(liveSession.getSnapshot().state)) {
        if (event.conversationId && event.conversationId !== liveConversationId) {
          liveTurnText = '';
          liveConversationId = event.conversationId;
        }
        if (event.phase === 'queued') {
          liveTurnText = '';
        }
        if (event.delta) {
          liveTurnText += event.delta;
          queueLiveCaption(liveTurnText, false);
        }
        if (event.phase === 'finished') {
          liveSession.turnFinished();
          const speech = (event.speakText ?? liveTurnText).trim();
          queueLiveCaption(speech, true);
          if (speech) {
            windowManager.speakInLiveHost(speech, liveSession.getSnapshot().session);
          }
          liveTurnText = '';
        } else if (event.phase === 'failed' || event.phase === 'cancelled') {
          liveSession.turnFailed();
          liveTurnText = '';
          queueLiveCaption('', true);
        } else if (event.phase === 'interrupt') {
          liveSession.approvalPending();
          liveTurnText = '';
        }
      }
    },
    notify: (title: string, body: string) => {
      const behavior = configService.getConfig().behavior;
      if (behavior?.notifyOnComplete === false) {
        return;
      }
      if (windowManager.areChatWindowsVisible()) {
        return;
      }
      void notificationService.notify({
        kind: 'system',
        severity: 'info',
        title,
        body,
        clickAction: 'none',
      });
    },
    recordCommand: (record) => {
      commandService.record(record);
    },
    checkpointer,
  });

  const liveTimers = new Map<number, ReturnType<typeof setTimeout>>();
  let liveTimerId = 0;

  let liveHandoffPending = false;
  let liveHandoffTimer: ReturnType<typeof setTimeout> | null = null;

  const clearLiveHandoff = (): void => {
    liveHandoffPending = false;
    if (liveHandoffTimer) {
      clearTimeout(liveHandoffTimer);
      liveHandoffTimer = null;
    }
  };

  /**
   * HUD-first live (plan 62 S4–S6): once the host reports listening, the
   * launcher hides and the HUD takes over. A failure surfaces the launcher
   * (with its live error) and leaves the HUD out of the way; a silent
   * timeout resets the session so Start is retryable.
   */
  const beginLiveHandoff = (): void => {
    liveHandoffPending = true;
    if (liveHandoffTimer) {
      clearTimeout(liveHandoffTimer);
    }
    liveHandoffTimer = setTimeout(() => {
      liveHandoffTimer = null;
      if (!liveHandoffPending) {
        return;
      }
      liveHandoffPending = false;
      liveSession?.stop('device-lost');
      windowManager.showMainWindow();
      void notificationService.notify({
        kind: 'system',
        severity: 'warn',
        title: TEXT.LIVE_ARIA,
        body: TEXT.LIVE_NOTICE_START_TIMEOUT,
        dedupeKey: 'live-start-timeout',
      });
    }, 10_000);
  };

  const finishLiveHandoff = (): void => {
    if (!liveHandoffPending) {
      return;
    }
    clearLiveHandoff();
    const posture = configService.getConfig().voice?.speechHudPosture ?? 'auto';
    if (posture === 'never') {
      windowManager.showMainWindow();
      return;
    }
    windowManager.hideChatWindows();
  };

  const failLiveHandoff = (): void => {
    if (!liveHandoffPending) {
      return;
    }
    clearLiveHandoff();
    windowManager.showMainWindow();
  };

  const sendLiveCaption = (text: string, final: boolean): void => {
    const snapshot = liveSession?.getSnapshot();
    if (!snapshot || snapshot.state === 'idle') {
      return;
    }
    const payload = {
      session: snapshot.session,
      seq: (liveCaptionSeq += 1),
      text: text.slice(0, 280),
      final,
    };
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed() && window.webContents.getURL().includes('speech-overlay.html')) {
        window.webContents.send('live:caption', payload);
      }
    });
  };

  const queueLiveCaption = (text: string, final: boolean): void => {
    if (final) {
      if (liveCaptionTimer) {
        clearTimeout(liveCaptionTimer);
        liveCaptionTimer = null;
      }
      pendingLiveCaption = '';
      sendLiveCaption(text, true);
      return;
    }
    pendingLiveCaption = text;
    if (liveCaptionTimer) {
      return;
    }
    liveCaptionTimer = setTimeout(() => {
      liveCaptionTimer = null;
      sendLiveCaption(pendingLiveCaption, false);
    }, 120);
  };

  const broadcastLive = (event: LiveEvent): void => {
    if (event.type === 'state') {
      if (event.snapshot.state === 'arming') {
        liveCaptionSeq = 0;
        beginLiveHandoff();
      } else if (event.snapshot.state === 'listening') {
        finishLiveHandoff();
      } else if (event.snapshot.state === 'error') {
        failLiveHandoff();
      } else if (event.snapshot.state === 'idle') {
        clearLiveHandoff();
      }
      if (event.snapshot.state === 'paused' && event.snapshot.reason === 'approval') {
        void notificationService
          .notify(
            buildLiveApprovalNotification({
              conversationId: liveConversationId,
              session: event.snapshot.session,
            })
          )
          .catch(() => undefined);
      }
      trayManager.setLiveState(event.snapshot);
      void windowManager.applyLiveSnapshot(event.snapshot);
    } else if (event.type === 'ended') {
      clearLiveHandoff();
    }
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('live:event', event);
      }
    });
  };

  const liveHost: LiveSessionHost = {
    broadcast: broadcastLive,
    startTurn: async (content) => {
      if (!liveConversationId) {
        throw new Error('No active conversation for live mode.');
      }
      await turnManager.start({ conversationId: liveConversationId, content });
    },
    cancelTurn: () => turnManager.cancel(),
    evaluateUtterance: (text) => evaluateVoiceUtterance(text, liveConversationId ?? undefined),
    runLiveIntent: (input) =>
      runLiveIntentPoint(
        {
          decision: {
            run: (prompt, questions) =>
              runDecision(decisionEngineDeps(), {
                config: configService.getConfig(),
                input: prompt,
                tools: [],
                questions,
              }),
          },
        },
        input
      ),
    recentExchange: () => recentExchangeFor(liveConversationId ?? undefined),
    idleTimeoutMs: () => configService.getConfig().voice?.liveIdleTimeoutMs ?? LIVE_IDLE_TIMEOUT_MS,
    turnCap: () => configService.getConfig().voice?.liveTurnCap ?? 0,
    setTimer: (fn, ms) => {
      const id = (liveTimerId += 1);
      liveTimers.set(
        id,
        setTimeout(() => {
          liveTimers.delete(id);
          fn();
        }, ms)
      );
      return id;
    },
    clearTimer: (handle) => {
      const timer = liveTimers.get(handle);
      if (timer) {
        clearTimeout(timer);
        liveTimers.delete(handle);
      }
    },
  };

  liveSession = new LiveSessionService(liveHost);

  windowManager.on('live-host-gone', () => {
    const snapshot = liveSession?.getSnapshot();
    if (!snapshot || snapshot.state === 'idle') {
      return;
    }
    liveTurnText = '';
    liveSession?.stop('device-lost');
    void notificationService.notify({
      kind: 'system',
      severity: 'warn',
      title: TEXT.LIVE_ARIA,
      body: TEXT.LIVE_NOTICE_HOST_STOPPED,
      dedupeKey: 'live-host-stopped',
    });
  });

  const liveIsActive = (): boolean => {
    const snapshot = liveSession?.getSnapshot();
    return snapshot ? isLiveActive(snapshot.state) : false;
  };

  const endLive = (): void => {
    if (!liveSession || !liveIsActive()) {
      return;
    }
    liveSession.stop('user');
    liveConversationId = null;
  };

  const speechStop = (): void => {
    speechService.stop();
  };

  const broadcastStopSpeaking = (): void => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('hotkey:stop-speaking');
      }
    });
  };

  hotkeyService.setLiveInterruptHandlers({
    interrupt: () => {
      const snapshot = liveSession?.getSnapshot();
      if (!snapshot || !isLiveActive(snapshot.state)) {
        speechStop();
        broadcastStopSpeaking();
        return;
      }
      if (snapshot.state === 'speaking') {
        liveSession!.interrupt();
      } else {
        endLive();
      }
    },
    stop: () => {
      if (liveIsActive()) {
        liveSession!.interrupt();
        return;
      }
      speechStop();
      broadcastStopSpeaking();
    },
    end: () => {
      endLive();
    },
  });

  const scheduleService = new ScheduleService({
    store: {
      findMany: () => databaseService.getClient().schedule.findMany({ orderBy: { createdAt: 'asc' } }),
      findUnique: (id) => databaseService.getClient().schedule.findUnique({ where: { id } }),
      create: (data) => databaseService.getClient().schedule.create({ data: { ...data, spec: data.spec as never } }),
      update: (id, data) =>
        databaseService.getClient().schedule.update({
          where: { id },
          data: { ...data, ...(data.spec ? { spec: data.spec as never } : {}) },
        }),
      remove: async (id) => {
        await databaseService.getClient().schedule.delete({ where: { id } });
      },
    },
    runTurn: async (prompt, conversationId) => {
      await turnManager.start({
        conversationId: conversationId ?? `temp-schedule-${randomUUID()}`,
        content: prompt,
      });
      return conversationId;
    },
    createConversation: async (title) => {
      const created = await conversationService.createConversation(title);
      return { id: created.id };
    },
    isBusy: () => turnManager.isActive(),
    runMiniApp: async (schedule) => {
      const started = await miniAppRunService.start(schedule.packId, schedule.rootPath, { disallowArm: true });
      if (!started.ok) {
        throw new Error(miniApps.formatError(started.error));
      }
      const run = await miniAppRunService.getRun(started.runId);
      return run?.conversationId ?? null;
    },
  });
  scheduleService.start();

  hotkeyService.setCommandRunner(
    createCommandHotkeyRunner({
      commandService,
      commandTitle: (commandId) => commandService.list().find((entry) => entry.id === commandId)?.title ?? null,
      binding: (commandId) => configService.getConfig().commands?.commandHotkeys?.[commandId],
      saveConversationId: async (commandId, conversationId) => {
        const commands = configService.getConfig().commands;
        await configService.updateConfig({
          commands: {
            ...commands,
            commandHotkeys: {
              ...(commands?.commandHotkeys ?? {}),
              [commandId]: { ...(commands?.commandHotkeys?.[commandId] ?? { accelerator: '' }), conversationId },
            },
          },
        });
        hotkeyService.registerAll();
      },
      createConversation: async (title) => {
        const created = await conversationService.createConversation(title);
        return { id: created.id };
      },
      startTurn: async (request) => (await turnManager.start(request)).tempMessageId,
      isBusy: () => turnManager.isActive(),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      notify: (title, body) => {
        const behavior = configService.getConfig().behavior;
        if (behavior?.notifyOnComplete === false) {
          return;
        }
        if (windowManager.areChatWindowsVisible()) {
          return;
        }
        void notificationService.notify({
          kind: 'schedule',
          severity: 'info',
          title,
          body,
          clickAction: 'none',
        });
      },
    })
  );

  const searchService = SearchService.getInstance();

  const translationService = TranslateService.getInstance();

  const decisionSettings = new DecisionSettingsController({
    config: () => configService.getConfig(),
    getApiKey: async (provider: LLMProvider) =>
      (await SecretService.getInstance().getSecret(providerSecretKey(provider.id))) ?? provider.apiKey,
    configRevision: () => configService.getRevision(),
    observeResolvedModel: decisionEngineDeps().observeResolvedModel,
  });

  const memoryConsolidation = new MemoryConsolidationService({
    configService,
    gateway: aiGateway,
  });
  getMemoryService().setConsolidator((newContent, candidate) =>
    memoryConsolidation.arbitrateSave(newContent, candidate)
  );

  const desktopContext = new DesktopContextService({ getConfig: () => configService.getConfig() });

  const speechCache = SpeechCacheService.getInstance();
  const speechService = new SpeechService({
    broadcast: (snapshot) => {
      trayManager.setSpeechState(snapshot);
      void windowManager.applySpeechSnapshot(snapshot);
      broadcastSpeechState(BrowserWindow.getAllWindows(), snapshot);
    },
    notify: (notice) => {
      void notificationService.notify(speechNoticeInput(notice));
    },
    liveActive: () => liveIsActive(),
    readSelection: () => desktopContext.readPrimarySelection(),
    readClipboard: () => desktopContext.readClipboard(),
    resolveTarget: (overrides) => ttsService.resolveTarget(overrides),
    synthesize: (params) => ttsService.speakResolved(params),
    cancelSynthesis: (requestId) => {
      cancelAudioOp(requestId);
    },
    cacheKey: (input) => speechCache.keyOf(input),
    cacheLookup: (key) => speechCache.lookup(key),
    cacheStore: (key, audio) => speechCache.store(key, audio),
    cacheRegister: (keys) => speechCache.registerUtterance(keys),
    play: (instruction) => sendToSpeechOverlays(BrowserWindow.getAllWindows(), 'speech:play', instruction),
    stopPlayback: () => sendToSpeechOverlays(BrowserWindow.getAllWindows(), 'speech:stop'),
    selectionMaxChars: () => configService.getConfig().voice?.selectionMaxChars ?? 8000,
    now: () => Date.now(),
    onHistoryAvailable: (available) => trayManager.setSpeechReplayAvailable(available),
  });

  hotkeyService.setSpeechHandlers({
    speakSelection: () => {
      void speechService.speakSelection();
    },
    speakClipboard: () => {
      void speechService.speakClipboard();
    },
    togglePause: () => {
      const state = speechService.getSnapshot().state;
      if (state === 'paused') {
        speechService.control('resume');
      } else if (state !== 'idle') {
        speechService.control('pause');
      }
    },
    stop: () => speechService.stop(),
    replayLast: () => {
      const latest = speechService.getHistory()[0];
      if (latest) {
        void speechService.replay(latest.utteranceId);
      }
    },
  });

  hotkeyService.setCommandLabelResolver(
    (commandId) => commandService.list().find((entry) => entry.id === commandId)?.title ?? null
  );

  hotkeyService.setHotkeyUnavailableHandler((hotkey: HotkeyConfig) => {
    void notificationService.notify(
      speechNoticeInput({ code: 'hotkey_unavailable', detail: hotkey.accelerator ?? hotkey.label })
    );
  });

  registerAiIpc({
    aiService,
    ttsService,
    sttService,
    turnManager,
    liveSession: () => liveSession,
    evaluateUtterance: evaluateVoiceUtterance,
  });
  registerAttachmentIpc({ attachmentService });
  registerConfigIpc({ configService, windowManager, hotkeyService });
  registerProviderIpc({ configService });
  registerConversationsIpc({ conversationService, messageService });
  registerMessagesIpc({ messageService, turnManager });
  registerHotkeysIpc({ hotkeyService });
  registerToolsIpc({ configService, toolPolicy, appService, mcpManager, windowManager });
  registerDocsIpc({ configService });
  registerAppsIpc({ configService, appService, mcpManager, contextDigests });
  registerSchedulesIpc({ scheduleService });
  registerCommandsIpc({ commandService, appDiscovery });
  registerSearchIpc({ searchService });
  registerTranslationIpc({ translationService });
  registerDecisionsIpc({ decisionSettings });
  registerMemoryIpc({ consolidation: memoryConsolidation });
  registerLiveIpc({
    session: liveSession!,
    onLevel: (level) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed() && window.webContents.getURL().includes('speech-overlay.html')) {
          window.webContents.send('live:mic-level', level);
        }
      });
    },
    setConversationId: (id) => {
      liveConversationId = id;
    },
    onStart: () => speechService.stop(),
    host: {
      start: () => windowManager.startLiveHost(),
      stop: () => windowManager.stopLiveHost(),
      ready: () => windowManager.markLiveHostReady(),
    },
  });
  registerSystemIpc({ desktopContext, toolPolicy, notify: (input) => notificationService.notify(input) });
  registerNotificationsIpc({
    list: (limit) => notificationService.list(limit),
    markRead: (id) => notificationService.markRead(id),
    markAllRead: () => notificationService.markAllRead(),
    clear: () => notificationService.clear(),
    click: async (id) => {
      const record = await notificationService.get(id);
      if (!record) {
        return false;
      }
      const routed = routeNotificationRecord?.(record) ?? false;
      await notificationService.markRead(id);
      return routed;
    },
  });
  const sendHubResult = (result: HubResult): void => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (window.isDestroyed()) {
        return;
      }
      const url = window.webContents.getURL();
      if (url.includes('speech-overlay.html') || url.includes('hub-popover.html')) {
        window.webContents.send('hub:result', result);
      }
    });
  };

  const sendHubSelection = (state: { available: boolean }): void => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (window.isDestroyed()) {
        return;
      }
      if (window.webContents.getURL().includes('speech-overlay.html')) {
        window.webContents.send('hub:selection', state);
      }
    });
  };

  const sendHubBusy = (busy: HubBusy): void => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (window.isDestroyed()) {
        return;
      }
      const url = window.webContents.getURL();
      if (url.includes('speech-overlay.html') || url.includes('hub-popover.html')) {
        window.webContents.send('hub:busy', busy);
      }
    });
  };

  const hubService = new HubService({
    getConfig: () => configService.getConfig(),
    getSpeech: () => speechService.getSnapshot(),
    getLive: () => liveSession!.getSnapshot(),
    readSelection: () => desktopContext.readPrimarySelection(),
    readClipboard: () => clipboard.readText(),
    translate: (text, target) => translationService.translate({ text, target }),
    speakSelection: () => speechService.speakSelection(),
    speakClipboard: () => speechService.speakClipboard(),
    speechControl: (action) => speechService.control(action),
    liveInterrupt: () => {
      const snapshot = liveSession?.getSnapshot();
      if (snapshot && (snapshot.state === 'speaking' || snapshot.state === 'preparing')) {
        liveSession!.interrupt();
      }
    },
    liveEnd: () => endLive(),
    startLive: () => hotkeyService.triggerStartLive(),
    endLive: () => hotkeyService.triggerEndLive(),
    openAssistant: () => windowManager.showMainWindow(),
    hideHub: () => windowManager.hideSpeechHudForSession(),
    openSettings: () => windowManager.showSettingsWindow({ tab: 'hub' }),
    startDictation: () => windowManager.startDictation(),
    sendResult: sendHubResult,
    openResult: (text) => windowManager.openLauncherWithText(text),
    sendBusy: sendHubBusy,
    sendSelection: sendHubSelection,
  });
  registerHubIpc({
    service: hubService,
    open: () => windowManager.toggleHubPopover(),
    close: () => windowManager.hideHubPopover(),
    openSettings: () => windowManager.showSettingsWindow({ tab: 'hub' }),
    copy: (text) => clipboard.writeText(text),
    activateResult: () => hubService.activateResult(),
    checkSelection: () => void hubService.checkSelection(),
  });

  registerSpeechIpc({
    cache: speechCache,
    speech: speechService,
    hudDrag: {
      begin: (x, y) => windowManager.beginSpeechHudDrag(x, y),
      move: (x, y) => windowManager.moveSpeechHudDrag(x, y),
      end: () => windowManager.endSpeechHudDrag(),
      cancel: () => windowManager.cancelSpeechHudDrag(),
    },
    live: {
      interruptReply: () => {
        const snapshot = liveSession?.getSnapshot();
        if (snapshot && (snapshot.state === 'speaking' || snapshot.state === 'preparing')) {
          liveSession!.interrupt();
        }
      },
      end: () => endLive(),
    },
    hud: {
      menu: () => windowManager.showSpeechHudMenu(),
      openAssistant: () => windowManager.showMainWindow(),
      busy: (active) => windowManager.setHudBusy(active),
    },
  });
  registerWindowIpc({ windowManager });
  registerMiniAppIpc(miniApps, miniApps.fsEnv);

  const connectorAccountsStore = createPrismaConnectorStore(() => databaseService.getClient());
  const openAuthorizeUrl = (url: string): Promise<unknown> => shell.openExternal(url);
  const oauthService = new OAuthService({
    secrets: SecretService.getInstance(),
    accounts: connectorAccountsStore,
    openExternal: openAuthorizeUrl,
    catalogRow: (providerId) => {
      const row = loadProviderCatalog().providers.find((entry) => entry.id === providerId) ?? null;
      return row && row.serviceConfig.calendar ? row : null;
    },
    clientId: (row) => clientIdFor(row),
    clientSecret: (row) => clientSecretFor(row),
    notify: (_accountId, condition) => {
      void notificationService.notify({
        kind: 'system',
        severity: 'warn',
        title: condition === 'failing' ? TEXT.CALENDAR_SYNC_FAILING_TITLE : TEXT.CALENDAR_NEEDS_AUTH_TITLE,
        body: condition === 'failing' ? TEXT.CALENDAR_SYNC_FAILING_BODY : TEXT.CALENDAR_NEEDS_AUTH_BODY,
        clickAction: 'open-settings',
      });
    },
  });
  const connectorService = new ConnectorService({
    secrets: SecretService.getInstance(),
    accounts: connectorAccountsStore,
    oauth: oauthService,
  });
  setConnectorServiceProvider(() => connectorService);
  // External-mutation audit rows (ADR-0052 §8): counts + typed codes only.
  setConnectorAuditClientProvider(() => databaseService.getClient());
  void oauthService.resumeSchedules().catch((error) => console.error('Calendar refresh resume failed:', error));
  app.once('will-quit', () => {
    void oauthService.stopAll();
  });
  registerCalendarIpc({ connectorService });

  console.log('IPC handlers registered successfully');
  return { speech: speechService };
}

export function removeIpcHandlers(): void {
  removeAllIpcHandlers();
  console.log('IPC handlers removed');
}
