// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import axe from 'axe-core';
import { SearchSection } from '@renderer/settings-react/tabs/SearchSection';
import { TEXT } from '@shared/constants/text';
import type { SearchProviderSaveInput, SearchProviderView } from '@shared/search';

afterEach(cleanup);

const providerView = (overrides: Partial<SearchProviderView['config']> = {}, hasKey = false): SearchProviderView => ({
  config: {
    id: 'sp-1',
    name: 'Campus SearXNG',
    type: 'searxng',
    enabled: true,
    baseUrl: 'http://home-server:8080',
    ...overrides,
  },
  hasKey,
});

function mockApi(options: { providers?: SearchProviderView[]; saveProvider?: ReturnType<typeof vi.fn> } = {}): void {
  window.electronAPI = {
    getSearchProviders: vi.fn(async () => options.providers ?? []),
    saveSearchProvider: options.saveProvider ?? vi.fn(async (input: SearchProviderSaveInput) => ({ config: input, hasKey: false })),
    deleteSearchProvider: vi.fn(async () => true),
    setSearchProviderEnabled: vi.fn(async () => true),
    moveSearchProvider: vi.fn(async () => true),
    testSearchProvider: vi.fn(async () => ({ ok: true, resultCount: 3, latencyMs: 42 })),
    openExternal: vi.fn(async () => {}),
  } as unknown as typeof window.electronAPI;
}

/** Opens a card's `⋯` actions menu — the trigger opens on pointerdown
 * (Radix), so a plain click event would not open it. */
function openCardMenu(name: string): void {
  fireEvent.pointerDown(screen.getByRole('button', { name: `Actions for ${name}` }));
}

function typeInto(label: string | RegExp, text: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
}

function clickAdvanced(): void {
  const details = screen.getByText(TEXT.SETUP_ADVANCED).closest('details');
  if (details) {
    details.open = true;
  }
}

