// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { SettingsApp } from '@renderer/settings-react/SettingsApp';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';
import type { ToolCatalogEntry } from '@shared/turns';
import { ToolsTab } from '@renderer/settings-react/tabs/ToolsTab';

afterEach(cleanup);

const toolCatalog: ToolCatalogEntry[] = [
  {
    name: 'run_shell',
    description: 'Run a shell command on this computer.',
    risk: 'destructive',
    category: 'system',
    editableArgs: true,
    enabled: true,
    granted: false,
    source: 'native',
    parameters: [{ name: 'command', type: 'string', required: true, description: 'The shell command to run.' }],
    verification: { mode: 'standard' },
    verificationCustom: false,
  },
  {
    name: 'clipboard_write',
    description: 'Write text to the clipboard.',
    risk: 'state-changing',
    category: 'desktop',
    editableArgs: false,
    enabled: true,
    granted: true,
    source: 'native',
    parameters: [{ name: 'text', type: 'string', required: true, description: 'Text to write.' }],
    verification: { mode: 'conditions', conditions: [{ param: 'text', operator: 'contains', value: 'key' }] },
    verificationCustom: true,
  },
];

function mockApi(): void {
  window.electronAPI = {
    getAppVersion: vi.fn(async () => '0.0.0-test'),
    loadConfig: vi.fn(async () => DEFAULT_CONFIG),
    getHotkeySettings: vi.fn(async () => ({})),
    saveConfig: vi.fn(async () => {}),
    saveHotkeySettings: vi.fn(async () => {}),
    resetConfig: vi.fn(async () => {}),
    getToolCatalog: vi.fn(async () => []),
    getDocsStatus: vi.fn(async () => []),
    setDocsIndexed: vi.fn(async () => ({ indexed: false, files: 0, chunks: 0 })),
    reindexDocs: vi.fn(async () => ({ files: 0, chunks: 0, truncated: false })),
    getSearchProviders: vi.fn(async () => []),
    getTranslationProviders: vi.fn(async () => []),
    saveTranslationProvider: vi.fn(async () => null),
    deleteTranslationProvider: vi.fn(async () => true),
    setTranslationProviderEnabled: vi.fn(async () => true),
    moveTranslationProvider: vi.fn(async () => true),
    testTranslationProvider: vi.fn(async () => ({ ok: true })),
    getDecisionState: vi.fn(async () => ({
      needle: { runtimePresent: true, weightsPresent: false, downloading: false, receivedBytes: 0, totalBytes: 35335380 },
    })),
    downloadDecisionWeights: vi.fn(async () => ({ ok: true })),
    cancelDecisionDownload: vi.fn(async () => true),
    testDecision: vi.fn(async () => ({ result: { status: 'off' }, durationMs: 1 })),
    listMemories: vi.fn(async () => []),
    searchMemories: vi.fn(async () => []),
    deleteMemory: vi.fn(async () => true),
    restoreMemory: vi.fn(async () => null),
    getToolApps: vi.fn(async () => ({ apps: [], deferredSupported: false })),
    getToolAppDigestStats: vi.fn(async () => ({})),
    getAppUsageStats: vi.fn(async () => ({ windowDays: 30, total: 0, rows: [] })),
    listToolAppPresets: vi.fn(async () => []),
    saveToolApp: vi.fn(async () => ({ ok: true })),
    removeToolApp: vi.fn(async () => true),
    setToolAppEnabled: vi.fn(async () => true),
    setToolAppState: vi.fn(async () => true),
    setToolAppEntityScope: vi.fn(async () => true),
    testToolApp: vi.fn(async () => ({ ok: true })),
    previewToolAppScope: vi.fn(async () => ({ entities: [] })),
  } as unknown as typeof window.electronAPI;
}

