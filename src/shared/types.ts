// src/shared/types.ts

import { AppConfig } from '@shared/config/AppConfig';
import { PdfProcessingStrategy } from "@main/services/AttachmentService";
import { MessageCreate } from "@shared/database-types";
import type { ApprovalResolution, ToolCatalogEntry, ToolClassDefaults, ToolResultView, ToolVerificationSettings, TurnEvent, TurnMetadata, TurnStartRequest } from '@shared/turns';
import type { CommandCatalogSnapshot, CommandOutcome } from './commands';
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
import type { MemoryRestoreInput, MemoryView } from '@shared/memory';

// =============================================================================
// ENUMS
// =============================================================================

export interface Preferences {
  autostart: boolean;
  showDockIcon: boolean;
  confirmOnQuit: boolean;
  confirmOnDelete: boolean;
}

export interface AutostartStatus {
  supported: boolean;
  enabled: boolean;
}

export type ModelCapability = 'text' | 'vision' | 'tools' | 'stt' | 'tts' | 'embeddings';

export const DEFAULT_MODEL_CAPS: ModelCapability[] = ['text'];

export interface Model {
  id: string; // e.g., 'gpt-4o-mini'
  name: string; // e.g., 'GPT-4o Mini'
  providerType: LLMProviderType; // e.g., 'openai'
  providerId: string; // ID του provider instance
  caps?: ModelCapability[];
  reasoningEffort?: string;
  temperature?: number;
  maxTokens?: number;
}

export enum AiTask {
  CHAT = 'chat',
  TITLES = 'titles',
  STT = 'stt',
  VOICE_ENDPOINT = 'voiceEndpoint',
  TTS = 'tts',
  /** LLM-backed translation engine (plan 19); no fallback to CHAT. */
  TRANSLATE = 'translate',
  /** Internal helper calls (memory dedupe, title-ish work). Falls back to CHAT. */
  PLUMBING = 'plumbing',
  /** Decision engines (plan 20): intent routing + tool dispatch; audit task only. */
  INTENT = 'intent',
  /** Default model for image/screen-capture turns (plan 21 D14). Falls back to CHAT. */
  VISION = 'vision',
}

/** OpenAI-compatible `/audio/speech` voice names (plan 12 §6). */
export const TTS_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'] as const;

export interface VoiceSettings {
  enabled: boolean;
  /** ISO-639-1 code or 'auto' (model-side language detection). */
  language: string;
  /** Transcribe each paused phrase while recording (interim results). */
  liveTranscript: boolean;
  /** Silence that closes a phrase before it is transcribed. */
  phraseGapMs: number;
  /** Force-commit a segment after this much continuous speech (0 = off). */
  maxSegmentMs: number;
  /** Input multiplier for silence detection and the live level bars. */
  gain: number;
  /** Auto-send a dictation when the voice-endpoint task judges it complete. */
  autoSend: boolean;
  /** Apply the model's corrected transcript (punctuation, capitals, fillers). */
  autoFix: boolean;
  /** Ask the model for paragraph/structure cleanup of the transcript. */
  formatting: boolean;
  /** Free-form instructions appended to the post-processing prompt. */
  customPrompt: string;
  /** Give the post-processing model the last exchange for terminology continuity. */
  attachContext: boolean;
  /** Speak finished assistant replies aloud (plan 12 §6; off by default). */
  speakReplies: boolean;
  /** Synthesizer voice name (OpenAI-compatible `/audio/speech` voices). */
  speakVoice: string;
  /** Speech rate multiplier (0.5–2.0). */
  speakSpeed: number;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  modelCount: number;
  error: string | null;
}

export interface SetupPresetOptions {
  /** Curated model ids to append (D21 review modal); omitted = the preset's curated list. */
  curatedIds?: string[];
  /** Gap-fill the empty CHAT default (default true). */
  bindChat?: boolean;
  /** Gap-fill the empty VISION default (default true). */
  bindVision?: boolean;
  /** Gap-fill the empty STT default (default true). */
  bindStt?: boolean;
}

export interface SetupProviderResult {
  ok: boolean;
  provider?: LLMProvider;
  assignedModelId: string | null;
  assignedVisionModelId?: string | null;
  assignedSttModelId?: string | null;
  catalogCount: number;
  /** True when the preset has a curated list but none of its ids matched the fetched catalog (D17 drift). */
  curatedMissed?: boolean;
  errorCode?: import('./ai/providerErrors').SetupProviderErrorCode;
  vendorMessage?: string | null;
  suspectedVendor?: string | null;
}

