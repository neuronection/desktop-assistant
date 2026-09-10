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
        return {
          id,
          title: 'hello',
          messages: [
            { id: 'u1', role: 'user', content: 'hello', createdAt: new Date() },
            { id: 'a1', role: 'assistant', content: 'Hello there', createdAt: new Date() },
          ],
        };
      }
      return null;
    }),
    getAllConversations: vi.fn(async () => [{ id: 'real-1', title: 'hello', updatedAt: new Date() }]),
    onTurnEvent: vi.fn((callback: (event: TurnEvent) => void) => {
      listeners.push(callback);
      return () => {
        const index = listeners.indexOf(callback);
        if (index >= 0) listeners.splice(index, 1);
      };
    }),
    startTurn: vi.fn(async () => 'turn_1'),
    cancelTurn: vi.fn(async () => {}),
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

async function sendHello(): Promise<{ emit: (event: TurnEvent) => void; startTurn: ReturnType<typeof vi.fn> }> {
  const api = mockApiWithTurnEvents();
  render(<StrictMode><DesktopApp /></StrictMode>);
  const textarea = await screen.findByRole('textbox');
  fireEvent.change(textarea, { target: { value: 'hello' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  await waitFor(() => expect(window.electronAPI.startTurn as ReturnType<typeof vi.fn>).toHaveBeenCalled());
  return api;
}

describe('live streaming into the desktop window', () => {
  it('renders live deltas while the turn streams', async () => {
    const { emit } = await sendHello();

    emit({ ...tempEvent, seq: 1, phase: 'queued' } as TurnEvent);
    emit({
      ...tempEvent,
      seq: 2,
      phase: 'thinking',
      step: { id: 's1', phase: 'thinking', label: 'Thinking', startedAt: Date.now() },
    } as TurnEvent);
    emit({ ...tempEvent, seq: 3, phase: 'streaming', delta: 'He' } as TurnEvent);

    await waitFor(() => expect(screen.getByText('He')).toBeTruthy(), { timeout: 3000 });
  });

  it('streams node telemetry through the real channel without breaking the live turn', async () => {
    const { emit } = await sendHello();
    const now = Date.now();

    emit({ ...tempEvent, seq: 1, phase: 'queued' } as TurnEvent);
    emit({
      ...tempEvent,
      seq: 2,
      phase: 'thinking',
      node: { node: 'model_request', label: 'Thinking', resumed: false },
      step: {
        id: 'node_model_request_1',
        phase: 'thinking',
        label: 'Thinking',
        startedAt: now,
        node: 'model_request',
      },
    } as TurnEvent);
    emit({
      ...tempEvent,
      seq: 3,
      phase: 'thinking',
      node: {
        node: 'model_request',
        label: 'Thinking',
        outcome: 'done',
        durationMs: 5,
        resumed: false,
      },
      step: {
        id: 'node_model_request_1',
        phase: 'thinking',
        label: 'Thinking',
        startedAt: now - 5,
        endedAt: now,
        node: 'model_request',
      },
    } as TurnEvent);
    emit({ ...tempEvent, seq: 4, phase: 'streaming', delta: 'Node' } as TurnEvent);

    await waitFor(() => expect(screen.getByText('Node')).toBeTruthy(), { timeout: 3000 });
  });

  it('shows the persisted response after the finished event (temp -> real conversation)', async () => {
    const { emit } = await sendHello();

    emit({ ...tempEvent, seq: 1, phase: 'queued' } as TurnEvent);
    emit({ ...tempEvent, seq: 2, phase: 'streaming', delta: 'Hello' } as TurnEvent);
    emit({ ...tempEvent, seq: 3, phase: 'finished' } as TurnEvent);

    await waitFor(() => expect(screen.getByText('Hello there')).toBeTruthy(), { timeout: 3000 });
  });
});
