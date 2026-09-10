// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { LLMProviderType, type TurnEvent } from '@shared/types';

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
    getConversationById: vi.fn(async (id: string) => ({
      id,
      title: 'Test',
      messages: [{ id: 'a1', role: 'assistant', content: 'Hello there', createdAt: new Date() }],
    })),
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
    resizeWindow: vi.fn(),
    hideWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    onSettingsOpen: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
  } as unknown as typeof window.electronAPI;
  return {
    emit: (event: TurnEvent) => listeners.forEach((listener) => listener(event)),
  };
}

const baseEvent = { tempMessageId: 'turn_1', conversationId: 'temp-1', model: 'm1' };

async function sendHello(): Promise<{ emit: (event: TurnEvent) => void; container: HTMLElement }> {
  const api = mockApiWithTurnEvents();
  const { container } = render(<ChatApp onThemeChange={vi.fn()} />);
  const textarea = await screen.findByRole('textbox');
  fireEvent.change(textarea, { target: { value: 'hello' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  await waitFor(() => expect((window.electronAPI.startTurn as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
  return { emit: api.emit, container };
}

describe('live streaming into the launcher UI', () => {
  it('leaves the compact bar on send and renders live deltas', async () => {
    const { emit } = await sendHello();

    emit({ ...baseEvent, seq: 1, phase: 'queued' } as TurnEvent);
    emit({
      ...baseEvent,
      seq: 2,
      phase: 'thinking',
      step: { id: 's1', phase: 'thinking', label: 'Thinking', startedAt: Date.now() },
    } as TurnEvent);
    emit({ ...baseEvent, seq: 3, phase: 'streaming', delta: 'He' } as TurnEvent);

    await waitFor(() => expect(screen.getByText('He')).toBeTruthy(), { timeout: 3000 });
  });

  it('renders the response in the done panel after the finished event', async () => {
    const { emit } = await sendHello();

    emit({ ...baseEvent, seq: 1, phase: 'queued' } as TurnEvent);
    emit({ ...baseEvent, seq: 2, phase: 'streaming', delta: 'Hello' } as TurnEvent);
    emit({ ...baseEvent, seq: 3, phase: 'finished' } as TurnEvent);

    await waitFor(() => expect(screen.getByText('Hello there')).toBeTruthy(), { timeout: 3000 });
  });

  it('streams node telemetry through the real channel without breaking the live turn', async () => {
    const { emit } = await sendHello();
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
        node: 'model_request',
      },
    } as TurnEvent);
    emit({
      ...baseEvent,
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
    emit({ ...baseEvent, seq: 4, phase: 'streaming', delta: 'Node' } as TurnEvent);

    await waitFor(() => expect(screen.getByText('Node')).toBeTruthy(), { timeout: 3000 });
  });

  it('sticks the compact panel to the latest text and yields to manual scrolling', async () => {
    const scrollHeightSpy = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    const clientHeightSpy = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(200);
    try {
      const { emit, container } = await sendHello();

      emit({ ...baseEvent, seq: 1, phase: 'queued' } as TurnEvent);
      emit({ ...baseEvent, seq: 2, phase: 'streaming', delta: 'First' } as TurnEvent);
      await waitFor(() => expect(screen.getByText(/First/)).toBeTruthy(), { timeout: 3000 });

      const scrollEl = container.querySelector('.overflow-y-auto') as HTMLElement;
      expect(scrollEl).toBeTruthy();
      await waitFor(() => expect(scrollEl.scrollTop).toBe(1000));

      scrollEl.scrollTop = 10;
      fireEvent.scroll(scrollEl);
      emit({ ...baseEvent, seq: 3, phase: 'streaming', delta: 'Second' } as TurnEvent);
      await waitFor(() => expect(screen.getByText(/Second/)).toBeTruthy(), { timeout: 3000 });
      expect(scrollEl.scrollTop).toBe(10);

      scrollEl.scrollTop = 1000;
      fireEvent.scroll(scrollEl);
      emit({ ...baseEvent, seq: 4, phase: 'streaming', delta: 'Third' } as TurnEvent);
      await waitFor(() => expect(screen.getByText(/Third/)).toBeTruthy(), { timeout: 3000 });
      await waitFor(() => expect(scrollEl.scrollTop).toBe(1000));
    } finally {
      scrollHeightSpy.mockRestore();
      clientHeightSpy.mockRestore();
    }
  });

  it('escapes auto-scroll on a small scroll-up nudge or a single wheel-up tick', async () => {
    const scrollHeightSpy = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    const clientHeightSpy = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(200);
    try {
      const { emit, container } = await sendHello();

      emit({ ...baseEvent, seq: 1, phase: 'queued' } as TurnEvent);
      emit({ ...baseEvent, seq: 2, phase: 'streaming', delta: 'Alpha' } as TurnEvent);
      await waitFor(() => expect(screen.getByText(/Alpha/)).toBeTruthy(), { timeout: 3000 });
      const scrollEl = container.querySelector('.overflow-y-auto') as HTMLElement;
      await waitFor(() => expect(scrollEl.scrollTop).toBe(1000));

      scrollEl.scrollTop = 790;
      fireEvent.scroll(scrollEl);
      emit({ ...baseEvent, seq: 3, phase: 'streaming', delta: 'Beta' } as TurnEvent);
      await waitFor(() => expect(screen.getByText(/Beta/)).toBeTruthy(), { timeout: 3000 });
      expect(scrollEl.scrollTop).toBe(790);

      scrollEl.scrollTop = 1000;
      fireEvent.scroll(scrollEl);
      emit({ ...baseEvent, seq: 4, phase: 'streaming', delta: 'Gamma' } as TurnEvent);
      await waitFor(() => expect(screen.getByText(/Gamma/)).toBeTruthy(), { timeout: 3000 });
      await waitFor(() => expect(scrollEl.scrollTop).toBe(1000));

      fireEvent.wheel(scrollEl, { deltaY: -120 });
      emit({ ...baseEvent, seq: 5, phase: 'streaming', delta: 'Delta' } as TurnEvent);
      await waitFor(() => expect(screen.getByText(/Delta/)).toBeTruthy(), { timeout: 3000 });
      expect(scrollEl.scrollTop).toBe(1000);
    } finally {
      scrollHeightSpy.mockRestore();
      clientHeightSpy.mockRestore();
    }
  });
});
