import * as fs from 'fs';
import { ipcMain, dialog, shell, app, BrowserWindow, desktopCapturer, screen, Menu, clipboard, Notification } from 'electron';
import { randomUUID } from 'crypto';
import { DatabaseService } from '@main/services/DatabaseService';
import { ConversationService } from '@main/services/ConversationService';
import { MessageService } from '@main/services/MessageService';
import { MainConfigService } from '@main/services/ConfigService';
import { SecretService, providerSecretKey, typesafeSecretKey } from '@main/services/SecretService';
import { MessageCreate, stringToMessageRole } from '@shared/database-types';
import { writeFile, readFile, stat } from 'fs/promises';
import { resolveWithinGrantedRoots } from '@main/ai/tools/policy';
import { EXECUTABLE_EXTENSIONS } from '@main/ai/tools/native/open-path';
import { AppConfig } from '@shared/config/AppConfig';
import { WindowManager } from '@main/window';
import { Settings, HotkeySettings, LLMProvider, IPCResponse, AIMessage, Model, PdfProcessResponse, ConversationMetadata, ProviderTestResult, SetupProviderResult, isResizeCorner, type ResizeCorner, type AutostartStatus } from '@shared/types';
import type { TurnEvent, TurnStartRequest, ToolClassDefaults, ToolRiskClass, ToolCatalogEntry, ToolVerificationSettings } from '@shared/turns';
import { HotkeyService } from '@main/services/HotkeyService';
import { AIService } from '@main/services/AIService';
import { AttachmentService } from '@main/services/AttachmentService';
import { SttService } from '@main/services/SttService';
import { TtsService } from '@main/services/TtsService';
import { compactTtsError } from '@main/ai/tts';
import { MemoryConsolidationService } from '@main/services/MemoryConsolidationService';
import { TurnManager } from '@main/turns/TurnManager';
import { runDecision } from '@main/ai/decide';
import { assembleDecisionPrompt } from '@main/ai/decide/prompt';
import { decisionToolSurface, type DecisionMcpToolSnapshot } from '@main/ai/decide/tool-surface';import { DecisionSettingsController } from '@main/ai/decide/settings-controller';
import { needleResourceDir, needleUserDataDir } from '@main/ai/decide/needle/context';
import { ContextDigestService } from '@main/ai/tools/apps/context-digests';
import { homeAssistantDigestProvider } from '@main/ai/tools/apps/context-providers/home-assistant';
import { McpDirectExecutor, snapshotDecisionMcpTools } from '@main/ai/tools/mcp-direct';
import type { McpServerConfig } from '@shared/mcp';
import { getToolResultService } from '@main/services/ToolResultService';
import { aiGateway } from '@main/ai/gateway';
import { evaluateUtterance, FAIL_VERDICT } from '@main/ai/utterance';
import { buildDefaultToolRegistry, NATIVE_TOOL_CATALOG } from '@main/ai/tools/native';
import { downloads } from '@main/ai/tools/downloads';
import { getDocsIndexService } from '@main/services/DocsIndexService';
import { getToolUsageStats, getAppUsageStats, pruneGraphNodeRuns } from '@main/ai/audit';
import { ScheduleService, type ScheduleInput } from '@main/services/ScheduleService';
import { createCommandHotkeyRunner } from '@main/services/commandHotkeyRunner';
import { createAssistantRunner } from '@main/ai/graphs/assistant';
import { createResearchRunner } from '@main/ai/graphs/research';
import { ToolPolicyEngine, defaultPolicySnapshot } from '@main/ai/tools/policy';
import { nativeCatalogEntries } from '@main/ai/tools/catalog';
import { McpManager } from '@main/ai/tools/mcp';
import { ResidencyService } from '@main/services/ResidencyService';
import { PrismaCheckpointSaver } from '@main/ai/checkpointer';
import type { ApprovalResolution } from '@shared/turns';
import type { EntityScope, ToolAppSaveInput, ToolAppView } from '@shared/apps';
import { AppService, type AppServiceDeps } from '@main/services/AppService';
import { AiTask } from '@shared/types';
import { resolveTaskModel } from '@shared/ai/tasks';
import { setDefaultModel, setupProviderFromPreset } from '@main/ai/providers/setup';
import { supportsProviderToolSearch } from '@main/ai/chat-models';
import { entityAllowedByScope, extractEntityIds } from '@main/ai/tools/app-selection';
import { APP_PRESETS, fastPathEligible } from '@shared/app-presets';
import type { SearchProviderSaveInput, SearchProviderView, SearchProviderTestResult } from '@shared/search';
import { SearchService } from '@main/services/SearchService';
import type {
  TranslationProviderSaveInput,
  TranslationProviderTestResult,
  TranslationProviderView,
  TranslationRunResult,
} from '@shared/translation';
import { TranslateService } from '@main/services/TranslateService';
import { getMemoryService } from '@main/services/MemoryService';
import type { MemoryRestoreInput, MemoryView } from '@shared/memory';
import { DesktopContextService } from '@main/services/DesktopContextService';
import type { ClipboardChange, SelectionResult } from '@main/services/DesktopContextService';
import { CommandService, type BuiltinActionHandlers } from '@main/services/CommandService';
import { AppDiscoveryService } from '@main/services/AppDiscoveryService';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';


