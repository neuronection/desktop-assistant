import { useEffect, useRef, useState, type JSX } from 'react';
import { ArrowDownToLine, X } from 'lucide-react';
import type { TurnStepProgress, TurnTraceStep } from '@shared/turns';
import { TEXT, interpolate } from '@shared/constants/text';

export function findActiveDownload(steps: TurnTraceStep[]): TurnStepProgress | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.endedAt === undefined && step.progress?.status === 'active') {
      return step.progress;
    }
  }
  return null;
}

export interface DownloadCardProps {
  progress: TurnStepProgress;
  variant?: 'compact' | 'rich';
  onCancel?: (downloadId: string) => void;
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${bytes} B`;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function DownloadCard(props: DownloadCardProps): JSX.Element {
  const { progress, variant = 'compact', onCancel, className = '' } = props;
  const [speed, setSpeed] = useState<number | null>(null);
  const last = useRef<{ loaded: number; at: number } | null>(null);

  useEffect(() => {
    if (progress.status !== 'active') {
      return;
    }
    const previous = last.current;
    const now = Date.now();
    if (previous && now > previous.at) {
      const instant = ((progress.loadedBytes - previous.loaded) / (now - previous.at)) * 1000;
      if (instant >= 0) {
        setSpeed((current) => (current === null ? instant : current * 0.7 + instant * 0.3));
      }
    }
    last.current = { loaded: progress.loadedBytes, at: now };
  }, [progress.loadedBytes, progress.status]);

  const percent =
    progress.totalBytes && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100))
      : null;
  const indeterminate = percent === null;
  const name = baseName(progress.destination);

  const bar = (
    <div
      className={`relative w-full overflow-hidden rounded-full bg-[var(--as-muted)] ${
        variant === 'compact' ? 'h-1.5' : 'h-2'
      }`}
    >
      {indeterminate ? (
        <div className="da-download-indeterminate h-full w-1/3 rounded-full bg-gradient-to-r from-[var(--as-primary)] via-[var(--as-primary)]/70 to-[var(--as-primary)]" />
      ) : (
        <div
          className="da-download-fill h-full rounded-full bg-gradient-to-r from-[var(--as-primary)] to-[var(--as-primary)]/70"
          style={{ width: `${percent}%` }}
        />
      )}
    </div>
  );

  const meta = (
    <span className="shrink-0 tabular-nums opacity-70">
      {percent !== null
        ? interpolate(TEXT.DOWNLOAD_PERCENT, { percent })
        : formatBytes(progress.loadedBytes)}
      {speed !== null && speed > 0 ? ` · ${interpolate(TEXT.DOWNLOAD_SPEED, { speed: formatBytes(Math.round(speed)) })}` : ''}
    </span>
  );

  if (variant === 'compact') {
    return (
      <div
        data-no-drag
        role="status"
        aria-label={TEXT.DOWNLOAD_GROUP_LABEL}
        className={`da-rise flex items-center gap-2 rounded-xl border border-[var(--as-border)] bg-[var(--as-surface)]/80 px-3 py-1.5 text-xs ${className}`}
      >
        <ArrowDownToLine className="h-3.5 w-3.5 shrink-0 text-[var(--as-primary)]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{name}</span>
          <span className="mt-0.5 block">{bar}</span>
        </span>
        {meta}
        <button
          type="button"
          className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
          aria-label={TEXT.DOWNLOAD_CANCEL}
          onClick={() => onCancel?.(progress.downloadId)}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div
      data-no-drag
      role="status"
      aria-label={TEXT.DOWNLOAD_GROUP_LABEL}
      className={`da-rise rounded-xl border border-[var(--as-border)] bg-[var(--as-surface)]/80 p-3 text-sm ${className}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <ArrowDownToLine className="h-4 w-4 text-[var(--as-primary)]" aria-hidden />
        <span className="font-medium">{TEXT.DOWNLOAD_TITLE}</span>
        <span className="min-w-0 truncate text-xs opacity-70" title={progress.destination}>
          {name}
        </span>
        <span className="ml-auto shrink-0">{meta}</span>
        <button
          type="button"
          className="shrink-0 rounded p-1 opacity-60 transition-opacity hover:opacity-100"
          aria-label={TEXT.DOWNLOAD_CANCEL}
          onClick={() => onCancel?.(progress.downloadId)}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {bar}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs opacity-60">
        <span className="shrink-0 tabular-nums">
          {progress.totalBytes
            ? interpolate(TEXT.DOWNLOAD_BYTES, {
                loaded: formatBytes(progress.loadedBytes),
                total: formatBytes(progress.totalBytes),
              })
            : interpolate(TEXT.DOWNLOAD_UNKNOWN_SIZE, { loaded: formatBytes(progress.loadedBytes) })}
        </span>
        <span className="min-w-0 truncate" title={progress.destination}>
          {progress.destination}
        </span>
      </div>
    </div>
  );
}
