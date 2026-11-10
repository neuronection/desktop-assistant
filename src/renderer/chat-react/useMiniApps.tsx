import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type JSX, type RefObject, type SetStateAction } from 'react';
import type { CommandEntry } from '@shared/commands';
import type { AppConfig } from '@shared/config/AppConfig';
import { TEXT, interpolate } from '@shared/constants/text';
import type { MiniAppView } from '@shared/app-pack';
import type { CustomLanguageEntry } from '@shared/languages';
import { LaunchPane } from '@renderer/shared/LaunchPane';
import type { LaunchOutcome } from '@renderer/shared/LaunchPane';
import type { PackLaunchValues } from '@renderer/shared/PackLaunchMenu';
import {
  liveOptionValuesFor,
  miniAppForEntry,
  miniAppForLiveOptions,
  optionsFooterFor,
  swapOptionsFor,
  type MiniApp,
  type MiniAppOpenOptions,
} from './miniApps';
import { setSurfacePackViews, surfacePackLaunchOptions } from './surfacePackState';
import { useLiveSurfaces } from '@packs/renderer';
import { MiniAppSurface } from './MiniAppSurface';

export interface UseMiniAppsOptions {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  config: AppConfig | null;
  /** The host's speech-bus path (the pad reads results aloud with it). */
  onSpeak?: (text: string) => void;
}

/**
 * Mini-app mode controller (plan 14 §9; pack-driven since plan 26):
 * generic mode lifecycle only — entry/exit, copy, palette wiring, the
 * in-pad options menu and submit interception. All per-app behavior
 * (live results, debounce, copy values) lives in the active pack's
 * binding under `packs/<id>/`.
 */
function toLaunchValues(options: MiniAppOpenOptions): PackLaunchValues {
  const values: PackLaunchValues = {};
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      values[key] = value;
    }
  }
  return values;
}

