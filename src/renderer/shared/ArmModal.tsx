import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { Modal, ModalContent, ModalBody, ModalFooter, ModalHeader, ModalTitle } from '@neuronection/assistant-ui/modal';
import { TEXT, interpolate } from '@shared/constants/text';

interface ArmItem {
  relPath: string;
  confidence: number | null;
  category: string | null;
}

export function ArmModal({ runId, onClose, onChanged }: { runId: string; onClose: () => void; onChanged: () => Promise<void> }): ReactElement {
  const [items, setItems] = useState<ArmItem[] | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ moved: number; changed: number; failed: number; skipped: number } | null>(null);

  useEffect(() => {
    void (async () => {
      const armed = await window.electronAPI.armMiniAppRun(runId);
      if (!armed.ok) {
        setError(interpolate(TEXT.MINIAPPS_ARM_FAILED, { error: armed.error }));
        return;
      }
      const proposal = armed.proposal as { id: string; payload: { items: ArmItem[] } };
      setProposalId(proposal.id);
      setItems(proposal.payload.items);
    })();
  }, [runId]);

  const resolve = useCallback(
    async (approve: boolean) => {
      if (!proposalId) {
        onClose();
        return;
      }
      const result = await window.electronAPI.resolveMiniAppProposal(proposalId, approve);
      if (result.ok && Array.isArray(result.outcome)) {
        const entries = result.outcome as { outcome: string }[];
        setOutcome({
          moved: entries.filter((entry) => entry.outcome === 'moved').length,
          changed: entries.filter((entry) => entry.outcome === 'changed' || entry.outcome === 'ask').length,
          failed: entries.filter((entry) => entry.outcome === 'failed').length,
          skipped: entries.filter((entry) => entry.outcome === 'skipped').length,
        });
        await onChanged();
        return;
      }
      onClose();
    },
    [proposalId, onClose, onChanged]
  );

  const groups = useMemo(() => {
    const map = new Map<string, ArmItem[]>();
    for (const item of items ?? []) {
      const key = item.category ?? '—';
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent className="max-w-xl">
        <ModalHeader>
          <ModalTitle>{interpolate(TEXT.MINIAPPS_ARM_TITLE, { count: String(items?.length ?? 0) })}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {error && <p role="alert" className="text-sm text-[var(--as-destructive)]">{error}</p>}
          {!error && !items && <p className="text-sm text-[var(--as-muted-foreground)]">…</p>}
          {items && items.length === 0 && <p className="text-sm text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_ARM_EMPTY}</p>}
          {items && items.length > 0 && (
            <>
              <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_ARM_BODY}</p>
              {groups.map(([category, groupItems]) => (
                <section key={category} aria-label={category} className="space-y-1">
                  <h4 className="text-xs font-medium">{category}</h4>
                  <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                    {groupItems.map((item) => (
                      <li key={item.relPath} className="flex items-center gap-2">
                        <span className="truncate">{item.relPath}</span>
                        <span className="ml-auto text-[var(--as-muted-foreground)]">
                          {item.confidence !== null ? item.confidence.toFixed(2) : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
          {outcome && (
            <p role="status" className="text-sm">
              {interpolate(TEXT.MINIAPPS_ARM_RESULT, {
                moved: String(outcome.moved),
                changed: String(outcome.changed),
                failed: String(outcome.failed),
                skipped: String(outcome.skipped),
              })}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          {outcome ? (
            <Button size="sm" onClick={onClose}>
              {TEXT.CLOSE_BUTTON}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => void resolve(false)}>
                {TEXT.MINIAPPS_ARM_REJECT}
              </Button>
              <Button size="sm" disabled={!items || items.length === 0} onClick={() => void resolve(true)}>
                {TEXT.MINIAPPS_ARM_CONFIRM}
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