export enum LLMProviderType {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
  GROQ = 'groq',
  TOGETHER = 'together',
  FIREWORKS = 'fireworks',
  OLLAMA = 'ollama',
}

export interface LLMProvider {
  id: string;
  name: string;
  type: LLMProviderType;
  apiKey: string;
  apiKeyHint?: string;
  apiBase: string;
  timeout: number;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  availableModels?: Model[];
  customModels?: Model[];
  /** Setup-wizard provenance (plan 21); absent = manually configured row. */
  presetKey?: string;
}

export interface ConversationSettings {
  historyLimit: number;
  clearHistoryOnMinimize: boolean;
  clearLastResponseOnMinimize: boolean;
  pdfProcessingStrategy: PdfProcessingStrategy
}

export interface BehaviorSettings {
  /** Which window the summon hotkey opens. */
  defaultMode: 'launcher' | 'desktop';
  /** Launcher: auto-expand the transcript when a response overflows the panel. */
  autoExpand: boolean;
  /** Pin transcripts to the newest message while a response streams. Off = manual scroll. */
  autoScroll: boolean;
  /** Notify (system notification) when a turn finishes while no chat window is visible. */
  notifyOnComplete: boolean;
  /** Hide the launcher when it loses focus. */
  hideOnBlur: boolean;
  /** Show per-turn trace timelines (phases, tool calls, durations). */
  traceDetails: boolean;
  /** Inject recalled memories at turn start and let the model bind memory_save. */
  memoryContext: boolean;
  /** Opt-in: show an "insert selection" button in the composer toolbar (X11 Linux only). */
  selectionCapture: boolean;
  /** Opt-in: flag clipboard changes on summon with an "ask about clipboard" chip. */
  clipboardWatcher: boolean;
}

export interface WindowSettings {
  dimensions: WindowDimensions;
  alwaysOnTop: boolean;
  startMinimized: boolean;
  frame: boolean;
  transparent: boolean;
  /** Set once the user explicitly changed `transparent`; legacy `false` seeds migrate to the new default until then. */
  transparentSet?: boolean;
  resizable: boolean;
}

export interface WindowStateData {
  position: { x: number; y: number } | null;
  rememberedBounds: { x: number; y: number; width: number; height: number } | null;
  desktopBounds: { x: number; y: number; width: number; height: number } | null;
  desktopMaximized: boolean;
}

export enum InputMode {
  SINGLE_LINE = 'single',
  MULTI_LINE = 'multi'
}

export enum RecordingState {
  IDLE = 'idle',
  RECORDING = 'recording',
  PROCESSING = 'processing'
}

export enum WindowState {
  COMPACT = 'compact',
  EXPANDED = 'expanded'
}

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system'
}

// =============================================================================
// HOTKEY TYPES
// =============================================================================

/**
 * Defines the available actions that can be triggered by a hotkey.
 */
export enum HotkeyAction {
  ToggleWindow = 'toggle-window',
  OpenSettings = 'open-settings',
  StartRecording = 'start-recording',
  ToggleExpand = 'toggle-expand',
  OpenDesktop = 'open-desktop',
  OpenCommandPalette = 'open-command-palette',
}

/**
 * Represents a single hotkey configuration.
 */
export interface HotkeyConfig {
  /** A unique identifier for the hotkey action. */
  action: HotkeyAction;
  /** The key combination (e.g., 'CommandOrControl+Shift+A'). Can be null if not set. */
  accelerator: string | null;
  /** A user-friendly description of the hotkey's function. */
  label: string;
  /** Whether the hotkey can be modified by the user. */
  isEditable: boolean;
}

export type HotkeySettings = {
  [key in HotkeyAction]: HotkeyConfig;
};

/**
 * Represents the complete set of hotkey settings for the application.
 * It's a dictionary-like type where each key is a HotkeyAction,
 * and the value is the corresponding HotkeyConfig.
 */


// =============================================================================
// INTERFACES
// =============================================================================

export interface AppState {
  inputMode: InputMode;
  recordingState: RecordingState;
  windowState: WindowState;
  isConversationVisible: boolean;
}

