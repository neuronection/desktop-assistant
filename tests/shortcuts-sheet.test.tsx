// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { ShortcutsSheet } from '@renderer/chat-react/ShortcutsSheet';
import { FIXED_IN_WINDOW_SHORTCUTS, detectMacPlatform, displayAccelerator, type ShortcutsView } from '@shared/shortcuts';
import { HotkeyAction } from '@shared/types';
import { TEXT } from '@shared/constants/text';

afterEach(cleanup);

const VIEW: ShortcutsView = {
  builtIns: [
    { action: HotkeyAction.ToggleWindow, label: 'Toggle App Window', accelerator: 'Control+Space' },
    { action: HotkeyAction.ToggleExpand, label: 'Expand/Collapse Launcher', accelerator: null },
    { action: HotkeyAction.SpeakSelection, label: 'Speak Selected Text', accelerator: 'CommandOrControl+Shift+S' },
  ],
  commands: [{ action: 'cmd-summarize', label: 'Summarize page', accelerator: 'Control+Alt+S' }],
};

function installApi(view: ShortcutsView | Promise<ShortcutsView> = VIEW) {
  const api = {
    getShortcuts: vi.fn(async () => view),
    onSettingsOpen: vi.fn(async () => true),
    hideWindow: vi.fn(),
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
  return api;
}

const RULE_EXCLUSIONS: Record<string, string> = {};

async function expectNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations
    .filter((violation) => !(RULE_EXCLUSIONS[violation.id] && violation.impact !== 'critical'))
    .map((violation) => `${violation.id} (${violation.impact})`)
    .join('\n');
  expect(summary).toBe('');
}

