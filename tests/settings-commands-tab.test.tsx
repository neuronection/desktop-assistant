// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { CommandsTab } from '@renderer/settings-react/tabs/CommandsTab';
import { DEFAULT_CONFIG, mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import type { CommandCatalogSnapshot } from '@shared/commands';

beforeEach(() => {
  (globalThis as { window?: unknown }).window = globalThis.window;
});

afterEach(cleanup);

const CATALOG: CommandCatalogSnapshot = {
  entries: [
    {
      id: 'tool:screen_capture',
      kind: 'tool',
      title: 'Screen capture',
      category: 'tools',
      aliases: ['screenshot'],
      slash: 'screenshot',
      source: 'native',
      scopes: { palette: true, agent: false },
      args: [],
      toolName: 'screen_capture',
    },
    {
      id: 'app:firefix',
      kind: 'app',
      title: 'Firefix',
      category: 'apps',
      aliases: ['firefix'],
      source: 'app',
      scopes: { palette: true, agent: false },
      args: [],
    },
  ],
  recentIds: ['app:firefix'],
  pins: [],
};

function baseConfig(): AppConfig {
  const config = mergeWithDefaults({});
  return {
    ...config,
    commands: {
      ...config.commands,
      integrations: [
        {
          id: 'acme',
          name: 'Acme',
          enabled: true,
          commands: [{ id: 'deploy', kind: 'http', title: 'Deploy', urlTemplate: 'https://api.acme.example/{{1}}' }],
        },
        {
          id: 'broken',
          name: 'Broken Pack',
          enabled: false,
          error: "Bound tool 'gone_tool' is unavailable.",
          commands: [{ id: 'x', kind: 'tool', title: 'X', toolName: 'gone_tool', argTemplate: { command: 'x' } }],
        },
      ],
      apps: { discovery: true, launchEnabled: true, hiddenApps: ['hidden-app'] },
    },
  };
}

function mockApi(config: AppConfig) {
  const api = {
    loadConfig: vi.fn(async () => config),
    saveConfig: vi.fn(async () => {}),
    getCommandCatalog: vi.fn(async () => CATALOG),
    refreshApps: vi.fn(async () => ({ count: CATALOG.entries.length })),
    executeCommand: vi.fn(async () => ({ status: 'done' as const, text: '= 4' })),
    saveCustomCommand: vi.fn(async () => ({ ok: true as const })),
    deleteCustomCommand: vi.fn(async () => true),
    importIntegration: vi.fn(async () => ({ ok: true as const, packId: 'acme' })),
    removeIntegration: vi.fn(async () => true),
    clearCommandHistory: vi.fn(async () => true),
  };
  window.electronAPI = api as unknown as typeof window.electronAPI;
  return api;
}

function renderTab(config: AppConfig, updateConfig = vi.fn()) {
  render(<CommandsTab config={config} updateConfig={updateConfig} />);
  return { updateConfig };
}

describe('Settings — Commands tab (plan 14 S6)', () => {
  it('renders catalog rows with source labels and category filters', async () => {
    mockApi(baseConfig());
    renderTab(baseConfig());
    expect(await screen.findByText('Screen capture')).toBeTruthy();
    expect(screen.getByText('Firefix')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'apps' }));
    expect(screen.queryByText('Screen capture')).toBeNull();
    expect(screen.getByText('Firefix')).toBeTruthy();
  });

  it('persists the agent-invocation toggle for a command', async () => {
    const config = baseConfig();
    const update = vi.fn();
    mockApi(config);
    renderTab(config, update);
    fireEvent.click(await screen.findByText('Firefix'));
    const toggle = await screen.findByRole('switch', { name: /allow the assistant to invoke/i });
    fireEvent.click(toggle);
    await waitFor(() => expect(update).toHaveBeenCalled());
    const patch = update.mock.calls[0][0] as AppConfig;
    expect(patch.commands.agentCallable['app:firefix']).toBe(true);
  });

  it('renders broken packs with their self-disable reason and removes packs', async () => {
    const api = mockApi(baseConfig());
    renderTab(baseConfig());
    expect(await screen.findByText(/gone_tool/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /delete acme/i }));
    await waitFor(() => expect(api.removeIntegration).toHaveBeenCalledWith('acme'));
  });

  it('imports a pasted manifest with secret values', async () => {
    const api = mockApi(baseConfig());
    renderTab(baseConfig());
    fireEvent.click(await screen.findByRole('button', { name: /import pack/i }));
    const manifest = {
      manifestVersion: 1,
      id: 'acme',
      name: 'Acme',
      commands: [
        {
          kind: 'http',
          name: 'deploy',
          title: 'Deploy',
          method: 'POST',
          urlTemplate: 'https://api.acme.example/{{1}}',
          headers: { Authorization: '${secret:deployKey}' },
          bodyTemplate: '{"ref":"{{1}}"}',
        },
      ],
    };
    fireEvent.change(screen.getByLabelText(/paste integration.json/i), { target: { value: JSON.stringify(manifest) } });
    const secretField = await screen.findByLabelText('deployKey');
    fireEvent.change(secretField, { target: { value: 'SECRET-VALUE' } });
    fireEvent.click(screen.getByRole('button', { name: /import pack/i }));
    await waitFor(() => expect(api.importIntegration).toHaveBeenCalled());
    const [json, secrets] = api.importIntegration.mock.calls[0];
    expect(json).toContain('acme');
    expect(secrets.deployKey).toBe('SECRET-VALUE');
  });

  it('creates a custom prompt command through the validated channel', async () => {
    const api = mockApi(baseConfig());
    renderTab(baseConfig());
    fireEvent.click(await screen.findByRole('button', { name: /new command/i }));
    fireEvent.change(screen.getByLabelText(/kind/i), { target: { value: 'prompt' } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Standup' } });
    fireEvent.change(screen.getByLabelText(/prompt text/i), { target: { value: 'Summarize {{1}}' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(api.saveCustomCommand).toHaveBeenCalled());
    const def = api.saveCustomCommand.mock.calls[0][0];
    expect(def.kind).toBe('prompt');
    expect(def.promptTemplate).toBe('Summarize {{1}}');
  });

  it('creates a bound tool instance with its own alias from the detail modal', async () => {
    const api = mockApi(baseConfig());
    const catalog: CommandCatalogSnapshot = {
      ...CATALOG,
      entries: [
        ...CATALOG.entries,
        {
          id: 'tool:web_fetch',
          kind: 'tool',
          title: 'Web fetch',
          category: 'web',
          aliases: [],
          source: 'native',
          scopes: { palette: false, agent: false },
          args: [{ name: 'url', required: true, type: 'string' }],
          toolName: 'web_fetch',
        },
      ],
    };
    api.getCommandCatalog.mockImplementation(async () => catalog);
    renderTab(baseConfig());
    fireEvent.click(await screen.findByText('Web fetch'));
    fireEvent.click(await screen.findByRole('button', { name: /new instance/i }));
    // Detail modal closed, editor preselected the bound tool.
    expect(screen.queryByText(/extra aliases/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Neuro' } });
    fireEvent.change(screen.getByLabelText(/^url$/i), { target: { value: 'https://neuronection.com' } });
    fireEvent.click(screen.getByRole('button', { name: /add alias/i }));
    fireEvent.change(screen.getByLabelText(/^aliases 1$/i), { target: { value: '/neuro' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(api.saveCustomCommand).toHaveBeenCalled());
    expect(api.saveCustomCommand.mock.calls[0][0]).toMatchObject({
      kind: 'tool',
      toolName: 'web_fetch',
      argTemplate: { url: 'https://neuronection.com' },
      aliases: ['neuro'],
    });
  });

  it('saves extra aliases row-wise and strips the display slash', async () => {
    const api = mockApi(baseConfig());
    const update = vi.fn();
    const initial = baseConfig();
    let current = initial;
    function Harness(): JSX.Element {
      const [config, setConfig] = useState(initial);
      const apply = (updates: Partial<AppConfig>): void => {
        update(updates);
        current = { ...current, ...updates };
        setConfig(current);
      };
      return <CommandsTab config={config} updateConfig={apply} />;
    }
    render(<Harness />);
    void api;
    fireEvent.click(await screen.findByText('Firefix'));
    fireEvent.click(await screen.findByRole('button', { name: /add alias/i }));
    fireEvent.change(screen.getByLabelText(/^extra aliases 1$/i), { target: { value: '/ffx' } });
    await waitFor(() => expect(update).toHaveBeenCalled());
    const patch = update.mock.calls.at(-1)[0] as AppConfig;
    expect(patch.commands.extraAliases['app:firefix']).toEqual(['ffx']);
  });

  it('rescans apps and restores hidden ones', async () => {
    const api = mockApi(baseConfig());
    renderTab(baseConfig());
    fireEvent.click(await screen.findByRole('button', { name: /rescan apps/i }));
    await waitFor(() => expect(api.refreshApps).toHaveBeenCalled());
    expect(screen.getByText(/2 apps found/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /hidden-app · restore/i }));
    await waitFor(() => {
      const toggles = screen.getAllByRole('switch', { name: /discover installed apps/i });
      expect(toggles.length).toBeGreaterThan(0);
    });
  });

  it('clears history after confirmation', async () => {
    const api = mockApi(baseConfig());
    renderTab(baseConfig());
    fireEvent.click(await screen.findByRole('button', { name: /clear history/i }));
    fireEvent.click(await screen.findByRole('button', { name: /clear history/i }));
    await waitFor(() => expect(api.clearCommandHistory).toHaveBeenCalled());
  });

  it('has no axe violations', async () => {
    mockApi(baseConfig());
    const { container } = render(
      <main>
        <CommandsTab config={baseConfig()} updateConfig={vi.fn()} />
      </main>
    );
    await screen.findByText('Screen capture');
    const results = await axe.run(container);
    const summary = results.violations
      .filter((violation) => !['document-title', 'html-has-lang'].includes(violation.id))
      .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`)
      .join('\n');
    expect(summary).toBe('');
  });
});
