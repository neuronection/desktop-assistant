// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { DesktopApp } from '@renderer/chat-react/DesktopApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';
import { MessageRole, type Message } from '@shared/types';

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

const now = new Date();
const messages: Message[] = [
  {
    id: 'u1',
    content: 'original question',
    role: MessageRole.USER,
    conversationId: 'conv-1',
    createdAt: now,
    parentId: null,
    activeChildId: 'a1',
    childIds: ['a1', 'a2'],
    variantIndex: 0,
    variantCount: 1,
    siblingIds: ['u1'],
  },
  {
    id: 'a1',
    content: 'first answer',
    role: MessageRole.ASSISTANT,
    conversationId: 'conv-1',
    createdAt: now,
    parentId: 'u1',
    activeChildId: null,
    childIds: [],
    variantIndex: 0,
    variantCount: 2,
    siblingIds: ['a1', 'a2'],
  },
  {
    id: 'a2',
    content: 'second answer',
    role: MessageRole.ASSISTANT,
    conversationId: 'conv-1',
    createdAt: now,
    parentId: 'u1',
    activeChildId: null,
    childIds: [],
    variantIndex: 1,
    variantCount: 2,
    siblingIds: ['a1', 'a2'],
  },
];

const conversation = {
  id: 'conv-1',
  title: 'Branch test',
  createdAt: now,
  updatedAt: now,
  isArchived: false,
  messages,
};

function mockApi(config: AppConfig = { ...DEFAULT_CONFIG }): { sync: (id: string) => void } {
  const syncListeners: Array<(id: string) => void> = [];
  window.electronAPI = {
    loadConfig: vi.fn(async () => config),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => conversation),
    getAllConversations: vi.fn(async () => [conversation]),
    getConversationTree: vi.fn(async () => ({ activeRootId: 'u1', nodes: messages })),
    getMessagesByConversation: vi.fn(async () => messages),
    selectMessage: vi.fn(async () => ({ conversationId: 'conv-1', messages })),
    editMessage: vi.fn(async () => ({
      conversationId: 'conv-1',
      messages,
      tempMessageId: 'turn-edit',
      queued: false,
    })),
    regenerateMessage: vi.fn(async () => ({
      conversationId: 'conv-1',
      messages,
      tempMessageId: 'turn-regen',
      queued: false,
    })),
    onTurnEvent: vi.fn(() => () => {}),
    startTurn: vi.fn(async () => ({ tempMessageId: 'turn-1', queued: false })),
    cancelTurn: vi.fn(async () => true),
    resizeWindow: vi.fn(),
    hideWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    onSessionSync: vi.fn((listener: (id: string) => void) => {
      syncListeners.push(listener);
      return () => {
        const index = syncListeners.indexOf(listener);
        if (index >= 0) syncListeners.splice(index, 1);
      };
    }),
    onLauncherToggleExpand: vi.fn(() => () => {}),
    getToolCatalog: vi.fn(async () => []),
    getScreenSources: vi.fn(async () => []),
    onSettingsOpen: vi.fn(async () => {}),
    saveFile: vi.fn(async () => ({ success: true })),
    setConversationMetadata: vi.fn(async () => {}),
  } as unknown as typeof window.electronAPI;
  return { sync: (id) => syncListeners.forEach((listener) => listener(id)) };
}

describe('branching UI surfaces (plan 40 S3)', () => {
  it('uses the library variant switcher and inline editor in the expanded launcher', async () => {
    const api = mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    await screen.findByRole('textbox');
    api.sync('conv-1');
    fireEvent.keyDown(document, { key: 'e', ctrlKey: true });
    await screen.findByText('original question');

    fireEvent.click(screen.getAllByLabelText(TEXT.CHAT_NEXT_VARIANT)[0]);
    await waitFor(() =>
      expect(window.electronAPI.selectMessage).toHaveBeenCalledWith(expect.any(String))
    );

    fireEvent.click(screen.getByLabelText(TEXT.CHAT_EDIT_MESSAGE));
    const editor = await waitFor(() => {
      const found = screen.getAllByLabelText(TEXT.CHAT_EDIT_MESSAGE).find((element) => element.tagName === 'TEXTAREA');
      expect(found).toBeTruthy();
      return found as HTMLTextAreaElement;
    });
    fireEvent.change(editor, { target: { value: 'edited question' } });
    fireEvent.click(screen.getByRole('button', { name: TEXT.CHAT_SAVE_RESEND }));
    await waitFor(() =>
      expect(window.electronAPI.editMessage).toHaveBeenCalledWith({
        messageId: 'u1',
        content: 'edited question',
      })
    );
  });

  it('renders the library branch tree in the desktop inspector and selects a node', async () => {
    const api = mockApi();
    render(<DesktopApp />);
    await screen.findByRole('textbox');
    api.sync('conv-1');
    await screen.findByText('original question');
    fireEvent.click(screen.getByTitle(TEXT.DESKTOP_SHOW_INSPECTOR));

    const tree = await screen.findByRole('tree');
    expect(tree).toBeTruthy();
    const nodes = screen.getAllByRole('treeitem');
    fireEvent.click(nodes[0]);
    await waitFor(() => expect(window.electronAPI.selectMessage).toHaveBeenCalled());
  });
});
