import type { ReactElement } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { Modal, ModalContent, ModalBody, ModalFooter, ModalHeader, ModalTitle } from '@neuronection/assistant-ui/modal';
import { TEXT, interpolate } from '@shared/constants/text';
import type { MiniAppRunDiffView } from '@shared/app-pack';

export function DiffModal({ diff, onClose }: { diff: MiniAppRunDiffView; onClose: () => void }): ReactElement {
  const kindLabel: Record<string, string> = {
    new: TEXT.MINIAPPS_RUN_DIFF_NEW,
    removed: TEXT.MINIAPPS_RUN_DIFF_REMOVED,
    changed: TEXT.MINIAPPS_RUN_DIFF_CHANGED,
    'verdict-change': TEXT.MINIAPPS_RUN_DIFF_CHANGED,
  };
  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{TEXT.MINIAPPS_RUN_DIFF}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {diff.baselineRunId === null ? (
            <p className="text-sm text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_RUN_DIFF_EMPTY}</p>
          ) : diff.entries.length === 0 ? (
            <p className="text-sm text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_RUN_DIFF_NONE}</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
              {diff.entries.map((entry) => (
                <li key={`${entry.kind}:${entry.relPath}`} className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {kindLabel[entry.kind]}
                  </Badge>
                  <span className="truncate">{entry.relPath}</span>
                  {entry.kind === 'verdict-change' && (
                    <span className="text-xs text-[var(--as-muted-foreground)]">
                      {interpolate(TEXT.MINIAPPS_RUN_DIFF_VERDICT, { before: entry.before ?? '?', after: entry.after ?? '?' })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {TEXT.CLOSE_BUTTON}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
