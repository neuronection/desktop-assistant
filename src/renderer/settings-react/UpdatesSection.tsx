import { useCallback, useEffect, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { AppConfig } from '@shared/config/AppConfig';
import { TEXT, interpolate } from '@shared/constants/text';
import type { UpdateApplyState, UpdateState } from '@shared/types';
import { SelectField } from './tabs/fields';

const APPLY_IDLE: UpdateApplyState = {
  supported: false,
  reason: null,
  mode: null,
  phase: 'idle',
  progress: null,
  error: null,
};

function checkErrorMessage(reason: string | null): string {
  const value = reason ?? '';
  if (/(404|failed to fetch|fetch failed|network|timeout|ENOTFOUND|ECONN|ETIMEDOUT)/i.test(value)) {
    return TEXT.UPDATE_CHECK_UNREACHABLE;
  }
  return TEXT.UPDATE_CHECK_INVALID;
}

function applyErrorMessage(reason: string | null): string {
  const value = reason ?? '';
  if (/^(dev|supported|nothing-offered|unsupported)$/i.test(value) || /feed-disagreement/i.test(value)) {
    return TEXT.UPDATE_APPLY_UNAVAILABLE;
  }
  if (/(checksum|download-failed|truncated|invalid-asset|no-asset|updater-unavailable)/i.test(value)) {
    return TEXT.UPDATE_APPLY_UNVERIFIED;
  }
  if (/open-failed/i.test(value)) {
    return TEXT.UPDATE_APPLY_OPEN_FAILED;
  }
  return TEXT.UPDATE_APPLY_UNKNOWN;
}

export interface UpdatesSectionProps {
  config: AppConfig;
  onChange: (updates: Partial<AppConfig>) => void;
}

export function UpdatesSection({ config, onChange }: UpdatesSectionProps): JSX.Element {
  const [state, setState] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await window.electronAPI.getUpdateStatus());
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const offProgress = window.electronAPI.onUpdateProgress((update) => {
      setProgress(update.percent);
    });
    const offState = window.electronAPI.onUpdateState?.((next) => {
      setState(next);
    });
    return () => {
      offProgress();
      offState?.();
    };
  }, [refresh]);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      setState(await window.electronAPI.checkForUpdates());
    } catch {
      setState(null);
    } finally {
      setChecking(false);
    }
  }, []);

  const runApply = useCallback(async () => {
    setApplying(true);
    try {
      await window.electronAPI.applyUpdate();
    } catch {
      void 0;
    } finally {
      await refresh();
      setApplying(false);
    }
  }, [refresh]);

  const release = state?.release ?? null;
  const apply = state?.apply ?? APPLY_IDLE;
  const releaseLabel =
    release?.channel === 'beta'
      ? interpolate(TEXT.UPDATE_AVAILABLE_BETA, { version: release.tag })
      : interpolate(TEXT.UPDATE_AVAILABLE_STABLE, { version: release?.tag ?? '' });
  const downloading = applying || apply.phase === 'downloading';

  return (
    <section aria-label={TEXT.UPDATE_CHANNEL_LABEL} className="mt-8 space-y-4 border-t border-[var(--as-border)] pt-6">
      <SelectField
        id="update-channel"
        label={TEXT.UPDATE_CHANNEL_LABEL}
        value={config.updates.channel}
        options={[
          { value: 'stable', label: TEXT.UPDATE_CHANNEL_STABLE },
          { value: 'beta', label: TEXT.UPDATE_CHANNEL_BETA },
        ]}
        onChange={(next) => {
          onChange({ updates: { channel: next as AppConfig['updates']['channel'] } });
        }}
        hint={TEXT.UPDATE_CHANNEL_HINT}
      />
      <div className="space-y-2" role="status">
        {release ? (
          <>
            <p className="text-sm font-semibold">{releaseLabel}</p>
            {(release.excerpt ?? release.notes) && (
              <p className="text-sm opacity-70">{(release.excerpt ?? release.notes ?? '').slice(0, 400)}</p>
            )}
            {apply.supported ? (
              apply.phase === 'opened' ? (
                <p className="text-sm" role="status">
                  {TEXT.UPDATE_OPENED}
                </p>
              ) : apply.phase === 'downloaded' ? (
                <Button size="sm" onClick={() => void window.electronAPI.installUpdate()}>
                  {TEXT.UPDATE_RESTART}
                </Button>
              ) : (
                <div className="space-y-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={downloading}
                    onClick={() => void runApply()}
                  >
                    {downloading
                      ? interpolate(TEXT.UPDATE_DOWNLOADING, { percent: progress ?? apply.progress ?? 0 })
                      : apply.phase === 'error'
                        ? TEXT.UPDATE_RETRY
                        : TEXT.UPDATE_APPLY}
                  </Button>
                  {downloading && (
                    <div
                      className="h-1 w-full overflow-hidden rounded-full bg-[var(--as-border)]"
                      role="progressbar"
                      aria-valuenow={progress ?? apply.progress ?? 0}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full bg-[var(--as-fg)]"
                        style={{ width: `${progress ?? apply.progress ?? 0}%` }}
                      />
                    </div>
                  )}
                </div>
              )
            ) : (
              <p className="text-xs opacity-60">{TEXT.UPDATE_MANUAL_HINT}</p>
            )}
            {apply.phase === 'error' && (
              <p className="text-xs text-red-400" role="alert">
                {applyErrorMessage(apply.error)}
              </p>
            )}
            <Button variant="outline" size="sm" onClick={() => void window.electronAPI.openReleasePage()}>
              {TEXT.UPDATE_OPEN_RELEASE}
            </Button>
          </>
        ) : (
          <p className="text-sm opacity-80">
            {state?.status === 'checking'
              ? TEXT.UPDATE_CHECKING
              : state?.status === 'error'
                ? checkErrorMessage(state.error)
                : state?.status === 'up-to-date'
                  ? TEXT.UPDATE_UP_TO_DATE
                  : TEXT.UPDATE_NOT_CHECKED}
          </p>
        )}
        <p className="text-xs opacity-50">
          {interpolate(TEXT.UPDATE_LAST_CHECKED, {
            when: state?.lastCheckedAt
              ? new Date(state.lastCheckedAt).toLocaleString()
              : TEXT.UPDATE_LAST_CHECKED_NEVER,
          })}
        </p>
      </div>
      {!release && (
        <Button variant="outline" size="sm" disabled={checking} onClick={() => void runCheck()}>
          {checking ? TEXT.UPDATE_CHECKING : TEXT.UPDATE_CHECK_NOW}
        </Button>
      )}
    </section>
  );
}
