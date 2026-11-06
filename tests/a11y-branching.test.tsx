// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { DesktopApp } from '@renderer/chat-react/DesktopApp';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
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

function mockApi(): { sync: (id: string) => void } {
  const syncListeners: Array<(id: string) => void> = [];
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG })),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => conversation),
    getAllConversations: vi.fn(async () => [conversation]),
    getConversationTree: vi.fn(async () => ({ activeRootId: 'u1', nodes: messages })),
    getMessagesByConversation: vi.fn(async () => messages),
    selectMessage: vi.fn(async () => ({ conversationId: 'conv-1', messages })),
    editMessage: vi.fn(async () => ({ conversationId: 'conv-1', messages, tempMessageId: 't', queued: false })),
    regenerateMessage: vi.fn(async () => ({ conversationId: 'conv-1', messages, tempMessageId: 't', queued: false })),
    onTurnEvent: vi.fn(() => () => {}),
    onSessionSync: vi.fn((listener: (id: string) => void) => {
      syncListeners.push(listener);
      return () => {
        const index = syncListeners.indexOf(listener);
        if (index >= 0) syncListeners.splice(index, 1);
      };
    }),
    onLauncherToggleExpand: vi.fn(() => () => {}),
    startTurn: vi.fn(async () => ({ tempMessageId: 't', queued: false })),
    cancelTurn: vi.fn(async () => true),
    resizeWindow: vi.fn(),
    hideWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    getToolCatalog: vi.fn(async () => []),
    getScreenSources: vi.fn(async () => []),
    onSettingsOpen: vi.fn(async () => {}),
    saveFile: vi.fn(async () => ({ success: true })),
    setConversationMetadata: vi.fn(async () => {}),
  } as unknown as typeof window.electronAPI;
  return { sync: (id) => syncListeners.forEach((listener) => listener(id)) };
}

const RULE_EXCLUSIONS: Record<string, string> = {};

async function expectNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations
    .filter((violation) => !(RULE_EXCLUSIONS[violation.id] && violation.impact !== 'critical'))
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`)
    .join('\n');
  expect(summary).toBe('');
}

describe('branching axe scans (plan 40 S3)', () => {
  it('launcher variant switcher + inline editor are violation-free', async () => {
    const api = mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    await screen.findByRole('textbox');
    api.sync('conv-1');
    fireEvent.keyDown(document, { key: 'e', ctrlKey: true });
    await screen.findByText('original question');
    fireEvent.click(screen.getByLabelText(TEXT.CHAT_EDIT_MESSAGE));
    await waitFor(() =>
      expect(screen.getAllByLabelText(TEXT.CHAT_EDIT_MESSAGE).some((element) => element.tagName === 'TEXTAREA')).toBe(true)
    );
    await expectNoViolations(document.body);
  });

  it('desktop branch tree rail is violation-free', async () => {
    const api = mockApi();
    render(<DesktopApp />);
    await screen.findByRole('textbox');
    api.sync('conv-1');
    await screen.findByText('original question');
    fireEvent.click(screen.getByTitle(TEXT.DESKTOP_SHOW_INSPECTOR));
    await screen.findByRole('tree');
    await expectNoViolations(document.body);
  });
});
