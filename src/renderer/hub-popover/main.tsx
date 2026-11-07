import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Copy,
  EyeOff,
  Home,
  Languages,
  Mic,
  Radio,
  RefreshCw,
  Settings,
  Volume2,
  X,
} from 'lucide-react';
import '@renderer/styles/theme.css';
import { applyTheme } from '@renderer/settings-react/theme';
import { ThemeType } from '@shared/constants/themes';
import { TEXT, interpolate } from '@shared/constants/text';
import { HUB_PAGE_SIZE } from '@shared/hubControls';
import type { HubActionView, HubBusy, HubResult } from '@shared/hub';
import './hub-popover.css';

const ACTION_ICONS: Record<string, React.ReactNode> = {
  'live-toggle': <Radio size={13} aria-hidden="true" />,
  'translate-selection': <Languages size={13} aria-hidden="true" />,
  'speak-selection': <Volume2 size={13} aria-hidden="true" />,
  dictate: <Mic size={13} aria-hidden="true" />,
  'open-assistant': <Home size={13} aria-hidden="true" />,
  'hide-hub': <EyeOff size={13} aria-hidden="true" />,
};

export function HubPopover(): React.ReactElement {
  const [actions, setActions] = useState<HubActionView[]>([]);
  const [result, setResult] = useState<HubResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refreshActions = (): void => {
    void window.electronAPI
      .getHubActions?.()
      .then(setActions)
      .catch(() => undefined);
  };

  useEffect(() => {
    const api = window.electronAPI;
    refreshActions();
    const offResult = api.onHubResult?.((next) => setResult(next));
    const offBusy = api.onHubBusy?.((next: HubBusy) => setBusyAction(next.active ? next.id : null));
    let active = true;
    api.onConfigUpdate?.(() => {
      if (active) {
        refreshActions();
      }
    });
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        refreshActions();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      offResult?.();
      offBusy?.();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const run = async (id: string): Promise<void> => {
    setBusy(id);
    setError(null);
    setResult(null);
    try {
      const response = await window.electronAPI.runHubAction(id);
      if (!response.ok) {
        setError(response.error ?? null);
      }
      if (id !== 'translate-selection') {
        window.electronAPI.closeHub();
      }
    } finally {
      setBusy(null);
    }
  };

  const actionLabel = (action: HubActionView): string => {
    if (action.id === 'live-toggle') {
      return action.active ? TEXT.HUB_LIVE_END : TEXT.HUB_LIVE_START;
    }
    return action.label;
  };

  const listedActions = actions;
  const pageCount = Math.max(1, Math.ceil(listedActions.length / HUB_PAGE_SIZE));
  const pageActions = listedActions.slice(page * HUB_PAGE_SIZE, (page + 1) * HUB_PAGE_SIZE);
  const actionKey = listedActions.map((action) => `${action.id}:${action.enabled}`).join('|');
  const resultVisible = result !== null;
  const resultTitle = useMemo(() => result?.title ?? '', [result]);
  const activeBusy = busy ?? busyAction;
  useEffect(() => {
    setPage(0);
  }, [actionKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  const busyLabel =
    activeBusy === 'translate-selection'
      ? TEXT.HUB_BUSY_TRANSLATING
      : activeBusy === 'speak-selection'
        ? TEXT.SPEECH_PREPARING
        : '';

  return (
    <div className="hub-panel" onPointerEnter={refreshActions}>
      <div className="hub-head">
        <span className="hub-title">{TEXT.HUB_POPOVER_TITLE}</span>
        <button type="button" className="hub-close" aria-label={TEXT.HUB_POPOVER_CLOSE} onClick={() => window.electronAPI.closeHub()}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      {busyLabel && (
        <div className="hub-busy" role="status" aria-live="polite">
          <span className="hub-spinner" aria-hidden="true" />
          <span>{busyLabel}</span>
        </div>
      )}

      <div className="hub-grid">
        {listedActions.length === 0 && <p className="hub-empty">{TEXT.HUB_POPOVER_EMPTY}</p>}
        {pageActions.map((action, index) => (
          <button
            key={`${action.id}-${index}`}
            type="button"
            className="hub-action"
            disabled={!action.enabled || busy !== null}
            title={action.enabled ? action.hint : action.reason ?? action.hint}
            onClick={() => void run(action.id)}
          >
            <span className="icon" aria-hidden="true">
              {ACTION_ICONS[action.id] ?? <Radio size={13} aria-hidden="true" />}
            </span>
            <span className="copy">
              <strong>{actionLabel(action)}</strong>
              <span>{action.enabled ? action.hint : action.reason ?? action.hint}</span>
            </span>
          </button>
        ))}
      </div>

      {pageCount > 1 && (
        <div className="hub-pager">
          <button
            type="button"
            className="hub-mini"
            aria-label={TEXT.HUB_PAGE_PREV}
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            ‹
          </button>
          <span className="hub-page-count">
            {interpolate(TEXT.HUB_PAGE_INDICATOR, { page: page + 1, pages: pageCount })}
          </span>
          <button
            type="button"
            className="hub-mini"
            aria-label={TEXT.HUB_PAGE_NEXT}
            disabled={page >= pageCount - 1}
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
          >
            ›
          </button>
        </div>
      )}

      {resultVisible && (
        <div className="hub-result">
          <span className="what">
            <span>{resultTitle}</span>
            <button
              type="button"
              className="hub-result-clear"
              aria-label={TEXT.HUB_RESULT_CLEAR}
              title={TEXT.HUB_RESULT_CLEAR}
              onClick={() => setResult(null)}
            >
              <X size={11} aria-hidden="true" />
            </button>
          </span>
          <span className="text">{result.text}</span>
          <span className="btns">
            <button type="button" className="hub-mini" onClick={() => window.electronAPI.copyHubText(result.text)}>
              <Copy size={10} aria-hidden="true" /> {TEXT.HUB_RESULT_COPY}
            </button>
            {result.kind !== 'error' && (
              <button
                type="button"
                className="hub-mini"
                onClick={() => {
                  window.electronAPI.activateHubResult?.();
                  window.electronAPI.closeHub();
                }}
              >
                <Home size={10} aria-hidden="true" /> {TEXT.HUB_RESULT_OPEN}
              </button>
            )}
            {result.retryable && (
              <button type="button" className="hub-mini" onClick={() => void run(result.id)}>
                <RefreshCw size={10} aria-hidden="true" /> {TEXT.HUB_RESULT_RETRY}
              </button>
            )}
          </span>
        </div>
      )}

      {error && !resultVisible && <div className="hub-result"><span className="text">{error}</span></div>}

      <div className="hub-foot">
        <button
          type="button"
          className="hub-mini"
          onClick={() => {
            window.electronAPI.openHubSettings();
            window.electronAPI.closeHub();
          }}
        >
          <Settings size={10} aria-hidden="true" /> {TEXT.HUB_POPOVER_SETTINGS}
        </button>
      </div>
    </div>
  );
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById('hub-root');
  if (!container) {
    return;
  }
  let theme: ThemeType = ThemeType.CLASSIC;
  try {
    const config = await window.electronAPI?.loadConfig?.();
    if (config?.theme) {
      theme = config.theme;
    }
  } catch {
    // keep the default theme
  }
  applyTheme(theme);
  createRoot(container).render(
    <React.StrictMode>
      <HubPopover />
    </React.StrictMode>
  );
}

void bootstrap();
