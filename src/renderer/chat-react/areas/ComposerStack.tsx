import type { JSX, ReactNode } from 'react';
import type { TurnInterruptPayload, TurnStepProgress } from '@shared/turns';
import type { ApprovalCardProps } from '../ApprovalCard';
import { ApprovalCard } from '../ApprovalCard';
import { DownloadCard } from '../DownloadCard';

interface ComposerStackProps {
  noticeBanner: ReactNode;
  pendingApproval: TurnInterruptPayload | null;
  resolveApproval: ApprovalCardProps['onResolve'];
  activeDownload: TurnStepProgress | null;
  paletteNode: ReactNode;
  miniAppsSurface: ReactNode;
  composer: ReactNode;
}

/** Expanded-mode composer slot: everything stacked above the composer —
 * notices, the approval card or an active download, the palette, the
 * mini-app surface and the composer itself. */
export function ComposerStack({
  noticeBanner,
  pendingApproval,
  resolveApproval,
  activeDownload,
  paletteNode,
  miniAppsSurface,
  composer,
}: ComposerStackProps): JSX.Element {
  return (
    <div data-no-drag className="contents">
      {noticeBanner}
      {pendingApproval && (
        <ApprovalCard
          variant="rich"
          requests={pendingApproval.requests}
          deadline={pendingApproval.deadline}
          onResolve={resolveApproval}
          className="mb-2"
        />
      )}
      {!pendingApproval && activeDownload && (
        <DownloadCard
          variant="rich"
          progress={activeDownload}
          onCancel={(id) => void window.electronAPI.cancelDownload(id)}
          className="mb-2"
        />
      )}
      {paletteNode}
      {miniAppsSurface}
      {composer}
    </div>
  );
}
