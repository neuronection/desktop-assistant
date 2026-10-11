// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DesktopApp } from '@renderer/chat-react/DesktopApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { MessageRole } from '@shared/types';
import type { Conversation, Message, TurnMetadata } from '@shared/types';
import type { MiniAppLiveCardView, MiniAppRunEventPayload, MiniAppRunMessageMetadata } from '@shared/app-pack';

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

const PACK_ID = 'file-deletion-review';
const DEFAULT_PACK_ID = 'other-pack';

const liveCardView: MiniAppLiveCardView = {
  packId: PACK_ID,
  nodes: [
    { id: 'status', type: 'badge', bind: 'run.status' },
    { id: 'progress', type: 'progress', bind: 'progress' },
    { id: 'scanned', type: 'stat', bind: 'totals.scanned' },
    { id: 'keep', type: 'stat', bind: 'totals.keep' },
  ],
  labels: { 'live.scanned': 'Files scanned' },
};

function runMetadata(overrides: Partial<MiniAppRunMessageMetadata> = {}): MiniAppRunMessageMetadata {
  return {
    runId: 'run-1',
    packId: PACK_ID,
    packTitle: 'Deletion review',
    status: 'running',
    rootPath: '/home/tester/demo',
    ...overrides,
  };
}

function runCardMessage(run: MiniAppRunMessageMetadata): Message {
  return {
    id: 'msg-2',
    role: MessageRole.ASSISTANT,
    content: 'markdown fallback that must not render',
    conversationId: 'conv-1',
    createdAt: new Date(),
    metadata: { outcome: 'ok', miniAppRun: run },
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

function mockDesktopApi(
  getConversation: () => Conversation | null
): {
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
    miniAppRunReport: vi.fn(async () => null),
    getMiniAppLiveCard: vi.fn(async (packId: string): Promise<MiniAppLiveCardView | null> => (packId === PACK_ID ? liveCardView : null)),
  } as unknown as typeof window.electronAPI;
  return {
    sync: (conversationId) => syncListeners.forEach((listener) => listener(conversationId)),
    emitRunEvent: (event) => runListeners.forEach((listener) => listener(event)),
  };
}

async function renderWithRunCard(run: MiniAppRunMessageMetadata, settledTotals = false): Promise<{ conversation: Conversation; api: ReturnType<typeof mockDesktopApi> }> {
  const conversation = conversationOf(
    runCardMessage({
      ...run,
      ...(settledTotals
        ? {
            totals: { scanned: 4, keep: 1, ask: 2, candidate: 1, ruleDecided: 3, modelDecided: 1, cacheHits: 0, pending: 0 },
            actualCalls: 12,
          }
        : {}),
    })
  );
  const api = mockDesktopApi(() => conversation);
  render(<DesktopApp />);
  await screen.findByRole('textbox');
  api.sync('conv-1');
  await waitFor(() => expect(document.querySelector('[data-miniapp-run-card]')).not.toBeNull());
  return { conversation, api };
}

describe('MiniAppRunCard — live run cards in the transcript (plan 28 S2)', () => {
  it('renders the card instead of the markdown and follows the real run:* event sequence', async () => {
    const { api } = await renderWithRunCard(runMetadata());
    expect(screen.queryByText('markdown fallback that must not render')).toBeNull();
    expect(screen.getByText('Running')).toBeTruthy();

    api.emitRunEvent({ type: 'run:started', runId: 'run-1', packId: PACK_ID, status: 'running' });
    api.emitRunEvent({ type: 'run:progress', runId: 'run-1', packId: PACK_ID, estimateCalls: 12 });
    expect(await screen.findByText('≈ 12 model calls')).toBeTruthy();

    api.emitRunEvent({ type: 'run:progress', runId: 'run-1', packId: PACK_ID, phase: 'decide', done: 3, total: 12 });
    expect(await screen.findByText('3 of 12')).toBeTruthy();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('12');

    api.emitRunEvent({ type: 'run:paused', runId: 'run-1', packId: PACK_ID, status: 'paused' });
    expect(await screen.findByText('Paused')).toBeTruthy();
    api.emitRunEvent({ type: 'run:resumed', runId: 'run-1', packId: PACK_ID, status: 'running' });
    expect(await screen.findByText('Running')).toBeTruthy();
  });

  it('accumulates coalesced run:items counts when no decide-phase progress exists', async () => {
    const { api } = await renderWithRunCard(runMetadata());
    api.emitRunEvent({ type: 'run:items', runId: 'run-1', packId: PACK_ID, count: 4 });
    api.emitRunEvent({ type: 'run:items', runId: 'run-1', packId: PACK_ID, count: 2 });
    expect(await screen.findByText('6 decided')).toBeTruthy();
  });

  it('settles from refreshed metadata on run:finished — tallies replace the live overlay', async () => {
    let settled = false;
    const run = runMetadata();
    const conversation = conversationOf(runCardMessage(run));
    const api = mockDesktopApi(() => {
      const message = conversation.messages[1];
      message.metadata = {
        outcome: 'ok',
        miniAppRun: settled
          ? { ...run, status: 'done', totals: { scanned: 4, keep: 1, ask: 2, candidate: 1, ruleDecided: 3, modelDecided: 1, cacheHits: 0, pending: 0 }, actualCalls: 12 }
          : run,
      };
      return conversation;
    });
    render(<DesktopApp />);
    await screen.findByRole('textbox');
    api.sync('conv-1');
    await screen.findByText('Running');

    settled = true;    api.emitRunEvent({ type: 'run:finished', runId: 'run-1', packId: PACK_ID, status: 'done' });
    expect(await screen.findByText('Done')).toBeTruthy();
    expect(await screen.findByText('Files scanned')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('Keep')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('12 model calls')).toBeTruthy();
  });

  it('renders settled history from metadata alone (restart truth, no events)', async () => {
    await renderWithRunCard(runMetadata({ status: 'done' }), true);
    expect(screen.getByText('Files scanned')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('falls back to the default card when the pack declares no liveCard', async () => {
    await renderWithRunCard(runMetadata({ packId: DEFAULT_PACK_ID, packTitle: 'Other pack', status: 'done' }), true);
    expect(screen.getByText('Other pack')).toBeTruthy();
    expect(screen.getByText('Scanned')).toBeTruthy();
  });

  it('the card action opens the in-window report', async () => {
    const { api } = await renderWithRunCard(runMetadata({ status: 'done' }), true);
    (window.electronAPI.miniAppRunReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      packTitle: 'Deletion review',
      run: { id: 'run-1', packId: PACK_ID, packVersion: '0.1.0', rootPath: '/home/tester/demo', status: 'done', totals: { scanned: 4, keep: 1, ask: 2, candidate: 1, ruleDecided: 3, modelDecided: 1, cacheHits: 0, pending: 0 }, estimateCalls: 3, actualCalls: 3, inputTokens: 0, outputTokens: 0, error: null, conversationId: 'conv-1', startedAt: 1, updatedAt: 2, finishedAt: 3 },
      items: [],
      reportNodes: [{ id: 'status', type: 'badge', bind: 'run.status' }],
      labels: {},
    });
    fireEvent.click(screen.getByRole('button', { name: 'View report' }));
    expect(await screen.findByText('Deletion review — report')).toBeTruthy();
    expect(window.electronAPI.miniAppRunReport).toHaveBeenCalledWith('run-1');
  });

  it('ignores events for other runs', async () => {
    const { api } = await renderWithRunCard(runMetadata());
    api.emitRunEvent({ type: 'run:progress', runId: 'run-OTHER', packId: PACK_ID, phase: 'decide', done: 9, total: 9 });
    api.emitRunEvent({ type: 'run:failed', runId: 'run-OTHER', packId: PACK_ID, status: 'failed' });
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
