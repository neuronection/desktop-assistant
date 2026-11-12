import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  hitTestWindows,
  normalizeRect,
  regionLabel,
  selectionFromGesture,
  windowLabel,
  type CaptureOverlaySession,
  type CapturePoint,
  type CaptureSelection,
  type CaptureWindowRect,
} from '@shared/capture';
import { TEXT, interpolate } from '@shared/constants/text';
import { useLatestRef } from '@renderer/chat-react/useLatestRef';

interface DragState {
  start: CapturePoint;
  current: CapturePoint;
  startedAt: number;
}

function pointOf(event: ReactPointerEvent<HTMLDivElement>): CapturePoint {
  return { x: event.clientX, y: event.clientY };
}

/**
 * The frozen-frame overlay (plan 80, D2). Everything is display-local DIP: the
 * window covers exactly one display, so `clientX/Y` needs no conversion.
 *
 * Click = the armed/hovered window · drag = a region · double-click = the
 * display · Enter = the armed target · Esc / right-click = nothing happened.
 */
export function CaptureOverlayApp(): JSX.Element {
  const [session, setSession] = useState<CaptureOverlaySession | null>(null);
  const [hover, setHover] = useState<CaptureWindowRect | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const committed = useRef(false);

  const sessionRef = useLatestRef(session);
  const hoverRef = useLatestRef(hover);
  const dragRef = useLatestRef(drag);

  const commit = useCallback((selection: CaptureSelection): void => {
    if (committed.current) {
      return;
    }
    committed.current = true;
    void window.electronAPI.commitCapture(selection);
  }, []);

  const cancel = useCallback((): void => {
    if (committed.current) {
      return;
    }
    committed.current = true;
    void window.electronAPI.cancelCapture();
  }, []);

  useLayoutEffect(() => {
    const unsubscribe = window.electronAPI.onCaptureSession((payload) => {
      const next = payload as CaptureOverlaySession | undefined;
      if (!next) {
        return;
      }
      committed.current = false;
      setHover(null);
      setDrag(null);
      setSession(next);
    });
    window.electronAPI.captureOverlayReady();
    return () => {
      unsubscribe();
    };
  }, []);

  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (committed.current) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (event.key === 'Enter') {
        const current = sessionRef.current;
        const target = hoverRef.current ?? current?.armed ?? null;
        event.preventDefault();
        if (target) {
          commit({ kind: 'window', window: target });
          return;
        }
        if (current?.initialRect) {
          commit({ kind: 'region', rect: current.initialRect });
          return;
        }
        commit({ kind: 'display' });
      }
    };
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      cancel();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [cancel, commit, sessionRef, hoverRef]);

  const windows = session?.windows ?? [];

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom has no pointer capture; the real window always does.
    }
    const point = pointOf(event);
    setDrag({ start: point, current: point, startedAt: Date.now() });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const point = pointOf(event);
    if (dragRef.current) {
      setDrag({ ...dragRef.current, current: point });
      return;
    }
    setHover(hitTestWindows(windows, point));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = dragRef.current;
    if (!state) {
      return;
    }
    const end = pointOf(event);
    setDrag(null);
    const hovered = hitTestWindows(windows, end) ?? hoverRef.current;
    const selection = selectionFromGesture({
      start: state.start,
      end,
      durationMs: Date.now() - state.startedAt,
      hovered,
    });
    if (selection.kind === 'display' && session?.initialRect) {
      commit({ kind: 'region', rect: session.initialRect });
      return;
    }
    commit(selection);
  };

  const selectionRect = drag
    ? normalizeRect(drag.start, drag.current)
    : hover?.rect ?? session?.initialRect ?? session?.armed?.rect ?? null;
  const label = drag
    ? interpolate(TEXT.CAPTURE_OVERLAY_SIZE, {
        width: Math.round(normalizeRect(drag.start, drag.current).width),
        height: Math.round(normalizeRect(drag.start, drag.current).height),
      })
    : hover
      ? windowLabel(hover)
      : session?.initialRect
        ? regionLabel(session.initialRect)
        : session?.armed
          ? windowLabel(session.armed)
          : null;

  const pillInside = selectionRect ? selectionRect.y < 26 : false;

  return (
    <div
      className="capture-root"
      role="dialog"
      aria-modal="true"
      aria-label={TEXT.CAPTURE_OVERLAY_LABEL}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => commit({ kind: 'display' })}
    >
      {session && <img className="capture-frame" src={session.preview} alt="" draggable={false} />}
      {session && !selectionRect && <div className="capture-dim" />}
      {selectionRect && (
        <div
          className="capture-selection"
          style={{
            left: Math.round(selectionRect.x),
            top: Math.round(selectionRect.y),
            width: Math.max(1, Math.round(selectionRect.width)),
            height: Math.max(1, Math.round(selectionRect.height)),
          }}
        >
          {label && (
            <span className={pillInside ? 'capture-label capture-label--inside' : 'capture-label'}>{label}</span>
          )}
        </div>
      )}
      <div className="capture-hint">
        <span>{session?.hint ?? TEXT.CAPTURE_OVERLAY_HINT}</span>
        <kbd>Esc</kbd>
      </div>
    </div>
  );
}
