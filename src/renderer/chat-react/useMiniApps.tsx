import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type JSX, type RefObject, type SetStateAction } from 'react';
import { evaluateExpression, formatCalcResult } from '@shared/commands';
import type { CommandEntry } from '@shared/commands';
import type { AppConfig } from '@shared/config/AppConfig';
import { TEXT, interpolate } from '@shared/constants/text';
import { clampPadDebounce } from '@shared/translation';
import { miniAppForEntry, type MiniApp } from './miniApps';
import { MiniAppSurface, type MiniTranslationState } from './MiniAppSurface';

export interface UseMiniAppsOptions {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  config: AppConfig | null;
}

/**
 * Mini-app mode controller (plan 14 §9) — one implementation shared by
 * the launcher (compact + expanded) and the desktop window: focused
 * pad entry/exit, live calc/translate state, copy-on-Enter, and the
 * palette focus-mode wiring.
 */
export function useMiniApps(options: UseMiniAppsOptions): {
  miniApp: MiniApp | null;
  miniExitEntries: CommandEntry[];
  paletteAllowedIds: string[] | undefined;
  isMiniAppActive: () => boolean;
  miniContext: () => { active: boolean; allowedIds: string[]; appName: string } | null;
  enterMiniApp: (entry: CommandEntry, openOptions?: { targetCode?: string | null }) => void;
  exitMiniApp: () => void;
  interceptSubmit: (text: string) => boolean;
  surface: JSX.Element | null;
} {
  const { input, setInput, composerRef, config } = options;
  const [miniApp, setMiniApp] = useState<MiniApp | null>(null);
  const [copied, setCopied] = useState(false);
  const [translation, setTranslation] = useState<MiniTranslationState | null>(null);
  const translateSeq = useRef(0);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const exitMiniApp = useCallback((): void => {
    setMiniApp(null);
    setCopied(false);
    setTranslation(null);
    setInput('');
    composerRef.current?.focus();
  }, [setInput, composerRef]);

  const enterMiniApp = useCallback(
    (entry: CommandEntry, openOptions?: { targetCode?: string | null }): void => {
      setCopied(false);
      setTranslation(null);
      setMiniApp(miniAppForEntry(entry, openOptions));
      setInput('');
      composerRef.current?.focus();
    },
    [setInput, composerRef]
  );

  const copyResult = useCallback((): void => {
    if (miniApp?.id === 'calc:evaluate') {
      const result = evaluateExpression(input.trim());
      if (result.ok) {
        setCopied(true);
        void window.electronAPI.writeToClipboard(formatCalcResult(result.value)).catch(() => undefined);
      }
      return;
    }
    if (miniApp?.id === 'tool:translate' && translation?.status === 'ok') {
      setCopied(true);
      void window.electronAPI.writeToClipboard(translation.text).catch(() => undefined);
    }
  }, [miniApp, input, translation]);

  useEffect(() => {
    if (miniApp?.id !== 'tool:translate') {
      return undefined;
    }
    const text = input.trim();
    if (!text) {
      setTranslation(null);
      return undefined;
    }
    const controller = new AbortController();
    const delay = clampPadDebounce(config?.translation?.padDebounceMs);
    const timer = window.setTimeout(() => {
      const seq = ++translateSeq.current;
      setTranslation({ status: 'pending' });
      window.electronAPI
        .translateText({ text, ...(miniApp.targetCode ? { target: miniApp.targetCode } : {}) })
        .then((result) => {
          if (translateSeq.current === seq && !controller.signal.aborted) {
            setTranslation({ status: 'ok', text: result.text, engine: result.engine, target: result.target, source: result.source });
          }
        })
        .catch((error: unknown) => {
          if (translateSeq.current === seq && !controller.signal.aborted) {
            setTranslation({ status: 'error', message: ((error as Error).message ?? String(error)).slice(0, 200) });
          }
        });
    }, delay);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [input, miniApp, config]);

  const miniExitEntries = useMemo<CommandEntry[]>(
    () =>
      miniApp
        ? [
            {
              id: 'nav:quit',
              kind: 'builtin' as const,
              title: interpolate(TEXT.COMMAND_MINI_EXIT_TITLE, { app: miniApp.title }),
              subtitle: miniApp.hint,
              category: 'navigation' as const,
              icon: 'log-out',
              aliases: ['exit', 'quit'],
              slash: 'exit',
              source: 'system' as const,
              scopes: { palette: true, agent: false },
              args: [],
              action: 'nav:quit' as const,
            },
          ]
        : [],
    [miniApp]
  );

  const interceptSubmit = useCallback(
    (text: string): boolean => {
      if (!miniApp || text.trimStart().startsWith('/')) {
        return false;
      }
      copyResult();
      return true;
    },
    [miniApp, copyResult]
  );

  return {
    miniApp,
    miniExitEntries,
    paletteAllowedIds: miniApp ? [miniApp.id, 'nav:quit'] : undefined,
    isMiniAppActive: () => miniApp !== null,
    miniContext: () => (miniApp ? { active: true, allowedIds: [miniApp.id, 'nav:quit'], appName: miniApp.title } : null),
    enterMiniApp,
    exitMiniApp,
    interceptSubmit,
    surface: miniApp ? (
      <MiniAppSurface app={miniApp} input={input} copied={copied} translation={translation} onCopy={copyResult} onExit={exitMiniApp} />
    ) : null,
  };
}
