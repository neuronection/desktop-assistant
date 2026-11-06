import type { ReactElement } from 'react';
import { Modal, ModalBody, ModalContent, ModalHeader, ModalTitle } from '@neuronection/assistant-ui/modal';
import { beginDialog, endDialog } from '@renderer/chat-react/dialogGuard';
import type { MiniAppView } from '@shared/app-pack';
import { LaunchPane } from '@renderer/shared/LaunchPane';
import { startAssessmentLaunch } from '@renderer/shared/PackLaunchMenu';
import type { LaunchOutcome } from '@renderer/shared/LaunchPane';
import type { PackLaunchValues } from '@renderer/shared/PackLaunchMenu';

/**
 * The settings host for the shared launch menu (plan 53 S3.4): the same
 * `LaunchPane` the palette uses, mounted in a modal — one component, two
 * hosts. Persistence lives in the pane; the dispatch here is the
 * assessment run start.
 */
export function PackLaunchDialog({
  pack,
  onClose,
  onStarted,
}: {
  pack: MiniAppView;
  onClose: () => void;
  onStarted: () => void;
}): ReactElement {
  const launch = async (values: PackLaunchValues): Promise<LaunchOutcome | void> => {
    const started = await startAssessmentLaunch(pack, values);
    if (started.error !== undefined) {
      return { error: started.error };
    }
    onStarted();
    return;
  };

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent size="md">
        <ModalHeader>
          <ModalTitle className="min-w-0 truncate">{pack.title}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <LaunchPane
            pack={pack}
            showBack={false}
            onBack={onClose}
            onLaunch={launch}
            onBrowsePath={async () => {
              beginDialog();
              try {
                const picked = await window.electronAPI.pickMiniAppRoot();
                return picked.ok ? picked.root : null;
              } finally {
                endDialog();
              }
            }}
          />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
