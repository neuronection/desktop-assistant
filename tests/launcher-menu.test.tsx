// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { LauncherMenu } from '@renderer/chat-react/LauncherMenu';

afterEach(cleanup);

function renderMenu(overrides: Partial<Parameters<typeof LauncherMenu>[0]> = {}) {
  const props = {
    onToggleExpand: vi.fn(),
    onNewConversation: vi.fn(),
    onOpenSettings: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<LauncherMenu {...props} />);
  return props;
}

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
});
