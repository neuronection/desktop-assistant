// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ToolsTab } from '@renderer/settings-react/tabs/ToolsTab';
import type { ToolCatalogEntry, ToolClassDefaults } from '@shared/turns';
import type { SearchProviderSaveInput, SearchProviderView } from '@shared/search';

afterEach(cleanup);

const catalog: ToolCatalogEntry[] = [
  {
    name: 'run_shell',
    description: 'Run a shell command.',
    risk: 'destructive',
    category: 'system',
    editableArgs: true,
    enabled: true,
    granted: false,
    source: 'native',
    parameters: [
      { name: 'command', type: 'string', required: true, description: 'The shell command to run.' },
      { name: 'timeoutMs', type: 'integer', required: false, description: 'Timeout in ms.' },
    ],
    verification: { mode: 'standard' },
    verificationCustom: false,
  },
  {
    name: 'clipboard_write',
    description: 'Write to the clipboard.',
    risk: 'state-changing',
    category: 'desktop',
    editableArgs: false,
    enabled: true,
    granted: true,
    source: 'native',
    parameters: [{ name: 'text', type: 'string', required: true, description: 'Text to write.' }],
    verification: { mode: 'conditions', conditions: [{ param: 'text', operator: 'contains', value: 'secret' }] },
    verificationCustom: true,
  },
  {
    name: 'screen_capture',
    description: 'Capture the screen.',
    risk: 'read-only',
    category: 'desktop',
    editableArgs: false,
    enabled: false,
    granted: false,
    source: 'native',
    parameters: [],
    verification: { mode: 'standard' },
    verificationCustom: false,
  },
  {
    name: 'read_file',
    description: 'Read a text file.',
    risk: 'read-only',
    category: 'files',
    editableArgs: false,
    enabled: true,
    granted: false,
    source: 'native',
    parameters: [{ name: 'path', type: 'string', required: true, description: 'File path.' }],
    verification: { mode: 'standard' },
    verificationCustom: false,
  },
];

const searchProvider: SearchProviderView = {
  config: {
    id: 'sp-1',
    name: 'Home SearXNG',
    type: 'searxng',
    enabled: true,
    baseUrl: 'http://home:8080',
    maxResults: 5,
  },
  hasKey: false,
};

const searchSave = vi.fn(async (input: SearchProviderSaveInput) => ({
  config: { ...input },
  hasKey: Boolean(input.key || input.keyHint),
}));

function mockApi(results: Partial<Record<string, unknown>> = {}): void {
  window.electronAPI = {
    getToolCatalog: vi.fn(async () => catalog),
    loadConfig: vi.fn(async () => ({ tools: { grantedRoots: ['/home/user/project'], classDefaults: {} } })),
    getDocsStatus: vi.fn(async () => []),
    setDocsIndexed: vi.fn(async () => ({ indexed: false, files: 0, chunks: 0 })),
    reindexDocs: vi.fn(async () => ({ files: 0, chunks: 0, truncated: false })),
    setToolEnabled: vi.fn(async () => true),
    revokeToolGrant: vi.fn(async () => true),
    setToolVerification: vi.fn(async () => true),
    setToolGrant: vi.fn(async () => true),
    setToolClassDefaults: vi.fn(async () => true),
    pickGrantedRoot: vi.fn(async () => '/home/user/notes'),
    removeGrantedRoot: vi.fn(async () => true),
    getSearchProviders: vi.fn(async () => [searchProvider]),
    saveSearchProvider: searchSave,
    deleteSearchProvider: vi.fn(async () => true),
    setSearchProviderEnabled: vi.fn(async () => true),
    moveSearchProvider: vi.fn(async () => true),
    testSearchProvider: vi.fn(async () => ({ ok: true, latencyMs: 15, resultCount: 3 })),
    getTranslationProviders: vi.fn(async () => []),
    saveTranslationProvider: vi.fn(async () => null),
    deleteTranslationProvider: vi.fn(async () => true),
    setTranslationProviderEnabled: vi.fn(async () => true),
    moveTranslationProvider: vi.fn(async () => true),
    testTranslationProvider: vi.fn(async () => ({ ok: true, translation: 'Hola', latencyMs: 15 })),
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
    ...results,
  } as unknown as typeof window.electronAPI;
}

