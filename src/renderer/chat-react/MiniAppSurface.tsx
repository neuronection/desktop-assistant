import { useState, type JSX } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { TEXT, interpolate } from '@shared/constants/text';
import type { MiniApp, SurfaceLiveState } from './miniApps';
import { MiniAppIcon } from './miniAppsIcon';

export interface MiniAppSurfaceProps {
  app: MiniApp;
  input: string;
  copied: boolean;
  live: SurfaceLiveState | null;
  onCopy: () => void;
  onExit: () => void;
}

function copyAffordance(copied: boolean): JSX.Element {
  return copied ? (
    <>
      <Check className="h-3 w-3 text-[var(--as-primary)]" aria-hidden />
      {TEXT.COMMAND_COPY_DONE}
    </>
  ) : (
    <>
      <Copy className="h-3 w-3" aria-hidden />
      {TEXT.COPY_BUTTON}
    </>
  );
}

/** Mini-app pad chrome (plan 14 §9): mode bar + the active pack's generic live rows — no per-app branches. */
export function MiniAppSurface(props: MiniAppSurfaceProps): JSX.Element {
  const { app, copied, live, onCopy, onExit } = props;
  const [rowHover, setRowHover] = useState(false);
  const hasInput = props.input.trim().length > 0;

  return (
    <div className="mb-2 flex flex-col gap-1.5">
      <div
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
        style={{ backgroundColor: 'color-mix(in srgb, var(--as-primary) 10%, transparent)' }}
      >
        <span
          className="flex size-5 items-center justify-center rounded-md text-white"
          style={{ backgroundColor: app.accent }}
        >
          <MiniAppIcon app={app} />
        </span>
        <span className="text-xs font-medium">{app.title}</span>
        <span className="text-[10px] opacity-60">{app.hint}</span>
        <button
          type="button"
          className="ml-auto opacity-60 hover:opacity-100"
          aria-label={interpolate(TEXT.COMMAND_MINI_EXIT_TITLE, { app: app.title })}
          onClick={onExit}
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      </div>
      {hasInput &&
        (live?.rows ?? []).map((row, index) => {
          if (row.kind === 'pending') {
            return (
              <div key={index} role="status" className="px-1.5 py-1 text-xs opacity-60" data-no-drag>
                {row.label}
              </div>
            );
          }
          if (row.kind === 'error') {
            return (
              <div key={index} role="alert" className="px-1.5 py-1 text-xs text-red-500" data-no-drag>
                {row.message}
              </div>
            );
          }
          if (row.variant === 'compact') {
            const revealCopy = rowHover || copied;
            return (
              <button
                key={index}
                type="button"
                data-no-drag
                role="status"
                aria-label={TEXT.COMMAND_COPY_RESULT}
                onClick={onCopy}
                onMouseEnter={() => setRowHover(true)}
                onMouseLeave={() => setRowHover(false)}
                className="flex w-full items-center gap-2 rounded-lg border border-[var(--as-border)] bg-[var(--as-surface)]/70 px-2.5 py-1.5 text-left text-sm font-medium transition-colors hover:border-[var(--as-primary)]/50"
              >
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                <span
                  className="flex shrink-0 items-center gap-1 text-xs font-normal"
                  style={{ opacity: revealCopy ? 1 : 0, transition: 'opacity 120ms ease' }}
                >
                  {copyAffordance(copied)}
                </span>
              </button>
            );
          }
          return (
            <div
              key={index}
              data-no-drag
              className="da-rise overflow-hidden rounded-lg border border-[var(--as-border)] bg-[var(--as-surface-raised)]"
            >
              <div
                aria-live="polite"
                className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words p-2 text-sm"
              >
                {row.value}
              </div>
              <div className="flex items-center gap-2 border-t border-[var(--as-border)] px-2 py-1 text-[10px] opacity-70">
                {row.meta && <span className="min-w-0 truncate">{row.meta}</span>}
                <button
                  type="button"
                  aria-label={TEXT.COMMAND_COPY_RESULT}
                  onClick={onCopy}
                  className="ml-auto flex shrink-0 items-center gap-1 text-xs opacity-80 hover:opacity-100"
                >
                  {copyAffordance(copied)}
                </button>
              </div>
            </div>
          );
        })}
    </div>
  );
}
