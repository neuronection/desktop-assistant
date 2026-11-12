import { useEffect, useLayoutEffect, useMemo, useState, type JSX } from 'react';
import { ArrowLeft, AppWindow, Crop, Monitor, MonitorUp, ScanText } from 'lucide-react';
import type { CaptureCapabilitiesLike, CaptureSourceRow } from '@shared/capture';
import { TEXT } from '@shared/constants/text';
import { useLatestRef } from './useLatestRef';

/** What a tile stands for; the app maps it to a capture request. */
export type CaptureChoice =
  | { kind: 'text' }
  | { kind: 'region' }
  | { kind: 'display' }
  | { kind: 'source'; id: string };

export interface CaptureSourcePanelProps {
  onSelect: (choice: CaptureChoice) => void;
  onClose: () => void;
}

type Step = 'grid' | 'windows' | 'screens';

/**
 * Cheap, session-scoped cache: the grid must paint on the frame it opens.
 * Probes are cached main-side too, so this only avoids a round trip.
 */
let capabilitiesCache: CaptureCapabilitiesLike | null = null;
let sourcesCache: { at: number; windows: CaptureSourceRow[]; screens: CaptureSourceRow[] } | null = null;
const SOURCES_TTL_MS = 20_000;

export function resetCapturePanelCache(): void {
  capabilitiesCache = null;
  sourcesCache = null;
}

/**
 * The capture mode grid (plan 82 S3): five modes today (Freeform joins with
 * plan 81 S5). Tiles never appear/disappear — an unknown or unsupported mode
 * is disabled with its reason, so the panel cannot reflow under the pointer
 * and opening it never waits on `desktopCapturer`. Window and screen lists are
 * fetched only when a tile is drilled into.
 */