describe('SearchSection (AI-providers pattern)', () => {
  it('renders configured providers as cards with priority and key badges', async () => {
    mockApi({
      providers: [
        providerView(),
        providerView({ id: 'sp-2', name: 'Tavily main', type: 'tavily', baseUrl: undefined, timeoutMs: 4000 }, true),
      ],
    });
    render(<SearchSection />);
    expect(await screen.findByText('Campus SearXNG')).toBeTruthy();
    expect(screen.getAllByText('SearXNG').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tavily').length).toBeGreaterThan(0);
    expect(screen.getByText('priority 1')).toBeTruthy();
    expect(screen.getByText('priority 2')).toBeTruthy();
    expect(screen.getByText(TEXT.SEARCH_KEY_STORED)).toBeTruthy();
    expect(screen.getByText('http://home-server:8080')).toBeTruthy();
  });

  it('add opens the tiles wizard; choosing a type shows the settings form', async () => {
    mockApi();
    render(<SearchSection />);
    fireEvent.click(await screen.findByRole('button', { name: TEXT.SEARCH_ADD }));
    const tiles = await screen.findByRole('group', { name: TEXT.SEARCH_TILES_ARIA });
    const chipTexts = Array.from(tiles.querySelectorAll('[data-as="capability-chips"] span')).map((n) => n.textContent);
    console.log('CHIP TEXTS:', JSON.stringify(chipTexts));
    console.log('HAS CLOUD:', tiles.innerHTML.includes('Cloud'));
    expect(within(tiles).getByRole('button', { name: /searxng/i })).toBeTruthy();
    expect(within(tiles).getAllByText(TEXT.SEARCH_CHIP_KEY).length).toBeGreaterThan(0);
    expect(within(tiles).getByText(TEXT.SEARCH_CHIP_KEYLESS)).toBeTruthy();
    expect(within(tiles).getAllByText(TEXT.SEARCH_CHIP_CLOUD).length).toBeGreaterThan(0);
    expect(within(tiles).getByText(TEXT.SEARCH_CHIP_SELF_HOSTED)).toBeTruthy();
    const searxngTile = within(tiles).getByRole('button', { name: /searxng/i });
    expect(searxngTile.querySelector('svg')).toBeTruthy();
    const tavilyTile = within(tiles).getByRole('button', { name: /tavily/i });
    expect(tavilyTile.querySelector('svg')).toBeTruthy();
    fireEvent.click(searxngTile);
    expect(screen.getByText(TEXT.SEARCH_STEP_CONFIGURE)).toBeTruthy();
    expect(screen.getAllByText('SearXNG').length).toBeGreaterThan(0);
  });

  it('wizard save maps the catalog form onto the search IPC payload', async () => {
    const saveProvider = vi.fn(async (input: SearchProviderSaveInput) => ({ config: input, hasKey: false }));
    mockApi({ saveProvider });
    render(<SearchSection />);
    fireEvent.click(await screen.findByRole('button', { name: TEXT.SEARCH_ADD }));
    fireEvent.click(screen.getByRole('button', { name: /searxng/i }));
    // searxng's base URL is core configuration — it stays on the main page
    typeInto(new RegExp(escapeRegExp(TEXT.SEARCH_BASE_URL_REQUIRED_LABEL), 'i'), 'http://home-server:8080');
    clickAdvanced();
    typeInto(TEXT.SEARCH_NAME_LABEL, 'Home SearXNG');
    typeInto('Timeout (ms)', '4000');
    typeInto('Default result count', '7');
    fireEvent.click(screen.getByRole('button', { name: TEXT.SEARCH_SAVE }));
    await waitFor(() => expect(saveProvider).toHaveBeenCalledTimes(1));
    const payload = saveProvider.mock.calls[0][0] as SearchProviderSaveInput;
    expect(payload.type).toBe('searxng');
    expect(payload.name).toBe('Home SearXNG');
    expect(payload.baseUrl).toBe('http://home-server:8080');
    expect(payload.enabled).toBe(true);
    expect(payload.timeoutMs).toBe(4000);
    expect(payload.maxResults).toBe(7);
    expect(payload.key).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cloud providers seed a numbered default name under Advanced', async () => {
    const saveProvider = vi.fn(async (input: SearchProviderSaveInput) => ({ config: input, hasKey: false }));
    mockApi({
      providers: [providerView({ id: 'sp-2', name: 'Tavily', type: 'tavily', baseUrl: undefined })],
      saveProvider,
    });
    render(<SearchSection />);
    await screen.findAllByText('Tavily');
    fireEvent.click(screen.getByRole('button', { name: TEXT.SEARCH_ADD }));
    fireEvent.click(screen.getByRole('button', { name: /tavily/i }));
    // the key is the whole main page; the name is pre-seeded under Advanced
    typeInto(TEXT.SEARCH_KEY_LABEL, 'tvly-key');
    fireEvent.click(screen.getByRole('button', { name: TEXT.SEARCH_SAVE }));
    await waitFor(() => expect(saveProvider).toHaveBeenCalledTimes(1));
    const payload = saveProvider.mock.calls[0][0] as SearchProviderSaveInput;
    expect(payload.name).toBe('Tavily 2');
    expect(payload.key).toBe('tvly-key');
  });

  it('keyed types gate save on the key in the wizard', async () => {
    mockApi();
    render(<SearchSection />);
    fireEvent.click(await screen.findByRole('button', { name: TEXT.SEARCH_ADD }));
    fireEvent.click(screen.getByRole('button', { name: /tavily/i }));
    const save = screen.getByRole('button', { name: TEXT.SEARCH_SAVE });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    typeInto(TEXT.SEARCH_KEY_LABEL, 'tvly-key');
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it('edit opens a detail page that replaces the card list and preserves config', async () => {
    const saveProvider = vi.fn(async (input: SearchProviderSaveInput) => ({ config: input, hasKey: true }));
    mockApi({ providers: [providerView({ timeoutMs: 5000 })], saveProvider });
    render(<SearchSection />);
    await screen.findByText('Campus SearXNG');
    openCardMenu('Campus SearXNG');
    fireEvent.click(await screen.findByRole('menuitem', { name: TEXT.SEARCH_EDIT_ACTION }));
    expect(await screen.findByRole('region', { name: `Web search provider page: ${TEXT.SEARCH_EDIT_TITLE}` })).toBeTruthy();
    expect(screen.queryByTestId('wsp-rows')).toBeNull();
    clickAdvanced();
    expect((screen.getByLabelText(TEXT.SEARCH_NAME_LABEL) as HTMLInputElement).value).toBe('Campus SearXNG');
    expect((screen.getByLabelText(new RegExp(escapeRegExp(TEXT.SEARCH_BASE_URL_LABEL), 'i')) as HTMLInputElement).value).toBe('http://home-server:8080');
    fireEvent.click(screen.getByRole('button', { name: TEXT.SEARCH_SAVE }));
    await waitFor(() => expect(saveProvider).toHaveBeenCalledTimes(1));
    const payload = saveProvider.mock.calls[0][0] as SearchProviderSaveInput;
    expect(payload.id).toBe('sp-1');
    expect(payload.enabled).toBe(true);
    expect(payload.key).toBeUndefined();
  });

  it('back from the edit page returns to the card list', async () => {
    mockApi({ providers: [providerView()] });
    render(<SearchSection />);
    await screen.findByText('Campus SearXNG');
    openCardMenu('Campus SearXNG');
    fireEvent.click(await screen.findByRole('menuitem', { name: TEXT.SEARCH_EDIT_ACTION }));
    await screen.findByRole('region', { name: `Web search provider page: ${TEXT.SEARCH_EDIT_TITLE}` });
    fireEvent.click(screen.getByRole('button', { name: TEXT.SETTINGS_BACK }));
    expect(await screen.findByTestId('wsp-rows')).toBeTruthy();
  });

  it('reorder rides the IPC channel and renumbers priorities', async () => {
    mockApi({ providers: [providerView(), providerView({ id: 'sp-2', name: 'Tavily main', type: 'tavily' })] });
    render(<SearchSection />);
    await screen.findByText('Campus SearXNG');
    openCardMenu('Tavily main');
    fireEvent.click(await screen.findByRole('menuitem', { name: TEXT.SEARCH_MOVE_UP_ACTION }));
    await waitFor(() => expect(window.electronAPI.moveSearchProvider).toHaveBeenCalledWith('sp-2', 'up'));
    expect(screen.getByText('priority 1')).toBeTruthy();
  });

  it('delete asks for confirmation, then removes the provider', async () => {
    mockApi({ providers: [providerView()] });
    render(<SearchSection />);
    await screen.findByText('Campus SearXNG');
    openCardMenu('Campus SearXNG');
    fireEvent.click(await screen.findByRole('menuitem', { name: TEXT.SEARCH_DELETE_ACTION }));
    expect(await screen.findByText(TEXT.SEARCH_DELETE_CONFIRM)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.REMOVE_BUTTON }));
    await waitFor(() => expect(window.electronAPI.deleteSearchProvider).toHaveBeenCalledWith('sp-1'));
    await waitFor(() => expect(screen.queryByText('Campus SearXNG')).toBeNull());
  });

  it('test rides the IPC channel and renders the probe status', async () => {
    mockApi({ providers: [providerView()] });
    render(<SearchSection />);
    await screen.findByText('Campus SearXNG');
    openCardMenu('Campus SearXNG');
    fireEvent.click(await screen.findByRole('menuitem', { name: TEXT.SEARCH_TEST_ACTION }));
    await waitFor(() => expect(window.electronAPI.testSearchProvider).toHaveBeenCalledWith('sp-1'));
    await waitFor(() => expect(screen.getByText(TEXT.SEARCH_PROBE_OK)).toBeTruthy());
  });

  it('has no axe violations on the card list', async () => {
    mockApi({ providers: [providerView(), providerView({ id: 'sp-2', name: 'Tavily main', type: 'tavily' }, true)] });
    const { container } = render(<SearchSection />);
    await screen.findByText('Campus SearXNG');
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it('has no axe violations on the add wizard', async () => {
    mockApi();
    const { container } = render(<SearchSection />);
    fireEvent.click(await screen.findByRole('button', { name: TEXT.SEARCH_ADD }));
    fireEvent.click(screen.getByRole('button', { name: /searxng/i }));
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it('has no axe violations on the edit page', async () => {
    mockApi({ providers: [providerView()] });
    const { container } = render(<SearchSection />);
    await screen.findByText('Campus SearXNG');
    openCardMenu('Campus SearXNG');
    fireEvent.click(await screen.findByRole('menuitem', { name: TEXT.SEARCH_EDIT_ACTION }));
    await screen.findByRole('region', { name: `Web search provider page: ${TEXT.SEARCH_EDIT_TITLE}` });
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