export function useMiniApps(options: UseMiniAppsOptions): {
  miniApp: MiniApp | null;
  miniExitEntries: CommandEntry[];
  paletteAllowedIds: string[] | undefined;
  isMiniAppActive: () => boolean;
  miniContext: () => { active: boolean; allowedIds: string[]; appName: string } | null;
  enterMiniApp: (entry: CommandEntry, openOptions?: MiniAppOpenOptions) => boolean;
  updateMiniAppOptions: (openOptions: MiniAppOpenOptions) => boolean;
  /** True while the in-pad options pane owns Escape — hosts must stand down. */
  optionsOpen: boolean;
  /** The pack's mirror direction, or null when the current state has no reverse. */
  swapDirection: (() => void) | null;
  exitMiniApp: () => void;
  interceptSubmit: (text: string) => boolean;
  surface: JSX.Element | null;
} {
  const { input, setInput, composerRef, config } = options;
  const [miniApp, setMiniApp] = useState<MiniApp | null>(null);
  const [copied, setCopied] = useState(false);
  const [packViews, setPackViews] = useState<MiniAppView[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const entryRef = useRef<CommandEntry | null>(null);

  /** Re-reads the registry so an applied option (and pack enable/title state) is current without a restart. */
  const refreshPackState = useCallback(async (): Promise<void> => {
    if (typeof window.electronAPI?.getMiniApps !== 'function') {
      return;
    }
    try {
      const state = await window.electronAPI.getMiniApps();
      setSurfacePackViews(state.packs, state.masterEnabled);
      setPackViews(state.packs);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    void refreshPackState();
  }, [refreshPackState]);

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
    setOptionsOpen(false);
    setInput('');
    composerRef.current?.focus();
  }, [setInput, composerRef]);

  const enterMiniApp = useCallback(
    (entry: CommandEntry, openOptions?: MiniAppOpenOptions): boolean => {
      const mini = miniAppForEntry(entry, openOptions, config);
      if (!mini) {
        return false;
      }
      entryRef.current = entry;
      setCopied(false);
      setOptionsOpen(false);
      setMiniApp(mini);
      setInput('');
      composerRef.current?.focus();
      return true;
    },
    [config, setInput, composerRef]
  );

  const updateMiniAppOptions = useCallback(
    (openOptions: MiniAppOpenOptions): boolean => {
      const entry = entryRef.current;
      if (!entry) {
        return false;
      }
      setMiniApp((current) => (current ? miniAppForLiveOptions(entry, current, openOptions, config) ?? current : current));
      composerRef.current?.focus();
      return true;
    },
    [config, composerRef]
  );

  const copyResult = useCallback((): void => {
    const value = live?.copyValue;
    if (value === null || value === undefined) {
      return;
    }
    setCopied(true);
    void window.electronAPI.writeToClipboard(value).catch(() => undefined);
  }, [live]);

  const swap = miniApp ? swapOptionsFor(miniApp) : null;
  const swapDirection = useCallback((): void => {
    if (swap !== null) {
      updateMiniAppOptions(swap);
    }
  }, [swap, updateMiniAppOptions]);

  const closeOptions = useCallback((): void => {
    setOptionsOpen(false);
    composerRef.current?.focus();
  }, [composerRef]);

  const toggleOptions = useCallback((): void => {
    if (optionsOpen) {
      closeOptions();
      return;
    }
    void refreshPackState().then(() => setOptionsOpen(true));
  }, [closeOptions, optionsOpen, refreshPackState]);

  const applyOptions = useCallback(
    async (values: PackLaunchValues): Promise<LaunchOutcome | void> => {
      if (!updateMiniAppOptions(values)) {
        return { error: { message: TEXT.MINIAPPS_LAUNCH_LIVE_UNAVAILABLE } };
      }
      setOptionsOpen(false);
      void refreshPackState();
      return undefined;
    },
    [refreshPackState, updateMiniAppOptions]
  );

  const addCustomLanguage = useCallback(async (code: string): Promise<CustomLanguageEntry | null> => {
    if (typeof window.electronAPI?.addTranslationCustomLanguage !== 'function') {
      return null;
    }
    try {
      return await window.electronAPI.addTranslationCustomLanguage(code);
    } catch {
      return null;
    }
  }, []);

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

  const optionsView = miniApp && optionsOpen ? packViews.find((view) => view.id === miniApp.packId) ?? null : null;
  const canEditOptions = miniApp !== null && (surfacePackLaunchOptions(miniApp.packId)?.length ?? 0) > 0;
  const optionsFooter = miniApp !== null && optionsOpen ? optionsFooterFor(miniApp) : null;

  return {
    miniApp,
    miniExitEntries,
    paletteAllowedIds: miniApp ? [miniApp.id, 'nav:quit'] : undefined,
    isMiniAppActive: () => miniApp !== null,
    miniContext: () => (miniApp ? { active: true, allowedIds: [miniApp.id, 'nav:quit'], appName: miniApp.title } : null),
    enterMiniApp,
    updateMiniAppOptions,
    optionsOpen,
    swapDirection: swap !== null ? swapDirection : null,
    exitMiniApp,
    interceptSubmit,
    surface: miniApp ? (
      <>
        {optionsView && (
          <LaunchPane
            pack={optionsView}
            primaryLabel={TEXT.MINIAPPS_LAUNCH_APPLY}
            secondaryLabel={TEXT.MINIAPPS_LAUNCH_CLOSE}
            onBack={closeOptions}
            onLaunch={applyOptions}
            onSecondary={closeOptions}
            initialValues={toLaunchValues(liveOptionValuesFor(miniApp))}
            footerLink={optionsFooter}
            customLanguages={config?.translation?.customLanguages ?? []}
            onAddCustomLanguage={addCustomLanguage}
          />
        )}
        <MiniAppSurface
          app={miniApp}
          input={input}
          copied={copied}
          live={live}
          onCopy={copyResult}
          onExit={exitMiniApp}
          onEditOptions={canEditOptions ? toggleOptions : undefined}
          optionsOpen={optionsOpen}
          onSwapDirection={swap !== null ? swapDirection : undefined}
          {...(options.onSpeak !== undefined ? { onSpeak: options.onSpeak } : {})}
        />
      </>
    ) : null,
  };
}