function mockToolsApi(): void {
  const memories = [
    {
      id: 'mem_1',
      content: 'Deploy user is admin',
      source: 'user',
      tags: ['work'],
      conversationId: 'conv_abcdef123456',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-08T10:00:00.000Z',
    },
    {
      id: 'mem_2',
      content: 'Prefers concise answers',
      source: 'assistant',
      tags: [],
      conversationId: null,
      createdAt: '2026-09-02T10:00:00.000Z',
      updatedAt: '2026-09-07T10:00:00.000Z',
    },
  ];
  window.electronAPI = {
    getAppVersion: vi.fn(async () => '0.0.0-test'),
    loadConfig: vi.fn(async () => ({
      ...DEFAULT_CONFIG,
      tools: { ...DEFAULT_CONFIG.tools, grantedRoots: ['/home/user/project'], classDefaults: {} },
    })),
    getHotkeySettings: vi.fn(async () => ({})),
    saveConfig: vi.fn(async () => {}),
    saveHotkeySettings: vi.fn(async () => {}),
    resetConfig: vi.fn(async () => {}),
    getToolCatalog: vi.fn(async () => toolCatalog),
    getDocsStatus: vi.fn(async () => []),
    setDocsIndexed: vi.fn(async () => ({ indexed: false, files: 0, chunks: 0 })),
    reindexDocs: vi.fn(async () => ({ files: 0, chunks: 0, truncated: false })),
    setToolEnabled: vi.fn(async () => true),
    revokeToolGrant: vi.fn(async () => true),
    setToolVerification: vi.fn(async () => true),
    setToolGrant: vi.fn(async () => true),
    setToolClassDefaults: vi.fn(async () => true),
    pickGrantedRoot: vi.fn(async () => null),
    removeGrantedRoot: vi.fn(async () => true),
    getSearchProviders: vi.fn(async () => []),
    saveSearchProvider: vi.fn(async () => null),
    deleteSearchProvider: vi.fn(async () => true),
    setSearchProviderEnabled: vi.fn(async () => true),
    moveSearchProvider: vi.fn(async () => true),
    testSearchProvider: vi.fn(async () => ({ ok: true })),
    getTranslationProviders: vi.fn(async () => []),
    saveTranslationProvider: vi.fn(async () => null),
    deleteTranslationProvider: vi.fn(async () => true),
    setTranslationProviderEnabled: vi.fn(async () => true),
    moveTranslationProvider: vi.fn(async () => true),
    testTranslationProvider: vi.fn(async () => ({ ok: true })),
    getDecisionState: vi.fn(async () => ({
      needle: { runtimePresent: true, weightsPresent: true, downloading: false, receivedBytes: 0, totalBytes: 35335380 },
    })),
    downloadDecisionWeights: vi.fn(async () => ({ ok: true })),
    cancelDecisionDownload: vi.fn(async () => true),
    testDecision: vi.fn(async () => ({ result: { status: 'decided', engine: 'needle', confidence: 0.9, band: 'act', calls: [{ tool: 'light_turn_on' }] }, durationMs: 120 })),
    listMemories: vi.fn(async () => memories),
    searchMemories: vi.fn(async () => memories),
    deleteMemory: vi.fn(async () => true),
    restoreMemory: vi.fn(async () => null),
  } as unknown as typeof window.electronAPI;
}

async function scanNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
    .join('\n');
  expect(summary).toBe('');
}