async function openDetails(name: string): Promise<void> {
  fireEvent.click(screen.getByLabelText(`Open details for ${name}`));
  await screen.findByRole('dialog');
}

describe('ToolsTab class defaults', () => {
  it('applies a preset to the class defaults', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('run_shell')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Apply the Trusted workspace preset' }));
    await waitFor(() =>
      expect(window.electronAPI.setToolClassDefaults).toHaveBeenCalledWith({ stateChanging: 'never' })
    );
  });

  it('changes a single class default from the dropdowns', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('run_shell')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Default verification for state-changing tools'), {
      target: { value: 'always_ask' },
    });
    await waitFor(() =>
      expect(window.electronAPI.setToolClassDefaults).toHaveBeenCalledWith({ stateChanging: 'always_ask' })
    );
  });

  it('shows the custom marker when defaults match no preset', async () => {
    mockApi({
      loadConfig: vi.fn(async () => ({
        tools: { grantedRoots: [], classDefaults: { readOnly: 'always_ask' } as ToolClassDefaults },
      })),
    });
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('Custom')).toBeTruthy());
  });

  it('marks rows with the effective class-default mode', async () => {
    mockApi({
      loadConfig: vi.fn(async () => ({
        tools: { grantedRoots: [], classDefaults: { stateChanging: 'never' } as ToolClassDefaults },
      })),
      getToolCatalog: vi.fn(async () =>
        catalog.map((row) =>
          row.name === 'clipboard_write'
            ? { ...row, verification: { mode: 'never' as const }, verificationCustom: false }
            : row
        )
      ),
    });
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('auto-run')).toBeTruthy());
  });
});

describe('ToolsTab catalog', () => {
  it('lists native tools as rows with badges and toggles the kill switch', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('run_shell')).toBeTruthy());
    const row = screen.getByText('run_shell').closest('li');
    expect(within(row as HTMLElement).getAllByText('Destructive').length).toBeGreaterThan(0);
    expect(screen.getByText('4 tools')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Enable screen_capture' }));
    await waitFor(() => expect(window.electronAPI.setToolEnabled).toHaveBeenCalledWith('screen_capture', true));
  });

  it('shows the custom verification badge only when a rule or override exists', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('1 rule · custom')).toBeTruthy());
    const plainRow = screen.getByText('screen_capture').closest('li');
    expect(within(plainRow as HTMLElement).queryByText('custom')).toBeNull();
  });

  it('shows parameter types and descriptions in the detail modal', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('run_shell')).toBeTruthy());
    await openDetails('run_shell');
    expect(screen.getByText('The shell command to run.')).toBeTruthy();
    expect(screen.getByText('integer')).toBeTruthy();
    expect(screen.getByText('required')).toBeTruthy();
    expect(screen.getByText('optional')).toBeTruthy();
  });

  it('applies an always-ask verification override', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('run_shell')).toBeTruthy());
    await openDetails('read_file');
    fireEvent.click(screen.getByRole('radio', { name: /Always ask/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(window.electronAPI.setToolVerification).toHaveBeenCalledWith('read_file', { mode: 'always_ask' })
    );
  });

  it('applies scenario conditions on the call arguments', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('run_shell')).toBeTruthy());
    await openDetails('read_file');
    fireEvent.click(screen.getByRole('radio', { name: /Ask only when/ }));
    fireEvent.change(screen.getByLabelText('Rule 1 condition'), { target: { value: 'equals' } });
    fireEvent.change(screen.getByLabelText('Rule 1 value'), { target: { value: '/etc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(window.electronAPI.setToolVerification).toHaveBeenCalled());
    const payload = (window.electronAPI.setToolVerification as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(payload.mode).toBe('conditions');
    expect(payload.conditions).toHaveLength(2);
    expect(payload.conditions[0]).toMatchObject({ param: 'path', operator: 'equals', value: '/etc' });
    expect(payload.conditions[1]).toMatchObject({ param: 'path', operator: 'present' });
  });

  it('grants and revokes the always-allow shortcut from the detail modal', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('run_shell')).toBeTruthy());
    await openDetails('read_file');
    fireEvent.click(screen.getByRole('button', { name: 'Always allow this tool' }));
    await waitFor(() => expect(window.electronAPI.setToolGrant).toHaveBeenCalledWith('read_file', true));
  });

  it('filters tools by search query', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('run_shell')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Search tools'), { target: { value: 'clipboard' } });
    expect(screen.queryByText('run_shell')).toBeNull();
    expect(screen.getByText('clipboard_write')).toBeTruthy();
  });

  it('filters tools by category chips', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('run_shell')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    expect(screen.getByText('read_file')).toBeTruthy();
    expect(screen.queryByText('run_shell')).toBeNull();
    expect(screen.queryByText('clipboard_write')).toBeNull();
  });

  it('filters tools by risk class select', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('run_shell')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Filter by risk class'), { target: { value: 'destructive' } });
    expect(screen.getByText('run_shell')).toBeTruthy();
    expect(screen.queryByText('clipboard_write')).toBeNull();
    expect(screen.queryByText('read_file')).toBeNull();
  });

  it('filters tools by the auto-approved status chip', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('1 auto-approved')).toBeTruthy());
    fireEvent.click(screen.getByText('1 auto-approved'));
    expect(screen.getByText('clipboard_write')).toBeTruthy();
    expect(screen.queryByText('run_shell')).toBeNull();
    fireEvent.click(screen.getByText('1 auto-approved'));
    expect(screen.getByText('run_shell')).toBeTruthy();
  });
});

