// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { DesktopApp } from '@renderer/chat-react/DesktopApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { TurnEvent } from '@shared/types';

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

function mockDesktopApi(config: AppConfig = { ...DEFAULT_CONFIG }): {
  emit: (event: TurnEvent) => void;
} {
  const listeners: Array<(event: TurnEvent) => void> = [];
  window.electronAPI = {
    loadConfig: vi.fn(async () => config),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => null),
    getAllConversations: vi.fn(async () => []),
    onTurnEvent: vi.fn((callback: (event: TurnEvent) => void) => {
      listeners.push(callback);
      return () => {
        const index = listeners.indexOf(callback);
        if (index >= 0) listeners.splice(index, 1);
      };
    }),
    startTurn: vi.fn(async () => 'turn_1'),
    cancelTurn: vi.fn(async () => {}),
    resumeTurn: vi.fn(async () => true),
    resizeWindow: vi.fn(),
    hideWindow: vi.fn(),
    minimizeWindow: vi.fn(async () => {}),
    openDesktop: vi.fn(async () => {}),
    onSessionSync: vi.fn(() => () => {}),
    getToolCatalog: vi.fn(async () => []),
    onSettingsOpen: vi.fn(async () => {}),
    saveFile: vi.fn(async () => ({ success: true })),
    setConversationMetadata: vi.fn(async () => {}),
  } as unknown as typeof window.electronAPI;
  return { emit: (event: TurnEvent) => listeners.forEach((listener) => listener(event)) };
}

async function renderDesktop(): Promise<{ emit: (event: TurnEvent) => void }> {
  const api = mockDesktopApi();
  render(<DesktopApp />);
  await screen.findByRole('textbox');
  return api;
}

const RULE_EXCLUSIONS: Record<string, string> = {};

async function expectNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations
    .filter((v) => !(RULE_EXCLUSIONS[v.id] && v.impact !== 'critical'))
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
    .join('\n');
  expect(summary).toBe('');
}

const baseEvent = { tempMessageId: 'turn_1', conversationId: 'real-1', model: 'm1' };

describe('DesktopApp axe scans', () => {
  it('idle desktop surface has no axe violations', async () => {
    await renderDesktop();
    await expectNoViolations(document.body);
  });

  it('desktop surface with the live flow card has no axe violations', async () => {
    const { emit } = await renderDesktop();
    const now = Date.now();

    emit({ ...baseEvent, seq: 1, phase: 'queued' } as TurnEvent);
    emit({
      ...baseEvent,
      seq: 2,
      phase: 'thinking',
      node: { node: 'model_request', label: 'Thinking', resumed: false },
      step: {
        id: 'node_model_request_1',
        phase: 'thinking',
        label: 'Thinking',
        startedAt: now,
        endedAt: now + 10,
        node: 'model_request',
      },
    } as TurnEvent);
    emit({
      ...baseEvent,
      seq: 3,
      phase: 'tool_call',
      step: {
        id: 'tool_c1',
        phase: 'tool_call',
        label: 'screen_capture',
        toolName: 'screen_capture',
        startedAt: now + 10,
        summary: 'Captured the screen',
      },
    } as TurnEvent);

    await waitFor(() => expect(screen.getByText('Working on it…')).toBeTruthy());
    await expectNoViolations(document.body);
  });

  it('desktop surface with a run card and the open report modal has no axe violations', async () => {
    mockDesktopApi();
    const conversation = {
      id: 'conv-1',
      title: 'Deletion review',
      createdAt: new Date(),
      updatedAt: new Date(),
      isArchived: false,
      messages: [
        { id: 'msg-1', role: 'user', content: 'Review my folder', conversationId: 'conv-1', createdAt: new Date() },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Run finished — 4 scanned',
          conversationId: 'conv-1',
          createdAt: new Date(),
          metadata: {
            outcome: 'ok',
            miniAppRun: { runId: 'run-1', packId: 'file-deletion-review', packTitle: 'Deletion review', status: 'done', rootPath: '/home/tester/demo' },
          },
        },
      ],
    };
    const syncListeners: Array<(conversationId: string) => void> = [];
    window.electronAPI = {
      ...window.electronAPI,
      getConversationById: vi.fn(async () => conversation),
      onSessionSync: vi.fn((callback: (conversationId: string) => void) => {
        syncListeners.push(callback);
        return () => {
          const index = syncListeners.indexOf(callback);
          if (index >= 0) syncListeners.splice(index, 1);
        };
      }),
      onMiniAppRunEvent: vi.fn(() => () => {}),
      miniAppRunReport: vi.fn(async () => ({
        packTitle: 'Deletion review',
        run: {
          id: 'run-1',
          packId: 'file-deletion-review',
          packVersion: '0.1.0',
          rootPath: '/home/tester/demo',
          status: 'done',
          totals: { scanned: 2, keep: 1, ask: 0, candidate: 1, ruleDecided: 2, modelDecided: 0, cacheHits: 0, pending: 0 },
          estimateCalls: 1,
          actualCalls: 1,
          inputTokens: 10,
          outputTokens: 5,
          error: null,
          conversationId: 'conv-1',
          startedAt: 1,
          updatedAt: 2,
          finishedAt: 3,
        },
        items: [
          { relPath: 'cache/junk.tmp', verdict: 'candidate', confidence: 0.91, decidedBy: 'engine:llm', evidence: null },
          { relPath: 'fresh.txt', verdict: 'keep', confidence: null, decidedBy: 'rule:fresh', evidence: null },
        ],
        reportNodes: [
          { id: 'status', type: 'badge', bind: 'run.status' },
          { id: 'items', type: 'table', columns: ['path', 'verdict', 'confidence', 'decidedBy'] },
        ],
        labels: {},
      })),
    } as unknown as typeof window.electronAPI;

    render(<DesktopApp />);
    await screen.findByRole('textbox');
    syncListeners.forEach((listener) => listener('conv-1'));
    fireEvent.click(await screen.findByRole('button', { name: 'View report' }));
    await screen.findByText('Deletion review — report');
    await expectNoViolations(document.body);
  });
});
