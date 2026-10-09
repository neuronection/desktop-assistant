import { useEffect, useRef, useState } from 'react';
import { Languages } from 'lucide-react';
import { TEXT, interpolate } from '@shared/constants/text';
import { clampPadDebounce, translationEngineLabel } from '@shared/translation';
import type { AppConfig } from '@shared/config/AppConfig';
import type { MiniApp, SurfaceLiveState, SurfaceRendererBinding } from '@renderer/chat-react/miniApps';
import { surfacePackConfig } from '@renderer/chat-react/surfacePackState';

type TranslationOutcome =
  | { status: 'pending' }
  | { status: 'ok'; text: string; engine: string; target: string; source?: string }
  | { status: 'error'; message: string };

/** The translate pad's live behavior: debounced translation over the direct IPC bridge. */
function useTranslateLive(app: MiniApp | null, input: string, configRaw: unknown): SurfaceLiveState | null {
  const config = configRaw as AppConfig | null;
  const [outcome, setOutcome] = useState<TranslationOutcome | null>(null);
  const seq = useRef(0);
  const trimmed = input.trim();
  useEffect(() => {
    if (!app || !trimmed) {
      setOutcome(null);
      return undefined;
    }
    const controller = new AbortController();
    const packDebounce = surfacePackConfig('mini-translate').padDebounceMs;
    const delay = clampPadDebounce(typeof packDebounce === 'number' ? packDebounce : config?.translation?.padDebounceMs);
    const timer = window.setTimeout(() => {
      const current = ++seq.current;
      setOutcome({ status: 'pending' });
      window.electronAPI
        .translateText({ text: trimmed, ...(app.targetCode ? { target: app.targetCode } : {}) })
        .then((result) => {
          if (seq.current === current && !controller.signal.aborted) {
            setOutcome({ status: 'ok', text: result.text, engine: result.engine, target: result.target, source: result.source });
          }
        })
        .catch((error: unknown) => {
          if (seq.current === current && !controller.signal.aborted) {
            setOutcome({ status: 'error', message: ((error as Error).message ?? String(error)).slice(0, 200) });
          }
        });
    }, delay);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [app, trimmed, config]);
  if (!app) {
    return null;
  }
  if (!trimmed || !outcome) {
    return { copyValue: null, rows: [] };
  }
  if (outcome.status === 'pending') {
    return { copyValue: null, rows: [{ kind: 'pending', label: TEXT.TRANSLATION_MINI_PENDING }] };
  }
  if (outcome.status === 'error') {
    return { copyValue: null, rows: [{ kind: 'error', message: interpolate(TEXT.TRANSLATION_MINI_ERROR, { error: outcome.message }) }] };
  }
  return {
    copyValue: outcome.text,
    rows: [
      {
        kind: 'result',
        variant: 'card',
        label: outcome.text,
        value: outcome.text,
        meta: interpolate(TEXT.TRANSLATE_RESULT_META, {
          engine: translationEngineLabel(outcome.engine),
          route: outcome.source ? `${outcome.source} → ${outcome.target}` : `→ ${outcome.target}`,
        }),
      },
    ],
  };
}

/** The translate pad's Tier-1 renderer binding (host code, keyed by pack id). */
export const translateRenderer: SurfaceRendererBinding = {
  packId: 'mini-translate',
  modeId: 'tool:translate',
  match: { toolName: 'translate' },
  icon: Languages,
  placeholder: TEXT.COMMAND_MINI_TRANSLATE_PLACEHOLDER,
  hint: TEXT.COMMAND_MINI_TRANSLATE_HINT,
  useLive: useTranslateLive,
  applyOpenOptions: (mini, options) => {
    const targetCode = options.targetCode?.trim().toLowerCase() || null;
    return { ...mini, targetCode, title: targetCode ? `${mini.title} → ${targetCode}` : mini.title };
  },
};
