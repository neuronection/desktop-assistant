import { contextBridge, ipcRenderer } from 'electron';
import { ElectronAPI, Settings, HotkeySettings, LLMProvider, IPCResponse, AIMessage, Model, ConversationMetadata, type ResizeCorner, type AutostartStatus } from '@shared/types';
import type { Conversation, ProviderTestResult, SetupProviderResult, SetupPresetOptions } from '@shared/types';
import type { ApprovalResolution, ToolCatalogEntry, ToolClassDefaults, ToolResultView, ToolVerificationSettings, TurnEvent, TurnStartRequest } from '@shared/turns';
import type { LiveEvent, LiveNoticeCode, LiveSnapshot } from '@shared/live';
import type { CommandCatalogSnapshot, CommandOutcome } from '@shared/commands';
import type { McpTestResult } from '@shared/mcp';
import type { EntityScope, ToolAppSaveInput, ToolAppView } from '@shared/apps';
import type { ToolAppPreset } from '@shared/app-presets';
import type { SearchProviderSaveInput, SearchProviderTestResult, SearchProviderView } from '@shared/search';
import type {
  TranslationProviderSaveInput,
  TranslationProviderTestResult,
  TranslationProviderView,
  TranslationRunResult,
} from '@shared/translation';
import type { DecisionSettingsState, DecisionTestRun } from '@shared/ai/decisions';
import type { MemoryRestoreInput, MemoryView } from '@shared/memory';
import type { ScheduleInput, ScheduleView } from '@shared/schedules';
import type { DocsRootView } from '@shared/docs';
import type { ToolUsageStats, AppUsageStats } from '@shared/toolUsage';
import { AppConfig } from '@shared/config/AppConfig';
import { MessageCreate } from '@shared/database-types';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
const electronAPI: ElectronAPI = {
  // Window management
  resizeWindow: (width: number|null, height: number|null) =>
    ipcRenderer.invoke('window:resize', width, height),
  resizeCornerStart: (corner: ResizeCorner) =>
    ipcRenderer.invoke('window:resize-corner-start', corner),
  resizeCornerUpdate: (dx: number, dy: number) =>
    ipcRenderer.invoke('window:resize-corner-update', dx, dy),
  resizeCornerEnd: () =>
    ipcRenderer.invoke('window:resize-corner-end'),
  moveWindowBy: (dx: number, dy: number) =>
    ipcRenderer.invoke('window:move-by', dx, dy),
  hideWindow: () => 
    ipcRenderer.invoke('window:hide'),
  showWindow: () => 
    ipcRenderer.invoke('window:show'),
  minimizeWindow: () =>
    ipcRenderer.invoke('window:minimize'),
  closeWindow: () =>
    ipcRenderer.invoke('window:close'),

  // Settings-specific IPC calls
  loadConfig: () => 
    ipcRenderer.invoke('config:load'),
  saveConfig: (config: Partial<AppConfig>) => 
    ipcRenderer.invoke('config:save', config),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  importConfig: (configJson: string) => ipcRenderer.invoke('config:import', configJson),
  onConfigUpdate: (callback: (config: Partial<AppConfig>) => void) => {
    const handler = (_event: any, config: Partial<AppConfig>) => callback(config);
    ipcRenderer.on('config-updated', handler);
    return () => {
      ipcRenderer.removeListener('config-updated', handler);
    };
  },
  // UI Interaction
  onFocusInput: (callback: () => void) => {
    ipcRenderer.on('focus-input', callback);
    // Return a cleanup function
    return () => {
      ipcRenderer.removeListener('focus-input', callback);
    };
  },

  fetchAvailableModels: (provider: LLMProvider): Promise<IPCResponse<Model[]>> =>
    ipcRenderer.invoke('ai:fetch-models', provider),
  testProvider: (provider: LLMProvider): Promise<ProviderTestResult> =>
    ipcRenderer.invoke('ai:test-provider', provider),
  // Provider Management
  addProvider: (providerData: Omit<LLMProvider, 'id'>) => ipcRenderer.invoke('provider:add', providerData),
  updateProvider: (provider: LLMProvider) => ipcRenderer.invoke('provider:update', provider),
  deleteProvider: (providerId: string) => ipcRenderer.invoke('provider:delete', providerId),
  setDefaultProvider: (providerId: string) => ipcRenderer.invoke('provider:set-default', providerId),
  setupProviderFromPreset: (presetKey: string, apiKey: string, name?: string, options?: SetupPresetOptions): Promise<SetupProviderResult> =>
    ipcRenderer.invoke('provider:setup-preset', presetKey, apiKey, name, options),
  setDefaultModel: (providerId: string, modelId: string, task?: string): Promise<IPCResponse<void>> =>
    ipcRenderer.invoke('provider:set-default-model', providerId, modelId, task),

  // AI Service
  generateAIResponse: (messages: AIMessage[]) =>
    ipcRenderer.invoke('ai:generate-response', messages),
  startTurn: (request: TurnStartRequest): Promise<{ tempMessageId: string }> =>
    ipcRenderer.invoke('ai:turn-start', request),
  cancelTurn: (): Promise<boolean> =>
    ipcRenderer.invoke('ai:turn-cancel'),
  cancelDownload: (downloadId: string): Promise<boolean> =>
    ipcRenderer.invoke('tools:cancel-download', downloadId),
  resumeTurn: (resolution: ApprovalResolution): Promise<boolean> =>
    ipcRenderer.invoke('ai:turn-resume', resolution),
  onTurnEvent: (callback: (event: TurnEvent) => void) => {
    const handler = (_event: any, turnEvent: TurnEvent) => callback(turnEvent);
    ipcRenderer.on('ai:turn-event', handler);
    return () => {
      ipcRenderer.removeListener('ai:turn-event', handler);
    };
  },
  startLive: (conversationId: string): Promise<LiveSnapshot> =>
    ipcRenderer.invoke('live:start', conversationId),
  stopLive: (): Promise<LiveSnapshot> =>
    ipcRenderer.invoke('live:stop'),
  getLiveState: (): Promise<LiveSnapshot> =>
    ipcRenderer.invoke('live:get-state'),
  onLiveEvent: (callback: (event: LiveEvent) => void) => {
    const handler = (_event: any, liveEvent: LiveEvent) => callback(liveEvent);
    ipcRenderer.on('live:event', handler);
    return () => {
      ipcRenderer.removeListener('live:event', handler);
    };
  },
  liveMicReady: () => ipcRenderer.send('live:mic-ready'),
  livePhraseCommitted: (transcript: string) => ipcRenderer.send('live:phrase-committed', transcript),
  liveSpeechDetected: (input: { transcript: string; currentSentence: string }) =>
    ipcRenderer.send('live:speech-detected', input),
  livePlaybackStarted: () => ipcRenderer.send('live:playback-started'),
  livePlaybackEnded: () => ipcRenderer.send('live:playback-ended'),
  liveInterrupt: () => ipcRenderer.send('live:interrupt'),
  liveFail: (code: LiveNoticeCode) => ipcRenderer.send('live:fail', code),
  liveWarning: (code: LiveNoticeCode) => ipcRenderer.send('live:warning', code),
  liveDowngrade: () => ipcRenderer.send('live:downgrade'),
  getToolCatalog: (): Promise<ToolCatalogEntry[]> =>
    ipcRenderer.invoke('tools:get-catalog'),
  getCommandCatalog: (): Promise<CommandCatalogSnapshot> =>
    ipcRenderer.invoke('commands:get-catalog'),
  executeCommand: (commandId: string, argv: string[], source?: 'palette' | 'hotkey'): Promise<CommandOutcome> =>
    ipcRenderer.invoke('commands:execute', commandId, argv, source),
  clearCommandHistory: (): Promise<boolean> =>
    ipcRenderer.invoke('commands:clear-history'),
  refreshApps: (): Promise<{ count: number }> =>
    ipcRenderer.invoke('commands:refresh-apps'),
  getAppIcon: (appId: string): Promise<string | null> =>
    ipcRenderer.invoke('commands:get-app-icon', appId),
  saveCustomCommand: (def: unknown): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('commands:save-custom', def),
  deleteCustomCommand: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('commands:delete-custom', id),
  importIntegration: (json: string, secrets: Record<string, string>): Promise<{ ok: boolean; error?: string; packId?: string }> =>
    ipcRenderer.invoke('commands:import-integration', json, secrets),
  removeIntegration: (packId: string): Promise<boolean> =>
    ipcRenderer.invoke('commands:remove-integration', packId),
  getToolResult: (callId: string): Promise<ToolResultView | null> =>
    ipcRenderer.invoke('tools:get-result', callId),
  openToolResultViewer: (callId: string): Promise<boolean> =>
    ipcRenderer.invoke('tools:open-result-viewer', callId),
  setToolEnabled: (name: string, enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('tools:set-tool-enabled', name, enabled),
  revokeToolGrant: (name: string): Promise<boolean> =>
    ipcRenderer.invoke('tools:revoke-tool-grant', name),
  setToolVerification: (name: string, settings: ToolVerificationSettings | null): Promise<boolean> =>
    ipcRenderer.invoke('tools:set-verification', name, settings),
  setToolGrant: (name: string, granted: boolean): Promise<boolean> =>
    ipcRenderer.invoke('tools:set-tool-grant', name, granted),
  setToolClassDefaults: (defaults: ToolClassDefaults): Promise<boolean> =>
    ipcRenderer.invoke('tools:set-class-defaults', defaults),
  pickGrantedRoot: (): Promise<string | null> =>
    ipcRenderer.invoke('tools:pick-root'),
  removeGrantedRoot: (root: string): Promise<boolean> =>
    ipcRenderer.invoke('tools:remove-root', root),
  getToolApps: (): Promise<{ apps: ToolAppView[]; deferredSupported: boolean; nativeToolCount: number }> =>
    ipcRenderer.invoke('apps:get-state'),
  getToolAppDigestStats: (): Promise<Record<string, { entities: number; ageMinutes: number }>> =>
    ipcRenderer.invoke('apps:context-digest-stats'),
  listToolAppPresets: (): Promise<ToolAppPreset[]> =>
    ipcRenderer.invoke('apps:list-presets'),
  saveToolApp: (input: ToolAppSaveInput): Promise<{ ok: true; view: ToolAppView } | { ok: false; error: string }> =>
    ipcRenderer.invoke('apps:save-app', input),
  removeToolApp: (appId: string): Promise<boolean> =>
    ipcRenderer.invoke('apps:remove-app', appId),
  setToolAppEnabled: (appId: string | null, enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('apps:set-enabled', appId, enabled),
  setToolAppState: (
    appId: string,
    toolName: string,
    patch: { enabled?: boolean; keywordTags?: string[]; riskOverride?: string } | null
  ): Promise<boolean> =>
    ipcRenderer.invoke('apps:set-tool-state', appId, toolName, patch),
  setToolAppEntityScope: (appId: string, scope: EntityScope | null): Promise<boolean> =>
    ipcRenderer.invoke('apps:set-entity-scope', appId, scope),
  testToolApp: (appId: string): Promise<McpTestResult | { ok: false; error: string }> =>
    ipcRenderer.invoke('apps:test-connection', appId),
  previewToolAppScope: (
    appId: string,
    rules: EntityScope['rules']
  ): Promise<{ entities: { id: string; allowed: boolean }[] }> =>
    ipcRenderer.invoke('apps:preview-scope', appId, { rules }),
  getSearchProviders: (): Promise<SearchProviderView[]> =>
    ipcRenderer.invoke('search:get-providers'),
  saveSearchProvider: (input: SearchProviderSaveInput): Promise<SearchProviderView> =>
    ipcRenderer.invoke('search:save-provider', input),
  deleteSearchProvider: (providerId: string): Promise<boolean> =>
    ipcRenderer.invoke('search:delete-provider', providerId),
  setSearchProviderEnabled: (providerId: string, enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('search:set-provider-enabled', providerId, enabled),
  moveSearchProvider: (providerId: string, direction: 'up' | 'down'): Promise<boolean> =>
    ipcRenderer.invoke('search:move-provider', providerId, direction),
  testSearchProvider: (providerId: string): Promise<SearchProviderTestResult> =>
    ipcRenderer.invoke('search:test-provider', providerId),
  getTranslationProviders: (): Promise<TranslationProviderView[]> =>
    ipcRenderer.invoke('translation:get-providers'),
  saveTranslationProvider: (input: TranslationProviderSaveInput): Promise<TranslationProviderView> =>
    ipcRenderer.invoke('translation:save-provider', input),
  deleteTranslationProvider: (providerId: string): Promise<boolean> =>
    ipcRenderer.invoke('translation:delete-provider', providerId),
  setTranslationProviderEnabled: (providerId: string, enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('translation:set-provider-enabled', providerId, enabled),
  moveTranslationProvider: (providerId: string, direction: 'up' | 'down'): Promise<boolean> =>
    ipcRenderer.invoke('translation:move-provider', providerId, direction),
  testTranslationProvider: (providerId: string): Promise<TranslationProviderTestResult> =>
    ipcRenderer.invoke('translation:test-provider', providerId),
  translateText: (request: { text: string; target?: string; source?: string }): Promise<TranslationRunResult> =>
    ipcRenderer.invoke('translation:translate', request),
  getDecisionState: (): Promise<DecisionSettingsState> =>
    ipcRenderer.invoke('decisions:get-state'),
  downloadDecisionWeights: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('decisions:download-weights'),
  cancelDecisionDownload: (): Promise<boolean> =>
    ipcRenderer.invoke('decisions:cancel-download'),
  testDecision: (input: string): Promise<DecisionTestRun> =>
    ipcRenderer.invoke('decisions:test', input),
  setDecisionKey: (key: string): Promise<boolean> =>
    ipcRenderer.invoke('decisions:set-key', key),
  clearDecisionKey: (): Promise<boolean> =>
    ipcRenderer.invoke('decisions:clear-key'),
  listMemories: (limit?: number, offset?: number): Promise<MemoryView[]> =>
    ipcRenderer.invoke('memory:list', limit, offset),
  searchMemories: (query: string, limit?: number): Promise<MemoryView[]> =>
    ipcRenderer.invoke('memory:search', query, limit),
  deleteMemory: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('memory:delete', id),
  restoreMemory: (input: MemoryRestoreInput): Promise<MemoryView> =>
    ipcRenderer.invoke('memory:restore', input),
  consolidateMemories: (): Promise<{ checked: number; merged: number; kept: number; skipped: boolean }> =>
    ipcRenderer.invoke('memory:consolidate'),
  selectionSupported: (): Promise<boolean> =>
    ipcRenderer.invoke('desktop:selection-supported'),
  autostartStatus: (): Promise<AutostartStatus> =>
    ipcRenderer.invoke('system:autostart-status'),
  clipboardChanged: (): Promise<{ changed: boolean; text?: string; preview?: string }> =>
    ipcRenderer.invoke('desktop:clipboard-changed'),
  captureSelection: (): Promise<{ ok: boolean; text?: string; error?: string }> =>
    ipcRenderer.invoke('desktop:capture-selection'),
  openDesktop: (conversationId?: string): Promise<void> =>
    ipcRenderer.invoke('desktop:open', conversationId),
  openLauncher: (mode?: 'compact' | 'expanded', conversationId?: string): Promise<void> =>
    ipcRenderer.invoke('desktop:open-launcher', mode, conversationId),
  onSessionSync: (callback: (conversationId: string) => void) => {
    const handler = (_event: any, conversationId: string) => callback(conversationId);
    ipcRenderer.on('session-sync', handler);
    return () => {
      ipcRenderer.removeListener('session-sync', handler);
    };
  },
  toggleMaximizeWindow: (): Promise<void> =>
    ipcRenderer.invoke('window:maximize'),
  onLauncherToggleExpand: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('launcher:toggle-expand', handler);
    return () => {
      ipcRenderer.removeListener('launcher:toggle-expand', handler);
    };
  },
  onLauncherNewConversation: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('launcher:new-conversation', handler);
    return () => {
      ipcRenderer.removeListener('launcher:new-conversation', handler);
    };
  },
  onLauncherSetMode: (callback: (mode: 'compact' | 'expanded') => void) => {
    const handler = (_event: unknown, mode: 'compact' | 'expanded') => callback(mode);
    ipcRenderer.on('launcher:set-mode', handler);
    return () => {
      ipcRenderer.removeListener('launcher:set-mode', handler);
    };
  },
  onLauncherOpenPalette: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('launcher:open-palette', handler);
    return () => {
      ipcRenderer.removeListener('launcher:open-palette', handler);
    };
  },
  onStopSpeaking: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('hotkey:stop-speaking', handler);
    return () => {
      ipcRenderer.removeListener('hotkey:stop-speaking', handler);
    };
  },
  downloadAttachment: (args: { dataUrl: string, filename: string }) => ipcRenderer.invoke('download-attachment', args),
  processPdfAttachment: (dataUrl: string) => ipcRenderer.invoke('process-pdf-attachment', dataUrl),
  // File operations for import/export
  saveFile: (options: any) => ipcRenderer.invoke('fs:save-file', options),
  openFile: (options: any) => ipcRenderer.invoke('fs:open-file', options),

  onSettingsOpen: (target?: { tab?: string; section?: string; commandId?: string }) =>
    ipcRenderer.invoke('settings:open', target),
  onSettingsNavigate: (callback: (target: { tab?: string; commandId?: string }) => void) => {
    const handler = (_event: unknown, target: { tab?: string; section?: string; commandId?: string }) => callback(target);
    ipcRenderer.on('settings:navigate', handler);
    return () => {
      ipcRenderer.removeListener('settings:navigate', handler);
    };
  },
  saveSettings: (settings: Settings) =>
    ipcRenderer.invoke('settings:save', settings),

  // Database operations - Conversations
  createConversation: (title: string) => 
    ipcRenderer.invoke('db:conversations:create', title),
  getAllConversations: () => 
    ipcRenderer.invoke('db:conversations:get-all'),
  getConversationById: (id: string) => 
    ipcRenderer.invoke('db:conversations:get-by-id', id),
  updateConversation: (id: string, title: string) => 
    ipcRenderer.invoke('db:conversations:update', id, title),
  setConversationMetadata: (id: string, metadata: ConversationMetadata): Promise<Conversation> =>
    ipcRenderer.invoke('db:conversations:set-metadata', id, metadata),
  deleteConversation: (id: string) => 
    ipcRenderer.invoke('db:conversations:delete', id),
  clearAllConversations: () =>
    ipcRenderer.invoke('db:conversations:clear-all'),
  clearMessagesByConversation: (conversationId: string) =>
    ipcRenderer.invoke('db:messages:clear-by-conversation', conversationId),
  // Database operations - Messages
  createMessage: (payload: MessageCreate) => 
    ipcRenderer.invoke('db:messages:create', payload),
  getMessagesByConversation: (conversationId: string) => 
    ipcRenderer.invoke('db:messages:get-by-conversation', conversationId),
  updateMessage: (id: string, content: string) => 
    ipcRenderer.invoke('db:messages:update', id, content),
  deleteMessage: (id: string) => 
    ipcRenderer.invoke('db:messages:delete', id),
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  captureHighResSource: (sourceId: string) => ipcRenderer.invoke('capture-high-res-source', sourceId),
  sttTranscribe: (audioData: Uint8Array): Promise<string | null> => {
    return ipcRenderer.invoke('stt:transcribe', audioData);
  },
  evaluateUtterance: (text: string, conversationId?: string): Promise<{ complete: boolean; text?: string }> => {
    return ipcRenderer.invoke('voice:evaluate-utterance', text, conversationId);
  },

  // System operations
  openExternal: (url: string) =>
    ipcRenderer.invoke('system:open-external', url),
  openPath: (path: string): Promise<string | null> =>
    ipcRenderer.invoke('system:open-path', path),
  showItemInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke('system:show-item-in-folder', path),

  // Schedules (Settings → Automation)
  listSchedules: (): Promise<ScheduleView[]> =>
    ipcRenderer.invoke('schedules:list'),
  createSchedule: (input: ScheduleInput): Promise<ScheduleView> =>
    ipcRenderer.invoke('schedules:create', input),
  updateSchedule: (id: string, patch: Partial<ScheduleInput> & { enabled?: boolean }): Promise<ScheduleView> =>
    ipcRenderer.invoke('schedules:update', id, patch),
  deleteSchedule: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('schedules:delete', id),
  runScheduleNow: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('schedules:run-now', id),

  // TTS (plan 12 §6): auto-speak finished replies + explicit speak buttons
  synthesizeTts: (text: string, requireToggle?: boolean): Promise<{ audioBase64: string; mime: string } | null> =>
    ipcRenderer.invoke('ai:tts-synthesize', text, requireToggle),

  // Docs index (Settings → Tools, plan 12 §5)
  getDocsStatus: (): Promise<DocsRootView[]> =>
    ipcRenderer.invoke('docs:get-status'),
  setDocsIndexed: (root: string, on: boolean): Promise<{ indexed: boolean; files: number; chunks: number }> =>
    ipcRenderer.invoke('docs:set-indexed', root, on),
  reindexDocs: (root: string | null): Promise<{ files: number; chunks: number; truncated: boolean }> =>
    ipcRenderer.invoke('docs:re-index', root),
  getToolUsageStats: (windowDays: number | null): Promise<ToolUsageStats> =>
    ipcRenderer.invoke('tools:usage-stats', windowDays),
  getAppUsageStats: (windowDays: number | null): Promise<AppUsageStats> =>
    ipcRenderer.invoke('apps:usage-stats', windowDays),
  showNotification: (title: string, body: string) => 
    ipcRenderer.invoke('notification:show', { title, body }),

  showContextMenu: () => ipcRenderer.invoke('system:show-context-menu'),

  // Clipboard
  writeToClipboard: (text: string) => 
    ipcRenderer.invoke('clipboard:write-text', text),
  readFromClipboard: () => 
    ipcRenderer.invoke('clipboard:read-text'),

  // Hotkey management
  getHotkeySettings: () => 
    ipcRenderer.invoke('hotkeys:get-settings'),
  saveHotkeySettings: (settings: Partial<HotkeySettings>) =>
    ipcRenderer.invoke('hotkeys:save-settings', settings),
  registerHotkeys: () => 
    ipcRenderer.invoke('hotkeys:register-all'),
  startHotkeyRecording: () => 
    ipcRenderer.invoke('hotkeys:start-recording'),
  stopHotkeyRecording: () => 
    ipcRenderer.invoke('hotkeys:stop-recording'),

  // // System information
  getAppVersion: () => ipcRenderer.invoke('system:get-app-version'),
  // getPlatform: () => ipcRenderer.invoke('system:get-platform'),

  // // File operations for import/export
  // saveFile: (options: any) => ipcRenderer.invoke('fs:save-file', options),
  // openFile: (options: any) => ipcRenderer.invoke('fs:open-file', options),

  // // Listen for main process events

};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