export interface WindowDimensions {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export interface ImageAttachment {
  type: 'image';
  data: string;
}

export interface PDFAttachment {
  type: 'pdf';
  data: string;
  filename: string;
  extractedText?: string;
}

export interface ScreenCaptureAttachment {
  type: 'screen-capture';
  data: string;
  sourceId: string;
}


export type Attachment = ImageAttachment | ScreenCaptureAttachment | PDFAttachment;

// =============================================================================
// DATABASE TYPES (ΕΝΗΜΕΡΩΜΕΝΟ)
// =============================================================================

export interface Message {
  id: string;
  content: string;
  attachments?: Attachment[];
  metadata?: TurnMetadata;
  error?: string;
  role: MessageRole;
  conversationId: string;
  createdAt: Date;
}

export interface ConversationMetadata {
  /** Per-conversation model override; falls back to `defaultChatModelId`. */
  modelId?: string;
  /** Per-conversation persona (system-prompt override; composes with the provider prompt). */
  systemPrompt?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: Message[];
  isArchived: boolean;
  metadata?: ConversationMetadata;
}

export interface DatabaseStats {
  conversationCount: number;
  messageCount: number;
  databaseSize: string;
  lastModified: Date | null;
}

export interface DatabaseHealthCheck {
  connected: boolean;
  tablesExist: boolean;
  canWrite: boolean;
  errors: string[];
}

// =============================================================================
// IPC TYPES
// =============================================================================

export interface IPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// =============================================================================
// AI SERVICE TYPES
// =============================================================================

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
  attachments?: Attachment[];
}

export interface PdfProcessSuccessResponse {
  success: true;
  data: {
    extractedText: string | null;
  };
}

export interface PdfProcessErrorResponse {
  success: false;
  error: string;
}

export type PdfProcessResponse = PdfProcessSuccessResponse | PdfProcessErrorResponse;

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

export type Settings = Partial<AppConfig>;

// =============================================================================
// UTILITY TYPES
// =============================================================================

export type MessageContent = string;
export type ConversationID = string;
export type MessageID = string;

// =============================================================================
// EVENT TYPES
// =============================================================================

// export interface AppEvents {
//   'conversation-created': Conversation;
//   'conversation-updated': Conversation;
//   'conversation-deleted': string;
//   'message-created': Message;
//   'message-updated': Message;
//   'message-deleted': string;
//   'window-state-changed': WindowState;
//   'recording-state-changed': RecordingState;
//   'input-mode-changed': InputMode;
// }

// =============================================================================
// ELECTRON API TYPES
// =============================================================================

export type ResizeCorner = 'bottom-left' | 'bottom-right';

export function isResizeCorner(value: unknown): value is ResizeCorner {
  return value === 'bottom-left' || value === 'bottom-right';
}

export interface ElectronAPI {
  loadConfig: () => Promise<AppConfig>;
  saveConfig: (config: any) => Promise<void>;
  saveSettings: (settings: Settings) => Promise<IPCResponse<void>>;
  resetConfig: () => Promise<IPCResponse<void>>;
  exportConfig: () => Promise<IPCResponse<{ path: string }>>;
  importConfig: (configJson: string) => Promise<IPCResponse<void>>;
  onConfigUpdate: (callback: (config: Partial<AppConfig>) => void) => void;

