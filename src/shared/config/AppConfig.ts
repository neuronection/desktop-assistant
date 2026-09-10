import { AiTask, ConversationSettings, BehaviorSettings, HotkeyAction, HotkeySettings, LLMProvider, LLMProviderType, Preferences, VoiceSettings, WindowSettings } from '../types';
import type { McpServerConfig, McpToolOverride } from '../mcp';
import type { ToolClassDefaults, ToolVerificationSettings } from '../turns';
import type { SearchProviderConfig } from '../search';
import { ThemeType } from '@shared/constants/themes';
import { v4 as uuidv4 } from 'uuid';

// =============================================================================
// INTERFACES
// =============================================================================


// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

export interface ToolPolicySettings {
  /** Persistent "always allow" grants per tool name (non-secret). */
  toolGrants: Record<string, 'always'>;
  /** Per-tool kill switch: disabled tools never bind to the agent. */
  disabledTools: string[];
  /** Filesystem roots (user-granted via OS picker) file tools may touch. */
  grantedRoots: string[];
  /** User-configured MCP servers (secrets live in the keyring, not here). */
  mcpServers: McpServerConfig[];
  /** Per-MCP-tool settings keyed by namespaced tool name. */
  mcpToolOverrides: Record<string, McpToolOverride>;
  /** Per-tool verification overrides keyed by tool name (namespaced for MCP). */
  toolSettings: Record<string, ToolVerificationSettings>;
  /** Class-level default verification (overridden by `toolSettings`). */
  classDefaults: ToolClassDefaults;
}

export interface SearchSettings {
  /** Ordered web-search provider instances (array order = priority; keys in the keyring). */
  providers: SearchProviderConfig[];
}

export interface CustomCommandDef {
  id: string;
  name: string;
  description?: string;
  kind: 'tool' | 'prompt';
  toolName?: string;
  argTemplate?: Record<string, string>;
  promptTemplate?: string;
  aliases: string[];
  icon?: string;
}

export interface IntegrationCommandDef {
  id: string;
  kind: 'http' | 'tool' | 'prompt';
  title: string;
  description?: string;
  aliases?: string[];
  icon?: string;
  args?: { name: string; description?: string; required?: boolean; type?: 'string' | 'number' | 'boolean' }[];
  toolName?: string;
  argTemplate?: Record<string, string>;
  promptTemplate?: string;
  method?: 'GET' | 'POST';
  urlTemplate?: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
}

export interface IntegrationPackConfig {
  id: string;
  name: string;
  enabled: boolean;
  commands: IntegrationCommandDef[];
  /** Set at boot when the stored pack no longer validates (D10 self-disable). */
  error?: string;
}

export interface CommandsSettings {
  /** Feature kill switch: false hides the palette and restores the plain composer. */
  enabled: boolean;
  custom: CustomCommandDef[];
  /** Command ids hidden from the palette (not executable anywhere). */
  hidden: string[];
  pins: string[];
  /** User-added aliases on top of built-in ones, keyed by command id. */
  extraAliases: Record<string, string[]>;
  /** Per-argument defaults, keyed by command id then arg name. */
  argDefaults: Record<string, Record<string, unknown>>;
  apps: {
    discovery: boolean;
    /** Master switch: false removes app entries from palette AND agent scope. */
    launchEnabled: boolean;
    hiddenApps: string[];
  };
  web: {
    behavior: 'inline' | 'browser';
    /** Engine URL template for the no-provider fallback (`?q=` style). */
    fallbackEngine: string;
  };
  history: {
    enabled: boolean;
    retentionDays: number;
  };
  integrations: IntegrationPackConfig[];
  /** Per-command agent scope (plan 14 D9); absent = off. */
  agentCallable: Record<string, boolean>;
}

export interface AppConfig {
  theme: ThemeType;
  preferences: Preferences;
  window: WindowSettings;
  providers: LLMProvider[];
  defaultProviderId: string | null;
  defaultChatModelId: string | null;
  taskAssignments: Record<AiTask, string | null>;
  conversation: ConversationSettings;
  voice: VoiceSettings;
  behavior: BehaviorSettings;
  hotkeys: HotkeySettings;
  tools: ToolPolicySettings;
  search: SearchSettings;
  commands: CommandsSettings;
}

