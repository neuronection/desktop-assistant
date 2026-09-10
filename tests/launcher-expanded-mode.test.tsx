// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
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
});

afterEach(cleanup);

function mockApi() {
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG }) as AppConfig),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => null),
    getAllConversations: vi.fn(async () => []),
    onTurnEvent: vi.fn(() => () => {}),
    startTurn: vi.fn(async () => 'turn_1'),
    cancelTurn: vi.fn(async () => {}),
    resizeWindow: vi.fn(),
    resizeCornerStart: vi.fn(async () => {}),
    resizeCornerUpdate: vi.fn(async () => {}),
    resizeCornerEnd: vi.fn(async () => {}),
    hideWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    onSettingsOpen: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
  } as unknown as typeof window.electronAPI;
}

async function renderExpanded(): Promise<HTMLElement> {
  mockApi();
  const { container } = render(<StrictMode><ChatApp onThemeChange={vi.fn()} /></StrictMode>);
  const textarea = await screen.findByRole('textbox');
  fireEvent.change(textarea, { target: { value: 'hello' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  await waitFor(() => expect(window.electronAPI.startTurn as ReturnType<typeof vi.fn>).toHaveBeenCalled());
  const emit = (event: TurnEvent) => {
    const handler = (window.electronAPI.onTurnEvent as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as ((event: TurnEvent) => void) | undefined;
    handler?.(event);
  };
  emit({ tempMessageId: 'turn_1', conversationId: 'temp-1', seq: 1, phase: 'queued' } as TurnEvent);
  emit({ tempMessageId: 'turn_1', conversationId: 'temp-1', seq: 2, phase: 'streaming', delta: 'Hi!' } as TurnEvent);
  emit({ tempMessageId: 'turn_1', conversationId: 'temp-1', seq: 3, phase: 'finished' } as TurnEvent);
  await waitFor(() => expect(screen.queryByText('Hi!')).toBeNull());
  fireEvent.keyDown(document, { key: 'e', ctrlKey: true });
  await screen.findByRole('button', { name: '+ New' });
  return container;
}

describe('launcher expanded mode', () => {
  it('keeps expand mode when starting a new conversation and clears the transcript', async () => {
    const container = await renderExpanded();

    fireEvent.click(screen.getByRole('button', { name: '+ New' }));

    expect(screen.getByRole('button', { name: '+ New' })).toBeTruthy();
    expect(await screen.findByText('Ask AI anything…')).toBeTruthy();
    expect(container.querySelector('aside')).toBeNull();
  });

  it('has no composer dropdown in expand mode — desktop/launcher live in the top menu', async () => {
    const container = await renderExpanded();

    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open desktop mode (Ctrl+D)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Launcher mode (Ctrl+E)' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Launcher mode (Ctrl+E)' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '+ New' })).toBeNull());
    expect(container.querySelector('[data-as="chat-panel-header"]')).toBeNull();
  });

  it('toggles the conversation sidebar closed as well as open', async () => {
    const container = await renderExpanded();

    const toggle = () => screen.getByRole('button', { name: 'Show conversations' });
    fireEvent.click(toggle());
    await waitFor(() => expect(container.querySelector('aside')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Hide conversations' }));
    await waitFor(() => expect(container.querySelector('aside')).toBeNull());
  });
});