describe('ShortcutsSheet (plan 59 S2)', () => {
  it('groups the live view into General / Voice / Commands', async () => {
    installApi();
    const { container } = render(<ShortcutsSheet onClose={vi.fn()} />);
    await screen.findByText('Toggle App Window');

    expect(screen.getByRole('group', { name: TEXT.SHORTCUTS_GROUP_GENERAL })).toBeTruthy();
    expect(screen.getByRole('group', { name: TEXT.SHORTCUTS_GROUP_VOICE })).toBeTruthy();
    expect(screen.getByRole('group', { name: TEXT.SHORTCUTS_GROUP_COMMANDS })).toBeTruthy();
    expect(within(screen.getByRole('group', { name: TEXT.SHORTCUTS_GROUP_VOICE })).getByText('Speak Selected Text')).toBeTruthy();
    expect(within(screen.getByRole('group', { name: TEXT.SHORTCUTS_GROUP_COMMANDS })).getByText('Summarize page')).toBeTruthy();
    expect(screen.getByText('Control+Space')).toBeTruthy();
    expect(screen.getByText(TEXT.HOTKEYS_NOT_SET)).toBeTruthy();
    await expectNoViolations(container);
  });

  it('never renders an empty Commands section', async () => {
    installApi({ ...VIEW, commands: [] });
    render(<ShortcutsSheet onClose={vi.fn()} />);
    await screen.findByText('Toggle App Window');
    expect(screen.queryByRole('group', { name: TEXT.SHORTCUTS_GROUP_COMMANDS })).toBeNull();
  });

  it('reads the aggregator on every open, never a cached copy', async () => {
    const api = installApi();
    const first = render(<ShortcutsSheet onClose={vi.fn()} />);
    await screen.findByText('Toggle App Window');
    first.unmount();

    api.getShortcuts.mockResolvedValueOnce({
      ...VIEW,
      builtIns: [{ ...VIEW.builtIns[0], accelerator: 'Alt+J' }],
    } as never);
    render(<ShortcutsSheet onClose={vi.fn()} />);
    await screen.findByText('Alt+J');
    expect(api.getShortcuts).toHaveBeenCalledTimes(2);
  });

  it('closes, deep-links to Settings → Hotkeys, then hides the launcher', async () => {
    const api = installApi();
    const onClose = vi.fn();
    render(<ShortcutsSheet onClose={onClose} />);
    await screen.findByText('Toggle App Window');
    fireEvent.click(screen.getByRole('button', { name: TEXT.SHORTCUTS_CUSTOMIZE }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.onSettingsOpen).toHaveBeenCalledWith({ tab: 'hotkeys' });
    expect(api.hideWindow).toHaveBeenCalledTimes(1);
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(api.onSettingsOpen.mock.invocationCallOrder[0]);
    expect(api.onSettingsOpen.mock.invocationCallOrder[0]).toBeLessThan(api.hideWindow.mock.invocationCallOrder[0]);
  });

  it('documents the static in-window chords including its own Ctrl+/', async () => {
    installApi();
    render(<ShortcutsSheet onClose={vi.fn()} />);
    await screen.findByText('Toggle App Window');
    const group = screen.getByRole('group', { name: TEXT.SHORTCUTS_GROUP_IN_WINDOW });
    expect(within(group).getByText(FIXED_IN_WINDOW_SHORTCUTS[0].label)).toBeTruthy();
    expect(within(group).getByText('Ctrl+/')).toBeTruthy();
    expect(within(group).getByText(TEXT.HOTKEYS_FIXED_SHORTCUTS)).toBeTruthy();
    expect(screen.getByText(TEXT.SHORTCUTS_FOOTER)).toBeTruthy();
  });

  it('lays the groups out in two columns without ever splitting one', async () => {
    installApi({ ...VIEW, commands: [] });
    render(<ShortcutsSheet onClose={vi.fn()} />);
    await screen.findByText('Toggle App Window');

    const grid = screen.getByTestId('shortcuts-grid');
    expect(grid.className).toContain('grid');
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.className).toContain('items-start');

    const groups = screen.getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      TEXT.SHORTCUTS_GROUP_GENERAL,
      TEXT.SHORTCUTS_GROUP_VOICE,
      TEXT.SHORTCUTS_GROUP_IN_WINDOW,
    ]);
    for (const group of groups) {
      expect(group.parentElement).toBe(grid);
      expect(group.querySelector('ul')?.children.length).toBeGreaterThan(0);
    }
    expect(groups[0].className).not.toContain('col-span-2');
    expect(groups[1].className).not.toContain('col-span-2');
    expect(groups[2].className).toContain('col-span-2');
  });

  it('keeps a fourth group unspanned so two columns fill the second row', async () => {
    installApi();
    render(<ShortcutsSheet onClose={vi.fn()} />);
    await screen.findByText('Summarize page');
    const groups = screen.getAllByRole('group');
    expect(groups).toHaveLength(4);
    for (const group of groups) {
      expect(group.className).not.toContain('col-span-2');
    }
  });

  it('scrolls its body internally so a tall list cannot grow the window', async () => {
    installApi();
    const { container } = render(<ShortcutsSheet onClose={vi.fn()} />);
    await screen.findByText('Toggle App Window');
    const scroll = screen.getByTestId('shortcuts-scroll');
    expect(scroll.className).toContain('overflow-y-auto');
    expect(scroll.className).toContain('max-h-[22rem]');
    expect(scroll.contains(screen.getByText('Toggle App Window'))).toBe(true);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBeNull();
    expect(container.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('closes on Escape without letting the launcher ladder react', async () => {
    installApi();
    const onClose = vi.fn();
    render(<ShortcutsSheet onClose={onClose} />);
    const close = await screen.findByRole('button', { name: TEXT.CLOSE_BUTTON });
    const bubble = vi.fn();
    document.addEventListener('keydown', bubble);
    fireEvent.keyDown(close, { key: 'Escape' });
    document.removeEventListener('keydown', bubble);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bubble).not.toHaveBeenCalled();
  });

  it('restores focus to the opener on close', async () => {
    installApi();
    const opener = document.createElement('button');
    opener.textContent = 'opener';
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(<ShortcutsSheet onClose={vi.fn()} />);
    await screen.findByText('Toggle App Window');
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('shortcuts sheet layout guard (plan 59, two-column rework)', () => {
  it('pins the grid mechanics in the component source (jsdom cannot lay out)', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/chat-react/ShortcutsSheet.tsx'), 'utf8');
    const scroll = source.slice(source.indexOf('data-testid="shortcuts-scroll"'));
    expect(scroll).toContain('max-h-[22rem]');
    expect(scroll).toContain('overflow-y-auto');
    const grid = scroll.slice(0, scroll.indexOf('</div>'));
    expect(grid).toContain('grid grid-cols-2 items-start');
    expect(source).toContain("spansRow ? 'col-span-2' : ''");
    expect(source).toMatch(/groups\.length % 2 === 1 && index === groups\.length - 1/);
  });
});

describe('shared accelerator formatter (plan 59 D10)', () => {
  it('maps CommandOrControl to the platform word form', () => {
    expect(displayAccelerator('CommandOrControl+Shift+S', false)).toBe('Control+Shift+S');
    expect(displayAccelerator('CommandOrControl+Shift+S', true)).toBe('Command+Shift+S');
    expect(displayAccelerator('Control+Space', false)).toBe('Control+Space');
  });

  it('detects the mac platform from the navigator value', () => {
    expect(detectMacPlatform('MacIntel')).toBe(true);
    expect(detectMacPlatform('Linux x86_64')).toBe(false);
  });
});
