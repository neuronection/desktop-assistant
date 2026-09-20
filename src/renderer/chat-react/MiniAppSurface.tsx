import { useState, type JSX } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { evaluateExpression, formatCalcResult } from '@shared/commands';
import { TEXT, interpolate } from '@shared/constants/text';
import { translationEngineLabel } from '@shared/translation';
import { MiniAppIcon, type MiniApp } from './miniApps';

export type MiniTranslationState =
  | { status: 'pending' }
  | { status: 'ok'; text: string; engine: string; target: string; source?: string }
  | { status: 'error'; message: string };

export interface MiniAppSurfaceProps {
  app: MiniApp;
  input: string;
  copied: boolean;
  translation: MiniTranslationState | null;
  onCopy: () => void;
  onExit: () => void;
}

/** Mini-app pad chrome (plan 14 §9): accent bar + live calc/translate rows — shared by every surface. */
export function MiniAppSurface(props: MiniAppSurfaceProps): JSX.Element {
  const { app, input, copied, translation, onCopy, onExit } = props;
  const [rowHover, setRowHover] = useState(false);

  const calcRow = (() => {
    if (app.id !== 'calc:evaluate' || !input.trim()) {
      return null;
    }
    const result = evaluateExpression(input.trim());
    if (!result.ok) {
      return null;
    }
    const revealCopy = rowHover || copied;
    return (
      <button
        type="button"
        data-no-drag
        role="status"
        aria-label={TEXT.COMMAND_COPY_RESULT}
        onClick={onCopy}
        onMouseEnter={() => setRowHover(true)}
        onMouseLeave={() => setRowHover(false)}
        className="flex w-full items-center gap-2 rounded-lg border border-[var(--as-border)] bg-[var(--as-surface)]/70 px-2.5 py-1.5 text-left text-sm font-medium transition-colors hover:border-[var(--as-primary)]/50"
      >
        <span className="min-w-0 flex-1 truncate">
          {interpolate(TEXT.COMMAND_CALC_RESULT, { value: formatCalcResult(result.value) })}
        </span>
        <span
          className="flex shrink-0 items-center gap-1 text-xs font-normal"
          style={{ opacity: revealCopy ? 1 : 0, transition: 'opacity 120ms ease' }}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-[var(--as-primary)]" aria-hidden />
              {TEXT.COMMAND_COPY_DONE}
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" aria-hidden />
              {TEXT.COPY_BUTTON}
            </>
          )}
        </span>
      </button>
    );
  })();

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
      {calcRow}
      {app.id === 'tool:translate' && input.trim() && translation?.status === 'pending' && (
        <div role="status" className="px-1.5 py-1 text-xs opacity-60" data-no-drag>
          {TEXT.TRANSLATION_MINI_PENDING}
        </div>
      )}
      {app.id === 'tool:translate' && input.trim() && translation?.status === 'error' && (
        <div role="alert" className="px-1.5 py-1 text-xs text-red-500" data-no-drag>
          {interpolate(TEXT.TRANSLATION_MINI_ERROR, { error: translation.message })}
        </div>
      )}
      {app.id === 'tool:translate' && input.trim() && translation?.status === 'ok' && (
        <div
          data-no-drag
          className="da-rise overflow-hidden rounded-lg border border-[var(--as-border)] bg-[var(--as-surface-raised)]"
        >
          <div
            aria-live="polite"
            className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words p-2 text-sm"
          >
            {translation.text}
          </div>
          <div className="flex items-center gap-2 border-t border-[var(--as-border)] px-2 py-1 text-[10px] opacity-70">
            <span className="min-w-0 truncate">
              {interpolate(TEXT.TRANSLATE_RESULT_META, {
                engine: translationEngineLabel(translation.engine),
                route: translation.source ? `${translation.source} → ${translation.target}` : `→ ${translation.target}`,
              })}
            </span>
            <button
              type="button"
              aria-label={TEXT.COMMAND_COPY_RESULT}
              onClick={onCopy}
              className="ml-auto flex shrink-0 items-center gap-1 text-xs opacity-80 hover:opacity-100"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-[var(--as-primary)]" aria-hidden />
                  {TEXT.COMMAND_COPY_DONE}
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" aria-hidden />
                  {TEXT.COPY_BUTTON}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
