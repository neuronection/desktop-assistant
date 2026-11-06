// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';

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
      id: 'msg-user',
      content: 'First question',
      role: 'user',
      conversationId: 'conv-1',
      createdAt: new Date(),
    },
    {
      id: 'msg-older',
      content: 'Older answer',
      role: 'assistant',
      conversationId: 'conv-1',
      createdAt: new Date(),
    },
    {
      id: 'msg-user-2',
      content: 'Latest question',
      role: 'user',
      conversationId: 'conv-1',
      createdAt: new Date(),
    },
    {
      id: 'msg-latest',
      content: 'Latest answer',
      role: 'assistant',
      conversationId: 'conv-1',
      createdAt: new Date(),
    },
  ],
};

function mockApi() {
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
    onSessionSync: vi.fn(() => () => {}),
    onLauncherSetMode: vi.fn(() => () => {}),
  } as unknown as typeof window.electronAPI;
}

describe('expanded mode entry', () => {
  it('starts at the beginning of the latest reply, not the whole conversation', async () => {
    mockApi();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<ChatApp onThemeChange={vi.fn()} />);
    await screen.findByRole('textbox');

    const sync = window.electronAPI.onSessionSync as unknown as ReturnType<typeof vi.fn>;
    const syncHandler = sync.mock.calls[0]?.[0] as ((id: string) => void) | undefined;

    syncHandler?.('conv-1');
    fireEvent.keyDown(document, { key: 'e', ctrlKey: true });

    await screen.findByText('Latest answer');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled(), { timeout: 1500 });

    const scrolledRows = scrollIntoView.mock.instances as unknown as HTMLElement[];
    expect(scrolledRows.some((row) => row.getAttribute('data-message-id') === 'msg-latest')).toBe(true);
    expect(scrolledRows.some((row) => row.getAttribute('data-message-id') === 'msg-older')).toBe(false);
  });
});
