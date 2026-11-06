import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

const DRAG_THRESHOLD_PX = 4;

/**
 * Pointer drag for the HUD window (plan 58 addendum). A move past the
 * threshold becomes a window drag (main clamps/snaps and persists on drop);
 * anything shorter stays a click, so a knob body can pause and drag.
 */
export function useHudDrag(): {
  dragProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  consumeDrag: () => boolean;
} {
  const origin = useRef<{ x: number; y: number } | null>(null);
  const startScreen = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const dragged = useRef(false);

  useEffect(() => {
    const cancel = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !dragging.current) {
        return;
      }
      event.preventDefault();
      window.electronAPI?.cancelSpeechHudDrag?.();
      origin.current = null;
      startScreen.current = null;
      dragging.current = false;
      dragged.current = false;
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);

  const finish = (): void => {
    if (dragging.current) {
      window.electronAPI?.endSpeechHudDrag?.();
    }
    origin.current = null;
    startScreen.current = null;
    dragging.current = false;
  };

  return {
    dragProps: {
      onPointerDown: (event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest?.('.sh-actions')) {
          return;
        }
        origin.current = { x: event.screenX, y: event.screenY };
        startScreen.current = { x: event.screenX, y: event.screenY };
        dragging.current = false;
        dragged.current = false;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove: (event) => {
        if (!origin.current) {
          return;
        }
        const dx = event.screenX - origin.current.x;
        const dy = event.screenY - origin.current.y;
        if (!dragging.current && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
          dragging.current = true;
          dragged.current = true;
          if (startScreen.current) {
            window.electronAPI?.beginSpeechHudDrag?.(startScreen.current.x, startScreen.current.y);
          }
        }
        if (dragging.current) {
          window.electronAPI?.moveSpeechHudDrag?.(event.screenX, event.screenY);
        }
      },
      onPointerUp: (event) => {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }
        finish();
      },
      onPointerCancel: () => finish(),
    },
    consumeDrag: () => {
      const wasDragged = dragged.current;
      dragged.current = false;
      return wasDragged;
    },
  };
}
