// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, act, fireEvent, render, screen } from '@testing-library/react';
import type { CaptureOverlaySession } from '@shared/capture';
import { CaptureOverlayApp } from '@renderer/capture-overlay-react/CaptureOverlayApp';

const commitCapture = vi.fn(async () => true);
const cancelCapture = vi.fn(async () => true);
const captureOverlayReady = vi.fn();
let emitSession: ((session: CaptureOverlaySession) => void) | null = null;

const session: CaptureOverlaySession = {
  sessionId: 'capture-1',
  display: { id: 1, width: 1000, height: 800, scaleFactor: 2 },
  preview: 'data:image/jpeg;base64,AAAA',
  windows: [
    { title: 'GitHub — Firefox', app: 'firefox', rect: { x: 100, y: 80, width: 400, height: 300 } },
    { title: 'main.ts — Code', app: 'code', rect: { x: 20, y: 20, width: 900, height: 700 } },
  ],
  armed: { title: 'GitHub — Firefox', app: 'firefox', rect: { x: 100, y: 80, width: 400, height: 300 } },
  hint: 'Click a window · drag a region · double-click for the whole screen',
};

beforeEach(() => {
  emitSession = null;
  window.electronAPI = {
    onCaptureSession: (callback: (payload: unknown) => void) => {
      emitSession = (next) => callback(next);
      return () => undefined;
    },
    captureOverlayReady,
    commitCapture,
    cancelCapture,
  } as unknown as typeof window.electronAPI;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mount(): void {
  render(<CaptureOverlayApp />);
  act(() => {
    emitSession?.(session);
  });
}

function pointer(target: Element, type: string, x: number, y: number): void {
  fireEvent.pointerDown === undefined
    ? fireEvent.mouseDown(target, { clientX: x, clientY: y })
    : fireEvent.pointerDown(target, { clientX: x, clientY: y, button: 0, pointerId: 1 });
}

function pointerUp(target: Element, x: number, y: number): void {
  fireEvent.pointerUp(target, { clientX: x, clientY: y, button: 0, pointerId: 1 });
}

function pointerMove(target: Element, x: number, y: number): void {
  fireEvent.pointerMove(target, { clientX: x, clientY: y, pointerId: 1 });
}

describe('capture overlay', () => {
  it('signals ready and renders the frozen frame with the armed target', () => {
    mount();
    expect(captureOverlayReady).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('firefox — GitHub — Firefox')).toBeTruthy();
  });

  it('commits the armed window on a plain click', () => {
    mount();
    const root = screen.getByRole('dialog');
    pointer(root, 'pointerdown', 200, 200);
    pointerUp(root, 201, 200);
    expect(commitCapture).toHaveBeenCalledWith({ kind: 'window', window: session.armed });
  });

  it('commits a dragged region in display-local DIP', () => {
    mount();
    const root = screen.getByRole('dialog');
    pointer(root, 'pointerdown', 40, 30);
    pointerMove(root, 240, 130);
    pointerUp(root, 240, 130);
    expect(commitCapture).toHaveBeenCalledWith({
      kind: 'region',
      rect: { x: 40, y: 30, width: 200, height: 100 },
    });
  });

  it('commits the display on a double click', () => {
    mount();
    fireEvent.doubleClick(screen.getByRole('dialog'));
    expect(commitCapture).toHaveBeenCalledWith({ kind: 'display' });
  });

  it('cancels on Escape and on right-click, without committing', () => {
    mount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cancelCapture).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(document);
    expect(cancelCapture).toHaveBeenCalledTimes(1);
    expect(commitCapture).not.toHaveBeenCalled();
  });

  it('commits the armed target with Enter and never twice', () => {
    mount();
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(commitCapture).toHaveBeenCalledTimes(1);
    expect(commitCapture).toHaveBeenCalledWith({ kind: 'window', window: session.armed });
  });

  it('keeps a previous region when Adjust re-arms it and the user just clicks', () => {
    render(<CaptureOverlayApp />);
    act(() => {
      emitSession?.({
        ...session,
        armed: null,
        initialRect: { x: 10, y: 10, width: 300, height: 200 },
      });
    });
    expect(screen.getByText('Region 300×200')).toBeTruthy();
    const root = screen.getByRole('dialog');
    pointer(root, 'pointerdown', 960, 760);
    pointerUp(root, 961, 760);
    expect(commitCapture).toHaveBeenCalledWith({
      kind: 'region',
      rect: { x: 10, y: 10, width: 300, height: 200 },
    });
  });
});
