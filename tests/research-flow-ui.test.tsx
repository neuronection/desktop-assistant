// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
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
});

afterEach(cleanup);

function mockApiWithTurnEvents(): { emit: (event: TurnEvent) => void } {
  const listeners: Array<(event: TurnEvent) => void> = [];
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG }) as AppConfig),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async (id: string) => {
      if (id === 'real-1') {
        return { id, title: 'research topic', messages: [] };
      }
      return null;
    }),
    getAllConversations: vi.fn(async () => [{ id: 'real-1', title: 'research topic', updatedAt: new Date() }]),
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
  return {
    emit: (event: TurnEvent) => listeners.forEach((listener) => listener(event)),
  };
}

const tempEvent = { tempMessageId: 'turn_1', conversationId: 'real-1', model: 'm1' };

async function sendResearchTurn(): Promise<{ emit: (event: TurnEvent) => void }> {
  const api = mockApiWithTurnEvents();
  render(<StrictMode><DesktopApp /></StrictMode>);
  const textarea = await screen.findByRole('textbox');
  fireEvent.change(textarea, { target: { value: '/research quantum computing' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  await waitFor(() => expect(window.electronAPI.startTurn as ReturnType<typeof vi.fn>).toHaveBeenCalled());
  return api;
}

describe('research flow telemetry into FlowCard (plan 13 S6)', () => {
  it('renders the live research node timeline with tool steps', async () => {
    const { emit } = await sendResearchTurn();
    const now = Date.now();

    emit({ ...tempEvent, seq: 1, phase: 'queued' } as TurnEvent);
    emit({
      ...tempEvent,
      seq: 2,
      phase: 'thinking',
      node: { node: 'plan', label: 'Planning', resumed: false },
      step: { id: 'node_plan_1', phase: 'thinking', label: 'Planning', startedAt: now, node: 'plan' },
    } as TurnEvent);
    emit({
      ...tempEvent,
      seq: 3,
      phase: 'thinking',
      node: { node: 'plan', label: 'Planning', outcome: 'done', durationMs: 4, resumed: false },
      step: { id: 'node_plan_1', phase: 'thinking', label: 'Planning', startedAt: now, endedAt: now + 4, node: 'plan' },
    } as TurnEvent);
    emit({
      ...tempEvent,
      seq: 4,
      phase: 'thinking',
      node: { node: 'search', label: 'Searching the web', resumed: false },
      step: { id: 'node_search_1', phase: 'thinking', label: 'Searching the web', startedAt: now + 4, node: 'search' },
    } as TurnEvent);
    emit({
      ...tempEvent,
      seq: 5,
      phase: 'tool_call',
      step: {
        id: 'tool_search_r1_1',
        phase: 'tool_call',
        label: 'web_search',
        toolName: 'web_search',
        summary: 'Searched the web for “quantum computing”',
        startedAt: now + 4,
      },
    } as TurnEvent);
    emit({
      ...tempEvent,
      seq: 6,
      phase: 'tool_result',
      step: {
        id: 'tool_search_r1_1',
        phase: 'tool_call',
        label: 'web_search',
        toolName: 'web_search',
        startedAt: now + 4,
        endedAt: now + 40,
        status: 'ok',
        node: 'search',
      },
    } as TurnEvent);
    emit({
      ...tempEvent,
      seq: 7,
      phase: 'thinking',
      node: {
        node: 'fetch',
        label: 'Reading sources',
        outcome: 'done',
        durationMs: 30,
        resumed: false,
      },
      step: { id: 'node_fetch_1', phase: 'thinking', label: 'Reading sources', startedAt: now + 40, endedAt: now + 70, node: 'fetch' },
    } as TurnEvent);

    await waitFor(() => {
      expect(screen.getByText('Working on it…')).toBeTruthy();
    }, { timeout: 3000 });

    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Planning'),
        expect.stringContaining('Searching the web'),
        expect.stringContaining('Reading sources'),
        expect.stringContaining('web_search'),
      ])
    );
  });

  it('shows the approval card inside the flow card while the research fetch is paused', async () => {
    const { emit } = await sendResearchTurn();
    const now = Date.now();

    emit({ ...tempEvent, seq: 1, phase: 'queued' } as TurnEvent);
    emit({
      ...tempEvent,
      seq: 2,
      phase: 'thinking',
      step: { id: 'node_fetch_1', phase: 'thinking', label: 'Reading sources', startedAt: now, node: 'fetch' },
    } as TurnEvent);
    emit({
      ...tempEvent,
      seq: 3,
      phase: 'tool_call',
      step: {
        id: 'tool_search_r1_1',
        phase: 'tool_call',
        label: 'web_search',
        toolName: 'web_search',
        startedAt: now,
        endedAt: now + 5,
        status: 'ok',
        node: 'search',
      },
    } as TurnEvent);
    emit({
      ...tempEvent,
      seq: 4,
      phase: 'interrupt',
      interrupt: {
        requests: [
          {
            id: 'appr_0',
            toolName: 'web_fetch',
            args: { url: 'https://example.com/a' },
            summary: 'Fetched https://example.com/a',
            risk: 'read-only',
            allowedDecisions: ['approve', 'reject'],
          },
        ],
        deadline: Date.now() + 60_000,
      },
    } as TurnEvent);

    await waitFor(() => {
      expect(screen.getByText('Allow once')).toBeTruthy();
    }, { timeout: 3000 });
    const card = screen.getByText('Working on it…').closest('[data-as="flow-status-card"]');
    expect(card?.getAttribute('data-status')).toBe('interrupted');
  });
});
