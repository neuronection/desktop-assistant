// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';
import type { TurnEvent } from '@shared/types';

class CapturingResizeObserver {
  static instances: CapturingResizeObserver[] = [];
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    CapturingResizeObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

beforeAll(() => {
  CapturingResizeObserver.instances = [];
  window.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

afterEach(cleanup);

const NOW = Date.now();

const ACTIVE_CONV = {
  id: 'conv-1',
  title: 'Test',
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
  isArchived: false,
  messages: [
    { id: 'msg-u', content: 'hi', role: 'user', conversationId: 'conv-1', createdAt: new Date(NOW) },
    { id: 'msg-a', content: 'Hello!', role: 'assistant', conversationId: 'conv-1', createdAt: new Date(NOW) },
  ],
};

function mockApi(withConversation: boolean): Array<(event: TurnEvent) => void> {
  const listeners: Array<(event: TurnEvent) => void> = [];
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG })),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () =>
      withConversation ? { ...ACTIVE_CONV, messages: ACTIVE_CONV.messages.map((message) => ({ ...message })) } : null
    ),
    getAllConversations: vi.fn(async () => (withConversation ? [ACTIVE_CONV] : [])),
    onTurnEvent: vi.fn((callback: (event: TurnEvent) => void) => {
      listeners.push(callback);
      return () => {};
    }),
    startTurn: vi.fn(async () => ({ tempMessageId: 'turn_1', conversationId: 'conv-1' })),
    cancelTurn: vi.fn(async () => true),
    hideWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    resizeWindow: vi.fn(),
    minimizeWindow: vi.fn(),
    onSettingsOpen: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
    onLauncherNewConversation: vi.fn(() => () => {}),
    onFocusInput: vi.fn(() => () => {}),
    setConversationMetadata: vi.fn(async () => {}),
  } as unknown as typeof window.electronAPI;
  return listeners;
}

describe('launcher conversation meta strip', () => {
  it('labels an empty conversation and offers no new-chat button', async () => {
    mockApi(false);
    render(<ChatApp onThemeChange={vi.fn()} />);
    await screen.findByRole('textbox');
    expect(screen.getByText(TEXT.LAUNCHER_CHAT_NEW)).toBeTruthy();
    expect(screen.queryByTitle(TEXT.MENU_NEW_CONVERSATION)).toBeNull();
  });

  it('shows the message count with a quick new-conversation button once the conversation has turns', async () => {
    const listeners = mockApi(true);
    render(<ChatApp onThemeChange={vi.fn()} />);
    await screen.findByRole('textbox');
    expect(screen.getByText(TEXT.LAUNCHER_CHAT_NEW)).toBeTruthy();

    const now = Date.now();
    listeners.forEach((listener) =>
      listener({
        tempMessageId: 'turn_1',
        conversationId: 'conv-1',
        model: 'm1',
        seq: 1,
        phase: 'finished',
      } as unknown as TurnEvent)
    );

    await waitFor(() => expect(screen.getByText(`2 ${TEXT.LAUNCHER_CHAT_MESSAGES}`)).toBeTruthy());
    const newChat = screen.getByTitle(TEXT.MENU_NEW_CONVERSATION);
    fireEvent.click(newChat);
    await waitFor(() => expect(screen.getByText(TEXT.LAUNCHER_CHAT_NEW)).toBeTruthy());
    expect(screen.queryByTitle(TEXT.MENU_NEW_CONVERSATION)).toBeNull();
  });
});
