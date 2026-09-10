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
});
