import type { JSX, ReactNode } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import type { TurnInterruptPayload, TurnStepProgress } from '@shared/turns';
import type { ApprovalCardProps } from '../ApprovalCard';
import { ApprovalCard } from '../ApprovalCard';
import { ArtifactChips } from '../ArtifactChips';
import { DownloadCard } from '../DownloadCard';
import { FundCard } from '../FundCard';
import type { LauncherMenuConversation } from '../LauncherMenu';
import { LauncherMenu } from '../LauncherMenu';
import { TraceTimeline } from '../TraceTimeline';
import type { TurnMetadata } from '@shared/schema/turnMetadata';
import { TEXT } from '@shared/constants/text';

interface CompactFlowProps {
  noticeBanner: ReactNode;
  speechDiscovery?: ReactNode;
  speechHistory?: ReactNode;
  shortcutsSheet?: ReactNode;
  pendingApproval: TurnInterruptPayload | null;
  resolveApproval: ApprovalCardProps['onResolve'];
  activeDownload: TurnStepProgress | null;
  launcherDone: boolean;
  launcherFailed: boolean;
  lastMeta: TurnMetadata | undefined;
  traceDetails: boolean | undefined;
  artifacts: NonNullable<TurnMetadata['artifacts']>;
  failedMessage: string;
  onDismissError: () => void;
  menuOpen: boolean;
  conversations: LauncherMenuConversation[];
  activeId: string | null;
  onMenuToggleExpand: () => void;
  onMenuOpenDesktop: () => void;
  onMenuNewConversation: () => void;
  onMenuOpenSettings: () => void;
  onMenuHide: () => void;
  onMenuOpenAbout: () => void;
  onMenuOpenConversation: (id: string) => void;
  onMenuOpenConversationDesktop: (id: string) => void;
  onMenuOpenSpeechHistory: () => void;
  onMenuOpenShortcuts: () => void;
  onMenuClose: () => void;
  updateVersion?: string | null;
  onMenuOpenUpdate: () => void;
  fundOpen: boolean;
  onFundClose: () => void;
  paletteNode: ReactNode;
  miniAppsSurface: ReactNode;
  conversationMeta: ReactNode;
}

/** Compact launcher chrome stack: everything between the window top and
 * the composer — notices, approval/download cards, trace timelines, the
 * failure alert, the phase strip, the menus and the palette. */
export function CompactFlow({
  noticeBanner,
  speechDiscovery,
  speechHistory,
  shortcutsSheet,
  pendingApproval,
  resolveApproval,
  activeDownload,
  launcherDone,
  launcherFailed,
  lastMeta,
  traceDetails,
  artifacts,
  failedMessage,
  onDismissError,
  menuOpen,
  conversations,
  activeId,
  onMenuToggleExpand,
  onMenuOpenDesktop,
  onMenuNewConversation,
  onMenuOpenSettings,
  onMenuHide,
  onMenuOpenAbout,
  onMenuOpenConversation,
  onMenuOpenConversationDesktop,
  onMenuOpenSpeechHistory,
  onMenuOpenShortcuts,
  onMenuClose,
  updateVersion,
  onMenuOpenUpdate,
  fundOpen,
  onFundClose,
  paletteNode,
  miniAppsSurface,
  conversationMeta,
}: CompactFlowProps): JSX.Element {
  return (
    <>
      {noticeBanner}
      {speechDiscovery}
      {pendingApproval && (
        <ApprovalCard
          variant="compact"
          requests={pendingApproval.requests}
          deadline={pendingApproval.deadline}
          onResolve={resolveApproval}
        />
      )}
      {!pendingApproval && activeDownload && (
        <DownloadCard
          variant="compact"
          progress={activeDownload}
          onCancel={(id) => void window.electronAPI.cancelDownload(id)}
        />
      )}
      {launcherDone && lastMeta && traceDetails && (
        <div className="da-rise px-1">
          <TraceTimeline meta={lastMeta} />
          <ArtifactChips artifacts={artifacts} className="mt-1" />
        </div>
      )}
      {launcherDone && lastMeta && !traceDetails && artifacts.length > 0 && (
        <div className="da-rise px-1">
          <ArtifactChips artifacts={artifacts} className="mt-1" />
        </div>
      )}
      {launcherFailed && (
        <div
          className="da-rise flex items-start gap-2 rounded-xl border border-[var(--as-danger)]/40 bg-[var(--as-danger)]/10 px-3 py-2 text-xs"
          role="alert"
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 break-words">{failedMessage}</span>
          <button type="button" className="opacity-60 hover:opacity-100" onClick={onDismissError} aria-label={TEXT.LAUNCHER_DISMISS_ERROR}>
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
      {menuOpen && (
        <LauncherMenu
          conversations={conversations}
          activeId={activeId}
          onToggleExpand={onMenuToggleExpand}
          onOpenDesktop={onMenuOpenDesktop}
          onNewConversation={onMenuNewConversation}
          onOpenSettings={onMenuOpenSettings}
          onHide={onMenuHide}
          onOpenAbout={onMenuOpenAbout}
          onOpenConversation={onMenuOpenConversation}
          onOpenConversationDesktop={onMenuOpenConversationDesktop}
          onOpenSpeechHistory={onMenuOpenSpeechHistory}
          onOpenShortcuts={onMenuOpenShortcuts}
          onClose={onMenuClose}
          updateVersion={updateVersion}
          onOpenUpdate={onMenuOpenUpdate}
        />
      )}
      {fundOpen && <FundCard onClose={onFundClose} />}
      {speechHistory}
      {shortcutsSheet}
      {paletteNode}
      {miniAppsSurface}
      {conversationMeta}
    </>
  );
}
