// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ToolsTab } from '@renderer/settings-react/tabs/ToolsTab';
import { TEXT } from '@shared/constants/text';
import type { ToolCatalogEntry } from '@shared/turns';

const tool: ToolCatalogEntry = {
  name: 'run_script',
  description: 'Run a script on this computer.',
  risk: 'state-changing',
  category: 'system',
  editableArgs: false,
  enabled: true,
  granted: false,
  source: 'native',
  parameters: [{ name: 'path', type: 'string', required: true, description: 'Script path.' }],
  verification: { mode: 'standard' },
  verificationCustom: false,
};

function mockApi(): ReturnType<typeof vi.fn> & never[] {
  const api = {
    getToolCatalog: vi.fn(async () => [tool]),
    getDocsStatus: vi.fn(async () => []),
    loadConfig: vi.fn(async () => ({ tools: { classDefaults: {}, grantedRoots: [] } })),
    setToolEnabled: vi.fn(async () => true),
    setToolGrant: vi.fn(async () => true),
    setToolVerification: vi.fn(async () => true),
    setToolClassDefaults: vi.fn(async () => true),
    setDocsIndexed: vi.fn(async () => ({ indexed: false, files: 0, chunks: 0 })),
    reindexDocs: vi.fn(async () => ({ files: 0, chunks: 0, truncated: false })),
    pickGrantedRoot: vi.fn(async () => null),
    removeGrantedRoot: vi.fn(async () => true),
  };
  window.electronAPI = api as unknown as typeof window.electronAPI;
  return api as unknown as ReturnType<typeof vi.fn> & never[];
}

afterEach(cleanup);

describe('tool details page (plan 50 phase A)', () => {
  it('replaces the tools section and returns via Back', async () => {
    mockApi();
    render(<ToolsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open details for run_script' }));

    const page = await screen.findByRole('region', { name: 'Tool settings — run_script' });
    expect(page).toBeTruthy();
    expect(screen.queryByRole('tabpanel', { name: TEXT.SETTINGS_NAV_TOOLS })).toBeNull();
    expect(within(page).getByText('Run a script on this computer.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Tool settings — run_script' })).toBeNull());
    expect(screen.getByRole('tabpanel', { name: TEXT.SETTINGS_NAV_TOOLS })).toBeTruthy();
  });

  it('persists the enable toggle from the page', async () => {
    const api = mockApi();
    render(<ToolsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open details for run_script' }));
    await screen.findByRole('region', { name: 'Tool settings — run_script' });
    fireEvent.click(screen.getByRole('switch', { name: 'Enable run_script' }));
    await waitFor(() => expect(api.setToolEnabled).toHaveBeenCalledWith('run_script', false));
  });

  it('persists the grant action from the page', async () => {
    const api = mockApi();
    render(<ToolsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open details for run_script' }));
    await screen.findByRole('region', { name: 'Tool settings — run_script' });
    fireEvent.click(screen.getByRole('button', { name: TEXT.TOOLS_GRANT_ALLOW }));
    await waitFor(() => expect(api.setToolGrant).toHaveBeenCalledWith('run_script', true));
  });
});
