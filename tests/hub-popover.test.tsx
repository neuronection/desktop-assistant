// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { HubPopover } from '@renderer/hub-popover/main';
import { SPEECH_INITIAL, type SpeechSnapshot } from '@shared/speech';
import { LIVE_INITIAL, type LiveSnapshot } from '@shared/live';
import { TEXT } from '@shared/constants/text';
import type { HubActionView, HubResult } from '@shared/hub';

let resultListener: ((result: HubResult) => void) | null = null;
let busyListener: ((busy: { id: string; active: boolean }) => void) | null = null;

const ACTIONS: HubActionView[] = [
  { id: 'live-toggle', label: TEXT.HUB_ACTION_LIVE, hint: TEXT.HUB_ACTION_LIVE_HINT, enabled: true, active: false },
  { id: 'translate-selection', label: TEXT.HUB_ACTION_TRANSLATE, hint: TEXT.HUB_ACTION_TRANSLATE_HINT, enabled: true },
  { id: 'hide-hub', label: TEXT.HUB_ACTION_HIDE, hint: TEXT.HUB_ACTION_HIDE_HINT, enabled: true },
];

function installApi(options: { speech?: SpeechSnapshot; live?: LiveSnapshot } = {}) {
  const api = {
    getHubActions: vi.fn(async () => ACTIONS),
    getSpeechSnapshot: vi.fn(async () => options.speech ?? SPEECH_INITIAL),
    getLiveState: vi.fn(async () => options.live ?? LIVE_INITIAL),
    onSpeechState: vi.fn(() => () => undefined),
    onLiveEvent: vi.fn(() => () => undefined),
    onHubBusy: vi.fn((callback: (busy: { id: string; active: boolean }) => void) => {
      busyListener = callback;
      return () => undefined;
    }),
    onHubResult: vi.fn((callback: (result: HubResult) => void) => {
      resultListener = callback;
      return () => undefined;
    }),
    onConfigUpdate: vi.fn(),
    runHubAction: vi.fn(async () => ({ ok: true })),
    copyHubText: vi.fn(),
    closeHub: vi.fn(),
    activateHubResult: vi.fn(),
    openHubSettings: vi.fn(),
  };
  window.electronAPI = api as unknown as typeof window.electronAPI;
  return api;
}

beforeEach(() => {
  resultListener = null;
  busyListener = null;
});
afterEach(cleanup);

