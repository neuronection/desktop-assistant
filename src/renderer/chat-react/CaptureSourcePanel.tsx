import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { AppWindow, Crop, Monitor } from 'lucide-react';
import type { CaptureSourceList, CaptureSourceRow } from '@shared/capture';
import { TEXT } from '@shared/constants/text';
import { useLatestRef } from './useLatestRef';

export type CaptureRowChoice =
  | { kind: 'source'; id: string }
  | { kind: 'region' };

export interface CaptureSourcePanelProps {
  onSelect: (choice: CaptureRowChoice) => void;
  onClose: () => void;
}

/**
 * The capture picker, in flow above the composer (plan 80 follow-up).
 *
 * Native-first: the rows are what the OS actually reports — screens always,
 * windows when the platform lists them, and a region row only when a native
 * region tool exists. No frozen screen, no custom full-screen surface.
 */
export function CaptureSourcePanel({ onSelect, onClose }: CaptureSourcePanelProps): JSX.Element {
  const [list, setList] = useState<CaptureSourceList | null>(null);
  const closeRef = useLatestRef(onClose);
  const firstRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [closeRef]);

  useEffect(() => {
    let cancelled = false;
    const load = window.electronAPI?.getCaptureSources;
    if (typeof load !== 'function') {
      setList({ screens: [], windows: [], region: false });
      return undefined;
    }
    void load
      .call(window.electronAPI)
      .then((sources) => {
        if (!cancelled) {
          setList(sources);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setList({ screens: [], windows: [], region: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    firstRef.current?.focus();
  }, [list]);

  const rows = (entries: CaptureSourceRow[], Icon: typeof Monitor): JSX.Element[] =>
    entries.map((row) => (
      <button
        key={row.id}
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--as-secondary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--as-primary)]"
        onClick={() => onSelect({ kind: 'source', id: row.id })}
      >
        {row.icon ? (
          <img src={row.icon} alt="" className="size-4 shrink-0 rounded-sm" />
        ) : (
          <Icon className="size-4 shrink-0 opacity-60" aria-hidden />
        )}
        <span className="truncate">{row.name}</span>
      </button>
    ));

  const empty = list && list.screens.length === 0 && list.windows.length === 0 && !list.region;

  return (
    <div
      role="menu"
      aria-label={TEXT.CAPTURE_PANEL_LABEL}
      className="mb-2 max-h-64 overflow-y-auto rounded-xl border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-1.5"
      data-testid="capture-source-panel"
    >
      {!list && <p className="px-2 py-1.5 text-sm opacity-60">{TEXT.CAPTURE_WAITING}</p>}
      {empty && <p className="px-2 py-1.5 text-sm opacity-60">{TEXT.CAPTURE_UNAVAILABLE}</p>}

      {list?.region && (
        <button
          ref={firstRef}
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--as-secondary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--as-primary)]"
          onClick={() => onSelect({ kind: 'region' })}
        >
          <Crop className="size-4 shrink-0 opacity-60" aria-hidden />
          <span>{TEXT.CAPTURE_PANEL_REGION}</span>
          <span className="ml-auto text-[11px] opacity-50">{TEXT.CAPTURE_PANEL_NATIVE}</span>
        </button>
      )}

      {list && list.screens.length > 0 && (
        <>
          <p className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide opacity-50">
            {TEXT.CAPTURE_PANEL_SCREENS}
          </p>
          {rows(list.screens, Monitor)}
        </>
      )}

      {list && list.windows.length > 0 && (
        <>
          <p className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide opacity-50">
            {TEXT.CAPTURE_PANEL_WINDOWS}
          </p>
          {rows(list.windows, AppWindow)}
        </>
      )}
    </div>
  );
}
