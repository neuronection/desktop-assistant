// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DesktopApp } from '@renderer/chat-react/DesktopApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { MessageRole } from '@shared/types';
import type { Conversation, Message, TurnMetadata } from '@shared/types';
import type { MiniAppRunEventPayload, MiniAppRunReportView } from '@shared/app-pack';

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

function runCardMessage(content: string, miniAppRun: TurnMetadata['miniAppRun']): Message {
  return {
    id: 'msg-2',
    role: MessageRole.ASSISTANT,
    content,
    conversationId: 'conv-1',
    createdAt: new Date(),
    metadata: { outcome: 'ok', miniAppRun },
  };
}

function conversationOf(message: Message): Conversation {
  return {
    id: 'conv-1',
    title: 'Deletion review',
    createdAt: new Date(),
    updatedAt: new Date(),
    isArchived: false,
    messages: [
      { id: 'msg-1', role: MessageRole.USER, content: 'Review my folder', conversationId: 'conv-1', createdAt: new Date() },
      message,
    ],
  };
}

function reportFixture(): MiniAppRunReportView {
  return {
    packTitle: 'Sample review',
    run: {
      id: 'run-1',
      packId: 'file-deletion-review',
      packVersion: '0.1.0',
      rootPath: '/home/tester/projects/demo',
      status: 'done',
      totals: { scanned: 4, keep: 1, ask: 2, candidate: 1, ruleDecided: 1, modelDecided: 3, cacheHits: 1, pending: 0 },
      estimateCalls: 3,
      actualCalls: 3,
      inputTokens: 90,
      outputTokens: 30,
      error: null,
      conversationId: 'conv-1',
      startedAt: 1,
      updatedAt: 2,
      finishedAt: 3,
    },
    items: [
      { relPath: 'cache/junk.tmp', verdict: 'candidate', confidence: 0.91, decidedBy: 'engine:llm', evidence: { rule: 'cache', list: 'candidate' } },
      { relPath: 'fresh.txt', verdict: 'keep', confidence: null, decidedBy: 'rule:fresh', evidence: null },
    ],
    reportNodes: [
      { id: 'status', type: 'badge', bind: 'run.status' },
      { id: 'items', type: 'table', columns: ['path', 'verdict', 'confidence', 'decidedBy'] },
    ],
    labels: { 'rule.cache': 'Build cache', 'rule.fresh': 'Recently modified' },
  };
}

function mockDesktopApi(getConversation: () => Conversation | null): {
  sync: (conversationId: string) => void;
  emitRunEvent: (event: MiniAppRunEventPayload) => void;
} {
  const syncListeners: Array<(conversationId: string) => void> = [];
  const runListeners: Array<(event: MiniAppRunEventPayload) => void> = [];
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG }) as AppConfig),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => getConversation()),
    getAllConversations: vi.fn(async () => []),
    onTurnEvent: vi.fn(() => () => {}),
    startTurn: vi.fn(async () => 'turn_1'),
    cancelTurn: vi.fn(async () => {}),
    resumeTurn: vi.fn(async () => true),
    resizeWindow: vi.fn(),
    hideWindow: vi.fn(),
    minimizeWindow: vi.fn(async () => {}),
    openDesktop: vi.fn(async () => {}),
    onSessionSync: vi.fn((callback: (conversationId: string) => void) => {
      syncListeners.push(callback);
      return () => {
        const index = syncListeners.indexOf(callback);
        if (index >= 0) syncListeners.splice(index, 1);
      };
    }),
    onLauncherNewConversation: vi.fn(() => () => {}),
    getToolCatalog: vi.fn(async () => []),
    onSettingsOpen: vi.fn(async () => {}),
    saveFile: vi.fn(async () => ({ success: true })),
    setConversationMetadata: vi.fn(async () => {}),
    onMiniAppRunEvent: vi.fn((callback: (event: MiniAppRunEventPayload) => void) => {
      runListeners.push(callback);
      return () => {
        const index = runListeners.indexOf(callback);
        if (index >= 0) runListeners.splice(index, 1);
      };
    }),
    miniAppRunReport: vi.fn(async () => reportFixture()),
  } as unknown as typeof window.electronAPI;
  return {
    sync: (conversationId) => syncListeners.forEach((listener) => listener(conversationId)),
    emitRunEvent: (event) => runListeners.forEach((listener) => listener(event)),
  };
}

const runMetadata = {
  runId: 'run-1',
  packId: 'file-deletion-review',
  packTitle: 'Deletion review',
  status: 'done',
  rootPath: '/home/tester/projects/demo',
};

describe('desktop run-card report chip (plan 27 S1)', () => {
  it('shows the View report chip on a persisted run card and opens the report fetched by runId', async () => {
    const card = runCardMessage('Run finished — 4 scanned', runMetadata);
    const api = mockDesktopApi(() => conversationOf(card));
    render(<DesktopApp />);
    await screen.findByRole('textbox');

    api.sync('conv-1');
    const chip = await screen.findByRole('button', { name: 'View report' });
    fireEvent.click(chip);

    await screen.findByText('Sample review — report');
    expect(window.electronAPI.miniAppRunReport).toHaveBeenCalledWith('run-1');
    expect(await screen.findByText('cache/junk.tmp')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByText('Sample review — report')).toBeNull());
  });

  it('renders no chip on messages without miniAppRun metadata', async () => {
    const plain = { ...runCardMessage('Plain reply', undefined), metadata: { outcome: 'ok' } as TurnMetadata };
    const api = mockDesktopApi(() => conversationOf(plain));
    render(<DesktopApp />);
    await screen.findByRole('textbox');

    api.sync('conv-1');
    await screen.findByText('Plain reply');
    expect(screen.queryByRole('button', { name: 'View report' })).toBeNull();
  });

  it('refreshes the transcript when a terminal run event arrives', async () => {
    let settled = false;
    const runningCard = runCardMessage('Run in progress…', { ...runMetadata, status: 'running' });
    const doneCard = runCardMessage('Run finished — 4 scanned', {
      ...runMetadata,
      status: 'done',
      totals: { scanned: 4, keep: 1, ask: 2, candidate: 1, ruleDecided: 3, modelDecided: 1, cacheHits: 0, pending: 0 },
    });
    const api = mockDesktopApi(() => conversationOf(settled ? doneCard : runningCard));
    render(<DesktopApp />);
    await screen.findByRole('textbox');

    api.sync('conv-1');
    await screen.findByText('Running');
    const callsAfterSync = (window.electronAPI.getConversationById as ReturnType<typeof vi.fn>).mock.calls.length;

    api.emitRunEvent({ type: 'run:progress', runId: 'run-1', packId: 'file-deletion-review', estimateCalls: 3 });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect((window.electronAPI.getConversationById as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterSync);

    settled = true;
    api.emitRunEvent({ type: 'run:finished', runId: 'run-1', packId: 'file-deletion-review', status: 'done' });
    await screen.findByText('Done');
    expect(await screen.findByText('Scanned')).toBeTruthy();
    expect((window.electronAPI.getConversationById as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterSync);
    expect(screen.getByRole('button', { name: 'View report' })).toBeTruthy();
  });
});
