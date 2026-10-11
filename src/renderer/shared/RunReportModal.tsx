import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { Modal, ModalContent, ModalBody, ModalFooter, ModalHeader, ModalTitle } from '@neuronection/assistant-ui/modal';
import { ArchiveRestore } from 'lucide-react';
import { TEXT, interpolate } from '@shared/constants/text';
import type { MiniAppRunReportView } from '@shared/app-pack';
import { ArmModal } from './ArmModal';
import { PackReportRenderer } from './PackReportRenderer';

export { ArmModal } from './ArmModal';
export { PackReportRenderer } from './PackReportRenderer';

export function RunReportModal({ runId, onClose }: { runId: string; onClose: () => void }): ReactElement {
  const [report, setReport] = useState<MiniAppRunReportView | null>(null);
  const [arming, setArming] = useState(false);
  const [restoredTo, setRestoredTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setReport(await window.electronAPI.miniAppRunReport(runId));
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onOverride = useCallback(
    async (relPath: string, action: 'keep' | 'candidate' | 'exclude') => {
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

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent className="max-w-2xl">
        <ModalHeader>
          <ModalTitle>{report ? `${report.packTitle} — report` : TEXT.MINIAPPS_REPORT_OPEN}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {report ? (
            <PackReportRenderer report={report} onOverride={onOverride} onReveal={onReveal} onOpen={onOpen} onRestore={onRestore} onExport={onExport} />
          ) : (
            <p className="text-sm text-[var(--as-muted-foreground)]">…</p>
          )}
          {restoredTo && (
            <p role="status" className="text-xs text-[var(--as-muted-foreground)]">
              {interpolate(TEXT.MINIAPPS_RESTORED_TO, { path: restoredTo })}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          {report?.canArm && (
            <Button size="sm" variant="outline" onClick={() => setArming(true)}>
              <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
              {TEXT.MINIAPPS_ARM}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>
            {TEXT.CLOSE_BUTTON}
          </Button>
        </ModalFooter>
      </ModalContent>
      {arming && <ArmModal runId={runId} onClose={() => setArming(false)} onChanged={load} />}
    </Modal>
  );
}
