// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
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

function mockApi(config: AppConfig = { ...DEFAULT_CONFIG }): ReturnType<typeof buildMocks> {
  const mocks = buildMocks(config);
  window.electronAPI = mocks.api as unknown as typeof window.electronAPI;
  return mocks;
}

function buildMocks(config: AppConfig) {
  const turnListeners: Array<(event: TurnEvent) => void> = [];
  const api = {
    loadConfig: vi.fn(async () => config),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => null),
    getAllConversations: vi.fn(async () => []),
    onTurnEvent: vi.fn((callback: (event: TurnEvent) => void) => {
      turnListeners.push(callback);
      return () => {
        const index = turnListeners.indexOf(callback);
        if (index >= 0) turnListeners.splice(index, 1);
      };
    }),
    startTurn: vi.fn(async () => {}),
    cancelTurn: vi.fn(async () => {}),
    hideWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    resizeWindow: vi.fn(),
    onSettingsOpen: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
    getScreenSources: vi.fn(async () => []),
  };
  return {
    api,
    hideWindow: api.hideWindow,
    startTurn: api.startTurn,
    emitTurnEvent: (event: TurnEvent) => turnListeners.forEach((listener) => listener(event)),
  };
}

async function renderLauncher(config?: AppConfig): Promise<ReturnType<typeof buildMocks>> {
  const mocks = mockApi(config);
  render(<ChatApp onThemeChange={vi.fn()} />);
  await screen.findByRole('textbox');
  return mocks;
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

const modelConfig = (): AppConfig => ({
  ...DEFAULT_CONFIG,
  defaultChatModelId: 'm1',
  providers: [
    {
      ...DEFAULT_CONFIG.providers[0],
      availableModels: [
        { id: 'm1', name: 'm1', providerType: LLMProviderType.OPENAI, providerId: DEFAULT_CONFIG.providers[0].id },
      ],
    },
  ],
});

describe('ChatApp axe scans', () => {
  it('launcher idle surface has no axe violations', async () => {
    const mocks = await renderLauncher();
    await expectNoViolations(document.body);
    expect(mocks.hideWindow).not.toHaveBeenCalled();
  });

  it('expanded surface has no axe violations', async () => {
    await renderLauncher();
    fireEvent.keyDown(document, { key: 'e', ctrlKey: true });
    await screen.findByText('Conversation');
    await expectNoViolations(document.body);
  });

  it('screen picker surface has no axe violations', async () => {
    await renderLauncher();
    fireEvent.click(screen.getByTitle('Share screen'));
    await screen.findByRole('dialog', { name: /Select a screen or window/ });
    await expectNoViolations(document.body);
  });

  it('expanded surface with attachments has no axe violations', async () => {
    const mocks = mockApi();
    const conversation = {
      id: 'conv-1',
      title: 'Test',
      createdAt: new Date(),
      updatedAt: new Date(),
      isArchived: false,
      messages: [
        {
          id: 'msg-1',
          content: 'What is in this picture?',
          role: 'user',
          attachments: [{ type: 'image', data: 'data:image/png;base64,QUJD' }],
          conversationId: 'conv-1',
          createdAt: new Date(),
        },
      ],
    };
    (mocks.api.getConversationById as ReturnType<typeof vi.fn>).mockResolvedValue(conversation);
    (mocks.api.getAllConversations as ReturnType<typeof vi.fn>).mockResolvedValue([conversation]);
    render(<ChatApp onThemeChange={vi.fn()} />);
    await screen.findByRole('textbox');
    fireEvent.keyDown(document, { key: 'e', ctrlKey: true });
    await screen.findByText('Conversation');
    fireEvent.click(screen.getByTitle('Show conversations'));
    fireEvent.click(screen.getByText('Test'));
    await screen.findByText('What is in this picture?');
    expect(screen.getByRole('img', { name: 'Image' })).toBeTruthy();
    await expectNoViolations(document.body);
  });

  it('launcher with the live trace strip has no axe violations', async () => {
    const { emitTurnEvent } = await renderLauncher(modelConfig());
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'take a screenshot' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect((window.electronAPI.startTurn as ReturnType<typeof vi.fn>)).toHaveBeenCalled());

    const base = { tempMessageId: 'turn_1', conversationId: 'temp-1', model: 'm1' };
    const now = Date.now();

    emitTurnEvent({ ...base, seq: 1, phase: 'queued' } as TurnEvent);
    emitTurnEvent({
      ...base,
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
    emitTurnEvent({
      ...base,
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

    await screen.findByText(/screen_capture/);
    await expectNoViolations(document.body);
  });
});

describe('ChatApp keyboard map', () => {
  it('Escape in the compact launcher hides the window', async () => {
    const mocks = await renderLauncher();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mocks.hideWindow).toHaveBeenCalledTimes(1);
  });

  it('Escape in the expanded view collapses instead of hiding', async () => {
    await renderLauncher();
    fireEvent.keyDown(document, { key: 'e', ctrlKey: true });
    await screen.findByText('Conversation');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Conversation')).toBeNull();
    expect((window.electronAPI.hideWindow as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('Escape closes the more-menu instead of hiding the window', async () => {
    await renderLauncher();
    fireEvent.click(screen.getByTitle('More'));
    expect(screen.getByRole('menu', { name: 'Launcher menu' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Launcher menu' })).toBeNull();
    expect((window.electronAPI.hideWindow as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('Escape closes the composer attach menu instead of hiding the window', async () => {
    await renderLauncher();
    fireEvent.click(screen.getByTitle('Attach files'));
    expect(screen.getByText('Select from files')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Select from files')).toBeNull();
    expect((window.electronAPI.hideWindow as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('Escape closes the screen picker, keeps the window up and refocuses the composer', async () => {
    await renderLauncher();
    fireEvent.click(screen.getByTitle('Share screen'));
    await screen.findByRole('dialog', { name: /Select a screen or window/ });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((window.electronAPI.hideWindow as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('Enter submits the turn; Shift+Enter does not', async () => {
    const mocks = await renderLauncher(modelConfig());
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(mocks.startTurn).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(mocks.startTurn).toHaveBeenCalledWith(expect.objectContaining({ content: 'hello' })));
  });
});
