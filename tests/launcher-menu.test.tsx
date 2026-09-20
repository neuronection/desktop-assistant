// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { LauncherMenu, type LauncherMenuConversation } from '@renderer/chat-react/LauncherMenu';
import { TEXT } from '@shared/constants/text';

afterEach(cleanup);

function renderMenu(overrides: Partial<Parameters<typeof LauncherMenu>[0]> = {}) {
  const props = {
    onToggleExpand: vi.fn(),
    onOpenDesktop: vi.fn(),
    onNewConversation: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenAbout: vi.fn(),
    onOpenConversation: vi.fn(),
    onOpenConversationDesktop: vi.fn(),
    conversations: [] as LauncherMenuConversation[],
    activeId: null as string | null,
    onClose: vi.fn(),
    ...overrides,
  };
  render(<LauncherMenu {...props} />);
  return props;
}

const history = (overrides: Partial<LauncherMenuConversation> = {}): LauncherMenuConversation => ({
  id: 'conv-1',
  title: 'Research notes',
  updatedAt: new Date(Date.now() - 3600_000).toISOString(),
  ...overrides,
});

describe('LauncherMenu', () => {
  it('renders the rarely-used actions', () => {
    renderMenu();
    const menu = screen.getByRole('menu', { name: /launcher menu/i });
    expect(menu).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /new conversation/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /expand/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /settings/i })).toBeTruthy();
  });

  it('closes first, then runs the chosen action', () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /settings/i }));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onOpenSettings).toHaveBeenCalled();
  });

  it('escape closes the menu and does not reach other handlers', () => {
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    renderMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(outside).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outside);
  });

  it('closes on outside click but not on clicks inside', () => {
    const props = renderMenu();
    const menu = screen.getByRole('menu', { name: /launcher menu/i });
    fireEvent.mouseDown(document.body);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(menu);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a conversation-count badge on the history entry', () => {
    renderMenu({ conversations: [history(), history({ id: 'conv-2', title: 'Second' })] });
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('history view lists conversations and opens the picked one in expanded mode by default', () => {
    const props = renderMenu({ conversations: [history()], activeId: 'conv-1' });
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(TEXT.MENU_HISTORY, 'i') }));
    const historyMenu = screen.getByRole('menu', { name: TEXT.MENU_HISTORY_LABEL });
    expect(historyMenu).toBeTruthy();
    expect(screen.getByText('Research notes')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: TEXT.HISTORY_OPEN_DESKTOP })).toBeTruthy();
    fireEvent.click(screen.getByTitle(TEXT.HISTORY_OPEN_EXPANDED));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onOpenConversation).toHaveBeenCalledWith('conv-1');
    expect(props.onOpenConversationDesktop).not.toHaveBeenCalled();
  });

  it('opens a history conversation in desktop mode from the row action', () => {
    const props = renderMenu({ conversations: [history()] });
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(TEXT.MENU_HISTORY, 'i') }));
    fireEvent.click(screen.getByRole('menuitem', { name: TEXT.HISTORY_OPEN_DESKTOP }));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onOpenConversationDesktop).toHaveBeenCalledWith('conv-1');
    expect(props.onOpenConversation).not.toHaveBeenCalled();
  });

  it('falls back to the untitled label and shows the empty state', () => {
    renderMenu({ conversations: [history({ title: '  ' })] });
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(TEXT.MENU_HISTORY, 'i') }));
    expect(screen.queryByText(TEXT.HISTORY_EMPTY)).toBeNull();
    expect(screen.getByText(TEXT.HISTORY_UNTITLED)).toBeTruthy();
  });

  it('renders the empty state when there are no conversations', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(TEXT.MENU_HISTORY, 'i') }));
    expect(screen.getByText(TEXT.HISTORY_EMPTY)).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: TEXT.HISTORY_OPEN_DESKTOP })).toBeNull();
  });

  it('escape in the history view returns to the menu instead of closing', () => {
    const props = renderMenu({ conversations: [history()] });
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(TEXT.MENU_HISTORY, 'i') }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('menu', { name: /launcher menu/i })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('back returns to the main menu without closing it', () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(TEXT.MENU_HISTORY, 'i') }));
    fireEvent.click(screen.getByRole('menuitem', { name: TEXT.HISTORY_BACK }));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('menu', { name: /launcher menu/i })).toBeTruthy();
  });

  it('arrow keys move focus across menu items', () => {
    renderMenu();
    const items = screen.getAllByRole('menuitem');
    (items[0] as HTMLButtonElement).focus();
    fireEvent.keyDown(screen.getByRole('menu', { name: /launcher menu/i }), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(screen.getByRole('menu', { name: /launcher menu/i }), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole('menu', { name: /launcher menu/i }), { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('renders About as the last item and opens the about page', () => {
    const props = renderMenu();
    const items = screen.getAllByRole('menuitem');
    fireEvent.click(screen.getByRole('menuitem', { name: /about/i }));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onOpenAbout).toHaveBeenCalledTimes(1);
    expect((items[items.length - 1] as HTMLElement).textContent).toMatch(/about/i);
  });
});