describe('hub popover (plan 65)', () => {
  it('lists the configured actions and keeps a translation result open', async () => {
    const api = installApi();
    render(<HubPopover />);
    const translate = await screen.findByRole('button', { name: new RegExp(TEXT.HUB_ACTION_TRANSLATE) });
    fireEvent.click(translate);
    await waitFor(() => expect(api.runHubAction).toHaveBeenCalledWith('translate-selection'));
    expect(api.closeHub).not.toHaveBeenCalled();
  });

  it('keeps a non-translation action and closes the popover', async () => {
    const api = installApi();
    render(<HubPopover />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(TEXT.HUB_ACTION_HIDE) }));
    await waitFor(() => expect(api.runHubAction).toHaveBeenCalledWith('hide-hub'));
    expect(api.closeHub).toHaveBeenCalledTimes(1);
  });

  it('keeps fixed playback controls out of the popover even while active', async () => {
    const idle = installApi();
    const view = render(<HubPopover />);
    await screen.findByRole('button', { name: new RegExp(TEXT.HUB_ACTION_TRANSLATE) });
    expect(screen.queryByRole('button', { name: TEXT.SPEECH_PAUSE })).toBeNull();
    expect(idle.runHubAction).not.toHaveBeenCalled();
    view.unmount();

    const speaking = installApi({ speech: { ...SPEECH_INITIAL, state: 'speaking' } });
    render(<HubPopover />);
    await screen.findByRole('button', { name: new RegExp(TEXT.HUB_ACTION_TRANSLATE) });
    expect(screen.queryByRole('button', { name: TEXT.SPEECH_PAUSE })).toBeNull();
    expect(speaking.runHubAction).not.toHaveBeenCalled();
  });

  it('keeps fixed live controls out of the popover even while a session is active', async () => {
    const api = installApi({ live: { ...LIVE_INITIAL, state: 'listening' } });
    render(<HubPopover />);
    await screen.findByRole('button', { name: new RegExp(TEXT.HUB_ACTION_TRANSLATE) });
    expect(screen.queryByRole('button', { name: TEXT.SPEECH_LIVE_INTERRUPT })).toBeNull();
    expect(screen.queryByRole('button', { name: TEXT.SPEECH_LIVE_END })).toBeNull();
    expect(api.runHubAction).not.toHaveBeenCalled();
  });

  it('renders a pushed result with copy, open and retry', async () => {
    const api = installApi();
    render(<HubPopover />);
    await screen.findByRole('button', { name: new RegExp(TEXT.HUB_ACTION_TRANSLATE) });
    act(() => {
      resultListener?.({
        id: 'translate-selection',
        kind: 'translation',
        title: 'Translation · en → de',
        text: 'Hallo Welt',
        retryable: true,
      });
    });
    expect(screen.getByText('Hallo Welt')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(TEXT.HUB_RESULT_COPY) }));
    expect(api.copyHubText).toHaveBeenCalledWith('Hallo Welt');
    fireEvent.click(screen.getByRole('button', { name: TEXT.HUB_RESULT_OPEN, exact: true }));
    expect(api.activateHubResult).toHaveBeenCalledTimes(1);
    expect(api.closeHub).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: TEXT.HUB_RESULT_CLEAR }));
    expect(screen.queryByText('Hallo Welt')).toBeNull();
    act(() => {
      resultListener?.({
        id: 'translate-selection',
        kind: 'translation',
        title: 'Translation · en → de',
        text: 'Hallo Welt',
        retryable: true,
      });
    });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(TEXT.HUB_RESULT_RETRY) }));
    await waitFor(() => expect(api.runHubAction).toHaveBeenCalledWith('translate-selection'));
  });

  it('has no a11y violations', async () => {
    installApi();
    const { container } = render(<HubPopover />);
    await screen.findByRole('button', { name: new RegExp(TEXT.HUB_ACTION_TRANSLATE) });
    const results = await axe.run(container);
    const summary = results.violations.map((v) => `${v.id} (${v.impact})`).join('\n');
    expect(summary).toBe('');
  });

  it('shows a translating state while the action is processing', async () => {
    installApi();
    render(<HubPopover />);
    await screen.findByRole('button', { name: new RegExp(TEXT.HUB_ACTION_TRANSLATE) });
    act(() => busyListener?.({ id: 'translate-selection', active: true }));
    expect(screen.getByText(TEXT.HUB_BUSY_TRANSLATING)).toBeTruthy();
    act(() => busyListener?.({ id: 'translate-selection', active: false }));
    expect(screen.queryByText(TEXT.HUB_BUSY_TRANSLATING)).toBeNull();
  });

  it('shows selection actions disabled with the reason and keeps the rest', async () => {
    const api = installApi();
    api.getHubActions.mockResolvedValue([
      {
        id: 'translate-selection',
        label: TEXT.HUB_ACTION_TRANSLATE,
        hint: TEXT.HUB_ACTION_TRANSLATE_HINT,
        enabled: false,
        reason: TEXT.HUB_SELECTION_REQUIRED,
      },
      { id: 'hide-hub', label: TEXT.HUB_ACTION_HIDE, hint: TEXT.HUB_ACTION_HIDE_HINT, enabled: true },
    ]);
    render(<HubPopover />);
    await screen.findByRole('button', { name: new RegExp(TEXT.HUB_ACTION_HIDE) });
    const translate = screen.getByRole('button', { name: new RegExp(TEXT.HUB_ACTION_TRANSLATE) });
    expect((translate as HTMLButtonElement).disabled).toBe(true);
    expect(translate.getAttribute('title')).toContain(TEXT.HUB_SELECTION_REQUIRED);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(TEXT.HUB_POPOVER_SETTINGS) }));
    expect(api.openHubSettings).toHaveBeenCalledTimes(1);
    expect(api.closeHub).toHaveBeenCalledTimes(1);
  });

  it('paginates the popover actions', async () => {
    const api = installApi();
    api.getHubActions.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => ({
        id: 'dictate',
        label: `${TEXT.HUB_ACTION_DICTATE} ${index + 1}`,
        hint: TEXT.HUB_ACTION_DICTATE_HINT,
        enabled: true,
      }))
    );
    render(<HubPopover />);
    await screen.findByText(`${TEXT.HUB_ACTION_DICTATE} 1`);
    expect(screen.queryByText(`${TEXT.HUB_ACTION_DICTATE} 5`)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: TEXT.HUB_PAGE_NEXT }));
    expect(screen.getByText(`${TEXT.HUB_ACTION_DICTATE} 5`)).toBeTruthy();
    expect(screen.queryByText(`${TEXT.HUB_ACTION_DICTATE} 1`)).toBeNull();
  });
});
