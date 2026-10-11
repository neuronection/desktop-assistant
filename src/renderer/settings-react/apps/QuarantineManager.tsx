import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { TEXT, interpolate } from '@shared/constants/text';

export function QuarantineManager({ packId, packTitle, onEmptied }: { packId: string; packTitle: string; onEmptied: () => Promise<void> }): ReactElement | null {
  const [records, setRecords] = useState<{ id: string; relPath: string; movedAt: number; restoredAt: number | null }[] | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [restoredCount, setRestoredCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    const list = await window.electronAPI.listMiniAppQuarantine(packId);
    setRecords(list?.records ?? []);
  }, [packId]);

  useEffect(() => {
    void load();
  }, [load]);

  const restoreOne = useCallback(
    async (recordId: string) => {
      await window.electronAPI.restoreMiniAppQuarantineRecord(recordId);
      await load();
    },
    [load]
  );

  const restoreAll = useCallback(async () => {
    let restored = 0;
    for (const record of (records ?? []).filter((entry) => entry.restoredAt === null)) {
      const result = await window.electronAPI.restoreMiniAppQuarantineRecord(record.id);
      if (result.ok) {
        restored += 1;
      }
    }
    setRestoredCount(restored);
    await load();
  }, [records, load]);

  if (records === null || records.length === 0) {
    return null;
  }

  return (
    <section aria-label={TEXT.MINIAPPS_QUARANTINE_SECTION} className="space-y-2 rounded-xl border border-[var(--as-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-medium">{TEXT.MINIAPPS_QUARANTINE_SECTION}</h4>
        <span className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => void restoreAll()}>
            {TEXT.MINIAPPS_QUARANTINE_RESTORE_ALL}
          </Button>
          <Button size="sm" variant="outline" className="text-[var(--as-destructive)]" onClick={() => setConfirmEmpty(true)}>
            {TEXT.MINIAPPS_QUARANTINE_EMPTY_BTN}
          </Button>
        </span>
      </div>
      {restoredCount !== null && (
        <p role="status" className="text-xs text-[var(--as-muted-foreground)]">
          {interpolate(TEXT.MINIAPPS_QUARANTINE_RESTORED_COUNT, { count: String(restoredCount) })}
        </p>
      )}
      <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
        {records.map((record) => (
          <li key={record.id} className="flex flex-wrap items-center gap-2">
            <span className="truncate" title={record.relPath}>{record.relPath}</span>
            {record.restoredAt !== null ? (
              <Badge variant="outline" className="text-[10px]">{TEXT.MINIAPPS_REVIEW_DONE}</Badge>
            ) : (
              <Button variant="ghost" size="sm" className="ml-auto" aria-label={TEXT.MINIAPPS_RESTORE_ITEM} onClick={() => void restoreOne(record.id)}>
                {TEXT.MINIAPPS_RESTORE_ITEM}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {confirmEmpty && (
        <ConfirmationModal
          open
          onOpenChange={(open) => !open && setConfirmEmpty(false)}
          title={TEXT.MINIAPPS_QUARANTINE_CONFIRM_TITLE}
          description={interpolate(TEXT.MINIAPPS_QUARANTINE_CONFIRM_BODY, { title: packTitle })}
          confirmLabel={TEXT.MINIAPPS_QUARANTINE_EMPTY_BTN}
          destructive
          onConfirm={() => {
            void (async () => {
              await window.electronAPI.emptyMiniAppQuarantine(packId);
              setConfirmEmpty(false);
              await load();
              await onEmptied();
            })();
          }}
        />
      )}
    </section>
  );
}
