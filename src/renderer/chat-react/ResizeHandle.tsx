import { useCallback, useRef, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type { ResizeCorner } from '@shared/types';

const CORNER_CLASSES: Record<ResizeCorner, string> = {
  'bottom-right': 'bottom-0 right-0 cursor-nwse-resize',
  'bottom-left': 'bottom-0 left-0 cursor-nesw-resize',
};

export function ResizeHandle({ corner, onResizeStart }: { corner: ResizeCorner; onResizeStart?: () => void }): JSX.Element {
  const draggingRef = useRef(false);
  const originRef = useRef({ x: 0, y: 0 });
  const pendingRef = useRef<{ dx: number; dy: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback((): void => {
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) {
      void window.electronAPI.resizeCornerUpdate(pending.dx, pending.dy);
    }
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      draggingRef.current = true;
      originRef.current = { x: event.screenX, y: event.screenY };
      event.currentTarget.setPointerCapture(event.pointerId);
      onResizeStart?.();
      void window.electronAPI.resizeCornerStart(corner);
    },
    [corner, onResizeStart]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!draggingRef.current) {
        return;
      }
      pendingRef.current = { dx: event.screenX - originRef.current.x, dy: event.screenY - originRef.current.y };
      if (timerRef.current === null) {
        timerRef.current = setTimeout(flush, 16);
      }
    },
    [flush]
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!draggingRef.current) {
        return;
      }
      draggingRef.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flush();
      void window.electronAPI.resizeCornerEnd();
    },
    [flush]
  );

  return (
    <div
      data-no-drag
      aria-hidden={true}
      data-testid={`window-resize-handle-${corner}`}
      className={`absolute z-50 h-5 w-5 touch-none ${CORNER_CLASSES[corner]}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}
