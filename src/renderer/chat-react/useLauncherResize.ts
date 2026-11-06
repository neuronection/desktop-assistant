import { useCallback, useEffect, useRef } from 'react';
import { WINDOW_SIZE } from '@shared/constants/window';
import {
  LAUNCHER_RESIZE_SETTLE_MS,
  planLauncherResize,
  quantizeLauncherHeight,
} from './launcherResize';

export interface LauncherResizeRequest {
  streaming: boolean;
  deferShrink?: boolean;
  width?: number;
}

export interface LauncherResizeController {
  request: (height: number, options: LauncherResizeRequest) => void;
  resizeNow: (height: number, width?: number) => void;
  cancel: () => void;
}

interface SentSize {
  width: number;
  height: number;
}

export function useLauncherResize(): LauncherResizeController {
  const sentSizeRef = useRef<SentSize | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingHeightRef = useRef<number | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleHeightRef = useRef<number | null>(null);

  const cancelFrame = useCallback((): void => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    pendingHeightRef.current = null;
  }, []);

  const cancelSettle = useCallback((): void => {
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    settleHeightRef.current = null;
  }, []);

  const commit = useCallback((height: number, width: number = WINDOW_SIZE.COMPACT_WIDTH): void => {
    const next = { width, height: quantizeLauncherHeight(height) };
    const sent = sentSizeRef.current;
    if (sent !== null && sent.width === next.width && sent.height === next.height) {
      return;
    }
    sentSizeRef.current = next;
    void window.electronAPI.resizeWindow(next.width, next.height);
  }, []);

  const resizeNow = useCallback(
    (height: number, width: number = WINDOW_SIZE.COMPACT_WIDTH): void => {
      cancelFrame();
      cancelSettle();
      commit(height, width);
    },
    [cancelFrame, cancelSettle, commit]
  );

  const flushFrame = useCallback((): void => {
    frameRef.current = null;
    const height = pendingHeightRef.current;
    pendingHeightRef.current = null;
    if (height !== null) {
      commit(height);
    }
  }, [commit]);

  const request = useCallback(
    (height: number, options: LauncherResizeRequest): void => {
      const current = sentSizeRef.current;
      if (current === null) {
        resizeNow(height, options.width);
        return;
      }

      const planned = planLauncherResize(current.height, height, options.streaming);
      if (planned > current.height) {
        cancelSettle();
        pendingHeightRef.current = planned;
        if (frameRef.current === null) {
          frameRef.current = requestAnimationFrame(flushFrame);
        }
        return;
      }
      if (planned < current.height) {
        cancelFrame();
        if (!options.deferShrink) {
          resizeNow(planned, options.width);
          return;
        }
        cancelSettle();
        settleHeightRef.current = planned;
        settleTimerRef.current = setTimeout(() => {
          settleTimerRef.current = null;
          const settled = settleHeightRef.current;
          settleHeightRef.current = null;
          if (settled !== null) {
            commit(settled, options.width);
          }
        }, LAUNCHER_RESIZE_SETTLE_MS);
        return;
      }

      if (!options.streaming) {
        cancelSettle();
      }
    },
    [cancelFrame, cancelSettle, commit, flushFrame, resizeNow]
  );

  const cancel = useCallback((): void => {
    cancelFrame();
    cancelSettle();
    sentSizeRef.current = null;
  }, [cancelFrame, cancelSettle]);

  useEffect(() => () => cancel(), [cancel]);

  return { request, resizeNow, cancel };
}
