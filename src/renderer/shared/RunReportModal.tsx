import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Modal, ModalContent, ModalBody, ModalHeader, ModalTitle } from '@neuronection/assistant-ui/modal';
import { TEXT, interpolate } from '@shared/constants/text';
import type { MiniAppRunReportView, PackOverrideAction } from '@shared/app-pack';
import { ArmModal } from './ArmModal';
import { PackReportRenderer } from './PackReportRenderer';

export { ArmModal } from './ArmModal';
export { PackReportRenderer } from './PackReportRenderer';

export function RunReportModal({ runId, onClose }: { runId: string; onClose: () => void }): ReactElement {
  const [report, setReport] = useState<MiniAppRunReportView | null>(null);
  const [arming, setArming] = useState(false);
  const [restoredTo, setRestoredTo] = useState<string | null>(null);
  const [windowError, setWindowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setReport(await window.electronAPI.miniAppRunReport(runId));
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onOverride = useCallback(
    async (relPath: string, action: PackOverrideAction) => {
      if (action === 'exclude') {
        await window.electronAPI.excludeMiniAppItem(runId, relPath);
      } else {
        await window.electronAPI.overrideMiniAppItem(runId, relPath, action);
      }
      await load();
    },
    [runId, load]
  );

  const onReveal = useCallback(async (relPath: string) => {
    await window.electronAPI.revealMiniAppItem(runId, relPath);
  }, [runId]);

  const onOpen = useCallback(async (relPath: string) => {
    await window.electronAPI.openMiniAppItem(runId, relPath);
  }, [runId]);

  const onRestore = useCallback(async (relPath: string) => {
    const result = await window.electronAPI.restoreMiniAppItem(runId, relPath);
    if (result.ok) {
      setRestoredTo(result.restoredPath);
      await load();
    }
  }, [runId, load]);

  const onExport = useCallback(async () => {
    const exported = await window.electronAPI.exportMiniAppRun(runId, 'markdown');
    if (exported.ok) {
      await window.electronAPI.saveFile({ defaultPath: exported.fileName, content: exported.text });
    }
  }, [runId]);

  const openInWindow = useCallback(async () => {
    if (!report) {
      return;
    }
    const result = await window.electronAPI.openMiniAppWindow(report.run.packId, runId);
    if (result.ok) {
      onClose();
    } else {
      setWindowError(result.error);
    }
  }, [report, runId, onClose]);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent className="max-w-4xl">
        <ModalHeader className="shrink-0 border-b border-[var(--as-border)]">
          <ModalTitle className="min-w-0 truncate">
            {report ? interpolate(TEXT.MINIAPPS_REPORT_TITLE, { pack: report.packTitle }) : TEXT.MINIAPPS_REPORT_OPEN}
          </ModalTitle>
          {windowError && (
            <p role="alert" className="mt-2 text-xs text-[var(--as-destructive)]">
              {interpolate(TEXT.MINIAPPS_WINDOW_OPEN_FAILED, { error: windowError })}
            </p>
          )}
        </ModalHeader>
        <ModalBody className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {report ? (
            <PackReportRenderer
              report={report}
              onOverride={onOverride}
              onReveal={onReveal}
              onOpen={onOpen}
              onRestore={onRestore}
              onExport={onExport}
              onReportChanged={load}
              onArm={report.canArm ? () => setArming(true) : undefined}
              onOpenWindow={() => void openInWindow()}
            />
          ) : (
            <p className="text-sm text-[var(--as-muted-foreground)]">…</p>
          )}
          {restoredTo && (
            <p role="status" className="mt-3 text-xs text-[var(--as-muted-foreground)]">
              {interpolate(TEXT.MINIAPPS_RESTORED_TO, { path: restoredTo })}
            </p>
          )}
        </ModalBody>
      </ModalContent>
      {arming && <ArmModal runId={runId} onClose={() => setArming(false)} onChanged={load} />}
    </Modal>
  );
}
