import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Minus, PanelRight, X } from 'lucide-react';
import { Button } from '@neuronection/assistant-ui/button';
import { TEXT, interpolate } from '@shared/constants/text';
import type { MiniAppRunReportView } from '@shared/app-pack';
import { PackReportRenderer } from '@renderer/shared/PackReportRenderer';

function readQuery(): { pack: string; run: string } {
  const params = new URLSearchParams(window.location.search);
  return { pack: params.get('pack') ?? '', run: params.get('run') ?? '' };
}

/**
 * The `ui:window` surface host (plan 32 Phase 4 / ADR-0040 clause 16):
 * a host-owned window rendering the pack's DECLARED declarative surface —
 * the run report through the same `PackReportRenderer` path the in-app
 * modal hosts (no markup path of its own; the vocabulary stays closed).
 * Theme rides the app theme (family tokens); the window closes on pack
 * disable, uninstall, kill switch and app shutdown from main.
 */
export function PackWindowApp(): ReactElement {
  const query = useRef(readQuery()).current;
  const [report, setReport] = useState<MiniAppRunReportView | null>(null);
  const [missing, setMissing] = useState(false);
  const [restoredTo, setRestoredTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    const view = await window.electronAPI.miniAppRunReport(query.run);
    if (view) {
      setReport(view);
    } else {
      setMissing(true);
    }
  }, [query.run]);

  useEffect(() => {
    void load();
  }, [load]);

  const onOverride = useCallback(
    async (relPath: string, action: 'keep' | 'candidate' | 'exclude') => {
      if (action === 'exclude') {
        await window.electronAPI.excludeMiniAppItem(query.run, relPath);
      } else {
        await window.electronAPI.overrideMiniAppItem(query.run, relPath, action);
      }
      await load();
    },
    [query.run, load]
  );

  const onReveal = useCallback(async (relPath: string) => {
    await window.electronAPI.revealMiniAppItem(query.run, relPath);
  }, [query.run]);

  const onOpen = useCallback(async (relPath: string) => {
    await window.electronAPI.openMiniAppItem(query.run, relPath);
  }, [query.run]);

  const onRestore = useCallback(
    async (relPath: string) => {
      const result = await window.electronAPI.restoreMiniAppItem(query.run, relPath);
      if (result.ok) {
        setRestoredTo(result.restoredPath);
        await load();
      }
    },
    [query.run, load]
  );

  const onExport = useCallback(async () => {
    const exported = await window.electronAPI.exportMiniAppRun(query.run, 'markdown');
    if (exported.ok) {
      await window.electronAPI.saveFile({ defaultPath: exported.fileName, content: exported.text });
    }
  }, [query.run]);

  return (
    <div className="flex h-full flex-col text-[var(--as-fg)]">
      <header className="pw-drag-region flex h-10 shrink-0 items-center gap-2 border-b border-[var(--as-border)] px-3">
        <PanelRight className="h-3.5 w-3.5 opacity-70" aria-hidden />
        <span className="text-xs font-medium uppercase tracking-wide opacity-70">{TEXT.MINIAPPS_WINDOW_TITLE}</span>
        <span className="truncate text-xs font-medium">{report ? report.packTitle : query.pack}</span>
        <div className="ml-auto flex items-center gap-1" data-no-drag>
          <Button variant="ghost" size="sm" title={TEXT.DESKTOP_MINIMIZE} onClick={() => void window.electronAPI.minimizeWindow()}>
            <Minus className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="sm" title={TEXT.CLOSE_BUTTON} onClick={() => void window.electronAPI.closeWindow()}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </header>

      {missing && (
        <div className="flex flex-1 items-center justify-center p-6 text-sm opacity-70" role="status">
          {TEXT.MINIAPPS_WINDOW_MISSING}
        </div>
      )}

      {!missing && !report && (
        <div className="flex flex-1 items-center justify-center p-6 text-sm opacity-70" role="status">
          …
        </div>
      )}

      {report && (
        <main aria-label={report.packTitle} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <PackReportRenderer
            report={report}
            onOverride={onOverride}
            onReveal={onReveal}
            onOpen={onOpen}
            onRestore={onRestore}
            onExport={onExport}
          />
          {restoredTo && (
            <p role="status" className="text-xs text-[var(--as-muted-foreground)]">
              {interpolate(TEXT.MINIAPPS_RESTORED_TO, { path: restoredTo })}
            </p>
          )}
        </main>
      )}
    </div>
  );
}