describe('ToolsTab folders', () => {
  it('lists granted folders and removes one', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('/home/user/project')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Remove folder /home/user/project'));
    await waitFor(() => expect(window.electronAPI.removeGrantedRoot).toHaveBeenCalledWith('/home/user/project'));
  });

  it('adds a granted folder via the OS picker', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText(/Add folder/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Add folder/));
    await waitFor(() => expect(screen.getByText('/home/user/notes')).toBeTruthy());
  });
});

describe('ToolsTab web search', () => {
  it('renders ordered providers without exposing key material', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('Home SearXNG')).toBeTruthy());
    expect(screen.getByText('priority 1')).toBeTruthy();
    expect(screen.getByText('http://home:8080')).toBeTruthy();
    expect(screen.queryByText('stored-key')).toBeNull();
  });

  it('saves a new provider with the key routed renderer→main', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText(/Add provider/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Add provider/));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Provider name'), { target: { value: 'Brave' } });
    fireEvent.change(within(dialog).getByLabelText('Provider type'), { target: { value: 'brave' } });
    fireEvent.change(within(dialog).getByLabelText('Provider API key'), { target: { value: 'bsk-9876' } });
    fireEvent.click(within(dialog).getByText('Save provider'));
    await waitFor(() => expect(searchSave).toHaveBeenCalled());
    const payload = searchSave.mock.calls[0][0] as SearchProviderSaveInput;
    expect(payload.type).toBe('brave');
    expect(payload.key).toBe('bsk-9876');
    expect(payload.baseUrl).toBeUndefined();
    await waitFor(() => expect(screen.getByText('Brave')).toBeTruthy());
  });

  it('requires a base URL for SearXNG instances', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText(/Add provider/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Add provider/));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Provider name'), { target: { value: 'Sear' } });
    fireEvent.click(within(dialog).getByText('Save provider'));
    await waitFor(() => expect(within(dialog).getByText(/base URL is required/i)).toBeTruthy());
    expect(searchSave).not.toHaveBeenCalled();
  });

  it('moves providers to reorder priority', async () => {
    const second: SearchProviderView = {
      config: { id: 'sp-2', name: 'Brave', type: 'brave', enabled: true, keyHint: '…abcd' },
      hasKey: true,
    };
    mockApi({ getSearchProviders: vi.fn(async () => [searchProvider, second]) });
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('Brave')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Move Brave up'));
    await waitFor(() => expect(window.electronAPI.moveSearchProvider).toHaveBeenCalledWith('sp-2', 'up'));
  });

  it('tests a provider connection', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByLabelText('Test provider Home SearXNG')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Test provider Home SearXNG'));
    await waitFor(() => expect(window.electronAPI.testSearchProvider).toHaveBeenCalledWith('sp-1'));
    await waitFor(() => expect(screen.getByText(/3 result\(s\) · 15ms/)).toBeTruthy());
  });

  it('deletes a provider after confirmation', async () => {
    mockApi();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByLabelText('Delete provider Home SearXNG')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Delete provider Home SearXNG'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByText('Remove'));
    await waitFor(() => expect(window.electronAPI.deleteSearchProvider).toHaveBeenCalledWith('sp-1'));
  });
});
