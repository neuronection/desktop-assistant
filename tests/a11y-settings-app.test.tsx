// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import axe from 'axe-core';
import { SettingsApp } from '@renderer/settings-react/SettingsApp';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
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
    getMcpServers: vi.fn(async () => []),
    getSearchProviders: vi.fn(async () => []),
    listMemories: vi.fn(async () => []),
    searchMemories: vi.fn(async () => []),
    deleteMemory: vi.fn(async () => true),
    restoreMemory: vi.fn(async () => null),
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
    getMcpServers: vi.fn(async () => []),
    setToolEnabled: vi.fn(async () => true),
    revokeToolGrant: vi.fn(async () => true),
    setToolVerification: vi.fn(async () => true),
    setToolGrant: vi.fn(async () => true),
    setToolClassDefaults: vi.fn(async () => true),
    pickGrantedRoot: vi.fn(async () => null),
    removeGrantedRoot: vi.fn(async () => true),
    setMcpEnabled: vi.fn(async () => true),
    saveMcpServer: vi.fn(async () => null),
    deleteMcpServer: vi.fn(async () => true),
    setMcpToolOverride: vi.fn(async () => true),
    testMcpServer: vi.fn(async () => ({ ok: true })),
    listMcpTools: vi.fn(async () => ({ ok: true, tools: [] })),
    getSearchProviders: vi.fn(async () => []),
    saveSearchProvider: vi.fn(async () => null),
    deleteSearchProvider: vi.fn(async () => true),
    setSearchProviderEnabled: vi.fn(async () => true),
    moveSearchProvider: vi.fn(async () => true),
    testSearchProvider: vi.fn(async () => ({ ok: true })),
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

  it('api tab with the transcription task has no axe violations', async () => {
    mockApi();
    const { container } = render(<SettingsApp onThemeChange={vi.fn()} />);
    const nav = await screen.findByRole('navigation', { name: /Settings sections/ });
    fireEvent.click(within(nav).getByRole('button', { name: /API Settings/ }));
    await screen.findByText('Transcription (voice input)');
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
    await screen.findByText('Deploy user is admin');
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
