import { useCallback, type PointerEvent as ReactPointerEvent } from 'react';

const DRAG_EXCLUDE = 'button, input, textarea, select, a, [role="button"], [data-no-drag]';

/**
 * Pointer-driven window drag for the chat panel header — a fallback for
 * platforms where `-webkit-app-region: drag` is unreliable (frameless
 * windows with native resize disabled). Only pointer-downs inside the
 * header background start a drag; buttons and inputs stay clickable.
 */
export function useWindowHeaderDrag(): (event: ReactPointerEvent) => void {
  return useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (!target.closest('[data-as="chat-panel-header"]')) {
      return;
    }
    if (target.closest(DRAG_EXCLUDE)) {
      return;
    }
    event.preventDefault();

    let lastX = event.clientX;
    let lastY = event.clientY;
    const onMove = (move: PointerEvent): void => {
      const dx = move.clientX - lastX;
      const dy = move.clientY - lastY;
      lastX = move.clientX;
      lastY = move.clientY;
      if (dx !== 0 || dy !== 0) {
        void window.electronAPI.moveWindowBy(dx, dy);
      }
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);
}
