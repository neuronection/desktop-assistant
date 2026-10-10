import * as fs from 'fs';
import { ipcMain, dialog, shell, app, BrowserWindow, desktopCapturer, screen, Menu, clipboard, Notification } from 'electron';
import { randomUUID, createHash } from 'crypto';
import { DatabaseService } from '@main/services/DatabaseService';
import { ConversationService } from '@main/services/ConversationService';
import { MessageService } from '@main/services/MessageService';
import { MainConfigService } from '@main/services/ConfigService';
import { SecretService, providerSecretKey, openrouterSecretKey } from '@main/services/SecretService';
import { MessageCreate, stringToMessageRole } from '@shared/database-types';
import { writeFile, readFile, stat, mkdir, rename, copyFile, rm } from 'fs/promises';
import { join } from 'path';
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
import { assembleDecisionPrompt } from '@main/ai/decide/prompt';
import { decisionToolSurface, type DecisionMcpToolSnapshot } from '@main/ai/decide/tool-surface';
import { DecisionSettingsController } from '@main/ai/decide/settings-controller';
import { needleResourceDir, needleUserDataDir } from '@main/ai/decide/needle/context';
import { ContextDigestService } from '@main/ai/tools/apps/context-digests';
import { homeAssistantDigestProvider } from '@main/ai/tools/apps/context-providers/home-assistant';
import { McpDirectExecutor, snapshotDecisionMcpTools } from '@main/ai/tools/mcp-direct';
import type { McpServerConfig } from '@shared/mcp';
import { getToolResultService } from '@main/services/ToolResultService';
import { aiGateway } from '@main/ai/gateway';
import { evaluateUtterance, FAIL_VERDICT, utteranceWantsText, type UtteranceVerdict } from '@main/ai/utterance';
import { runUtteranceGate } from '@main/ai/decide/points/utterance-gate';
import { runLiveIntentPoint } from '@main/ai/decide/points/live-intent';
import { LiveSessionService, type LiveSessionHost } from '@main/services/LiveSessionService';
import { isLiveActive, LIVE_IDLE_TIMEOUT_MS, type LiveEvent, type LiveNoticeCode, type LiveSnapshot } from '@shared/live';
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
import { MiniAppRegistry } from '@main/apps/registry';
import { TEXT, interpolate } from '@shared/constants/text';
import { ALL_BUNDLED_PACKS } from '@packs';
import { capabilitiesFor, PackCapabilityError, type PackCapabilityDeps } from '@main/apps/capabilities';
import { joinWithinRoot, validateRunRoot, PackFs, type PackFsEnv } from '@main/apps/capabilities/fs';
import { nodePackFsDeps } from '@main/apps/capabilities/node-fs';
import { PackRunBridge } from '@main/apps/capabilities/run';
import { MiniAppRunService } from '@main/apps/run/RunService';
import { diffRuns, exportRunReport } from '@main/apps/run/export';
import { ProposalService, type ProposalRow } from '@main/apps/run/proposals';
import { QuarantineService, type QuarantineRecord } from '@main/apps/quarantine';
import { runnerFingerprint } from '@main/apps/run/fingerprint';
import { formatPackError } from '@main/apps/errors';
import type { MiniAppRunItemRow, MiniAppRunRow, MiniAppRunStore } from '@main/apps/run/store';
import type {
  MiniAppExportFormat,
  MiniAppRunDiffView,
  MiniAppRunReportView,
  MiniAppRunView,
} from '@shared/app-pack';
import { resolveDecisionEngine, runDecision } from '@main/ai/decide';
import {
  PACK_LIMITS,
  validatePackConfig,
  type PackError,
  type ImportMiniAppResult,
  type MiniAppSaveConfigResult,
  type MiniAppSetEnabledResult,
  type MiniAppsState,
} from '@shared/app-pack';
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

  const decisionEngineDeps = () => ({
    getApiKey: async (provider: LLMProvider) =>
      (await SecretService.getInstance().getSecret(providerSecretKey(provider.id))) ?? provider.apiKey,
    getJevKey: async () => SecretService.getInstance().getSecret(openrouterSecretKey()),
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

  ipcMain.handle('voice:evaluate-utterance', async (_event, text: string, conversationId?: string) => {
    try {
      return await evaluateVoiceUtterance(text, conversationId);
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
          return { success: true, cancelled: true };
        }
        const base64Data = dataUrl.split(';base64,').pop();
        if (!base64Data) {
          throw new Error('Invalid Data URL format.');
        }
        
        const buffer = Buffer.from(base64Data, 'base64');

        fs.writeFileSync(result.filePath, buffer);

        
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
  const miniAppRegistry = new MiniAppRegistry({
    config: () => configService.getConfig(),
    updateMiniApps: async (patch) => {
      const current = configService.getConfig().miniApps;
      await configService.updateConfig({ miniApps: { ...current, ...patch } });
    },
    now: () => Date.now(),
    sha256: (input) => createHash('sha256').update(input).digest('hex'),
  });
  const miniAppRunBridge = new PackRunBridge({ newId: () => randomUUID(), now: () => Date.now() });
  const miniAppFsEnv: PackFsEnv = {
    home: app.getPath('home'),
    userData: app.getPath('userData'),
    platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
    ...(process.env.SYSTEMROOT ? { systemRoot: process.env.SYSTEMROOT } : {}),
    ...(process.env.PROGRAMFILES ? { programFiles: process.env.PROGRAMFILES } : {}),
    ...(process.env.PROGRAMDATA ? { programData: process.env.PROGRAMDATA } : {}),
  };
  const miniAppCapabilityDeps: PackCapabilityDeps = {
    ...nodePackFsDeps,
    fsEnv: miniAppFsEnv,
    decideDeps: { config: () => configService.getConfig(), engineDeps: decisionEngineDeps() },
    run: miniAppRunBridge,
  };
  const prismaRunRow = (row: {
    id: string; packId: string; packVersion: string; rootPath: string; configHash: string; engineId: string;
    status: string; totals: unknown; estimateCalls: number; actualCalls: number; inputTokens: number; outputTokens: number;
    error: string | null; conversationId: string | null; startedAt: Date; updatedAt: Date; finishedAt: Date | null;
  }): MiniAppRunRow => ({
    id: row.id,
    packId: row.packId,
    packVersion: row.packVersion,
    rootPath: row.rootPath,
    configHash: row.configHash,
    engineId: row.engineId,
    status: row.status as MiniAppRunRow['status'],
    totals: (row.totals as MiniAppRunRow['totals']) ?? null,
    estimateCalls: row.estimateCalls,
    actualCalls: row.actualCalls,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    error: row.error,
    conversationId: row.conversationId,
    startedAt: Number(row.startedAt),
    updatedAt: Number(row.updatedAt),
    finishedAt: row.finishedAt ? Number(row.finishedAt) : null,
  });
  const miniAppDb = () => databaseService.getClient();
  const miniAppRunStore: MiniAppRunStore = {
    createRun: async (row) => {
      await miniAppDb().miniAppRun.create({
        data: {
          id: row.id,
          packId: row.packId,
          packVersion: row.packVersion,
          rootPath: row.rootPath,
          configHash: row.configHash,
          engineId: row.engineId,
          status: row.status,
          totals: row.totals as never,
          estimateCalls: row.estimateCalls,
          actualCalls: row.actualCalls,
          error: row.error,
          startedAt: new Date(row.startedAt),
          updatedAt: new Date(row.updatedAt),
        },
      });
    },
    updateRun: async (id, patch) => {
      await miniAppDb().miniAppRun.update({
        where: { id },
        data: {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.totals !== undefined ? { totals: patch.totals as never } : {}),
          ...(patch.estimateCalls !== undefined ? { estimateCalls: patch.estimateCalls } : {}),
          ...(patch.actualCalls !== undefined ? { actualCalls: patch.actualCalls } : {}),
          ...(patch.error !== undefined ? { error: patch.error } : {}),
          ...(patch.finishedAt !== undefined && patch.finishedAt !== null ? { finishedAt: new Date(patch.finishedAt) } : {}),
        },
      });
    },
    getRun: async (id) => {
      const row = await miniAppDb().miniAppRun.findUnique({ where: { id } });
      return row ? prismaRunRow(row) : null;
    },
    runsByStatus: async (status) => {
      const rows = await miniAppDb().miniAppRun.findMany({ where: { status } });
      return rows.map(prismaRunRow);
    },
    recentRuns: async (packId, limit = 20) => {
      const rows = await miniAppDb().miniAppRun.findMany({
        where: packId !== undefined ? { packId } : undefined,
        orderBy: { updatedAt: 'desc' },
        take: limit,
      });
      return rows.map(prismaRunRow);
    },
    appendItem: async (row) => {
      const client = miniAppDb();
      const existing = await client.miniAppRunItem.findFirst({ where: { runId: row.runId, fingerprint: row.fingerprint } });
      if (existing) {
        await client.miniAppRunItem.update({
          where: { id: existing.id },
          data: {
            verdict: row.verdict,
            confidence: row.confidence,
            decidedBy: row.decidedBy,
            evidence: row.evidence as never,
            updatedAt: new Date(row.updatedAt),
          },
        });
        return;
      }
      await client.miniAppRunItem.create({
        data: { ...row, evidence: row.evidence as never, updatedAt: new Date(row.updatedAt) },
      });
    },
    itemsOfRun: async (runId) => {
      const rows = await miniAppDb().miniAppRunItem.findMany({ where: { runId } });
      return rows.map((row) => ({
        runId: row.runId,
        packId: row.packId,
        packVersion: row.packVersion,
        configHash: row.configHash,
        engineId: row.engineId,
        fingerprint: row.fingerprint,
        relPath: row.relPath,
        verdict: row.verdict as MiniAppRunItemRow['verdict'],
        confidence: row.confidence ?? null,
        decidedBy: row.decidedBy,
        evidence: (row.evidence as Record<string, unknown> | null) ?? null,
        updatedAt: Number(row.updatedAt),
      }));
    },
    findCachedVerdict: async (key) => {
      const row = await miniAppDb().miniAppRunItem.findFirst({ where: key, orderBy: { updatedAt: 'desc' } });
      if (!row) {
        return null;
      }
      return {
        packId: row.packId,
        packVersion: row.packVersion,
        configHash: row.configHash,
        engineId: row.engineId,
        fingerprint: row.fingerprint,
        relPath: row.relPath,
        verdict: row.verdict as MiniAppRunItemRow['verdict'],
        confidence: row.confidence ?? null,
        decidedBy: row.decidedBy,
        evidence: (row.evidence as Record<string, unknown> | null) ?? null,
        updatedAt: Number(row.updatedAt),
      };
    },
    updateItemVerdict: async (runId, relPath, verdict, decidedBy) => {
      const existing = await miniAppDb().miniAppRunItem.findFirst({ where: { runId, relPath } });
      if (!existing) {
        return false;
      }
      await miniAppDb().miniAppRunItem.update({
        where: { id: existing.id },
        data: { verdict, decidedBy, evidence: { userOverride: true } as never },
      });
      return true;
    },
    upsertFeedback: async (row) => {
      const existing = await miniAppDb().miniAppFeedback.findUnique({
        where: { packId_rootPath_relPath: { packId: row.packId, rootPath: row.rootPath, relPath: row.relPath } },
      });
      if (existing) {
        await miniAppDb().miniAppFeedback.update({
          where: { id: existing.id },
          data: { verdict: row.verdict, source: row.source, ...(row.note ? { note: row.note } : {}) },
        });
        return;
      }
      await miniAppDb().miniAppFeedback.create({ data: row });
    },
    feedbackFor: async (packId, rootPath) => {
      const rows = await miniAppDb().miniAppFeedback.findMany({ where: { packId, rootPath } });
      const map = new Map<string, { packId: string; rootPath: string; relPath: string; verdict: 'keep' | 'ask' | 'candidate'; source: 'override' | 'exclude'; note?: string }>();
      for (const row of rows) {
        map.set(row.relPath, feedbackRowToView(row));
      }
      return map;
    },
    feedbackList: async (packId) => {
      const rows = await miniAppDb().miniAppFeedback.findMany({ where: { packId }, orderBy: { updatedAt: 'desc' }, take: 500 });
      return rows.map(feedbackRowToView);
    },
    feedbackClear: async (packId, relPath) => {
      const where = relPath !== undefined ? { packId, relPath } : { packId };
      const removed = await miniAppDb().miniAppFeedback.deleteMany({ where });
      return removed.count;
    },
    pruneRuns: async (keepPerPack) => {
      const rows = await miniAppDb().miniAppRun.findMany({ orderBy: { updatedAt: 'desc' } });
      const perPack = new Map<string, number>();
      const doomed: string[] = [];
      for (const row of rows) {
        if (['paused', 'interrupted', 'running', 'queued'].includes(row.status)) {
          continue;
        }
        const seen = (perPack.get(row.packId) ?? 0) + 1;
        perPack.set(row.packId, seen);
        if (seen > keepPerPack) {
          doomed.push(row.id);
        }
      }
      for (const id of doomed) {
        await miniAppDb().miniAppRunItem.deleteMany({ where: { runId: id } });
        await miniAppDb().miniAppRun.delete({ where: { id } });
      }
      return doomed.length;
    },
  };
  const feedbackRowToView = (row: {
    packId: string; rootPath: string; relPath: string; verdict: string; source: string; note: string | null;
  }): { packId: string; rootPath: string; relPath: string; verdict: 'keep' | 'ask' | 'candidate'; source: 'override' | 'exclude'; note?: string } => ({
    packId: row.packId,
    rootPath: row.rootPath,
    relPath: row.relPath,
    verdict: row.verdict as 'keep' | 'ask' | 'candidate',
    source: row.source as 'override' | 'exclude',
    ...(row.note ? { note: row.note } : {}),
  });
  const miniAppPackTitle = (packId: string): string => {
    const view = miniAppRegistry.getState().packs.find((candidate) => candidate.id === packId);
    return view?.title ?? packId;
  };
  const runRowToView = (row: MiniAppRunRow): MiniAppRunView => ({
    id: row.id,
    packId: row.packId,
    packVersion: row.packVersion,
    rootPath: row.rootPath,
    status: row.status,
    totals: row.totals,
    estimateCalls: row.estimateCalls,
    actualCalls: row.actualCalls,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    error: row.error,
    conversationId: row.conversationId,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
  });
  const miniAppRunService = new MiniAppRunService({
    store: miniAppRunStore,
    runBridge: miniAppRunBridge,
    getPack: (packId) => {
      const pack = miniAppRegistry.runnablePack(packId);
      if (!pack) {
        return null;
      }
      const view = miniAppRegistry.getState().packs.find((candidate) => candidate.id === packId);
      const effective = view
        ? validatePackConfig(pack, view.configValues)
        : validatePackConfig(pack, undefined);
      return { pack, config: effective.ok ? effective.values : {}, title: view?.title ?? packId };
    },
    openFs: async (pack, root) => {
      try {
        return await capabilitiesFor(pack, miniAppCapabilityDeps).fs(root);
      } catch (error) {
        if (error instanceof PackCapabilityError) {
          return { ok: false, error: error.error };
        }
        throw error;
      }
    },
    decideFor: (pack) => {
      try {
        return capabilitiesFor(pack, miniAppCapabilityDeps).decide;
      } catch {
        return null;
      }
    },
    resolveEngineId: async () => {
      const config = configService.getConfig();
      const resolution = await resolveDecisionEngine(config.decision, config, decisionEngineDeps());
      if (resolution.kind === 'llm-engine') {
        return { ok: true as const, engineId: 'llm' };
      }
      if (resolution.kind === 'jev-engine') {
        return { ok: true as const, engineId: 'jev' };
      }
      if (resolution.kind === 'needle-engine') {
        return { ok: true as const, engineId: 'needle' };
      }
      if (resolution.kind === 'off') {
        return { ok: false as const, error: { code: 'not-ready', detail: { reason: 'decision engine is off' } } };
      }
      if (resolution.kind === 'unavailable' && resolution.engine === 'jev') {
        return { ok: false as const, error: { code: 'needs-secret', detail: { reason: resolution.reason } } };
      }
      return { ok: false as const, error: { code: 'not-ready', detail: { reason: (resolution as { reason?: string }).reason ?? 'engine unavailable' } } };
    },
    broadcast: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('miniapps:run-event', event);
      }
    },
    createConversation: async (title) => {
      const created = await conversationService.createConversation(title);
      return { id: created.id };
    },
    createRunMessage: async (conversationId, content, metadata) => {
      const message = await messageService.createMessage(content, stringToMessageRole('assistant'), conversationId, undefined, undefined, metadata as never);
      return { id: message.id };
    },
    updateRunMessage: async (messageId, content, metadata) => {
      await messageService.updateMessage(messageId, { content, metadata: metadata as never });
    },
    notify: (title, body) => {
      const behavior = configService.getConfig().behavior;
      if (behavior?.notifyOnComplete === false) {
        return;
      }
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
    },
    packTitle: miniAppPackTitle,
    now: () => Date.now(),
    newId: () => randomUUID(),
  });
  const quarantineFs = {
    mkdir: async (path: string, recursive: true) => {
      await mkdir(path, { recursive });
    },
    stat: async (path: string) => {
      const stats = await stat(path);
      return { isFile: stats.isFile(), isDirectory: stats.isDirectory(), size: stats.size, dev: stats.dev };
    },
    rename: (from: string, to: string) => rename(from, to),
    copyAndDelete: async (from: string, to: string) => {
      await copyFile(from, to);
      await rm(from, { force: true });
    },
    writeFile: (path: string, content: string) => writeFile(path, content, 'utf8'),
    readFile: (path: string) => readFile(path, 'utf8'),
    exists: async (path: string) => {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    unlink: (path: string) => rm(path, { force: true }),
    now: () => Date.now(),
    newId: () => randomUUID(),
  };
  const quarantineStore: import('@main/apps/quarantine').QuarantineStore = {
    create: async (record) => {
      await miniAppDb().miniAppQuarantine.create({
        data: {
          id: record.id, proposalId: record.proposalId, packId: record.packId, runId: record.runId,
          relPath: record.relPath, originPath: record.originPath, quarantinePath: record.quarantinePath,
          size: record.size, movedAt: new Date(record.movedAt),
        },
      });
    },
    byProposal: async (proposalId) => {
      const rows = await miniAppDb().miniAppQuarantine.findMany({ where: { proposalId } });
      return rows.map(quarantineRowToRecord);
    },
    byRun: async (runId) => {
      const rows = await miniAppDb().miniAppQuarantine.findMany({ where: { runId } });
      return rows.map(quarantineRowToRecord);
    },
    byPack: async (packId) => {
      const rows = await miniAppDb().miniAppQuarantine.findMany({ where: { packId } });
      return rows.map(quarantineRowToRecord);
    },
    olderThan: async (packId, cutoff) => {
      const rows = await miniAppDb().miniAppQuarantine.findMany({
        where: { packId, movedAt: { lt: new Date(cutoff) }, restoredAt: null },
      });
      return rows.map(quarantineRowToRecord);
    },
    markRestored: async (id, at) => {
      await miniAppDb().miniAppQuarantine.update({ where: { id }, data: { restoredAt: new Date(at) } });
    },
    delete: async (id) => {
      await miniAppDb().miniAppQuarantine.delete({ where: { id } });
    },
    packIdsWithRecords: async () => {
      const rows = await miniAppDb().miniAppQuarantine.findMany({ distinct: ['packId'], select: { packId: true } });
      return rows.map((row) => row.packId);
    },
  };
  const quarantineRowToRecord = (row: {
    id: string; proposalId: string; packId: string; runId: string; relPath: string;
    originPath: string; quarantinePath: string; size: number; movedAt: Date; restoredAt: Date | null;
  }): QuarantineRecord => ({
    id: row.id, proposalId: row.proposalId, packId: row.packId, runId: row.runId, relPath: row.relPath,
    originPath: row.originPath, quarantinePath: row.quarantinePath, size: row.size,
    movedAt: Number(row.movedAt), restoredAt: row.restoredAt ? Number(row.restoredAt) : null,
  });
  const quarantineService = new QuarantineService(quarantineFs, quarantineStore, async () => app.getPath('userData'));
  const proposalStore: import('@main/apps/run/proposals').ProposalStore = {
    create: async (row) => {
      await miniAppDb().miniAppProposal.create({
        data: {
          id: row.id, runId: row.runId, packId: row.packId, verb: row.verb, status: row.status,
          payload: row.payload as never, outcome: null as never, error: null,
          ...(row.resolvedAt !== null ? { resolvedAt: new Date(row.resolvedAt) } : {}),
        },
      });
    },
    get: async (id) => {
      const row = await miniAppDb().miniAppProposal.findUnique({ where: { id } });
      return row ? proposalRowToView(row) : null;
    },
    update: async (id, patch) => {
      await miniAppDb().miniAppProposal.update({
        where: { id },
        data: {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.outcome !== undefined ? { outcome: patch.outcome as never } : {}),
          ...(patch.error !== undefined ? { error: patch.error } : {}),
          ...(patch.resolvedAt !== undefined && patch.resolvedAt !== null ? { resolvedAt: new Date(patch.resolvedAt) } : {}),
        },
      });
    },
    pendingForRun: async (runId) => {
      const row = await miniAppDb().miniAppProposal.findFirst({ where: { runId, status: 'pending' } });
      return row ? proposalRowToView(row) : null;
    },
  };
  const proposalRowToView = (row: {
    id: string; runId: string; packId: string; verb: string; status: string;
    payload: unknown; outcome: unknown; error: string | null; createdAt: Date; resolvedAt: Date | null;
  }): ProposalRow => ({
    id: row.id, runId: row.runId, packId: row.packId, verb: row.verb,
    status: row.status as ProposalRow['status'],
    payload: row.payload as ProposalRow['payload'],
    outcome: (row.outcome as ProposalRow['outcome']) ?? null,
    error: row.error, createdAt: Number(row.createdAt),
    resolvedAt: row.resolvedAt ? Number(row.resolvedAt) : null,
  });
  const proposalService = new ProposalService(proposalStore, quarantineService, miniAppRunStore, {
    now: () => Date.now(),
    newId: () => randomUUID(),
  });
  const openRunFs = async (rootPath: string): Promise<{ statItem: (relative: string) => Promise<{ ok: true; size: number; mtimeMs: number; isFile: boolean } | { ok: false; error: PackError }>; rootPath: string } | null> => {
    const validated = await validateRunRoot(rootPath, miniAppFsEnv, nodePackFsDeps);
    if (!validated.ok) {
      return null;
    }
    const fs = new PackFs(validated.value.root, validated.value.dev, nodePackFsDeps);
    return {
      rootPath: validated.value.root,
      statItem: async (relative) => {
        const result = await fs.statItem(relative);
        return result.ok
          ? { ok: true, size: result.value.size, mtimeMs: result.value.mtimeMs, isFile: result.value.isFile }
          : { ok: false, error: result.error };
      },
    };
  };
  void miniAppRunService.reconcileBoot().catch((error) => console.error('Mini-app run reconciliation failed:', error));
  const installBundledPacks = async (restore = false): Promise<string[]> => {
    const bundled: unknown[] = [...ALL_BUNDLED_PACKS];
    const installed = restore ? await miniAppRegistry.restoreBundled(bundled) : await miniAppRegistry.ensureBundled(bundled);
    const installedIds = new Set(miniAppRegistry.getState().packs.map((view) => view.id));
    const quarantinedIds = await quarantineStore.packIdsWithRecords().catch(() => [] as string[]);
    for (const packId of new Set([...installedIds, ...quarantinedIds])) {
      void quarantineService.pruneRetention(packId).catch(() => undefined);
    }
    return installed;
  };
  void installBundledPacks().catch((error) => console.error('Mini-app bundled install failed:', error));
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
    miniAppPacks: () => miniAppPalettePacks(),
    startMiniAppRun: async (packId: string) => {
      const window = windowManager.getMainWindow() ?? BrowserWindow.getAllWindows()[0];
      if (!window) {
        return { ok: false as const, error: 'No window is available to pick a folder.' };
      }
      const picked = await dialog.showOpenDialog(window, { title: TEXT.MINIAPPS_RUN_PICK_TITLE, properties: ['openDirectory'] });
      if (picked.canceled || picked.filePaths.length === 0) {
        return { ok: false as const, error: 'cancelled' };
      }
      const started = await miniAppRunService.start(packId, picked.filePaths[0], {});
      if (!started.ok) {
        return { ok: false as const, error: formatPackError(started.error) };
      }
      const run = await miniAppRunService.getRun(started.runId);
      return {
        ok: true as const,
        text: interpolate(TEXT.MINIAPPS_RUN_STARTED_NOTICE, { title: miniAppPackTitle(packId) }),
        conversationId: run?.conversationId ?? null,
      };
    },
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
        runDecision(
          {
            getApiKey: async (provider: LLMProvider) =>
              (await SecretService.getInstance().getSecret(providerSecretKey(provider.id))) ?? provider.apiKey,
            getJevKey: async () => SecretService.getInstance().getSecret(openrouterSecretKey()),
          },
          { config: configService.getConfig(), input, tools, systemPrompt: await decisionSystemPrompt() }
        ),
    },
    decisionSpeak: {
      run: async (input, questions) =>
        runDecision(
          {
            getApiKey: async (provider: LLMProvider) =>
              (await SecretService.getInstance().getSecret(providerSecretKey(provider.id))) ?? provider.apiKey,
            getJevKey: async () => SecretService.getInstance().getSecret(openrouterSecretKey()),
          },
          { config: configService.getConfig(), input, tools: [], questions }
        ),
    },
    broadcast: (event: TurnEvent) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('ai:turn-event', event);
        }
      });
      if (liveSession && isLiveActive(liveSession.getSnapshot().state)) {
        if (event.conversationId) {
          liveConversationId = event.conversationId;
        }
        if (event.phase === 'finished') {
          liveSession.turnFinished();
        } else if (event.phase === 'failed' || event.phase === 'cancelled') {
          liveSession.turnFailed();
        } else if (event.phase === 'interrupt') {
          liveSession.approvalPending();
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
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
    },
    recordCommand: (record) => {
      commandService.record(record);
    },
  });

  const liveTimers = new Map<number, ReturnType<typeof setTimeout>>();
  let liveTimerId = 0;

  const broadcastLive = (event: LiveEvent): void => {
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
      broadcastStopSpeaking();
    },
    end: () => {
      endLive();
    },
  });

  ipcMain.handle('live:start', async (_event, conversationId: string): Promise<LiveSnapshot> => {
    liveConversationId = typeof conversationId === 'string' && conversationId ? conversationId : null;
    return liveSession!.start();
  });

  ipcMain.handle('live:stop', async (): Promise<LiveSnapshot> => {
    const snapshot = liveSession!.stop('user');
    liveConversationId = null;
    return snapshot;
  });

  ipcMain.handle('live:get-state', async (): Promise<LiveSnapshot> => liveSession!.getSnapshot());

  ipcMain.on('live:mic-ready', () => liveSession?.micReady());
  ipcMain.on('live:phrase-committed', (_event, transcript: string) => {
    void liveSession?.phraseCommitted(transcript);
  });
  ipcMain.on('live:speech-detected', (_event, input: { transcript: string; currentSentence: string }) => {
    void liveSession?.speechDetected(input);
  });
  ipcMain.on('live:playback-started', () => liveSession?.playbackStarted());
  ipcMain.on('live:playback-ended', () => liveSession?.playbackEnded());
  ipcMain.on('live:interrupt', () => liveSession?.interrupt());
  ipcMain.on('live:fail', (_event, code: LiveNoticeCode) => liveSession?.fail(code));
  ipcMain.on('live:warning', (_event, code: LiveNoticeCode) => liveSession?.warn(code));
  ipcMain.on('live:downgrade', () => liveSession?.downgrade());
  ipcMain.on('live:set-duplex', (_event, fullDuplex: boolean) => liveSession?.setFullDuplex(fullDuplex === true));

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
    const resolved = await turnManager.resolveApproval(resolution);
    if (resolved) {
      liveSession?.approvalResolved();
    }
    return resolved;
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
  let catalogDiagnosed = false;
  ipcMain.handle('commands:get-catalog', async () => {
    await appDiscovery.ensureWarm();
    if (!catalogDiagnosed) {
      catalogDiagnosed = true;
      const packs = miniAppPalettePacks();
      const runEntries = packs.filter((pack) => pack.kind === 'assessment' && pack.enabled);
      console.log(
        `[miniapps:palette] seam packs=${packs.map((pack) => `${pack.id}(${pack.kind},${pack.enabled ? 'on' : 'off'})`).join(' ') || 'NONE'}; run entries=${runEntries.length}`
      );
    }
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
  // MINI-APP PACKS (plan 26 S1 — config.miniApps lifecycle; validation is the
  // ONE shared validator, never re-implemented here)
  // =============================================================================

  ipcMain.handle('miniapps:get-state', async (): Promise<MiniAppsState> => miniAppRegistry.getState());

  ipcMain.handle('miniapps:import', async (_event, json: unknown, path: unknown): Promise<ImportMiniAppResult> => {
    if (typeof json !== 'string' || json.length === 0 || json.length > PACK_LIMITS.manifestMaxBytes * 2) {
      return { ok: false, error: 'Invalid pack file.' };
    }
    const originPath = typeof path === 'string' && path.length > 0 && path.length <= 1024 ? path : undefined;
    return miniAppRegistry.importManifest(json, { kind: 'imported', ...(originPath ? { path: originPath } : {}) });
  });

  ipcMain.handle('miniapps:remove', async (_event, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
      return false;
    }
    return miniAppRegistry.remove(id);
  });

  ipcMain.handle('miniapps:set-enabled', async (_event, id: unknown, enabled: unknown): Promise<MiniAppSetEnabledResult> => {
    if (id !== null && (typeof id !== 'string' || id.length === 0 || id.length > 200)) {
      return { ok: false, error: 'Invalid pack id.' };
    }
    if (typeof enabled !== 'boolean') {
      return { ok: false, error: 'enabled must be a boolean.' };
    }
    return miniAppRegistry.setEnabled(id as string | null, enabled);
  });

  ipcMain.handle('miniapps:save-config', async (_event, id: unknown, values: unknown): Promise<MiniAppSaveConfigResult> => {
    if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
      return { ok: false, error: 'Invalid pack id.' };
    }
    return miniAppRegistry.saveConfig(id, values);
  });

  ipcMain.handle('miniapps:pick-root', async (event): Promise<{ ok: true; root: string } | { ok: false; error: string }> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return { ok: false, error: 'No window.' };
    }
    const picked = await dialog.showOpenDialog(window, { title: 'Choose a folder to assess', properties: ['openDirectory'] });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, error: 'cancelled' };
    }
    return { ok: true, root: picked.filePaths[0] };
  });

  ipcMain.handle('miniapps:run-start', async (_event, packId: unknown, rootPath: unknown, options: unknown): Promise<{ ok: true; runId: string } | { ok: false; error: string }> => {
    if (typeof packId !== 'string' || packId.length === 0 || packId.length > 200) {
      return { ok: false, error: 'Invalid pack id.' };
    }
    if (typeof rootPath !== 'string' || rootPath.length === 0 || rootPath.length > 2048) {
      return { ok: false, error: 'Invalid root path.' };
    }
    const maxModelCalls =
      typeof options === 'object' && options !== null && typeof (options as { maxModelCalls?: unknown }).maxModelCalls === 'number'
        ? (options as { maxModelCalls: number }).maxModelCalls
        : undefined;
    const started = await miniAppRunService.start(packId, rootPath, maxModelCalls !== undefined ? { maxModelCalls } : {});
    if (!started.ok) {
      return { ok: false, error: formatPackError(started.error) };
    }
    return { ok: true, runId: started.runId };
  });

  ipcMain.handle('miniapps:run-cancel', async (_event, runId: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return { ok: false, error: 'Invalid run id.' };
    }
    const result = await miniAppRunService.cancel(runId);
    return result.ok ? { ok: true } : { ok: false, error: formatPackError(result.error) };
  });

  ipcMain.handle('miniapps:run-resume', async (_event, runId: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return { ok: false, error: 'Invalid run id.' };
    }
    const result = await miniAppRunService.resume(runId);
    return result.ok ? { ok: true } : { ok: false, error: formatPackError(result.error) };
  });

  ipcMain.handle('miniapps:runs-list', async (_event, packId: unknown): Promise<MiniAppRunView[]> => {
    const scoped = typeof packId === 'string' && packId.length > 0 && packId.length <= 200 ? packId : undefined;
    const rows = await miniAppRunService.recentRuns(scoped, 20);
    return rows.map(runRowToView);
  });

  const REPORT_DISPLAY_CAP = 2000;
  const buildReportView = async (runId: string, itemCap = REPORT_DISPLAY_CAP): Promise<MiniAppRunReportView | null> => {
    const run = await miniAppRunService.getRun(runId);
    if (!run) {
      return null;
    }
    const items = await miniAppRunService.itemsOfRun(runId);
    const manifest = miniAppRegistry.runnablePack(run.packId)?.manifest;
    const labels: Record<string, string> = {};
    let reportNodes: unknown[] = [
      { id: 'status', type: 'badge', bind: 'run.status' },
      { id: 'totals', type: 'stat', bind: 'totals.scanned' },
      { id: 'items', type: 'table', columns: ['path', 'verdict', 'confidence', 'decidedBy'] },
      { id: 'ev', type: 'evidence' },
    ];
    if (manifest && manifest.kind === 'assessment' && manifest.report) {
      reportNodes = manifest.report.nodes;
      const locale = manifest.i18n.locales[manifest.i18n.defaultLocale] ?? {};
      for (const [key, value] of Object.entries(locale)) {
        if (key.startsWith('report.') || key.startsWith('rule.')) {
          labels[key] = value;
        }
      }
    }
    const mapped = items.map((item) => ({
      relPath: item.relPath,
      verdict: item.verdict,
      confidence: item.confidence,
      decidedBy: item.decidedBy,
      evidence: item.evidence,
    }));
    return {
      run: runRowToView(run),
      packTitle: miniAppPackTitle(run.packId),
      items: itemCap > 0 ? mapped.slice(0, itemCap) : mapped,
      ...(itemCap > 0 && mapped.length > itemCap ? { itemsTruncated: mapped.length - itemCap } : {}),
      reportNodes,
      labels,
      canArm:
        manifest !== undefined &&
        manifest.kind === 'assessment' &&
        manifest.run.propose !== undefined &&
        manifest.capabilities.includes('fs-write-quarantine'),
    };
  };
  ipcMain.handle('miniapps:run-report', async (_event, runId: unknown): Promise<MiniAppRunReportView | null> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return null;
    }
    return buildReportView(runId);
  });

  ipcMain.handle('miniapps:override-item', async (_event, runId: unknown, relPath: unknown, verdict: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return { ok: false, error: 'Invalid run id.' };
    }
    if (typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 2048) {
      return { ok: false, error: 'Invalid path.' };
    }
    if (verdict !== 'keep' && verdict !== 'ask' && verdict !== 'candidate') {
      return { ok: false, error: 'Invalid verdict.' };
    }
    const run = await miniAppRunService.getRun(runId);
    if (!run) {
      return { ok: false, error: 'Unknown run.' };
    }
    await miniAppRunStore.upsertFeedback({
      packId: run.packId,
      rootPath: run.rootPath,
      relPath,
      verdict,
      source: 'override',
    });
    await miniAppRunStore.updateItemVerdict(runId, relPath, verdict, 'override:user');
    return { ok: true };
  });

  ipcMain.handle('miniapps:exclude-item', async (_event, runId: unknown, relPath: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return { ok: false, error: 'Invalid run id.' };
    }
    if (typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 2048) {
      return { ok: false, error: 'Invalid path.' };
    }
    const run = await miniAppRunService.getRun(runId);
    if (!run) {
      return { ok: false, error: 'Unknown run.' };
    }
    await miniAppRunStore.upsertFeedback({
      packId: run.packId,
      rootPath: run.rootPath,
      relPath,
      verdict: 'keep',
      source: 'exclude',
    });
    await miniAppRunStore.updateItemVerdict(runId, relPath, 'keep', 'override:exclude');
    return { ok: true };
  });

  ipcMain.handle('miniapps:reveal-item', async (_event, runId: unknown, relPath: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 2048) {
      return { ok: false, error: 'Invalid arguments.' };
    }
    const run = await miniAppRunService.getRun(runId);
    if (!run) {
      return { ok: false, error: 'Unknown run.' };
    }
    const validated = await validateRunRoot(run.rootPath, miniAppFsEnv, nodePackFsDeps);
    if (!validated.ok) {
      return { ok: false, error: formatPackError(validated.error) };
    }
    const joined = joinWithinRoot(validated.value.root, relPath);
    if (joined === null) {
      return { ok: false, error: 'Path escapes the run root.' };
    }
    try {
      await stat(joined);
    } catch {
      return { ok: false, error: 'The file no longer exists.' };
    }
    shell.showItemInFolder(joined);
    return { ok: true };
  });

  ipcMain.handle('miniapps:open-item', async (_event, runId: unknown, relPath: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 2048) {
      return { ok: false, error: 'Invalid arguments.' };
    }
    const run = await miniAppRunService.getRun(runId);
    if (!run) {
      return { ok: false, error: 'Unknown run.' };
    }
    const validated = await validateRunRoot(run.rootPath, miniAppFsEnv, nodePackFsDeps);
    if (!validated.ok) {
      return { ok: false, error: formatPackError(validated.error) };
    }
    const joined = joinWithinRoot(validated.value.root, relPath);
    if (joined === null) {
      return { ok: false, error: 'Path escapes the run root.' };
    }
    try {
      const info = await stat(joined);
      if (!info.isFile()) {
        return { ok: false, error: 'Not a file.' };
      }
      if ([...EXECUTABLE_EXTENSIONS].some((extension) => joined.toLowerCase().endsWith(extension))) {
        return { ok: false, error: 'Executables are refused.' };
      }
    } catch {
      return { ok: false, error: 'The file no longer exists.' };
    }
    const error = await shell.openPath(joined);
    if (error) {
      return { ok: false, error };
    }
    return { ok: true };
  });

  ipcMain.handle('miniapps:arm-run', async (_event, runId: unknown): Promise<{ ok: true; proposal: ProposalRow } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return { ok: false, error: 'Invalid run id.' };
    }
    const run = await miniAppRunService.getRun(runId);
    if (!run) {
      return { ok: false, error: 'Unknown run.' };
    }
    const pack = miniAppRegistry.runnablePack(run.packId);
    if (!pack) {
      return { ok: false, error: 'Pack is not runnable.' };
    }
    const items = await miniAppRunService.itemsOfRun(runId);
    const fs = await openRunFs(run.rootPath);
    if (!fs) {
      return { ok: false, error: 'The run root is no longer accessible.' };
    }
    const armed = await proposalService.arm(pack, run, items, fs);
    if (!armed.ok) {
      return { ok: false, error: formatPackError(armed.error) };
    }
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('miniapps:proposal-event', { type: 'proposal:created', proposalId: armed.proposal.id, runId, packId: run.packId });
    }
    return { ok: true, proposal: armed.proposal };
  });

  ipcMain.handle('miniapps:resolve-proposal', async (_event, proposalId: unknown, approve: unknown): Promise<{ ok: true; outcome: unknown } | { ok: false; error: string }> => {
    if (typeof proposalId !== 'string' || proposalId.length === 0 || proposalId.length > 200) {
      return { ok: false, error: 'Invalid proposal id.' };
    }
    if (typeof approve !== 'boolean') {
      return { ok: false, error: 'approve must be a boolean.' };
    }
    const resolved = await proposalService.resolve(proposalId, approve);
    if (!resolved.ok) {
      return { ok: false, error: formatPackError(resolved.error) };
    }
    if (!resolved.executed) {
      return { ok: true, outcome: null };
    }
    const proposal = await proposalService.get(proposalId);
    if (!proposal) {
      return { ok: false, error: 'Proposal vanished.' };
    }
    const run = await miniAppRunService.getRun(proposal.runId);
    if (!run) {
      return { ok: false, error: 'Unknown run.' };
    }
    const fs = await openRunFs(run.rootPath);
    if (!fs) {
      return { ok: false, error: 'The run root is no longer accessible.' };
    }
    const outcome = await proposalService.execute(proposalId, fs, (relative, size, mtimeMs) =>
      runnerFingerprint(fs.rootPath, relative, size, mtimeMs)
    );
    const moved = outcome.filter((entry) => entry.outcome === 'moved').length;
    const title = miniAppPackTitle(proposal.packId);
    if (Notification.isSupported()) {
      new Notification({
        title,
        body: moved > 0 ? `${moved} item(s) quarantined — restorable from the report` : 'Nothing was moved — see the report',
      }).show();
    }
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('miniapps:proposal-event', { type: 'proposal:executed', proposalId, runId: proposal.runId, packId: proposal.packId });
    }
    return { ok: true, outcome };
  });

  ipcMain.handle('miniapps:abort-proposal', (_event, proposalId: unknown): boolean => {
    if (typeof proposalId !== 'string' || proposalId.length === 0 || proposalId.length > 200) {
      return false;
    }
    proposalService.abort(proposalId);
    return true;
  });

  ipcMain.handle('miniapps:restore-item', async (_event, runId: unknown, relPath: unknown): Promise<{ ok: true; restoredPath: string } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 2048) {
      return { ok: false, error: 'Invalid arguments.' };
    }
    const result = await proposalService.restoreItem(runId, relPath);
    return result.ok ? { ok: true, restoredPath: result.restoredPath } : { ok: false, error: formatPackError(result.error) };
  });

  ipcMain.handle('miniapps:restore-batch', async (_event, proposalId: unknown): Promise<{ ok: true; restored: number } | { ok: false; error: string }> => {
    if (typeof proposalId !== 'string' || proposalId.length === 0 || proposalId.length > 200) {
      return { ok: false, error: 'Invalid proposal id.' };
    }
    const result = await proposalService.restoreBatch(proposalId);
    return result.ok ? { ok: true, restored: result.restored } : { ok: false, error: formatPackError(result.error) };
  });

  ipcMain.handle('miniapps:restore-bundled', async (): Promise<{ ok: true; installed: string[] } | { ok: false; error: string }> => {
    try {
      const installed = await installBundledPacks(true);
      return { ok: true, installed };
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) };
    }
  });

  ipcMain.handle('miniapps:restore-quarantine-record', async (_event, recordId: unknown): Promise<{ ok: true; restoredPath: string } | { ok: false; error: string }> => {
    if (typeof recordId !== 'string' || recordId.length === 0 || recordId.length > 200) {
      return { ok: false, error: 'Invalid record id.' };
    }
    const allPacks = await quarantineStore.packIdsWithRecords();
    for (const packId of allPacks) {
      const records = await quarantineStore.byPack(packId);
      const record = records.find((entry) => entry.id === recordId);
      if (record) {
        const result = await quarantineService.restore(record);
        return result.ok ? { ok: true, restoredPath: result.restoredPath } : { ok: false, error: formatPackError(result.error) };
      }
    }
    return { ok: false, error: 'Unknown quarantine record.' };
  });

  ipcMain.handle('miniapps:quarantine-list', async (_event, packId: unknown): Promise<{ packId: string; records: { id: string; relPath: string; originPath: string; movedAt: number; restoredAt: number | null }[] } | null> => {
    if (typeof packId !== 'string' || packId.length === 0 || packId.length > 200) {
      return null;
    }
    const records = await quarantineStore.byPack(packId);
    return {
      packId,
      records: records
        .sort((a, b) => b.movedAt - a.movedAt)
        .slice(0, 200)
        .map((record) => ({
          id: record.id,
          relPath: record.relPath,
          originPath: record.originPath,
          movedAt: record.movedAt,
          restoredAt: record.restoredAt,
        })),
    };
  });

  ipcMain.handle('miniapps:feedback-list', async (_event, packId: unknown): Promise<{ packId: string; rootPath: string; relPath: string; verdict: string; source: string }[]> => {
    if (typeof packId !== 'string' || packId.length === 0 || packId.length > 200) {
      return [];
    }
    const rows = await miniAppRunStore.feedbackList(packId);
    return rows.map((row) => ({ packId: row.packId, rootPath: row.rootPath, relPath: row.relPath, verdict: row.verdict, source: row.source }));
  });

  ipcMain.handle('miniapps:feedback-clear', async (_event, packId: unknown, relPath: unknown): Promise<number> => {
    if (typeof packId !== 'string' || packId.length === 0 || packId.length > 200) {
      return 0;
    }
    const path = typeof relPath === 'string' && relPath.length > 0 && relPath.length <= 2048 ? relPath : undefined;
    return miniAppRunStore.feedbackClear(packId, path);
  });

  ipcMain.handle('miniapps:quarantine-status', async (_event, packId: unknown): Promise<{ total: number; restorable: number }> => {
    const scoped = typeof packId === 'string' && packId.length > 0 && packId.length <= 200 ? packId : undefined;
    const all = scoped ? await quarantineStore.byPack(scoped) : [];
    return {
      total: all.length,
      restorable: all.filter((record) => record.restoredAt === null).length,
    };
  });

  ipcMain.handle('miniapps:empty-quarantine', async (_event, packId: unknown): Promise<{ ok: true; removed: number } | { ok: false; error: string }> => {
    if (typeof packId !== 'string' || packId.length === 0 || packId.length > 200) {
      return { ok: false, error: 'Invalid pack id.' };
    }
    const removed = await quarantineService.empty(packId);
    return { ok: true, removed };
  });

  ipcMain.handle('miniapps:run-export', async (_event, runId: unknown, format: unknown): Promise<{ ok: true; text: string; fileName: string } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return { ok: false, error: 'Invalid run id.' };
    }
    if (format !== 'markdown' && format !== 'json' && format !== 'csv') {
      return { ok: false, error: 'Unknown export format.' };
    }
    const report = await buildReportView(runId, 0);
    if (!report) {
      return { ok: false, error: 'Unknown run.' };
    }
    return {
      ok: true,
      text: exportRunReport(report, format),
      fileName: `${report.run.packId}-${report.run.id}.${format === 'markdown' ? 'md' : format}`,
    };
  });

  ipcMain.handle('miniapps:run-diff', async (_event, runId: unknown): Promise<MiniAppRunDiffView | null> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return null;
    }
    const run = await miniAppRunService.getRun(runId);
    if (!run) {
      return null;
    }
    const latestItems = (await miniAppRunService.itemsOfRun(runId)).map((item) => ({
      relPath: item.relPath,
      fingerprint: item.fingerprint,
      verdict: item.verdict,
    }));
    const prior = (await miniAppRunService.recentRuns(run.packId, 50))
      .filter((candidate) => candidate.id !== runId && candidate.rootPath === run.rootPath && ['done', 'paused', 'interrupted', 'canceled'].includes(candidate.status))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const baseline = prior
      ? {
          runId: prior.id,
          items: (await miniAppRunService.itemsOfRun(prior.id)).map((item) => ({
            relPath: item.relPath,
            fingerprint: item.fingerprint,
            verdict: item.verdict,
          })),
        }
      : null;
    const diff = diffRuns(
      { runId, finishedAt: run.finishedAt, updatedAt: run.updatedAt, items: latestItems },
      baseline
        ? {
            runId: baseline.runId,
            finishedAt: prior ? prior.finishedAt : null,
            updatedAt: prior ? prior.updatedAt : 0,
            items: baseline.items,
          }
        : null
    );
    return { runId, baselineRunId: diff.baselineRunId, entries: diff.entries };
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
    getJevKey: async () => SecretService.getInstance().getSecret(openrouterSecretKey()),
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

  ipcMain.handle('decisions:set-key', async (_event, key: unknown) => {
    const value = typeof key === 'string' ? key.trim() : '';
    if (!value) {
      return false;
    }
    await SecretService.getInstance().setSecret(openrouterSecretKey(), value);
    return true;
  });

  ipcMain.handle('decisions:clear-key', async () => {
    await SecretService.getInstance().deleteSecret(openrouterSecretKey());
    return true;
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
    return null; 
  });

  ipcMain.handle('hotkeys:stop-recording', async () => {
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
    'miniapps:get-state', 'miniapps:import', 'miniapps:remove', 'miniapps:set-enabled', 'miniapps:save-config',
    'miniapps:pick-root', 'miniapps:run-start', 'miniapps:run-cancel', 'miniapps:run-resume', 'miniapps:runs-list', 'miniapps:run-report', 'miniapps:run-export', 'miniapps:run-diff',
    'miniapps:override-item', 'miniapps:exclude-item', 'miniapps:reveal-item', 'miniapps:open-item',
    'miniapps:arm-run', 'miniapps:resolve-proposal', 'miniapps:abort-proposal', 'miniapps:restore-item', 'miniapps:restore-quarantine-record', 'miniapps:restore-batch', 'miniapps:quarantine-status', 'miniapps:quarantine-list', 'miniapps:feedback-list', 'miniapps:feedback-clear', 'miniapps:empty-quarantine', 'miniapps:restore-bundled',
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