const defaultOpenAIProvider: LLMProvider = {
  id: uuidv4(),
  name: 'OpenAI Default',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://api.openai.com/v1',
  timeout: 120000,
  temperature: 0.7,
  maxTokens: 2000,
  systemPrompt: "You're a friendly assistant delivering clear, concise answers for everyday learning and fun facts. Keep replies brief, use tables for clarity, and make learning quick and enjoyable.",
  availableModels: [],
  customModels: []
};


export const DEFAULT_CONFIG: AppConfig = {
  theme: ThemeType.CLASSIC,
  preferences: {
    autostart: false,
    showDockIcon: true,
    confirmOnQuit: true,
    confirmOnDelete: true,
  },
  window: {
    dimensions: { width: 650, height: 130, minWidth: 400, minHeight: 130 },
    alwaysOnTop: true,
    startMinimized: false,
    frame: false,
    transparent: true,
    resizable: true,
  },
  providers: [defaultOpenAIProvider],
  defaultProviderId: defaultOpenAIProvider.id,
  defaultChatModelId: null,
  taskAssignments: {
    [AiTask.CHAT]: null,
    [AiTask.TITLES]: null,
    [AiTask.STT]: null,
    [AiTask.VOICE_ENDPOINT]: null,
  },
  conversation: {
      historyLimit: 100,
      clearHistoryOnMinimize: false,
      clearLastResponseOnMinimize: false,
      pdfProcessingStrategy: 'extractText'
  },
  voice: {
    enabled: true,
    language: 'auto',
    liveTranscript: true,
    phraseGapMs: 700,
    maxSegmentMs: 0,
    gain: 1,
    autoSend: false,
    autoFix: false,
    formatting: false,
    customPrompt: '',
    attachContext: false,
  },
  behavior: {
      defaultMode: 'launcher',
      autoExpand: true,
      notifyOnComplete: true,
      hideOnBlur: false,
      traceDetails: false,
      memoryContext: true,
      selectionCapture: false,
      clipboardWatcher: false
  },
  hotkeys: {
    [HotkeyAction.ToggleWindow]: {
      action: HotkeyAction.ToggleWindow,
      accelerator: 'CommandOrControl+Shift+A',
      label: 'Toggle App Window',
      isEditable: true,
    },
    [HotkeyAction.OpenSettings]: {
      action: HotkeyAction.OpenSettings,
      accelerator: 'CommandOrControl+,',
      label: 'Open Settings',
      isEditable: true,
    },
    [HotkeyAction.StartRecording]: {
      action: HotkeyAction.StartRecording,
      accelerator: 'CommandOrControl+Shift+R',
      label: 'Start Voice Recording',
      isEditable: true,
    },
    [HotkeyAction.ToggleExpand]: {
      action: HotkeyAction.ToggleExpand,
      accelerator: null,
      label: 'Expand/Collapse Launcher',
      isEditable: true,
    },
    [HotkeyAction.OpenDesktop]: {
      action: HotkeyAction.OpenDesktop,
      accelerator: null,
      label: 'Open Desktop Mode',
      isEditable: true,
    },
    [HotkeyAction.OpenCommandPalette]: {
      action: HotkeyAction.OpenCommandPalette,
      accelerator: null,
      label: 'Open Command Palette',
      isEditable: true,
    },
  },
  tools: {
    toolGrants: {},
    disabledTools: [],
    grantedRoots: [],
    mcpServers: [],
    mcpToolOverrides: {},
    toolSettings: {},
    classDefaults: {},
  },
  search: {
    providers: [],
  },
  commands: {
    enabled: true,
    custom: [],
    hidden: [],
    pins: [],
    extraAliases: {},
    argDefaults: {},
    apps: { discovery: true, launchEnabled: true, hiddenApps: [] },
    web: { behavior: 'inline', fallbackEngine: 'https://duckduckgo.com/?q=' },
    history: { enabled: true, retentionDays: 90 },
    integrations: [],
    agentCallable: {},
  },
};