export function setupIpcHandlers(
  databaseService: DatabaseService, 
  windowManager: WindowManager,
  hotkeyService: HotkeyService
): void {
  const conversationService = new ConversationService(databaseService);
  const messageService = new MessageService(databaseService, conversationService);
  const configService = MainConfigService.getInstance();
  const attachmentService = AttachmentService.getInstance(configService.getConfig());
  const sttService = new SttService();
  const ttsService = new TtsService();

  ipcMain.handle('ai:tts-synthesize', async (_event, text: string, requireToggle?: boolean) => {
    if (typeof text !== 'string' || text.length === 0 || text.length > 8000) {
      return null;
    }
    try {
      return await ttsService.speak(text, requireToggle !== false);
    } catch (error) {
      console.error('TTS synthesis failed:', error);
      throw new Error(compactTtsError(error));
    }
  });

  const aiService = new AIService();
  // =============================================================================
  // CONFIGURATION MANAGEMENT
  // =============================================================================

  ipcMain.handle('config:load', async () => {
    try {
      return configService.getConfig();
    } catch (error) {
      console.error('Failed to load config via IPC:', error);
      return null;
    }
  });

  ipcMain.handle('config:save', async (event, config: Partial<AppConfig>) => {
    try {
      const previousTransparent = configService.getConfig().window?.transparent;
      const previousAutostart = configService.getConfig().preferences?.autostart ?? false;
      await configService.updateConfig(config);

      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('config-updated', config);
      });

      if (config.window && config.window.transparent !== previousTransparent) {
        void windowManager.recreateMainWindow();
      }

      const nextAutostart = configService.getConfig().preferences?.autostart ?? false;
      if (nextAutostart !== previousAutostart) {
        ResidencyService.getInstance().apply(nextAutostart);
      }

      hotkeyService.registerAll();
      return true;
    } catch (error) {
      console.error('Failed to save config via IPC:', error);
      throw error;
    }
  });

  ipcMain.handle('config:reset', async (_event) => {
    try {
      await configService.resetToDefaults()
      ResidencyService.getInstance().apply(configService.getConfig().preferences?.autostart ?? false);
    } catch (error) {
      console.error('Failed to save config via IPC:', error);
      throw error;
    }
  });

  ipcMain.handle('config:export', async (_event) => {
    try {
      return await configService.exportConfig();
    } catch (error) {
      console.error('Failed to save config via IPC:', error);
      throw error;
    }
  });
  ipcMain.handle('get-screen-sources', async (_event) => {
    const sources = await desktopCapturer.getSources({ 
        types: ['window', 'screen'],
        fetchWindowIcons: true,
        thumbnailSize: { width: 300, height: 300 } 
    });
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null
    }));
  });

  ipcMain.handle('capture-high-res-source', async (event, sourceId: string) => {
    if (!sourceId) {
      throw new Error('Source ID is required');
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const requiredSize = primaryDisplay.size;

    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: {
        width: requiredSize.width,
        height: requiredSize.height
      }
    });

    const selectedSource = sources.find(s => s.id === sourceId);

    if (!selectedSource) {
      throw new Error(`Source with ID "${sourceId}" not found or has been closed.`);
    }

    return selectedSource.thumbnail.toDataURL();
  });

  ipcMain.handle('stt:transcribe', async (_event, audioData: Uint8Array) => {
    try {
      const audioBuffer = Buffer.from(audioData);
      
      const transcription = await sttService.transcribe(audioBuffer);
      return transcription;
    } catch (error) {
      console.error('IPC Handler Error [stt:transcribe]:', error);
      throw error; 
    }
  });

  ipcMain.handle('voice:evaluate-utterance', async (_event, text: string, conversationId?: string) => {
    try {
      const config = configService.getConfig();
      let recentExchange: string | undefined;
      if (config.voice?.attachContext && conversationId) {
        try {
          const conversation = await conversationService.getConversationById(conversationId);
          const messages = (conversation?.messages ?? []).filter((message) => message.content.trim());
          const lastTwo = messages.slice(-2).reverse();
          recentExchange = lastTwo
            .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content.trim().slice(0, 600)}`)
            .join('\n');
        } catch (error) {
          console.warn('voice:evaluate-utterance: context load failed, continuing without context:', error);
        }
      }
      return await evaluateUtterance(config, {
        gateway: aiGateway,
        resolveKey: async (provider: LLMProvider) =>
          (await SecretService.getInstance().getSecret(providerSecretKey(provider.id))) ?? provider.apiKey,
      }, text, { recentExchange });
    } catch (error) {
      console.error('IPC Handler Error [voice:evaluate-utterance]:', error);
      return FAIL_VERDICT;
    }
  });

  ipcMain.handle(
    'download-attachment',
    async (event, args: { dataUrl: string; filename: string }) => {
      try {
        const { dataUrl, filename } = args;

        if (!dataUrl || !filename) {
          throw new Error('Invalid arguments: dataUrl and filename are required.');
        }

        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
          throw new Error('Could not find the associated browser window.');
        }

        const result = await dialog.showSaveDialog(window, {
          title: 'Save Attachment',
          defaultPath: filename,
          buttonLabel: 'Save',
        });

        if (result.canceled || !result.filePath) {
          console.log('Attachment download cancelled by user.');
          return { success: true, cancelled: true };
        }
        const base64Data = dataUrl.split(';base64,').pop();
        if (!base64Data) {
          throw new Error('Invalid Data URL format.');
        }
        
        const buffer = Buffer.from(base64Data, 'base64');

        fs.writeFileSync(result.filePath, buffer);

        console.log(`Attachment saved successfully to: ${result.filePath}`);
        
        return { success: true, path: result.filePath };

      } catch (error) {
        console.error('Failed to download attachment:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle('process-pdf-attachment', async (event, dataUrl: string): Promise<PdfProcessResponse> => {
    try {
      const result = await attachmentService.processPdf(dataUrl);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('config:get-path', () => {
    return configService.getConfigPath('config.json');
  });

  ipcMain.handle('config:import', async (event, configJson: string) => {
    try {
      return await configService.importConfig(configJson);
    } catch (error) {
      console.error('Failed to import config:', error);
      return false;
    }
  });

  // =============================================================================
  // AI SERVICE OPERATIONS
  // =============================================================================
  ipcMain.handle('ai:generate-response', async (event, messages: AIMessage[]) => {
    try {
      const response = await aiService.generateResponse(messages);
      return response;
    } catch (error) {
      console.error('Failed to generate AI response:', error);
      throw error;
    }
  });

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
  const appServiceDeps: AppServiceDeps = {
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
    hasSecret: (key) => SecretService.getInstance().hasSecret(key),
    newId: () => randomUUID(),
    resetConnections: () => mcpManager.close(),
    invalidateDigest: (serverId) => contextDigests.invalidate(serverId),
  };
  const appService = new AppService(appServiceDeps);
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
  void appService.boot().catch((error) => console.error('Tool-apps boot failed:', error));
  app.once('will-quit', () => {
    void mcpManager.close();
  });
  const checkpointer = new PrismaCheckpointSaver(() => {
    try {
      return databaseService.getClient();
    } catch {
      return null;
    }
  });
  void checkpointer
    .setup()
    .then(() => checkpointer.prune())
    .then(() => pruneGraphNodeRuns())
    .catch((error) => console.error('Checkpointer boot failed (in-memory fallback applies to new turns only):', error));
  void getToolResultService()
    .prune()
    .catch((error) => console.error('Tool-result prune failed:', error));
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
    storeSecret: (key, value) => SecretService.getInstance().setSecret(key, value),
    resolveSecret: async (key) => await SecretService.getInstance().getSecret(key),
    deleteSecret: (key) => SecretService.getInstance().deleteSecret(key),
  });
  void appDiscovery
    .scan(false)
    .catch((error) => console.error('App discovery scan failed:', error));
  void commandService
    .validateStoredIntegrations()
    .catch((error) => console.error('Integration validation failed:', error));
  void commandService
    .pruneHistory()
    .catch((error) => console.error('Command-history prune failed:', error));
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

  const turnManager = new TurnManager({
    conversations: conversationService,
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
        });
      },
      run: async (input, tools) =>
        runDecision(
          {
            getApiKey: async (provider: LLMProvider) =>
              (await SecretService.getInstance().getSecret(providerSecretKey(provider.id))) ?? provider.apiKey,
            getJevKey: async () => SecretService.getInstance().getSecret(typesafeSecretKey()),
          },
          { config: configService.getConfig(), input, tools, systemPrompt: await decisionSystemPrompt() }
        ),
    },
    broadcast: (event: TurnEvent) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('ai:turn-event', event);
        }
      });
    },
    notify: (title: string, body: string) => {
      const behavior = configService.getConfig().behavior;
      if (behavior?.notifyOnComplete === false) {
        return;
      }
      if (windowManager.areChatWindowsVisible()) {
        return;
      }
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
    },
    recordCommand: (record) => {
      commandService.record(record);
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
      startTurn: async (request) => turnManager.start(request),
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
        if (Notification.isSupported()) {
          new Notification({ title, body }).show();
        }
      },
    })
  );

  ipcMain.handle('schedules:list', async () => {
    return scheduleService.list();
  });

  ipcMain.handle('schedules:create', async (_event, input: ScheduleInput) => {
    return scheduleService.create(input);
  });

  ipcMain.handle('schedules:update', async (_event, id: string, patch: Partial<ScheduleInput> & { enabled?: boolean }) => {
    return scheduleService.update(id, patch);
  });

  ipcMain.handle('schedules:delete', async (_event, id: string) => {
    await scheduleService.remove(id);
    return true;
  });

  ipcMain.handle('schedules:run-now', async (_event, id: string) => {
    return scheduleService.runNow(id);
  });

  ipcMain.handle('tools:usage-stats', async (_event, windowDays: number | null) => {
    const days = windowDays === 7 || windowDays === 30 ? windowDays : null;
    return getToolUsageStats(days);
  });

  ipcMain.handle('apps:usage-stats', async (_event, windowDays: number | null) => {
    const days = windowDays === 7 || windowDays === 30 ? windowDays : null;
    return getAppUsageStats(days, (tool, mcpServer) => appService.appDisplayNameForTool(tool, mcpServer));
  });

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

  ipcMain.handle('ai:turn-start', async (event, request: TurnStartRequest) => {
    try {
      const tempMessageId = await turnManager.start(request);
      return { tempMessageId };
    } catch (error) {
      console.error('Failed to start turn:', error);
      throw error;
    }
  });

  ipcMain.handle('ai:turn-cancel', async () => {
    return turnManager.cancel();
  });

  ipcMain.handle('ai:turn-resume', async (_event, resolution: ApprovalResolution) => {
    return turnManager.resolveApproval(resolution);
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

  ipcMain.handle('commands:get-catalog', async () => {
    await appDiscovery.ensureWarm();
    return commandService.snapshot();
  });

  ipcMain.handle('commands:refresh-apps', async () => {
    const apps = await appDiscovery.scan(true);
    return { count: apps.length };
  });

  ipcMain.handle('commands:get-app-icon', async (_event, appId: string) => {
    if (typeof appId !== 'string' || appId.length === 0 || appId.length > 200) {
      return null;
    }
    const app = appDiscovery.getApps().find((candidate) => candidate.id === appId);
    if (!app) {
      return null;
    }
    return appDiscovery.iconDataUrl(app);
  });

  ipcMain.handle('commands:execute', async (_event, commandId: string, argv: unknown, source: unknown) => {
    if (typeof commandId !== 'string' || commandId.length === 0 || commandId.length > 200) {
      return { status: 'error', error: 'Invalid command id.' };
    }
    if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== 'string')) {
      return { status: 'error', error: 'Invalid command arguments.' };
    }
    const invocationSource = source === 'hotkey' ? 'hotkey' : 'palette';
    return commandService.execute(commandId, argv as string[], invocationSource);
  });

  ipcMain.handle('commands:clear-history', async () => {
    await commandService.clearHistory();
    return true;
  });

  ipcMain.handle('commands:save-custom', async (_event, def) => {
    if (typeof def !== 'object' || def === null) {
      return { ok: false, error: 'Invalid command definition.' };
    }
    return commandService.saveCustom(def);
  });

  ipcMain.handle('commands:delete-custom', async (_event, id: string) => {
    if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
      return false;
    }
    return commandService.deleteCustom(id);
  });

  ipcMain.handle('commands:import-integration', async (_event, json: string, secrets: Record<string, string>) => {
    if (typeof json !== 'string' || json.length === 0 || json.length > 200_000) {
      return { ok: false, error: 'Invalid manifest.' };
    }
    const safeSecrets: Record<string, string> = {};
    for (const [name, value] of Object.entries(typeof secrets === 'object' && secrets !== null ? secrets : {})) {
      if (typeof name === 'string' && name.length <= 100 && typeof value === 'string' && value.length <= 10_000) {
        safeSecrets[name] = value;
      }
    }
    return commandService.importPack(json, safeSecrets);
  });

  ipcMain.handle('commands:remove-integration', async (_event, packId: string) => {
    if (typeof packId !== 'string' || packId.length === 0 || packId.length > 200) {
      return false;
    }
    return commandService.removePack(packId);
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

  // =============================================================================
  // TOOL APPS (plan 15) — apps are the only MCP registration path (D11);
  // secrets live only in the keyring — masked-IPC pattern
  // =============================================================================

  ipcMain.handle('apps:get-state', async (): Promise<{ apps: ToolAppView[]; deferredSupported: boolean; nativeToolCount: number }> => {
    const chatModel = resolveTaskModel(configService.getConfig(), AiTask.CHAT);
    const deferredSupported = chatModel
      ? supportsProviderToolSearch(chatModel.provider, chatModel.modelId)
      : false;
    return { apps: await appService.getState(), deferredSupported, nativeToolCount: appService.nativeToolCount() };
  });

  /** Plan 23 S6 readout: cached digest stats per enabled app (no fetch). */
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

  // =============================================================================
  // WEB SEARCH PROVIDERS (keys live only in the keyring — masked-IPC pattern)
  // =============================================================================

  const searchService = SearchService.getInstance();

  ipcMain.handle('search:get-providers', async (): Promise<SearchProviderView[]> => {
    return searchService.listProviders();
  });

  ipcMain.handle('search:save-provider', async (_event, input: SearchProviderSaveInput): Promise<SearchProviderView> => {
    return searchService.saveProvider(input);
  });

  ipcMain.handle('search:delete-provider', async (_event, providerId: string): Promise<boolean> => {
    return searchService.deleteProvider(providerId);
  });

  ipcMain.handle('search:set-provider-enabled', async (_event, providerId: string, enabled: boolean): Promise<boolean> => {
    return searchService.setProviderEnabled(providerId, enabled);
  });

  ipcMain.handle('search:move-provider', async (_event, providerId: string, direction: 'up' | 'down'): Promise<boolean> => {
    return searchService.moveProvider(providerId, direction);
  });

  ipcMain.handle('search:test-provider', async (_event, providerId: string): Promise<SearchProviderTestResult> => {
    return searchService.testProvider(providerId);
  });

  const translationService = TranslateService.getInstance();

  ipcMain.handle('translation:get-providers', async (): Promise<TranslationProviderView[]> => {
    return translationService.listProviders();
  });

  ipcMain.handle('translation:save-provider', async (_event, input: TranslationProviderSaveInput): Promise<TranslationProviderView> => {
    return translationService.saveProvider(input);
  });

  ipcMain.handle('translation:delete-provider', async (_event, providerId: string): Promise<boolean> => {
    return translationService.deleteProvider(providerId);
  });

  ipcMain.handle('translation:set-provider-enabled', async (_event, providerId: string, enabled: boolean): Promise<boolean> => {
    return translationService.setProviderEnabled(providerId, enabled);
  });

  ipcMain.handle('translation:move-provider', async (_event, providerId: string, direction: 'up' | 'down'): Promise<boolean> => {
    return translationService.moveProvider(providerId, direction);
  });

  ipcMain.handle('translation:test-provider', async (_event, providerId: string): Promise<TranslationProviderTestResult> => {
    return translationService.testProvider(providerId);
  });

  const decisionSettings = new DecisionSettingsController({
    config: () => configService.getConfig(),
    userDataDir: () => needleUserDataDir(),
    resourceDir: () => needleResourceDir(),
    getApiKey: async (provider: LLMProvider) =>
      (await SecretService.getInstance().getSecret(providerSecretKey(provider.id))) ?? provider.apiKey,
    getJevKey: async () => SecretService.getInstance().getSecret(typesafeSecretKey()),
  });

  ipcMain.handle('decisions:get-state', async () => {
    return decisionSettings.getState();
  });

  ipcMain.handle('decisions:download-weights', async () => {
    return decisionSettings.downloadWeights();
  });

  ipcMain.handle('decisions:cancel-download', async () => {
    return decisionSettings.cancelDownload();
  });

  ipcMain.handle('decisions:test', async (_event, input: unknown) => {
    const text = typeof input === 'string' ? input.trim().slice(0, 200) : '';
    if (!text) {
      throw new Error('Provide a command to test.');
    }
    return decisionSettings.test(text);
  });

  ipcMain.handle('translation:translate', async (_event, request: unknown): Promise<TranslationRunResult> => {
    const input = (request ?? {}) as { text?: unknown; target?: unknown; source?: unknown };
    const text = typeof input.text === 'string' ? input.text : '';
    if (!text.trim() || text.length > 10_000) {
      throw new Error('Provide text to translate (max 10000 characters).');
    }
    const clean = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() && value.trim().length <= 32 ? value.trim().toLowerCase() : undefined;
    return translationService.translate({
      text,
      ...(clean(input.target) ? { target: clean(input.target) } : {}),
      ...(clean(input.source) ? { source: clean(input.source) } : {}),
    });
  });

  const toMemoryView = (row: {
    id: string;
    content: string;
    source: string;
    tags: unknown;
    conversationId: string | null;
    mergedFrom?: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): MemoryView => ({
    id: row.id,
    content: row.content,
    source: row.source === 'assistant' ? 'assistant' : 'user',
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    conversationId: row.conversationId,
    mergedFrom: Array.isArray(row.mergedFrom)
      ? (row.mergedFrom.filter(
          (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as { id?: unknown }).id === 'string' &&
            typeof (entry as { content?: unknown }).content === 'string' &&
            typeof (entry as { mergedAt?: unknown }).mergedAt === 'string'
        ) as MemoryView['mergedFrom'])
      : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

  ipcMain.handle('memory:list', async (_event, limit?: number, offset?: number): Promise<MemoryView[]> => {
    const rows = await getMemoryService().list(limit, offset);
    return rows.map(toMemoryView);
  });

  ipcMain.handle('memory:search', async (_event, query: string, limit?: number): Promise<MemoryView[]> => {
    const rows = await getMemoryService().search(query, limit);
    return rows.map(toMemoryView);
  });

  ipcMain.handle('memory:delete', async (_event, id: string): Promise<boolean> => {
    return getMemoryService().forgetById(id);
  });

  ipcMain.handle('memory:restore', async (_event, input: MemoryRestoreInput): Promise<MemoryView> => {
    const { memory } = await getMemoryService().save({
      content: input.content,
      source: input.source,
      conversationId: input.conversationId ?? null,
      tags: input.tags,
    });
    return toMemoryView(memory);
  });

  const memoryConsolidation = new MemoryConsolidationService({
    configService,
    gateway: aiGateway,
  });
  getMemoryService().setConsolidator((newContent, candidate) =>
    memoryConsolidation.arbitrateSave(newContent, candidate)
  );

  ipcMain.handle('memory:consolidate', async () => {
    const rows = await getMemoryService().list(500, 0);
    return memoryConsolidation.consolidatePass(
      rows.map((row) => ({ id: row.id, content: row.content, source: row.source === 'assistant' ? ('assistant' as const) : ('user' as const) })),
      (targetId, mergedContent, absorbed) =>
        getMemoryService()
          .mergeIntoAndRemoveSource(targetId, mergedContent, absorbed)
          .then(() => undefined)
    );
  });

  const desktopContext = new DesktopContextService({ getConfig: () => configService.getConfig() });

  ipcMain.handle('desktop:selection-supported', async (): Promise<boolean> => {
    return desktopContext.selectionSupported();
  });

  ipcMain.handle('desktop:clipboard-changed', async (): Promise<ClipboardChange> => {
    return desktopContext.clipboardChanged();
  });

  ipcMain.handle('desktop:capture-selection', async (): Promise<SelectionResult> => {
    return desktopContext.captureSelection();
  });

  ipcMain.handle('ai:fetch-models', async (event, provider: LLMProvider): Promise<IPCResponse<Model[]>> => {
    try {
      const models = await aiService.fetchAvailableModels(provider);
      return { success: true, data: models };
    } catch (error) {
      console.error('Failed to fetch AI models via IPC:', error);
      return { success: false, error: (error as Error).message, data: [] };
    }
  });

  ipcMain.handle('ai:test-provider', async (event, provider: LLMProvider): Promise<ProviderTestResult> => {
    const startedAt = Date.now();
    try {
      const models = await aiService.fetchAvailableModels(provider);
      const latencyMs = Date.now() - startedAt;
      if (models.length === 0) {
        return { ok: false, latencyMs, modelCount: 0, error: 'No models reachable (check the API key).' };
      }
      return { ok: true, latencyMs, modelCount: models.length, error: null };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - startedAt, modelCount: 0, error: (error as Error).message };
    }
  });

  // =============================================================================
  // WINDOW MANAGEMENT
  // =============================================================================

  ipcMain.handle('window:resize', async (event, width: number|null, height: number|null) => {
    windowManager.resizeMainWindow(width, height)
  });

  ipcMain.handle('window:resize-corner-start', async (_event, corner: ResizeCorner) => {
    if (!isResizeCorner(corner)) {
      throw new Error(`Invalid resize corner: ${String(corner)}`);
    }
    windowManager.beginCornerResize(corner);
  });

  ipcMain.handle('window:resize-corner-update', async (_event, dx: number, dy: number) => {
    windowManager.updateCornerResize(dx, dy);
  });

  ipcMain.handle('window:resize-corner-end', async () => {
    windowManager.endCornerResize();
  });

  ipcMain.handle('window:move-by', async (_event, dx: number, dy: number) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      throw new Error(`Invalid move deltas: ${String(dx)}, ${String(dy)}`);
    }
    windowManager.moveMainWindowBy(Math.trunc(dx), Math.trunc(dy));
  });

  ipcMain.handle('window:hide', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.hide();
    }
  });

  ipcMain.handle('window:show', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.show();
      window.focus();
    }
  });

  ipcMain.handle('window:minimize', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.minimize();
    }
  });

  ipcMain.handle('window:close', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.close();
    }
  });

  ipcMain.handle('window:set-always-on-top', async (event, flag: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.setAlwaysOnTop(flag);
    }
  });

  ipcMain.handle('window:maximize', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  });

  ipcMain.handle('desktop:open', async (event, conversationId?: string) => {
    windowManager.hideMainWindow();
    await windowManager.showDesktopWindow(conversationId);
  });

  ipcMain.handle('desktop:open-launcher', (event, mode?: 'compact' | 'expanded', conversationId?: string) => {
    windowManager.hideDesktopWindow();
    windowManager.showMainWindow();
    const main = windowManager.getMainWindow();
    if (!main || main.isDestroyed()) return;
    if (conversationId) {
      main.webContents.send('session-sync', conversationId);
    }
    main.webContents.send('launcher:set-mode', mode ?? 'compact');
  });

  ipcMain.handle('attachment:download', async (event, dataUrl: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;

    try {
      // Extract mime type and base64 data
      const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        throw new Error('Invalid data URL format.');
      }
      
      const mimeType = matches[1];
      const base64Data = matches[2];
      const extension = mimeType.split('/')[1] || 'png';
      
      const { canceled, filePath } = await dialog.showSaveDialog(window, {
        title: 'Save Attachment',
        defaultPath: `attachment-${Date.now()}.${extension}`,
        filters: [{ name: 'Images', extensions: [extension, 'jpg', 'png', 'gif'] }]
      });

      if (!canceled && filePath) {
        const buffer = Buffer.from(base64Data, 'base64');
        await fs.promises.writeFile(filePath, buffer);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to download attachment:', error);
      dialog.showErrorBox('Download Error', 'Could not save the attachment. Please try again.');
      return false;
    }
  });


  ipcMain.handle('settings:open', async (_event, target?: { tab?: string; section?: string; commandId?: string }) => {
    const safeTarget =
      target && typeof target === 'object'
        ? {
            tab: typeof target.tab === 'string' && target.tab.length <= 40 ? target.tab : undefined,
            section: typeof target.section === 'string' && target.section.length <= 40 ? target.section : undefined,
            commandId: typeof target.commandId === 'string' && target.commandId.length <= 200 ? target.commandId : undefined,
          }
        : undefined;
    windowManager.showSettingsWindow(safeTarget);
  });

  ipcMain.handle('settings:save', async (event, settings: Settings) => {
    try {
      await configService.saveSettings(settings);
      return { success: true };
    } catch (error) {
      console.error('Failed to save settings via IPC:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // =============================================================================
  // DATABASE OPERATIONS - CONVERSATIONS
  // =============================================================================

  ipcMain.handle('db:conversations:create', async (event, title: string) => {
    try {
      const conversation = await conversationService.createConversation(title);
      return conversation;
    } catch (error) {
      console.error('Failed to create conversation:', error);
      throw error;
    }
  });

  ipcMain.handle('db:conversations:get-all', async () => {
    try {
      const conversations = await conversationService.getAllConversations();
      return conversations;
    } catch (error) {
      console.error('Failed to get conversations:', error);
      throw error;
    }
  });

  ipcMain.handle('db:conversations:get-by-id', async (event, id: string) => {
    try {
      const conversation = await conversationService.getConversationById(id);
      return conversation;
    } catch (error) {
      console.error('Failed to get conversation by id:', error);
      throw error;
    }
  });

  ipcMain.handle('db:conversations:update', async (event, id: string, title: string) => {
    try {
      const conversation = await conversationService.updateConversation(id, { title });
      return conversation;
    } catch (error) {
      console.error('Failed to update conversation:', error);
      throw error;
    }
  });

  ipcMain.handle('db:conversations:delete', async (event, id: string) => {
    try {
      await conversationService.deleteConversation(id);
      return true;
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      throw error;
    }
  });

  ipcMain.handle('db:conversations:set-metadata', async (event, id: string, metadata: ConversationMetadata) => {
    try {
      return await conversationService.setConversationMetadata(id, metadata);
    } catch (error) {
      console.error('Failed to set conversation metadata:', error);
      throw error;
    }
  });

  ipcMain.handle('db:conversations:clear-all', async () => {
    try {
      await conversationService.clearAllConversations();
      return true;
    } catch (error) {
      console.error('Failed to clear all conversations:', error);
      throw error;
    }
  });

  // =============================================================================
  // DATABASE OPERATIONS - MESSAGES
  // =============================================================================
    ipcMain.handle('db:messages:create', async (event, messageData: MessageCreate) => {
      try {
          const message = await messageService.createMessage(
            messageData.content,
            stringToMessageRole(messageData.role),
            messageData.conversationId,
            messageData.attachments,
            messageData.error
          );
          return message;
      } catch (error) {
          console.error('Failed to create message:', error);
          throw error;
      }
    });


  ipcMain.handle('db:messages:get-by-conversation', async (event, conversationId: string) => {
    try {
      const messages = await messageService.getMessagesByConversation(conversationId);
      return messages;
    } catch (error) {
      console.error('Failed to get messages by conversation:', error);
      throw error;
    }
  });

  ipcMain.handle('db:messages:update', async (event, id: string, content: string) => {
    try {
      const message = await messageService.updateMessage(id, { content });
      return message;
    } catch (error) {
      console.error('Failed to update message:', error);
      throw error;
    }
  });

  ipcMain.handle('db:messages:delete', async (event, id: string) => {
    try {
      await messageService.deleteMessage(id);
      return true;
    } catch (error) {
      console.error('Failed to delete message:', error);
      throw error;
    }
  });

  ipcMain.handle('db:messages:clear-by-conversation', async (event, conversationId: string) => {
    try {
      await messageService.clearMessagesByConversation(conversationId);
      return true;
    } catch (error) {
      console.error('Failed to clear messages by conversation:', error);
      throw error;
    }
  });

  // =============================================================================
  // FILE SYSTEM OPERATIONS
  // =============================================================================

  ipcMain.handle('fs:save-file', async (event, options: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
    content: string;
  }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    try {
      const result = await dialog.showSaveDialog(window, {
        title: options.title || 'Save File',
        defaultPath: options.defaultPath,
        filters: options.filters || [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (!result.canceled && result.filePath) {
        await writeFile(result.filePath, options.content);
        return result.filePath;
      }

      return null;
    } catch (error) {
      console.error('Failed to save file:', error);
      throw error;
    }
  });

  ipcMain.handle('fs:open-file', async (event, options?: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
    properties?: ('openFile' | 'multiSelections')[];
  }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    try {
      const result = await dialog.showOpenDialog(window, {
        title: options?.title || 'Open File',
        filters: options?.filters || [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: options?.properties || ['openFile']
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const content = await readFile(filePath, 'utf-8');
        return { filePath, content };
      }

      return null;
    } catch (error) {
      console.error('Failed to open file:', error);
      throw error;
    }
  });

  // =============================================================================
  // SYSTEM OPERATIONS
  // =============================================================================

  ipcMain.handle('system:show-context-menu', (event) => {
    const template = [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { type: 'separator' },
      { role: 'selectAll' }
    ];
    // @ts-expect-error template role union does not satisfy Electron's MenuItemConstructorOptions
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) || undefined });
  });

  ipcMain.handle('system:get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('system:get-platform', () => {
    return process.platform;
  });

  ipcMain.handle('system:autostart-status', (): AutostartStatus => {
    return ResidencyService.getInstance().getStatus();
  });

  ipcMain.handle('system:get-arch', () => {
    return process.arch;
  });

  ipcMain.handle('system:open-external', async (event, url: string) => {
    try {
      await shell.openExternal(url);
      return true;
    } catch (error) {
      console.error('Failed to open external URL:', error);
      return false;
    }
  });

  ipcMain.handle('system:show-item-in-folder', (event, path: string) => {
    shell.showItemInFolder(path);
  });

  /**
   * Opens a file-artifact with its default application on explicit user
   * click. Same rails as the `open_path` tool: must exist, executables
   * are refused, files must live inside the granted roots (folders may
   * be anywhere). Returns an error string or null on success.
   */
  ipcMain.handle('system:open-path', async (_event, path: string): Promise<string | null> => {
    if (typeof path !== 'string' || path.length === 0 || path.length > 4096) {
      return 'Invalid path.';
    }
    const info = await stat(path).catch(() => null);
    if (!info) {
      return `'${path}' does not exist.`;
    }
    if (!info.isDirectory()) {
      const lower = path.toLowerCase();
      if ([...EXECUTABLE_EXTENSIONS].some((ext) => lower.endsWith(ext))) {
        return 'Executable files cannot be opened.';
      }
      if (resolveWithinGrantedRoots(toolPolicy.grantedRoots() ?? [], path) === null) {
        return `'${path}' is outside the folders the user approved. Grant that folder in Settings → Tools to open files from it.`;
      }
    }
    const error = await shell.openPath(path);
    return error || null;
  });

  ipcMain.handle('system:quit-app', () => {
    app.quit();
  });

  // =============================================================================
  // CLIPBOARD OPERATIONS
  // =============================================================================

  ipcMain.handle('clipboard:write-text', async (_event, text: string) => {
    try {
      await clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error('Failed to write to clipboard:', error);
      return false;
    }
  });

  ipcMain.handle('clipboard:read-text', async () => {
    try {
      return await clipboard.readText();
    } catch (error) {
      console.error('Failed to read from clipboard:', error);
      return '';
    }
  });

  // =============================================================================
  // NOTIFICATION OPERATIONS
  // =============================================================================

  ipcMain.handle('notification:show', (event, options: {
    title: string;
    body: string;
    silent?: boolean;
    urgency?: 'normal' | 'critical' | 'low';
  }) => {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: options.title,
        body: options.body,
        silent: options.silent || false,
        urgency: options.urgency || 'normal'
      });
      
      notification.show();
      return true;
    }
    
    return false;
  });

  // =============================================================================
  // DIALOG OPERATIONS
  // =============================================================================

  ipcMain.handle('dialog:show-message', async (event, options: {
    type?: 'none' | 'info' | 'error' | 'question' | 'warning';
    title?: string;
    message: string;
    detail?: string;
    buttons?: string[];
    defaultId?: number;
    cancelId?: number;
  }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return { response: -1 };

    try {
      const result = await dialog.showMessageBox(window, {
        type: options.type || 'info',
        title: options.title || 'Message',
        message: options.message,
        detail: options.detail,
        buttons: options.buttons || ['OK'],
        defaultId: options.defaultId || 0,
        cancelId: options.cancelId
      });

      return result;
    } catch (error) {
      console.error('Failed to show message dialog:', error);
      return { response: -1 };
    }
  });

  ipcMain.handle('dialog:show-error', async (event, title: string, content: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;

    try {
      await dialog.showErrorBox(title, content);
    } catch (error) {
      console.error('Failed to show error dialog:', error);
    }
  });


  // =============================================================================
  // HOTKEY MANAGEMENT
  // =============================================================================

  ipcMain.handle('hotkeys:get-settings', async () => {
    return hotkeyService.getSettings();
  });

  ipcMain.handle('hotkeys:save-settings', async (event, settings: Partial<HotkeySettings>) => {
    try {
      await hotkeyService.saveAndReloadHotkeys(settings);
      return { success: true };
    } catch (error) {
      console.error('Failed to save hotkey settings:', error);
      return { success: false, error: (error as Error).message };
    }
  });
  
  ipcMain.handle('hotkeys:register-all', async () => {
      hotkeyService.registerAll();
  });


  // Placeholder for recording functionality. A real implementation might need a dedicated window.
  ipcMain.handle('hotkeys:start-recording', async (_event) => {
    console.log("IPC: Start hotkey recording requested.");
    return null; 
  });

  ipcMain.handle('hotkeys:stop-recording', async () => {
    console.log("IPC: Stop hotkey recording requested.");
  });


  ipcMain.handle('provider:add', async (event, providerData: Omit<LLMProvider, 'id'>): Promise<IPCResponse<LLMProvider>> => {
    try {
      const newProvider = await configService.addLLMProvider(providerData);
      return { success: true, data: newProvider };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('provider:update', async (event, provider: LLMProvider): Promise<IPCResponse<void>> => {
    try {
      await configService.updateLLMProvider(provider);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('provider:delete', async (event, providerId: string): Promise<IPCResponse<void>> => {
    try {
      await configService.deleteLLMProvider(providerId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('provider:set-default', async (event, providerId: string): Promise<IPCResponse<void>> => {
    try {
      await configService.setDefaultLLMProvider(providerId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('provider:setup-preset', async (_event, presetKey: string, apiKey: string, name?: string, options?: { curatedIds?: string[]; bindChat?: boolean; bindVision?: boolean; bindStt?: boolean }): Promise<SetupProviderResult> => {
    try {
      const key = typeof apiKey === 'string' ? apiKey : '';
      const safeName = typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 80 ? name.trim() : undefined;
      const safeOptions =
        options && typeof options === 'object'
          ? {
              ...(Array.isArray(options.curatedIds)
                ? { curatedIds: options.curatedIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 100).slice(0, 30) }
                : {}),
              ...(typeof options.bindChat === 'boolean' ? { bindChat: options.bindChat } : {}),
              ...(typeof options.bindVision === 'boolean' ? { bindVision: options.bindVision } : {}),
              ...(typeof options.bindStt === 'boolean' ? { bindStt: options.bindStt } : {}),
            }
          : undefined;
      const setupStore = {
        getConfig: () => configService.getConfig(),
        addLLMProvider: (provider: Omit<LLMProvider, 'id'>) => configService.addLLMProvider(provider),
        updateLLMProvider: (provider: LLMProvider) => configService.updateLLMProvider(provider),
        setDefaultLLMProvider: (id: string) => configService.setDefaultLLMProvider(id),
        updateConfig: (updates: Partial<AppConfig>) => configService.updateConfig(updates),
        resolveSecret: async (id: string) =>
          (await SecretService.getInstance().getSecret(providerSecretKey(id))) ?? null,
      };
      const result = await setupProviderFromPreset(setupStore, String(presetKey), key, safeName, safeOptions);
      if (result.ok) {
        const config = configService.getConfig();
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('config-updated', config);
        });
      }
      return result;
    } catch (error: any) {
      console.error('Provider preset setup failed:', error);
      return { ok: false, assignedModelId: null, catalogCount: 0, errorCode: 'unknown', vendorMessage: error.message };
    }
  });

  ipcMain.handle('provider:set-default-model', async (_event, providerId: string, modelId: string, task?: string): Promise<IPCResponse<void>> => {
    try {
      const safeTask = task === AiTask.VISION ? AiTask.VISION : task === AiTask.STT ? AiTask.STT : AiTask.CHAT;
      await setDefaultModel(configService, String(providerId), String(modelId), safeTask);
      const config = configService.getConfig();
      BrowserWindow.getAllWindows().forEach((window) => {
        window.webContents.send('config-updated', config);
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // =============================================================================
  // DEVELOPMENT HELPERS
  // =============================================================================

  ipcMain.handle('dev:open-devtools', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && process.env.NODE_ENV === 'development') {
      window.webContents.openDevTools();
    }
  });

  ipcMain.handle('dev:reload', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && process.env.NODE_ENV === 'development') {
      window.webContents.reload();
    }
  });

  // =============================================================================
  // ERROR HANDLING
  // =============================================================================

  ipcMain.handle('log:error', (event, error: any) => {
    console.error('Renderer Error:', error);
  });

  ipcMain.handle('log:info', (event, message: string) => {
    console.log('Renderer Info:', message);
  });

  ipcMain.handle('log:warn', (event, message: string) => {
    console.warn('Renderer Warning:', message);
  });

  console.log('IPC handlers registered successfully');
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export function removeIpcHandlers(): void {
  // Remove all registered IPC handlers
  const handlers = [
    // Window management
    'window:resize', 'window:resize-corner-start', 'window:resize-corner-update', 'window:resize-corner-end', 'window:move-by', 'window:hide', 'window:show', 'window:minimize', 'window:close', 'window:set-always-on-top', 'window:maximize', 'desktop:open', 'desktop:open-launcher',

    // Configuration
    'config:load', 'config:save', 'config:get-path',

    // AI
    'ai:generate-response', 'ai:fetch-models', 'ai:turn-start', 'ai:turn-cancel', 'ai:turn-resume', 'ai:tts-synthesize',
    'provider:setup-preset', 'provider:set-default-model',
    'tools:get-catalog', 'tools:set-tool-enabled', 'tools:revoke-tool-grant', 'tools:pick-root', 'tools:remove-root',
    'tools:set-verification', 'tools:set-tool-grant', 'tools:set-class-defaults',
    'tools:get-result', 'tools:open-result-viewer', 'tools:cancel-download',
    'commands:get-catalog', 'commands:execute', 'commands:clear-history', 'commands:refresh-apps', 'commands:get-app-icon',
    'schedules:list', 'schedules:create', 'schedules:update', 'schedules:delete', 'schedules:run-now',
    'docs:get-status', 'docs:set-indexed', 'docs:re-index', 'tools:usage-stats', 'apps:usage-stats', 'apps:context-digest-stats',
    'commands:save-custom', 'commands:delete-custom', 'commands:import-integration', 'commands:remove-integration',
    'search:get-providers', 'search:save-provider', 'search:delete-provider', 'search:set-provider-enabled', 'search:move-provider', 'search:test-provider',
    'translation:get-providers', 'translation:save-provider', 'translation:delete-provider', 'translation:set-provider-enabled', 'translation:move-provider', 'translation:test-provider', 'translation:translate',
    'decisions:get-state', 'decisions:download-weights', 'decisions:cancel-download', 'decisions:test',
    'memory:list', 'memory:search', 'memory:delete', 'memory:restore', 'memory:consolidate',
    'desktop:selection-supported', 'desktop:clipboard-changed', 'desktop:capture-selection',

    // Database - Conversations
    'db:conversations:create', 'db:conversations:get-all', 'db:conversations:get-by-id',
    'db:conversations:update', 'db:conversations:delete', 'db:conversations:clear-all', 'db:conversations:set-metadata',
    
    // Database - Messages
    'db:messages:create', 'db:messages:get-by-conversation', 'db:messages:update',
    'db:messages:delete', 'db:messages:clear-by-conversation',
    
    // File system
    'fs:save-file', 'fs:open-file',
    
    // System
    'system:get-app-version', 'system:get-platform', 'system:get-arch', 'system:autostart-status',
    'system:open-external', 'system:show-item-in-folder', 'system:open-path', 'system:quit-app',
    
    // Clipboard
    'clipboard:write-text', 'clipboard:read-text',
    
    // Notifications
    'notification:show',
    
    // Dialogs
    'dialog:show-message', 'dialog:show-error',
    
    // Development
    'dev:open-devtools', 'dev:reload',
    
    // Logging
    'log:error', 'log:info', 'log:warn'
  ];

  handlers.forEach(handler => {
    ipcMain.removeHandler(handler);
  });

  console.log('IPC handlers removed');
}