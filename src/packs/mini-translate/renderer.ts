import { useEffect, useRef, useState } from 'react';
import { Languages } from 'lucide-react';
import { TEXT, interpolate } from '@shared/constants/text';
import { TRANSLATION_MODES, TRANSLATION_PAD_DEBOUNCE_DEFAULT, clampPadDebounce, translationEngineLabel } from '@shared/translation';
import type { TranslationMode } from '@shared/translation';
import type { MiniApp, MiniAppOpenOptions, SurfaceLiveState, SurfaceOptionContext, SurfaceRendererBinding } from '@renderer/chat-react/miniApps';
import { surfacePackConfig } from '@renderer/chat-react/surfacePackState';

type TranslationOutcome =
  | { status: 'pending' }
  | { status: 'ok'; text: string; engine: string; target: string; source?: string }
  | { status: 'error'; message: string };

/** The translate pad's live behavior: debounced translation over the direct IPC bridge. */
function useTranslateLive(app: MiniApp | null, input: string): SurfaceLiveState | null {
  const [outcome, setOutcome] = useState<TranslationOutcome | null>(null);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const trimmed = input.trim();
  const retry = (): void => setAttempt((current) => current + 1);
  useEffect(() => {
    if (!app || !trimmed) {
      setOutcome(null);
      return undefined;
    }
    const controller = new AbortController();
    const packDebounce = surfacePackConfig('mini-translate').padDebounceMs;
    const delay = clampPadDebounce(typeof packDebounce === 'number' ? packDebounce : TRANSLATION_PAD_DEBOUNCE_DEFAULT);
    const timer = window.setTimeout(() => {
      const current = ++seq.current;
      const mode = resolveEngineMode(app.engineMode);
      setOutcome({ status: 'pending' });
      window.electronAPI
        .translateText({
          text: trimmed,
          ...(app.targetCode ? { target: app.targetCode } : {}),
          ...(app.sourceCode ? { source: app.sourceCode } : {}),
          ...(mode !== null ? { mode } : {}),
        })
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
  }, [app, trimmed, attempt]);
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
    return {
      copyValue: null,
      rows: [{ kind: 'error', message: interpolate(TEXT.TRANSLATION_MINI_ERROR, { error: outcome.message }), retry }],
    };
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
        speak: outcome.text,
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
  applyOpenOptions: applyTranslateOptions,
  applyLiveOptions: applyTranslateOptions,
  liveOptionValues: (mini) => ({
    source: mini.sourceCode ?? 'auto',
    target: mini.targetCode ?? '',
    engine: mini.engineMode ?? 'inherit',
  }),
  swapOptions: (mini) =>
    mini.sourceCode !== null && mini.sourceCode !== undefined && mini.targetCode
      ? { source: mini.targetCode, target: mini.sourceCode }
      : null,
  optionsFooter: () => ({
    label: TEXT.TRANSLATE_ENGINE_SETTINGS,
    onClick: () => {
      void window.electronAPI.onSettingsOpen({ tab: 'tools', section: 'translation' });
    },
  }),
};

function normalizeLanguage(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

/**
 * Open/live options for the pad: explicit launch values win over the pack's
 * remembered choice, which wins over the app's translation default (`/tr`
 * reads the same one), which wins over the engine's own `en` fallback. An
 * `auto` source stays null so the engine detects the language.
 */
function applyTranslateOptions(mini: MiniApp, options: MiniAppOpenOptions, context: SurfaceOptionContext): MiniApp {
  const targetCode =
    normalizeLanguage(options.target) ??
    normalizeLanguage(options.targetCode) ??
    normalizeLanguage(context.packConfig.targetCode) ??
    normalizeLanguage(context.config?.translation?.defaultTarget) ??
    'en';
  const rawSource = normalizeLanguage(options.source) ?? normalizeLanguage(context.packConfig.sourceCode);
  const sourceCode = rawSource !== null && rawSource !== 'auto' ? rawSource : null;
  return {
    ...mini,
    sourceCode,
    targetCode,
    engineMode: resolveEngineMode(normalizeLanguage(options.engine) ?? normalizeLanguage(context.packConfig.engineMode) ?? 'inherit'),
    route: sourceCode !== null ? `${sourceCode} → ${targetCode}` : `→ ${targetCode}`,
  };
}

function resolveEngineMode(value: string | null | undefined): TranslationMode | null {
  return value !== null && value !== undefined && value !== 'inherit' && (TRANSLATION_MODES as readonly string[]).includes(value)
    ? (value as TranslationMode)
    : null;
}