// =============================================================================
// UTILITY FUNCTIONS (no window dependencies)
// =============================================================================

/**
 * Validate configuration object
 */
export function validateConfig(config: Partial<AppConfig>): boolean {
  try {
    // Validate theme
    if (config.theme && !Object.values(ThemeType).includes(config.theme)) {
      return false;
    }
    // Validate window dimensions
    if (config.window?.dimensions) {
      const { width, height, minWidth, minHeight } = config.window.dimensions;
      if (width < minWidth || height < minHeight) {
        return false;
      }
    }
    
    // Validate providers
    if (config.providers) {
      if (!Array.isArray(config.providers)) return false;
      for (const provider of config.providers) {
        if (!provider.id || !provider.name || !provider.type) {
          return false;
        }
      }
      if (config.defaultProviderId && !config.providers.some(p => p.id === config.defaultProviderId)) {
        return false; // defaultProviderId must exist in the providers list
      }
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge config with defaults
 */
function migrateProviderRegistry(provider: LLMProvider): LLMProvider {
  const registry = [...(provider.availableModels ?? [])];
  for (const custom of provider.customModels ?? []) {
    if (!registry.some((m) => m.id === custom.id)) {
      registry.push(custom);
    }
  }
  return { ...provider, availableModels: registry, customModels: [] };
}

export function mergeWithDefaults(config: Partial<AppConfig>): AppConfig {  // Deep merge for nested objects is important
  const window: WindowSettings = { ...DEFAULT_CONFIG.window, ...config.window };
  if (window.transparentSet !== true) {
    window.transparent = DEFAULT_CONFIG.window.transparent;
  }
  const legacyStt = (config as Partial<AppConfig> & { stt?: { enabled?: boolean; model?: string } }).stt;
  const legacySttModel = legacyStt?.model ?? '';
  const legacySttRegistered = legacySttModel.length > 0 && (config.providers ?? []).some((provider) =>
    [...(provider.availableModels ?? []), ...(provider.customModels ?? [])].some((m) => m.id === legacySttModel)
  );
  return {
    ...DEFAULT_CONFIG,
    ...config,
    preferences: { ...DEFAULT_CONFIG.preferences, ...config.preferences },
    window,
    conversation: { ...DEFAULT_CONFIG.conversation, ...config.conversation },
    voice: { ...DEFAULT_CONFIG.voice, ...config.voice },
    behavior: { ...DEFAULT_CONFIG.behavior, ...config.behavior },
    hotkeys: { ...DEFAULT_CONFIG.hotkeys, ...config.hotkeys },
    tools: {
      toolGrants: { ...DEFAULT_CONFIG.tools.toolGrants, ...config.tools?.toolGrants },
      disabledTools: config.tools?.disabledTools ?? DEFAULT_CONFIG.tools.disabledTools,
      grantedRoots: config.tools?.grantedRoots ?? DEFAULT_CONFIG.tools.grantedRoots,
      mcpServers: config.tools?.mcpServers ?? DEFAULT_CONFIG.tools.mcpServers,
      mcpToolOverrides: { ...DEFAULT_CONFIG.tools.mcpToolOverrides, ...config.tools?.mcpToolOverrides },
      toolSettings: { ...DEFAULT_CONFIG.tools.toolSettings, ...config.tools?.toolSettings },
      classDefaults: { ...DEFAULT_CONFIG.tools.classDefaults, ...config.tools?.classDefaults },
    },
    search: {
      providers: config.search?.providers ?? DEFAULT_CONFIG.search.providers,
    },
    commands: {
      enabled: config.commands?.enabled ?? DEFAULT_CONFIG.commands.enabled,
      custom: config.commands?.custom ?? DEFAULT_CONFIG.commands.custom,
      hidden: config.commands?.hidden ?? DEFAULT_CONFIG.commands.hidden,
      pins: config.commands?.pins ?? DEFAULT_CONFIG.commands.pins,
      extraAliases: { ...DEFAULT_CONFIG.commands.extraAliases, ...config.commands?.extraAliases },
      argDefaults: { ...DEFAULT_CONFIG.commands.argDefaults, ...config.commands?.argDefaults },
      apps: { ...DEFAULT_CONFIG.commands.apps, ...config.commands?.apps },
      web: { ...DEFAULT_CONFIG.commands.web, ...config.commands?.web },
      history: { ...DEFAULT_CONFIG.commands.history, ...config.commands?.history },
      integrations: config.commands?.integrations ?? DEFAULT_CONFIG.commands.integrations,
      agentCallable: { ...DEFAULT_CONFIG.commands.agentCallable, ...config.commands?.agentCallable },
    },
    // Custom logic for providers to avoid duplicates and ensure defaults
    providers:
      config.providers && config.providers.length > 0
        ? config.providers.map(migrateProviderRegistry)
        : DEFAULT_CONFIG.providers,
    defaultProviderId: config.defaultProviderId !== undefined ? config.defaultProviderId : DEFAULT_CONFIG.defaultProviderId,
    taskAssignments: {
      ...DEFAULT_CONFIG.taskAssignments,
      ...(config.taskAssignments ?? {}),
      [AiTask.CHAT]:
        config.taskAssignments?.[AiTask.CHAT] ??
        config.defaultChatModelId ??
        DEFAULT_CONFIG.taskAssignments[AiTask.CHAT],
      [AiTask.STT]:
        config.taskAssignments?.[AiTask.STT] ??
        (legacyStt?.enabled && legacySttRegistered ? legacySttModel : null),
    },
  };
}

/**
 * Export configuration to JSON string
 */
export function exportConfigToJSON(config: AppConfig): string {
  return JSON.stringify(config, null, 2);
}

/**
 * Import configuration from JSON string
 */
export function importConfigFromJSON(jsonString: string): AppConfig | null {
  try {
    const parsed = JSON.parse(jsonString);
    if (validateConfig(parsed)) {
      return mergeWithDefaults(parsed);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get configuration difference between two configs
 */
export function getConfigDiff(
  oldConfig: AppConfig, 
  newConfig: AppConfig
): Partial<AppConfig> {
  const diff: any = {};
  
  Object.keys(newConfig).forEach(key => {
    const oldValue = (oldConfig as any)[key];
    const newValue = (newConfig as any)[key];
    
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      diff[key] = newValue;
    }
  });
  
  return diff;
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Check if object is valid AppConfig
 */
export function isValidAppConfig(obj: any): obj is AppConfig {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.theme === 'string' &&
    typeof obj.window === 'object' &&
    Array.isArray(obj.providers) &&
    (typeof obj.defaultProviderId === 'string' || obj.defaultProviderId === null) &&
    typeof obj.conversation === 'object' &&
    (obj.voice === undefined || typeof obj.voice === 'object') &&
    typeof obj.hotkeys === 'object' &&
    typeof obj.preferences === 'object' &&
    typeof obj.tools === 'object'
  );
}

// =============================================================================
// HELPER FUNCTIONS FOR SPECIFIC SETTINGS
// =============================================================================
export function createLLMProvider(overrides: Partial<LLMProvider>): LLMProvider {
    const id = overrides.id || uuidv4();
    return {
        ...defaultOpenAIProvider, // Start with a base default
        ...overrides,
        id: id, // Ensure id is always present
    };
}
/**
 * Create minimal API settings
 */
// export function createApiSettings(overrides: Partial<ApiSettings> = {}): ApiSettings {
//   return {
//     ...DEFAULT_CONFIG.api,
//     ...overrides
//   };
// }

/**
 * Create minimal window settings
 */
export function createWindowSettings(overrides: Partial<WindowSettings> = {}): WindowSettings {
  return {
    ...DEFAULT_CONFIG.window,
    ...overrides
  };
}

/**
 * Create minimal hotkey settings
 */
export function createHotkeySettings(overrides: Partial<HotkeySettings> = {}): HotkeySettings {
  return {
    ...DEFAULT_CONFIG.hotkeys,
    ...overrides
  };
}