describe('SettingsApp axe scans', () => {
  it('general tab has no axe violations', async () => {
    mockApi();
    const { container } = render(<SettingsApp onThemeChange={vi.fn()} />);
    await screen.findByRole('navigation', { name: /Settings sections/ });
    await scanNoViolations(container);
  });

  it('tools tab has no axe violations', async () => {
    mockApi();
    const { container } = render(<SettingsApp onThemeChange={vi.fn()} />);
    const nav = await screen.findByRole('navigation', { name: /Settings sections/ });
    fireEvent.click(within(nav).getByRole('button', { name: /Tools/ }));
    await screen.findByRole('heading', { name: 'Native tools' });
    await scanNoViolations(container);
  });

  it('apps tab has no axe violations', async () => {
    mockApi();
    const { container } = render(<SettingsApp onThemeChange={vi.fn()} />);
    const nav = await screen.findByRole('navigation', { name: /Settings sections/ });
    fireEvent.click(within(nav).getByRole('button', { name: new RegExp(TEXT.SETTINGS_NAV_APPS) }));
    await screen.findByPlaceholderText(/search apps/i);
    await scanNoViolations(container);
  });

  it('apps tab with a populated list has no axe violations', async () => {
    mockApi();
    window.electronAPI.getToolApps = vi.fn(async () => ({
      apps: [
        {
          app: {
            id: 'app-1',
            name: 'Home Assistant',
            description: 'Smart home control',
            enabled: true,
            sources: [
              {
                kind: 'mcp',
                server: {
                  id: 'srv-1',
                  name: 'homeassistant',
                  transport: { type: 'http', url: 'http://homeassistant.local:8124/mcp' },
                  enabled: true,
                  defaultAction: 'allow',
                },
              },
            ],
            toolState: {},
            exposure: 'relevance',
          },
          status: { appId: 'app-1', state: 'connected', toolCount: 2, latencyMs: 12, lastError: null },
          envKeys: ['TOKEN'],
          headerKeys: [],
          knownTools: [
            { name: 'mcp__homeassistant__list_devices', state: { enabled: true, keywordTags: ['devices'] } },
            { name: 'mcp__homeassistant__control', state: null },
          ],
        },
      ],
      deferredSupported: false,
    })) as unknown as typeof window.electronAPI.getToolApps;
    const { container } = render(<SettingsApp onThemeChange={vi.fn()} />);
    const nav = await screen.findByRole('navigation', { name: /Settings sections/ });
    fireEvent.click(within(nav).getByRole('button', { name: new RegExp(TEXT.SETTINGS_NAV_APPS) }));
    await screen.findByText('Smart home control');
    await scanNoViolations(container);
  });

  it('app detail modal connection editor (stdio and http) has no axe violations', async () => {
    mockApi();
    const baseApp = {
      id: 'app-1',
      name: 'Files',
      description: 'Local file tools',
      enabled: true,
      toolState: {},
      exposure: 'relevance',
    } as const;
    window.electronAPI.getToolApps = vi.fn(async () => ({
      apps: [
        {
          app: {
            ...baseApp,
            sources: [
              {
                kind: 'mcp',
                server: {
                  id: 'srv-1',
                  name: 'files',
                  transport: { type: 'stdio', command: '/usr/bin/npx', args: ['-y', 'mcp-server-files'] },
                  enabled: true,
                  defaultAction: 'allow',
                },
              },
            ],
          },
          status: { appId: 'app-1', state: 'connected', toolCount: 1, latencyMs: 12, lastError: null },
          envKeys: ['API_KEY'],
          headerKeys: ['Authorization'],
          knownTools: [{ name: 'mcp__files__read', state: null }],
        },
        {
          app: {
            ...baseApp,
            id: 'app-2',
            name: 'Remote MCP',
            description: 'Remote HTTP tools',
            sources: [
              {
                kind: 'mcp',
                server: {
                  id: 'srv-2',
                  name: 'remote',
                  transport: { type: 'http', url: 'http://remote.local/mcp' },
                  enabled: true,
                  defaultAction: 'allow',
                },
              },
            ],
          },
          status: null,
          envKeys: [],
          headerKeys: [],
          knownTools: [],
        },
      ],
      deferredSupported: false,
    })) as unknown as typeof window.electronAPI.getToolApps;
    const { container } = render(<SettingsApp onThemeChange={vi.fn()} />);
    const nav = await screen.findByRole('navigation', { name: /Settings sections/ });
    fireEvent.click(within(nav).getByRole('button', { name: new RegExp(TEXT.SETTINGS_NAV_APPS) }));
    await screen.findByText('Local file tools');
    await scanNoViolations(container);
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    await screen.findByRole('dialog');
    await screen.findByLabelText('Command');
    await scanNoViolations(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]!);
    await waitFor(() => expect(screen.getByLabelText('Server endpoint')).toBeTruthy());
    await scanNoViolations(document.body);
  });

  it('api tab with the transcription task has no axe violations', async () => {
    mockApi();
    const { container } = render(<SettingsApp onThemeChange={vi.fn()} />);
    const nav = await screen.findByRole('navigation', { name: /Settings sections/ });
    fireEvent.click(within(nav).getByRole('button', { name: /API Settings/ }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Task Assignments' }));
    await screen.findByText('Transcription (voice input)');
    await scanNoViolations(container);
  });

  it('api tab setup wizard on first run (tiles + form) has no axe violations', async () => {
    mockApi();
    window.electronAPI.loadConfig = vi.fn(async () => ({
      ...DEFAULT_CONFIG,
      providers: [],
      defaultProviderId: null,
      taskAssignments: { ...DEFAULT_CONFIG.taskAssignments },
    })) as unknown as typeof window.electronAPI.loadConfig;
    window.electronAPI.testProvider = vi.fn(async () => ({ ok: false, latencyMs: 1, modelCount: 0, error: 'refused' })) as unknown as typeof window.electronAPI.testProvider;
    const { container } = render(<SettingsApp onThemeChange={vi.fn()} />);
    const nav = await screen.findByRole('navigation', { name: /Settings sections/ });
    fireEvent.click(within(nav).getByRole('button', { name: /API Settings/ }));
    await screen.findByText('Set up AI');
    await scanNoViolations(container);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await screen.findByRole('dialog');
    await scanNoViolations(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'Google Gemini' }));
    await screen.findByLabelText('API key');
    await scanNoViolations(document.body);
  });

  it('voice tab has no axe violations', async () => {
    mockApi();
    const { container } = render(<SettingsApp onThemeChange={vi.fn()} />);
    const nav = await screen.findByRole('navigation', { name: /Settings sections/ });
    fireEvent.click(within(nav).getByRole('button', { name: /Voice/ }));
    await screen.findByRole('heading', { name: 'Voice' });
    await scanNoViolations(container);
    fireEvent.click(screen.getByRole('tab', { name: 'Replies' }));
    await screen.findByText('Speech (TTS)');
    await scanNoViolations(container);
  });
});

