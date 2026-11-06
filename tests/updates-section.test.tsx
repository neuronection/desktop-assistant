// @vitest-environment jsdom
import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeWithDefaults } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';
import type { UpdateState } from '@shared/types';
import { UpdatesSection } from '@renderer/settings-react/UpdatesSection';

const stableState: UpdateState = {
  status: 'up-to-date',
  channel: 'stable',
  currentVersion: '0.10.0',
  release: null,
  lastCheckedAt: '2026-10-30T09:00:00Z',
  nextCheckAt: null,
  error: null,
  apply: {
    supported: true,
    reason: null,
    phase: 'idle',
    progress: null,
    error: null,
  },
};

const availableState: UpdateState = {
  status: 'available',
  channel: 'beta',
  currentVersion: '0.10.0',
  release: {
    version: '0.11.0-rc.1',
    tag: 'v0.11.0-rc.1',
    channel: 'beta',
    publishedAt: '2026-10-29T12:00:00Z',
    url: 'https://github.com/neuronection/desktop-assistant/releases/tag/v0.11.0-rc.1',
    excerpt: 'Release candidate for the 0.11.0 line.',
  },
  lastCheckedAt: '2026-10-30T09:00:00Z',
  nextCheckAt: null,
  error: null,
  apply: {
    supported: true,
    reason: null,
    phase: 'idle',
    progress: null,
    error: null,
  },
};

const bridge = {
  getUpdateStatus: vi.fn<() => Promise<UpdateState>>(),
  checkForUpdates: vi.fn<() => Promise<UpdateState>>(),
  applyUpdate: vi.fn<() => Promise<{ ok: boolean; reason?: string }>>(),
  installUpdate: vi.fn<() => Promise<{ ok: boolean }>>(),
  onUpdateProgress: vi.fn<(listener: (progress: { percent: number }) => void) => () => void>(),
  onUpdateState: vi.fn<(listener: (state: UpdateState) => void) => () => void>(),
  openReleasePage: vi.fn<() => Promise<{ success: boolean }>>(),
};

const renderSection = (config = mergeWithDefaults({} as never)) =>
  render(<UpdatesSection config={config} onChange={vi.fn()} />);

async function scanNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
    .join('\n');
  expect(summary).toBe('');
}

