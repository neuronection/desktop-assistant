// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { useEffect, type JSX } from 'react';
import { useChatSession } from '@renderer/chat-react/useChatSession';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { CommandEntry } from '@shared/commands';
import type { Conversation } from '@shared/types';

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

const runConversation: Conversation = {
  id: 'conv-9',
  title: 'Deletion review',
  createdAt: new Date(),
  updatedAt: new Date(),
  isArchived: false,
  messages: [
    {
      id: 'msg-1',
      role: 'assistant',
      content: 'Run in progress…',
      conversationId: 'conv-9',
      createdAt: new Date(),
      metadata: {
        outcome: 'ok',
        miniAppRun: { runId: 'run-1', packId: 'file-deletion-review', packTitle: 'Deletion review', status: 'running', rootPath: '/home/tester/demo' },
      },
    },
  ],
};

const runEntry: CommandEntry = {
  id: 'miniapp:run:file-deletion-review',
  kind: 'builtin',
  title: 'Run a deletion review',
  category: 'apps',
  aliases: [],
  slash: 'file-deletion-review',
  source: 'builtin',
  scopes: { palette: true },
  args: [],
  action: 'miniapp:run-start',
};

function mockApi(): void {
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG }) as AppConfig),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => runConversation),
    getAllConversations: vi.fn(async () => []),
    onTurnEvent: vi.fn(() => () => {}),
    startTurn: vi.fn(async () => 'turn_1'),
    cancelTurn: vi.fn(async () => {}),
    resumeTurn: vi.fn(async () => true),
    onSessionSync: vi.fn(() => () => {}),
    getToolCatalog: vi.fn(async () => []),
    onSettingsOpen: vi.fn(async () => {}),
    setConversationMetadata: vi.fn(async () => {}),
    onMiniAppRunEvent: vi.fn(() => () => {}),
    executeCommand: vi.fn(async () => ({ status: 'done', text: 'Run started', conversationId: 'conv-9' })),
    openDesktop: vi.fn(async () => {}),
    writeToClipboard: vi.fn(async () => {}),
  } as unknown as typeof window.electronAPI;
}

function SessionProbe({ onSession }: { onSession: (session: ReturnType<typeof useChatSession>) => void }): JSX.Element {
  const session = useChatSession();
  useEffect(() => {
    onSession(session);
  }, [onSession, session]);
  return null;
}

describe('mini-app run start opens the desktop window on the run conversation (plan 27 S1 follow-up)', () => {
  it('palette execution: done outcome with a conversationId selects it locally and opens desktop mode on it', async () => {
    mockApi();
    let ready: ReturnType<typeof useChatSession> | null = null;
    render(<SessionProbe onSession={(session) => { ready = session; }} />);

    await waitFor(() => expect(ready).not.toBeNull());
    const session = ready!;
    await session.runCommandEntry(runEntry, []);

    expect(window.electronAPI.executeCommand).toHaveBeenCalledWith('miniapp:run:file-deletion-review', [], 'palette');
    expect(window.electronAPI.getConversationById).toHaveBeenCalledWith('conv-9');
    expect(window.electronAPI.openDesktop).toHaveBeenCalledWith('conv-9');
    await waitFor(() => expect(ready!.activeId).toBe('conv-9'));
    await waitFor(() => expect(ready!.messages.some((message) => message.content === 'Run in progress…')).toBe(true));
  });

  it('done outcome without a conversationId never opens desktop mode', async () => {
    mockApi();
    (window.electronAPI.executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'done', text: 'Copied' });
    let ready: ReturnType<typeof useChatSession> | null = null;
    render(<SessionProbe onSession={(session) => { ready = session; }} />);

    await waitFor(() => expect(ready).not.toBeNull());
    await ready!.runCommandEntry(runEntry, []);

    expect(window.electronAPI.openDesktop).not.toHaveBeenCalled();
  });
});