describe('ToolsTab axe scans', () => {
  it('populated catalog has no axe violations', async () => {
    mockToolsApi();
    const { container } = render(<ToolsTab />);
    await screen.findByText('run_shell');
    await scanNoViolations(container);
  });

  it('memories manager with rows has no axe violations', async () => {
    mockToolsApi();
    const { container } = render(<ToolsTab />);
    fireEvent.click(screen.getByRole('tab', { name: 'Memories' }));
    await screen.findByText('Deploy user is admin');
    await scanNoViolations(container);
  });

  it('folders panel has no axe violations', async () => {
    mockToolsApi();
    const { container } = render(<ToolsTab />);
    fireEvent.click(screen.getByRole('tab', { name: 'Folders' }));
    await screen.findByText('/home/user/project');
    await scanNoViolations(container);
  });

  it('usage panel has no axe violations', async () => {
    mockToolsApi();
    window.electronAPI.getToolUsageStats = vi.fn(async () => ({
      windowDays: 30,
      total: 4,
      rows: [{ tool: 'run_shell', total: 4, ok: 3, errors: 0, denied: 1, approvals: { denied: 1 }, avgDurationMs: 12, lastUsedAt: '2026-09-14T10:00:00.000Z' }],
      recentFailures: [],
    })) as unknown as typeof window.electronAPI.getToolUsageStats;
    const { container } = render(<ToolsTab />);
    fireEvent.click(screen.getByRole('tab', { name: 'Usage' }));
    await screen.findByText('run_shell');
    await scanNoViolations(container);
  });

  it('web search panel has no axe violations', async () => {
    mockToolsApi();
    const { container } = render(<ToolsTab />);
    fireEvent.click(screen.getByRole('tab', { name: 'Web search' }));
    await screen.findByText('Add provider');
    await scanNoViolations(container);
  });

  it('translation panel has no axe violations', async () => {
    mockToolsApi();
    const { container } = render(<ToolsTab />);
    fireEvent.click(screen.getByRole('tab', { name: 'Translation' }));
    await screen.findByText('Add service');
    await scanNoViolations(container);
  });

  it('decisions panel has no axe violations', async () => {
    mockToolsApi();
    window.electronAPI.loadConfig = vi.fn(async () => ({
      ...DEFAULT_CONFIG,
      decision: { engine: 'needle', actThreshold: 0.85, confirmThreshold: 0.5 },
      voice: { ...DEFAULT_CONFIG.voice, autoSend: true, autoSendEngine: 'decision' },
    })) as unknown as typeof window.electronAPI.loadConfig;
    const { container } = render(<ToolsTab />);
    fireEvent.click(screen.getByRole('tab', { name: 'Decisions' }));
    await screen.findByRole('combobox', { name: 'Decision engine' });
    await screen.findByText(TEXT.DECISION_USED_BY_TITLE);
    await scanNoViolations(container);
  });

  it('tool details modal has no axe violations', async () => {
    mockToolsApi();
    render(<ToolsTab />);
    await screen.findByText('run_shell');
    fireEvent.click(screen.getByLabelText('Open details for run_shell'));
    await screen.findByRole('dialog');
    await scanNoViolations(document.body);
  });
});