  generateAIResponse: (messages: AIMessage[]) => Promise<string>;
  startTurn: (request: TurnStartRequest) => Promise<{ tempMessageId: string }>;
  cancelTurn: () => Promise<boolean>;
  cancelDownload: (downloadId: string) => Promise<boolean>;
  resumeTurn: (resolution: ApprovalResolution) => Promise<boolean>;
  onTurnEvent: (callback: (event: TurnEvent) => void) => () => void;
  getToolCatalog: () => Promise<ToolCatalogEntry[]>;
  getCommandCatalog: () => Promise<CommandCatalogSnapshot>;
  executeCommand: (commandId: string, argv: string[], source?: 'palette' | 'hotkey') => Promise<CommandOutcome>;
  clearCommandHistory: () => Promise<boolean>;
  refreshApps: () => Promise<{ count: number }>;
  getAppIcon: (appId: string) => Promise<string | null>;
  saveCustomCommand: (def: unknown) => Promise<{ ok: boolean; error?: string }>;
  deleteCustomCommand: (id: string) => Promise<boolean>;
  importIntegration: (json: string, secrets: Record<string, string>) => Promise<{ ok: boolean; error?: string; packId?: string }>;
  removeIntegration: (packId: string) => Promise<boolean>;
  getToolResult: (callId: string) => Promise<ToolResultView | null>;
  openToolResultViewer: (callId: string) => Promise<boolean>;
  setToolEnabled: (name: string, enabled: boolean) => Promise<boolean>;
  revokeToolGrant: (name: string) => Promise<boolean>;
  setToolVerification: (name: string, settings: ToolVerificationSettings | null) => Promise<boolean>;
  setToolGrant: (name: string, granted: boolean) => Promise<boolean>;
  setToolClassDefaults: (defaults: ToolClassDefaults) => Promise<boolean>;
  pickGrantedRoot: () => Promise<string | null>;
  removeGrantedRoot: (root: string) => Promise<boolean>;
  getToolApps: () => Promise<{ apps: ToolAppView[]; deferredSupported: boolean; nativeToolCount: number }>;
  listToolAppPresets: () => Promise<ToolAppPreset[]>;
  saveToolApp: (input: ToolAppSaveInput) => Promise<{ ok: true; view: ToolAppView } | { ok: false; error: string }>;
  removeToolApp: (appId: string) => Promise<boolean>;
  setToolAppEnabled: (appId: string | null, enabled: boolean) => Promise<boolean>;
  setToolAppState: (
    appId: string,
    toolName: string,
    patch: { enabled?: boolean; keywordTags?: string[]; riskOverride?: string } | null
  ) => Promise<boolean>;
  setToolAppEntityScope: (appId: string, scope: EntityScope | null) => Promise<boolean>;
  testToolApp: (appId: string) => Promise<McpTestResult | { ok: false; error: string }>;
  previewToolAppScope: (appId: string, rules: EntityScope['rules']) => Promise<{ entities: { id: string; allowed: boolean }[] }>;
  getSearchProviders: () => Promise<SearchProviderView[]>;
  saveSearchProvider: (input: SearchProviderSaveInput) => Promise<SearchProviderView>;
  deleteSearchProvider: (providerId: string) => Promise<boolean>;
  setSearchProviderEnabled: (providerId: string, enabled: boolean) => Promise<boolean>;
  moveSearchProvider: (providerId: string, direction: 'up' | 'down') => Promise<boolean>;
  testSearchProvider: (providerId: string) => Promise<SearchProviderTestResult>;
  getTranslationProviders: () => Promise<TranslationProviderView[]>;
  saveTranslationProvider: (input: TranslationProviderSaveInput) => Promise<TranslationProviderView>;
  deleteTranslationProvider: (providerId: string) => Promise<boolean>;
  setTranslationProviderEnabled: (providerId: string, enabled: boolean) => Promise<boolean>;
  moveTranslationProvider: (providerId: string, direction: 'up' | 'down') => Promise<boolean>;
  testTranslationProvider: (providerId: string) => Promise<TranslationProviderTestResult>;
  translateText: (request: { text: string; target?: string; source?: string }) => Promise<TranslationRunResult>;
  getDecisionState: () => Promise<import('./ai/decisions').DecisionSettingsState>;
  downloadDecisionWeights: () => Promise<{ ok: boolean; error?: string }>;
  cancelDecisionDownload: () => Promise<boolean>;
  testDecision: (input: string) => Promise<import('./ai/decisions').DecisionTestRun>;
  listMemories: (limit?: number, offset?: number) => Promise<MemoryView[]>;
  searchMemories: (query: string, limit?: number) => Promise<MemoryView[]>;
  deleteMemory: (id: string) => Promise<boolean>;
  restoreMemory: (input: MemoryRestoreInput) => Promise<MemoryView>;
  consolidateMemories: () => Promise<{ checked: number; merged: number; kept: number; skipped: boolean }>;
  selectionSupported: () => Promise<boolean>;
  autostartStatus: () => Promise<AutostartStatus>;
  clipboardChanged: () => Promise<{ changed: boolean; text?: string; preview?: string }>;
  captureSelection: () => Promise<{ ok: boolean; text?: string; error?: string }>;
  openDesktop: (conversationId?: string) => Promise<void>;
  openLauncher: (mode?: 'compact' | 'expanded', conversationId?: string) => Promise<void>;
  onSessionSync: (callback: (conversationId: string) => void) => () => void;
  onLauncherSetMode: (callback: (mode: 'compact' | 'expanded') => void) => () => void;
  toggleMaximizeWindow: () => Promise<void>;
  onLauncherToggleExpand: (callback: () => void) => () => void;
  onLauncherNewConversation: (callback: () => void) => () => void;
  onLauncherOpenPalette: (callback: () => void) => () => void;
  clearMessagesByConversation: (conversationId: string) => Promise<void>;
  clearAllConversations: () => Promise<void>; 
  fetchAvailableModels: (provider: LLMProvider) => Promise<IPCResponse<Model[]>>;
  testProvider: (provider: LLMProvider) => Promise<ProviderTestResult>;
  sttTranscribe: (audioData: Uint8Array) => Promise<string | null>;
  evaluateUtterance: (text: string, conversationId?: string) => Promise<{ complete: boolean; text?: string }>;