export function CaptureSourcePanel({ onSelect, onClose }: CaptureSourcePanelProps): JSX.Element {
  const [caps, setCaps] = useState<CaptureCapabilitiesLike | null>(capabilitiesCache);
  const [step, setStep] = useState<Step>('grid');
  const [rows, setRows] = useState<{ windows: CaptureSourceRow[]; screens: CaptureSourceRow[] } | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const closeRef = useLatestRef(onClose);

  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (step !== 'grid') {
        setStep('grid');
        return;
      }
      closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [closeRef, step]);

  useEffect(() => {
    if (capabilitiesCache) {
      return undefined;
    }
    let cancelled = false;
    void window.electronAPI
      ?.getCaptureCapabilities?.()
      .then((next) => {
        if (!cancelled && next) {
          capabilitiesCache = next;
          setCaps(next);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRows = (): void => {
    if (sourcesCache && Date.now() - sourcesCache.at < SOURCES_TTL_MS) {
      setRows({ windows: sourcesCache.windows, screens: sourcesCache.screens });
      return;
    }
    setLoadingRows(true);
    void window.electronAPI
      ?.getCaptureSources?.()
      .then((list) => {
        sourcesCache = { at: Date.now(), windows: list.windows, screens: list.screens };
        setRows({ windows: list.windows, screens: list.screens });
      })
      .catch(() => setRows({ windows: [], screens: [] }))
      .finally(() => setLoadingRows(false));
  };

  const ocrReady = caps?.ocr.local === true || (caps?.ocr.model === true && caps.ocr.allowed);
  const regionReady = caps ? caps.region : true;
  const textReady = regionReady && ocrReady;
  const checking = caps === null;

  const tiles = useMemo(
    () => [
      ...(textReady
        ? [
            {
              id: 'text' as const,
              label: TEXT.CAPTURE_TILE_TEXT,
              hint: TEXT.CAPTURE_TILE_TEXT_HINT,
              icon: ScanText,
            },
          ]
        : []),
      ...(regionReady
        ? [
            {
              id: 'region' as const,
              label: TEXT.CAPTURE_TILE_REGION,
              hint: TEXT.CAPTURE_TILE_REGION_HINT,
              icon: Crop,
            },
          ]
        : []),
      {
        id: 'window' as const,
        label: TEXT.CAPTURE_TILE_WINDOW,
        hint: TEXT.CAPTURE_TILE_WINDOW_HINT,
        icon: AppWindow,
      },
      ...(caps === null || caps.screens > 1
        ? [
            {
              id: 'screen' as const,
              label: TEXT.CAPTURE_TILE_SCREEN,
              hint: TEXT.CAPTURE_TILE_SCREEN_HINT,
              icon: Monitor,
            },
          ]
        : []),
      {
        id: 'display' as const,
        label: TEXT.CAPTURE_TILE_DISPLAY,
        hint: TEXT.CAPTURE_TILE_DISPLAY_HINT,
        icon: MonitorUp,
      },
    ],
    [caps, regionReady, textReady]
  );

  const listed = (step === 'windows' ? rows?.windows ?? [] : rows?.screens ?? []).map((row) => (
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
        <AppWindow className="size-4 shrink-0 opacity-60" aria-hidden />
      )}
      <span className="truncate">{row.name}</span>
    </button>
  ));

  return (
    <div
      role="menu"
      aria-label={TEXT.CAPTURE_PANEL_LABEL}
      className="mb-2 max-h-64 overflow-y-auto rounded-xl border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-1.5"
      data-testid="capture-source-panel"
      aria-busy={checking ? 'true' : 'false'}
    >
      {step === 'grid' && checking && (
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={TEXT.CAPTURE_PANEL_LABEL} aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((cell) => (
            <span key={cell} className="h-16 animate-pulse rounded-lg bg-[var(--as-secondary)] opacity-40" />
          ))}
        </div>
      )}

      {step === 'grid' && !checking && (
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={TEXT.CAPTURE_PANEL_LABEL}>
          {tiles.map((tile, index) => {
            const Icon = tile.icon;
            return (
              <button
                key={tile.id}
                type="button"
                role="menuitem"
                autoFocus={index === 0}
                title={tile.hint}
                className="flex h-16 flex-col items-start justify-center gap-1 rounded-lg border border-transparent px-2 text-left transition-colors hover:border-[var(--as-border)] hover:bg-[var(--as-secondary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--as-primary)]"
                onClick={() => {
                  if (tile.id === 'window' || tile.id === 'screen') {
                    setStep(tile.id === 'window' ? 'windows' : 'screens');
                    loadRows();
                    return;
                  }
                  if (tile.id === 'text') {
                    onSelect({ kind: 'text' });
                    return;
                  }
                  if (tile.id === 'region') {
                    onSelect({ kind: 'region' });
                    return;
                  }
                  onSelect({ kind: 'display' });
                }}
              >
                <Icon className="size-4 opacity-70" aria-hidden />
                <span className="text-xs font-medium">{tile.label}</span>
                <span className="w-full truncate text-[10px] opacity-55">{tile.hint}</span>
              </button>
            );
          })}
        </div>
      )}

      {step !== 'grid' && (
        <div role="group" aria-label={TEXT.CAPTURE_PANEL_LABEL}>
          <button
            type="button"
            role="menuitem"
            autoFocus
            className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs opacity-70 transition-colors hover:bg-[var(--as-secondary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--as-primary)]"
            onClick={() => setStep('grid')}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {TEXT.CAPTURE_PANEL_BACK}
          </button>
          {loadingRows && (
            <p role="presentation" className="px-2 py-1.5 text-sm opacity-60">
              {TEXT.CAPTURE_WAITING}
            </p>
          )}
          {!loadingRows && listed}
          {!loadingRows && !rows && (
            <p role="presentation" className="px-2 py-1.5 text-sm opacity-60">
              {TEXT.CAPTURE_WAITING}
            </p>
          )}
          {!loadingRows && rows && listed.length === 0 && (
            <p role="presentation" className="px-2 py-1.5 text-sm opacity-60">
              {TEXT.CAPTURE_UNAVAILABLE}
            </p>
          )}
        </div>
      )}

    </div>
  );
}