describe('UpdatesSection', () => {
  afterEach(cleanup);

  beforeEach(() => {
    bridge.getUpdateStatus.mockReset();
    bridge.checkForUpdates.mockReset();
    bridge.applyUpdate.mockReset();
    bridge.installUpdate.mockReset();
    bridge.openReleasePage.mockReset();
    bridge.onUpdateProgress.mockReset();
    bridge.onUpdateProgress.mockReturnValue(() => undefined);
    bridge.onUpdateState.mockReset();
    bridge.onUpdateState.mockReturnValue(() => undefined);
    window.electronAPI = bridge as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it('shows the up-to-date status and the last-checked time', async () => {
    bridge.getUpdateStatus.mockResolvedValue(stableState);
    renderSection();
    expect(await screen.findByText(TEXT.UPDATE_UP_TO_DATE)).toBeTruthy();
    expect(screen.getByText(/2026/).textContent).toContain(TEXT.UPDATE_LAST_CHECKED.slice(0, 12));
  });

  it('offers an available beta release with a plain-text note and a release link', async () => {
    bridge.getUpdateStatus.mockResolvedValue(availableState);
    renderSection();
    expect(
      await screen.findByText(interpolatePreview(TEXT.UPDATE_AVAILABLE_BETA, 'v0.11.0-rc.1')),
    ).toBeTruthy();
    expect(screen.getByText('Release candidate for the 0.11.0 line.')).toBeTruthy();
    const open = screen.getByRole('button', { name: TEXT.UPDATE_OPEN_RELEASE });
    fireEvent.click(open);
    await waitFor(() => expect(bridge.openReleasePage).toHaveBeenCalledTimes(1));
  });

  it('forces an immediate check from the button', async () => {
    bridge.getUpdateStatus.mockResolvedValue(stableState);
    bridge.checkForUpdates.mockResolvedValue(stableState);
    renderSection();
    const button = await screen.findByRole('button', { name: TEXT.UPDATE_CHECK_NOW });
    fireEvent.click(button);
    await waitFor(() => expect(bridge.checkForUpdates).toHaveBeenCalledTimes(1));
  });

  it('renders the stable channel as selected by default', async () => {
    bridge.getUpdateStatus.mockResolvedValue(stableState);
    renderSection(mergeWithDefaults({} as never));
    expect(await screen.findByText(TEXT.UPDATE_CHANNEL_LABEL)).toBeTruthy();
  });

  it('offers the consent-gated apply for a supported install type', async () => {
    bridge.getUpdateStatus.mockResolvedValue(availableState);
    bridge.applyUpdate.mockResolvedValue({ ok: true });
    renderSection();
    const apply = await screen.findByRole('button', { name: TEXT.UPDATE_APPLY });
    fireEvent.click(apply);
    await waitFor(() => expect(bridge.applyUpdate).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: TEXT.UPDATE_OPEN_RELEASE })).toBeTruthy();
  });

  it('offers a retry after an apply failure', async () => {
    bridge.getUpdateStatus.mockResolvedValue({
      ...availableState,
      apply: { ...availableState.apply, phase: 'error', error: 'checksum unavailable for X' },
    });
    bridge.applyUpdate.mockResolvedValue({ ok: true });
    renderSection();
    expect((await screen.findByRole('alert')).textContent).toBe(TEXT.UPDATE_APPLY_UNVERIFIED);
    const retry = await screen.findByRole('button', { name: TEXT.UPDATE_RETRY });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(bridge.applyUpdate).toHaveBeenCalledTimes(1));
  });

  it('does not claim up to date before the first check', async () => {
    bridge.getUpdateStatus.mockResolvedValue({ ...stableState, status: 'idle', lastCheckedAt: null });
    renderSection();
    expect(await screen.findByText(TEXT.UPDATE_NOT_CHECKED)).toBeTruthy();
    expect(screen.queryByText(TEXT.UPDATE_UP_TO_DATE)).toBeNull();
  });

  it('shows a bounded message instead of a raw version-API error', async () => {
    bridge.getUpdateStatus.mockResolvedValue({
      ...stableState,
      status: 'error',
      error: 'version API 404 for desktop-assistant',
    });
    renderSection();
    expect(await screen.findByText(TEXT.UPDATE_CHECK_UNREACHABLE)).toBeTruthy();
    expect(screen.queryByText(/version API 404/)).toBeNull();
  });

  it('summarises a verification failure without exposing the raw reason', async () => {
    bridge.getUpdateStatus.mockResolvedValue({
      ...availableState,
      apply: { ...availableState.apply, phase: 'error', error: 'download-failed: checksum unavailable for X' },
    });
    renderSection();
    expect((await screen.findByRole('alert')).textContent).toBe(TEXT.UPDATE_APPLY_UNVERIFIED);
    expect(screen.queryByText(/checksum unavailable/)).toBeNull();
  });

  it('stays live from the main-process update state push', async () => {
    let push: ((state: UpdateState) => void) | null = null;
    bridge.onUpdateState.mockImplementation((listener) => {
      push = listener;
      return () => undefined;
    });
    bridge.getUpdateStatus.mockResolvedValue(stableState);
    renderSection();
    await screen.findByText(TEXT.UPDATE_UP_TO_DATE);
    act(() => push?.(availableState));
    expect(await screen.findByText(TEXT.UPDATE_AVAILABLE_BETA.replace('{version}', 'v0.11.0-rc.1'))).toBeTruthy();
  });

  it('is axe-clean', async () => {
    bridge.getUpdateStatus.mockResolvedValue(availableState);
    const { container } = renderSection();
    await screen.findByRole('status');
    await scanNoViolations(container);
  });
});

function interpolatePreview(template: string, version: string): string {
  return template.replace('{version}', version);
}