  addProvider: (providerData: Omit<LLMProvider, 'id'>) => Promise<IPCResponse<LLMProvider>>;
  updateProvider: (provider: LLMProvider) => Promise<IPCResponse<void>>;
  deleteProvider: (providerId: string) => Promise<IPCResponse<void>>;
  setDefaultProvider: (providerId: string) => Promise<IPCResponse<void>>;
  setupProviderFromPreset: (presetKey: string, apiKey: string, name?: string, options?: SetupPresetOptions) => Promise<SetupProviderResult>;
  setDefaultModel: (providerId: string, modelId: string, task?: string) => Promise<IPCResponse<void>>;
  onFocusInput: (callback: () => void) => () => void;
  resizeWindow: (width: number|null, height: number|null) => void;
  resizeCornerStart: (corner: ResizeCorner) => Promise<void>;
  resizeCornerUpdate: (dx: number, dy: number) => Promise<void>;
  moveWindowBy: (dx: number, dy: number) => Promise<void>;
  resizeCornerEnd: () => Promise<void>;
  hideWindow: () => void;
  showWindow: () => void;
  minimizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  getAppVersion: () => Promise<string>;

  createConversation: (title: string) => Promise<any>;
  getAllConversations: () => Promise<any[]>;
  getConversationById: (id: string) => Promise<any | null>;
  updateConversation: (id: string, title: string) => Promise<any>;
  setConversationMetadata: (id: string, metadata: ConversationMetadata) => Promise<Conversation | null>;
  deleteConversation: (id: string) => Promise<void>;
  createMessage: (payload: MessageCreate) => Promise<any>;
  getMessagesByConversation: (conversationId: string) => Promise<any[]>;
  updateMessage: (id: string, content: string) => Promise<any>;
  deleteMessage: (id: string) => Promise<void>;
  downloadAttachment: (args: { dataUrl: string, filename: string }) => Promise<void>;
  processPdfAttachment: (dataUrl: string) => Promise<PdfProcessResponse>;
  getHotkeySettings: () => Promise<HotkeySettings>;
  saveHotkeySettings: (settings: Partial<HotkeySettings>) => Promise<IPCResponse<void>>;
  registerHotkeys: () => Promise<void>;
  startHotkeyRecording: () => Promise<string | null>;
  stopHotkeyRecording: () => void;
  getScreenSources: () => Promise<ScreenSource[]>;
  captureHighResSource: (sourceId: string) => Promise<string>;


  showContextMenu: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  openPath: (path: string) => Promise<string | null>;
  showItemInFolder: (path: string) => Promise<void>;
  listSchedules: () => Promise<import('./schedules').ScheduleView[]>;
  createSchedule: (input: import('./schedules').ScheduleInput) => Promise<import('./schedules').ScheduleView>;
  updateSchedule: (
    id: string,
    patch: Partial<import('./schedules').ScheduleInput> & { enabled?: boolean }
  ) => Promise<import('./schedules').ScheduleView>;
  deleteSchedule: (id: string) => Promise<boolean>;
  runScheduleNow: (id: string) => Promise<boolean>;
  getDocsStatus: () => Promise<import('./docs').DocsRootView[]>;
  setDocsIndexed: (
    root: string,
    on: boolean
  ) => Promise<{ indexed: boolean; files: number; chunks: number }>;
  reindexDocs: (root: string | null) => Promise<{ files: number; chunks: number; truncated: boolean }>;
  synthesizeTts: (text: string, requireToggle?: boolean) => Promise<{ audioBase64: string; mime: string } | null>;
  getToolUsageStats: (windowDays: number | null) => Promise<import('./toolUsage').ToolUsageStats>;
  getAppUsageStats: (windowDays: number | null) => Promise<import('./toolUsage').AppUsageStats>;
  showNotification: (title: string, body: string) => Promise<void>;
  writeToClipboard: (text: string) => Promise<boolean>;
  readFromClipboard: () => Promise<string>;
  
  saveFile: (options: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
    content: string;
  }) => Promise<string | null>;

  openFile: (options?: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
    properties?: ('openFile' | 'multiSelections')[];
  }) => Promise<{ filePath: string; content: string } | null>;

  onSettingsOpen: (target?: { tab?: string; section?: string; commandId?: string }) => Promise<void>;
  onSettingsNavigate: (callback: (target: { tab?: string; section?: string; commandId?: string }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
}