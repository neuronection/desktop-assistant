// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { FundCard } from '@renderer/chat-react/FundCard';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';

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

describe('launcher fund card', () => {
  it('renders the sponsor channels', () => {
    render(<FundCard onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /help desktop assistant grow/i })).toBeTruthy();
    const link = screen.getByRole('link', { name: /buy me a coffee/i });
    expect(link.getAttribute('href')).toBe('https://buymeacoffee.com/neuronection');
    expect(screen.getByRole('link', { name: /star on github/i })).toBeTruthy();
  });

  it('closes on escape and on outside click', async () => {
    const onClose = vi.fn();
    render(<FundCard onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('has no axe violations', async () => {
    const { container } = render(<FundCard onClose={vi.fn()} />);
    const results = await axe.run(container);
    const summary = results.violations
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
      .join('\n');
    expect(summary).toBe('');
  });
});

describe('launcher heart entry', () => {
  function mockApi(): void {
    window.electronAPI = {
      loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG })),
      onConfigUpdate: vi.fn(() => () => {}),
      getConversationById: vi.fn(async () => null),
      getAllConversations: vi.fn(async () => []),
      onTurnEvent: vi.fn(() => () => {}),
      startTurn: vi.fn(async () => 'turn_1'),
      cancelTurn: vi.fn(async () => {}),
      resizeWindow: vi.fn(),
      hideWindow: vi.fn(),
      openDesktop: vi.fn(async () => {}),
      openLauncher: vi.fn(async () => {}),
      onSettingsOpen: vi.fn(async () => {}),
      onLauncherToggleExpand: vi.fn(() => () => {}),
      onLauncherNewConversation: vi.fn(() => () => {}),
      onLauncherSetMode: vi.fn(() => () => {}),
      onSessionSync: vi.fn(() => () => {}),
      getCommandCatalog: vi.fn(async () => ({ entries: [], recentIds: [], pins: [] })),
    } as unknown as typeof window.electronAPI;
  }

  it('opens the fund card from the composer heart and closes on escape', async () => {
    mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    await screen.findByRole('textbox');
    fireEvent.click(screen.getByTitle('Support this project'));
    expect(await screen.findByRole('dialog', { name: /help desktop assistant grow/i })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /help desktop assistant grow/i })).toBeNull());
    expect((window.electronAPI.hideWindow as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
