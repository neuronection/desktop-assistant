// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';

beforeAll(() => {
  if (!('ResizeObserver' in window)) {
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(cleanup);

const conversation = {
  id: 'conv-1',
  title: 'Research notes',
  createdAt: new Date(),
  updatedAt: new Date(),
  isArchived: false,
  messages: [
    {
      id: 'msg-1',
      content: 'Earlier answer',
      role: 'assistant',
      conversationId: 'conv-1',
      createdAt: new Date(),
    },
  ],
};

function mockApi(): void {
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG }) as AppConfig),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async (id: string) => (id === 'conv-1' ? conversation : null)),
    getAllConversations: vi.fn(async () => [conversation]),
    onTurnEvent: vi.fn(() => () => {}),
    startTurn: vi.fn(async () => 'turn_1'),
    cancelTurn: vi.fn(async () => {}),
    resizeWindow: vi.fn(),
    hideWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    onSettingsOpen: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
  } as unknown as typeof window.electronAPI;
}

async function openHistory(): Promise<void> {
  mockApi();
  render(<ChatApp onThemeChange={vi.fn()} />);
  await screen.findByRole('textbox');
  fireEvent.click(screen.getByTitle('More'));
  fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(TEXT.MENU_HISTORY, 'i') }));
  await screen.findByRole('menu', { name: TEXT.MENU_HISTORY_LABEL });
}

describe('launcher history menu', () => {
  it('opens a history conversation in expanded mode by default', async () => {
    await openHistory();
    fireEvent.click(screen.getByTitle(TEXT.HISTORY_OPEN_EXPANDED));
    await screen.findByText('Conversation');
    await screen.findByText('Earlier answer');
    expect(window.electronAPI.openDesktop).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu', { name: TEXT.MENU_HISTORY_LABEL })).toBeNull();
  });

  it('opens a history conversation in desktop mode from the row action', async () => {
    await openHistory();
    fireEvent.click(screen.getByRole('menuitem', { name: TEXT.HISTORY_OPEN_DESKTOP }));
    await waitFor(() => expect(window.electronAPI.openDesktop).toHaveBeenCalledWith('conv-1'));
    expect(screen.queryByText('Conversation')).toBeNull();
  });
});
