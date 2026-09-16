// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
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
  window.HTMLMediaElement.prototype.pause = function pause(): void {};
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(cleanup);

function mockApi(synthesize: Deferred<{ audioBase64: string; mime: string }>): { emit: (event: TurnEvent) => void } {
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
    synthesizeTts: vi.fn(() => synthesize.promise),
  } as unknown as typeof window.electronAPI;
  return {
    emit: (event: TurnEvent) => listeners.forEach((listener) => listener(event)),
  };
}

const baseEvent = { tempMessageId: 'turn_1', conversationId: 'temp-1', model: 'm1' };

async function renderDoneReply(synthesize: Deferred<{ audioBase64: string; mime: string }>) {
  const { emit } = mockApi(synthesize);
  render(<ChatApp onThemeChange={vi.fn()} />);
  const textarea = await screen.findByRole('textbox');
  fireEvent.change(textarea, { target: { value: 'hello' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  await vi.waitFor(() => expect(window.electronAPI.startTurn as ReturnType<typeof vi.fn>).toHaveBeenCalled());
  emit({ ...baseEvent, seq: 1, phase: 'queued' } as TurnEvent);
  emit({ ...baseEvent, seq: 2, phase: 'streaming', delta: 'Hello' } as TurnEvent);
  emit({ ...baseEvent, seq: 3, phase: 'finished' } as TurnEvent);
  await screen.findByText('Hello there');
  return { emit };
}

describe('speak feedback (immediate click response)', () => {
  it('shows preparing instantly on click, then speaking, then settles', async () => {
    const synthesize = defer<{ audioBase64: string; mime: string }>();
    let playingAudio: HTMLMediaElement | null = null;
    window.HTMLMediaElement.prototype.play = function play(): Promise<void> {
      playingAudio = this;
      return Promise.resolve();
    };
    await renderDoneReply(synthesize);
    const speakButton = screen.getByRole('button', { name: 'Speak reply' });

    fireEvent.click(speakButton);
    expect(screen.getByRole('status', { name: 'Preparing audio…' })).toBeTruthy();
    expect((speakButton as HTMLButtonElement).disabled).toBe(true);

    synthesize.resolve({ audioBase64: 'aaa', mime: 'audio/wav' });
    await screen.findByRole('status', { name: 'Speaking…' });
    expect((speakButton as HTMLButtonElement).disabled).toBe(false);

    playingAudio?.dispatchEvent(new Event('ended'));
    await vi.waitFor(() => expect(screen.queryByRole('status', { name: 'Speaking…' })).toBeNull());
  });

  it('returns to idle with an error notice when synthesis fails', async () => {
    const synthesize = defer<{ audioBase64: string; mime: string }>();
    await renderDoneReply(synthesize);
    const notificationHandler = vi.fn();
    const { NotificationService } = await import('@renderer/services/NotificationService');
    NotificationService.setHandler(notificationHandler);

    window.HTMLMediaElement.prototype.play = function play(): Promise<void> {
      return Promise.resolve();
    };

    fireEvent.click(screen.getByRole('button', { name: 'Speak reply' }));
    synthesize.reject(new Error('model or endpoint not found (HTTP 404)'));
    await vi.waitFor(() => {
      expect(notificationHandler).toHaveBeenCalledWith(expect.stringContaining('HTTP 404'), 'error');
    });
    expect(screen.queryByRole('status', { name: 'Preparing audio…' })).toBeNull();
    NotificationService.setHandler(null);
  });
});
