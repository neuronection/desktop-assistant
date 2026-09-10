import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { CommandCatalogSnapshot, CommandEntry } from '@shared/commands';
import { buildPaletteModel, invalidateCommandCatalog, loadCommandCatalog, type PaletteModel } from './commandSource';

export interface UseCommandPaletteOptions {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  /** Executes a selected entry by id (S8 fix: no text round-trip for non-tool kinds). */
  executeEntry: (entry: CommandEntry, argv: string[]) => Promise<void>;
  sending: boolean;
  /** Extra gate (e.g. the launcher's expanded mode disables the palette). */
  enabled?: boolean;
  /** Catalog ids hidden from the palette for the current context (e.g. Quit while a mini app is active). */
  excludeIds?: string[];
  /** When set, ONLY these ids (plus extraEntries) are shown — mini-app focus mode (plan 14 §9). */
  allowedIds?: string[];
  /** Context entries injected on top (e.g. "Exit Calculator" while a mini app is active). */
  extraEntries?: CommandEntry[];
  /** Called when a real turn will start via a palette execution. */
  onSubmitting?: () => void;
}

export type CommandRowAction = 'pin' | 'configure' | 'disable';

/**
 * One palette controller shared by both windows (plan 14 §2/§8):
 * snapshot-per-summon freshness, derived open state, execution through
 * the session submit path and the config-mutating row actions.
 */
export function useCommandPalette(options: UseCommandPaletteOptions): {
  open: boolean;
  model: PaletteModel | null;
  pinnedIds: string[] | undefined;
  close: () => void;
  execute: (entry: CommandEntry, argv: string[]) => void;
  rowAction: (entry: CommandEntry, action: CommandRowAction) => Promise<void>;
  requestOpen: () => void;
} {
  const { input, setInput, composerRef, executeEntry, sending, enabled = true } = options;
  const [catalog, setCatalog] = useState<CommandCatalogSnapshot | null>(null);
  const wasOpenRef = useRef(false);
  const openRef = useRef(false);

  const open = enabled && !sending && input.trimStart().startsWith('/') && input.trim().length > 0;

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      void loadCommandCatalog(true)
        .then(setCatalog)
        .catch(() => setCatalog(null));
    }
    if (!open) {
      wasOpenRef.current = open;
    }
    openRef.current = open;
  }, [open]);

  // Config saves (settings window) broadcast to every renderer — refresh
  // the open palette so new aliases/pins land without closing it.
  useEffect(() => {
    if (!window.electronAPI?.onConfigUpdate) {
      return undefined;
    }
    return window.electronAPI.onConfigUpdate(() => {
      invalidateCommandCatalog();
      if (openRef.current) {
        void loadCommandCatalog(true)
          .then(setCatalog)
          .catch(() => setCatalog(null));
      }
    });
  }, []);

  const model = useMemo(() => {
    if (!open || !catalog) {
      return null;
    }
    let effective = catalog;
    if (options.allowedIds) {
      const allowed = new Set([...options.allowedIds, ...(options.extraEntries ?? []).map((entry) => entry.id)]);
      effective = { ...catalog, entries: catalog.entries.filter((entry) => allowed.has(entry.id)) };
    }
    return buildPaletteModel(effective, input.trimStart().slice(1), options.excludeIds, options.extraEntries);
  }, [open, catalog, input, options.excludeIds, options.extraEntries]);

  const close = useCallback((): void => {
    setInput('');
    composerRef.current?.focus();
  }, [setInput, composerRef]);

  const execute = useCallback(
    (entry: CommandEntry, argv: string[]): void => {
      void executeEntry(entry, argv);
    },
    [executeEntry]
  );

  const rowAction = useCallback(
    async (entry: CommandEntry, action: CommandRowAction): Promise<void> => {
      const loaded = await window.electronAPI.loadConfig();
      const current = loaded.commands;
      if (!current) {
        return;
      }
      if (action === 'pin') {
        const pins = current.pins.includes(entry.id)
          ? current.pins.filter((id) => id !== entry.id)
          : [...current.pins, entry.id];
        await window.electronAPI.saveConfig({ ...loaded, commands: { ...current, pins } });
      } else if (action === 'disable') {
        await window.electronAPI.saveConfig({
          ...loaded,
          commands: { ...current, hidden: [...new Set([...current.hidden, entry.id])] },
        });
      } else {
        await window.electronAPI.onSettingsOpen({ tab: 'commands', commandId: entry.id });
        return;
      }
      invalidateCommandCatalog();
      setCatalog(null);
    },
    []
  );

  const requestOpen = useCallback((): void => {
    setInput((prev) => (prev.trimStart().startsWith('/') ? prev : `/${prev}`));
    composerRef.current?.focus();
  }, [setInput, composerRef]);

  return { open, model, pinnedIds: catalog?.pins, close, execute, rowAction, requestOpen };
}
