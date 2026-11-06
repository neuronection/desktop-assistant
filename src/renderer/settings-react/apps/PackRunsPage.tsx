import type { ReactElement } from 'react';
import { PackRuns } from './PackRuns';
import { PackPageShell } from './PackPageShell';
import { TEXT } from '@shared/constants/text';
import type { MiniAppView } from '@shared/app-pack';

/**
 * The pack runs page (plan 49 phase 1): run history with start/cancel/
 * resume, exports, the changed-since-last-run diff, plus the quarantine
 * and stored-overrides managers (they ride inside PackRuns). Separation
 * of concerns: runs live independently of the pack's configuration.
 */
export function PackRunsPage({
  view,
  onBack,
  focusReportRunId,
}: {
  view: MiniAppView;
  onBack: () => void;
  focusReportRunId?: { packId: string; runId: string; at: number } | null;
}): ReactElement {
  return (
    <PackPageShell
      title={view.title}
      pageLabel={TEXT.MINIAPPS_RUNS_PAGE_ARIA}
      onBack={onBack}
    >
      <PackRuns
        packId={view.id}
        packTitle={view.title}
        focusReportRunId={focusReportRunId && focusReportRunId.packId === view.id ? focusReportRunId : null}
      />
    </PackPageShell>
  );
}
