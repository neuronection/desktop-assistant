import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type JSX, type RefObject, type SetStateAction } from 'react';
import type { CommandEntry } from '@shared/commands';
import type { AppConfig } from '@shared/config/AppConfig';
import { TEXT, interpolate } from '@shared/constants/text';
import { miniAppForEntry, miniAppForLiveOptions, type MiniApp, type MiniAppOpenOptions } from './miniApps';
import { surfacePackLaunchOptions } from './surfacePackState';
import { setSurfacePackViews } from './surfacePackState';
import { useLiveSurfaces } from '@packs/renderer';
import { MiniAppSurface } from './MiniAppSurface';

export interface UseMiniAppsOptions {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  config: AppConfig | null;
  /** Opens the launch menu for the LIVE surface (plan 53 S3.4) — offered only when the pack declares options. */
  onEditOptions?: () => void;
}

/**
 * Mini-app mode controller (plan 14 §9; pack-driven since plan 26):
 * generic mode lifecycle only — entry/exit, copy, palette wiring and
 * submit interception. All per-app behavior (live results, debounce,
 * copy values) lives in the active pack's binding under `packs/<id>/`.
 */
export function useMiniApps(options: UseMiniAppsOptions): {
  miniApp: MiniApp | null;
  miniExitEntries: CommandEntry[];
  paletteAllowedIds: string[] | undefined;
  isMiniAppActive: () => boolean;
  miniContext: () => { active: boolean; allowedIds: string[]; appName: string } | null;
  enterMiniApp: (entry: CommandEntry, openOptions?: MiniAppOpenOptions) => boolean;
  updateMiniAppOptions: (openOptions: MiniAppOpenOptions) => boolean;
  exitMiniApp: () => void;
  interceptSubmit: (text: string) => boolean;
  surface: JSX.Element | null;
} {
  const { input, setInput, composerRef, config } = options;
  const [miniApp, setMiniApp] = useState<MiniApp | null>(null);
  const [copied, setCopied] = useState(false);
  const entryRef = useRef<CommandEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (typeof window.electronAPI.getMiniApps !== 'function') {
      return () => undefined;
    }
    void window.electronAPI
      .getMiniApps()
      .then((state) => {
        if (!cancelled) {
          setSurfacePackViews(state.packs, state.masterEnabled);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const live = useLiveSurfaces(miniApp, input, config);

  const exitMiniApp = useCallback((): void => {
    entryRef.current = null;
    setMiniApp(null);
    setCopied(false);
    setInput('');
    composerRef.current?.focus();
  }, [setInput, composerRef]);

  const enterMiniApp = useCallback(
    (entry: CommandEntry, openOptions?: MiniAppOpenOptions): boolean => {
      const mini = miniAppForEntry(entry, openOptions);
      if (!mini) {
        return false;
      }
      entryRef.current = entry;
      setCopied(false);
      setMiniApp(mini);
      setInput('');
      composerRef.current?.focus();
      return true;
    },
    [setInput, composerRef]
  );

  const updateMiniAppOptions = useCallback(
    (openOptions: MiniAppOpenOptions): boolean => {
      const entry = entryRef.current;
      if (!entry) {
        return false;
      }
      setMiniApp((current) => (current ? miniAppForLiveOptions(entry, current, openOptions) ?? current : current));
      composerRef.current?.focus();
      return true;
    },
    [composerRef]
  );

  const copyResult = useCallback((): void => {
    const value = live?.copyValue;
    if (value === null || value === undefined) {
      return;
    }
    setCopied(true);
    void window.electronAPI.writeToClipboard(value).catch(() => undefined);
  }, [live]);

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
    updateMiniAppOptions,
    exitMiniApp,
    interceptSubmit,
    surface: miniApp ? (
      <MiniAppSurface
        app={miniApp}
        input={input}
        copied={copied}
        live={live}
        onCopy={copyResult}
        onExit={exitMiniApp}
        onEditOptions={
          options.onEditOptions && (surfacePackLaunchOptions(miniApp.packId)?.length ?? 0) > 0 ? options.onEditOptions : undefined
        }
      />
    ) : null,
  };
}
