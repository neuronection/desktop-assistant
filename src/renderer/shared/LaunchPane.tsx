import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ArrowLeft } from 'lucide-react';
import { TEXT } from '@shared/constants/text';
import type { MiniAppView } from '@shared/app-pack';
import { PackLaunchMenu, persistPackConfigValues } from './PackLaunchMenu';
import type { PackLaunchError, PackLaunchValues } from './PackLaunchMenu';

export interface LaunchOutcome {
  error?: PackLaunchError;
  notice?: string;
}

/**
 * The in-flow launch pane (plan 53 S3): renders the shared launch menu,
 * persists config-bound values through the one store, then delegates the
 * dispatch to the host. Escape steps back (commit-phase subscription with
 * a latest-ref — the repo's event-contract law); the host decides what
 * closes the pane on success.
 */
export function LaunchPane({
  pack,
  primaryLabel,
  showBack = true,
  onBack,
  onLaunch,
  onOpenRuns,
  onConfigure,
  onOpenWindow,
  onBrowsePath,
}: {
  pack: MiniAppView;
  primaryLabel?: string;
  showBack?: boolean;
  onBack: () => void;
  onLaunch: (values: PackLaunchValues) => Promise<LaunchOutcome | void>;
  onOpenRuns?: () => void;
  onConfigure?: () => void;
  onOpenWindow?: () => void;
  onBrowsePath?: () => Promise<string | null>;
}): JSX.Element {
  const [error, setError] = useState<PackLaunchError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const backRef = useRef(onBack);

  useLayoutEffect(() => {
    backRef.current = onBack;
  }, [onBack]);

  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        backRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  useLayoutEffect(() => {
    const first = paneRef.current?.querySelector<HTMLElement>(
      '[data-testid^="launch-option-"] input, [data-testid^="launch-option-"] select, [data-testid^="launch-option-"] button, [data-testid="launch-primary"]'
    );
    first?.focus();
  }, []);

  const handleLaunch = useCallback(
    async (values: PackLaunchValues): Promise<void> => {
      setLaunching(true);
      setError(null);
      setNotice(null);
      const persisted = await persistPackConfigValues(pack, values);
      let outcome: LaunchOutcome | void = undefined;
      try {
        outcome = await onLaunch(values);
      } finally {
        setLaunching(false);
      }
      if (outcome?.error) {
        setError(outcome.error);
        return;
      }
      if (outcome?.notice !== undefined) {
        setNotice(outcome.notice);
      }
      if (!persisted) {
        setNotice(TEXT.MINIAPPS_LAUNCH_SAVE_FAILED);
      }
    },
    [pack, onLaunch]
  );

  return (
    <div ref={paneRef} data-testid="launch-pane" className="flex flex-col gap-1.5">
      {showBack && (
        <div className="flex items-center gap-1.5 px-0.5">
          <button
            type="button"
            data-testid="launch-back"
            aria-label={TEXT.MINIAPPS_LAUNCH_BACK}
            className="rounded p-0.5 opacity-70 hover:opacity-100"
            onClick={onBack}
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span className="text-xs font-medium">{pack.title}</span>
        </div>
      )}
      <PackLaunchMenu
        view={pack}
        primaryLabel={primaryLabel}
        error={error}
        notice={notice}
        launching={launching}
        onLaunch={(values) => void handleLaunch(values)}
        onOpenRuns={onOpenRuns}
        onConfigure={onConfigure}
        onOpenWindow={onOpenWindow}
        onBrowsePath={onBrowsePath}
      />
    </div>
  );
}
