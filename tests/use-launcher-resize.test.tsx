// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useLauncherResize } from '@renderer/chat-react/useLauncherResize';
import { LAUNCHER_RESIZE_SETTLE_MS } from '@renderer/chat-react/launcherResize';
import { WINDOW_SIZE } from '@shared/constants/window';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('useLauncherResize', () => {
  let resizeWindow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cleanup();
    resizeWindow = vi.fn();
    window.electronAPI = { resizeWindow } as unknown as typeof window.electronAPI;
  });

  it('coalesces growth into one native request per frame', async () => {
    const { result } = renderHook(() => useLauncherResize());
    act(() => result.current.request(300, { streaming: true }));
    await waitFor(() => expect(resizeWindow).toHaveBeenCalledWith(WINDOW_SIZE.COMPACT_WIDTH, 300));
    expect(resizeWindow).toHaveBeenCalledTimes(1);
  });

  it('never shrinks while streaming and shrinks after the settle window', async () => {
    const { result } = renderHook(() => useLauncherResize());
    act(() => result.current.resizeNow(300));
    expect(resizeWindow).toHaveBeenLastCalledWith(WINDOW_SIZE.COMPACT_WIDTH, 300);

    act(() => result.current.request(200, { streaming: true }));
    await wait(LAUNCHER_RESIZE_SETTLE_MS + 40);
    expect(resizeWindow).toHaveBeenLastCalledWith(WINDOW_SIZE.COMPACT_WIDTH, 300);

    act(() => result.current.request(200, { streaming: false, deferShrink: true }));
    await wait(LAUNCHER_RESIZE_SETTLE_MS / 2);
    expect(resizeWindow).toHaveBeenLastCalledWith(WINDOW_SIZE.COMPACT_WIDTH, 300);

    await waitFor(() => expect(resizeWindow).toHaveBeenLastCalledWith(WINDOW_SIZE.COMPACT_WIDTH, 200), { timeout: 1000 });
  });

  it('drops an identical target', () => {
    const { result } = renderHook(() => useLauncherResize());
    act(() => result.current.request(300, { streaming: false }));
    expect(resizeWindow).toHaveBeenCalledTimes(1);
    act(() => result.current.request(300, { streaming: false }));
    expect(resizeWindow).toHaveBeenCalledTimes(1);
  });

  it('re-fits after a manual drag owned the window', () => {
    const { result } = renderHook(() => useLauncherResize());
    act(() => result.current.resizeNow(300));
    act(() => result.current.cancel());
    act(() => result.current.request(250, { streaming: false }));
    expect(resizeWindow).toHaveBeenLastCalledWith(WINDOW_SIZE.COMPACT_WIDTH, 250);
    expect(resizeWindow).toHaveBeenCalledTimes(2);
  });
});
