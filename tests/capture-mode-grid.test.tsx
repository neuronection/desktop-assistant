// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import type { CaptureCapabilitiesLike, CaptureSourceList } from '@shared/capture';
import { CaptureSourcePanel, resetCapturePanelCache } from '@renderer/chat-react/CaptureSourcePanel';
import { TEXT } from '@shared/constants/text';

beforeEach(() => {
  resetCapturePanelCache();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function caps(overrides: Partial<CaptureCapabilitiesLike> & { ocr?: Partial<CaptureCapabilitiesLike['ocr']> } = {}): CaptureCapabilitiesLike {
  return {
    platform: 'linux',
    egress: 'off',
    region: true,
    screens: 2,
    ocr: { local: true, model: false, allowed: false, egress: 'off', ...overrides.ocr },
    ...overrides,
  } as CaptureCapabilitiesLike;
}

function sources(overrides: Partial<CaptureSourceList> = {}): CaptureSourceList {
  return {
    screens: [
      { id: 'screen:1:0', name: 'Screen 1', kind: 'screen', displayId: 1 },
      { id: 'screen:2:0', name: 'Screen 2', kind: 'screen', displayId: 2 },
    ],
    windows: [
      { id: 'window:0x1:0', name: 'GitHub — Firefox', kind: 'window', icon: 'data:image/png;base64,AA' },
      { id: 'window:0x2:0', name: 'main.ts — Code', kind: 'window' },
    ],
    region: true,
    ...overrides,
  };
}

function mockApi(options: { caps?: CaptureCapabilitiesLike; sources?: CaptureSourceList; pendingCaps?: boolean } = {}) {
  const getCaptureCapabilities = options.pendingCaps
    ? vi.fn(() => new Promise<CaptureCapabilitiesLike>(() => undefined))
    : vi.fn(async () => options.caps ?? caps());
  const getCaptureSources = vi.fn(async () => options.sources ?? sources());
  window.electronAPI = { getCaptureCapabilities, getCaptureSources } as unknown as typeof window.electronAPI;
  return { getCaptureCapabilities, getCaptureSources };
}

async function open(): Promise<{ onSelect: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> }> {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <main>
      <CaptureSourcePanel onSelect={onSelect} onClose={onClose} />
    </main>
  );
  await screen.findByTestId('capture-source-panel');
  return { onSelect, onClose };
}

describe('capture mode grid', () => {
  it('paints every tile on the first frame, before the capability probe returns', async () => {
    mockApi({ pendingCaps: true });
    await open();
    for (const label of [
      TEXT.CAPTURE_TILE_TEXT,
      TEXT.CAPTURE_TILE_REGION,
      TEXT.CAPTURE_TILE_WINDOW,
      TEXT.CAPTURE_TILE_SCREEN,
      TEXT.CAPTURE_TILE_DISPLAY,
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText(TEXT.CAPTURE_PANEL_CHECKING)).toBeTruthy();
  });

  it('never enumerates windows or screens just to open the grid', async () => {
    const api = mockApi();
    await open();
    await waitFor(() => expect(api.getCaptureCapabilities).toHaveBeenCalledTimes(1));
    expect(api.getCaptureSources).not.toHaveBeenCalled();
  });

  it('enables region and display immediately and disables text until an engine is known', async () => {
    mockApi({ pendingCaps: true });
    await open();
    expect((screen.getByText(TEXT.CAPTURE_TILE_REGION).closest('button') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText(TEXT.CAPTURE_TILE_DISPLAY).closest('button') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText(TEXT.CAPTURE_TILE_TEXT).closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Text and Rectangle with a reason when the machine cannot do them', async () => {
    mockApi({ caps: caps({ region: false, ocr: { local: false, model: false, allowed: false } }) });
    await open();
    await waitFor(() =>
      expect((screen.getByText(TEXT.CAPTURE_TILE_REGION).closest('button') as HTMLButtonElement).disabled).toBe(true)
    );
    const textTile = screen.getByText(TEXT.CAPTURE_TILE_TEXT).closest('button') as HTMLButtonElement;
    expect(textTile.disabled).toBe(true);
    expect(textTile.getAttribute('title')).toBe(TEXT.CAPTURE_REGION_UNAVAILABLE);
  });

  it('disables Text when the only engine is blocked by the egress policy', async () => {
    mockApi({ caps: caps({ ocr: { local: false, model: true, allowed: false } }) });
    await open();
    await waitFor(() => expect(screen.getByText(TEXT.CAPTURE_TILE_TEXT_UNAVAILABLE)).toBeTruthy());
  });

  it('runs the region, text and display tiles directly', async () => {
    mockApi();
    const { onSelect } = await open();
    await waitFor(() =>
      expect((screen.getByText(TEXT.CAPTURE_TILE_TEXT).closest('button') as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(screen.getByText(TEXT.CAPTURE_TILE_REGION));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'region' });
    fireEvent.click(screen.getByText(TEXT.CAPTURE_TILE_TEXT));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'text' });
    fireEvent.click(screen.getByText(TEXT.CAPTURE_TILE_DISPLAY));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'display' });
  });

  it('loads the window list only when drilled into, and caches it for the session', async () => {
    const api = mockApi();
    const { onSelect } = await open();
    fireEvent.click(screen.getByText(TEXT.CAPTURE_TILE_WINDOW));
    const row = await screen.findByRole('menuitem', { name: /GitHub — Firefox/ });
    expect(api.getCaptureSources).toHaveBeenCalledTimes(1);
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'source', id: 'window:0x1:0' });

    cleanup();
    const second = await open();
    fireEvent.click(screen.getByText(TEXT.CAPTURE_TILE_WINDOW));
    await screen.findByRole('menuitem', { name: /GitHub — Firefox/ });
    expect(api.getCaptureSources).toHaveBeenCalledTimes(1);
    expect(second.onSelect).not.toHaveBeenCalled();
  });

  it('drills back to the grid and closes on Escape', async () => {
    mockApi();
    const { onClose } = await open();
    fireEvent.click(screen.getByText(TEXT.CAPTURE_TILE_SCREEN));
    await screen.findByRole('menuitem', { name: /Screen 1/ });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(TEXT.CAPTURE_TILE_DISPLAY)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is axe clean', async () => {
    mockApi();
    await open();
    await waitFor(() => expect(screen.queryByText(TEXT.CAPTURE_PANEL_CHECKING)).toBeNull());
    expect((await axe.run(document.body)).violations).toEqual([]);
  });
});
