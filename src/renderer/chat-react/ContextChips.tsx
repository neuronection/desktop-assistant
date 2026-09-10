import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Clipboard } from 'lucide-react';
import { TEXT } from '@shared/constants/text';

interface ClipboardChange {
  changed: boolean;
  text?: string;
  preview?: string;
}

/**
 * Summon-scoped clipboard chip (plan 12 §2), rendered in flow above the
 * composer. Main-gated by `behavior.clipboardWatcher`; poll-on-summon
 * only, content enters the prompt only when the user clicks. (Selection
 * capture moved to the composer toolbar as an opt-in button.)
 */
export function ContextChips({ onInsert }: { onInsert: (text: string) => void }): JSX.Element | null {
  const [summons, setSummons] = useState(0);
  const [clipboardChip, setClipboardChip] = useState<ClipboardChange | null>(null);
  const summonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;
    const api = window.electronAPI;
    if (!api?.clipboardChanged || !api?.onFocusInput) {
      return;
    }
    const unsubscribe = api.onFocusInput(() => {
      setSummons((count) => count + 1);
    });
    return () => {
      disposed = true;
      unsubscribe();
      if (summonTimer.current) {
        clearTimeout(summonTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (summons === 0) {
      return;
    }
    setClipboardChip(null);
    const api = window.electronAPI;
    if (!api?.clipboardChanged) {
      return;
    }
    if (summonTimer.current) {
      clearTimeout(summonTimer.current);
    }
    summonTimer.current = setTimeout(() => {
      void api
        .clipboardChanged()
        .then((change) => {
          setClipboardChip(change.changed ? change : null);
        })
        .catch(() => undefined);
    }, 150);
  }, [summons]);

  const insertClipboard = useCallback(() => {
    if (clipboardChip?.text) {
      onInsert(clipboardChip.text);
    }
  }, [clipboardChip, onInsert]);

  if (!clipboardChip?.changed || !clipboardChip.text) {
    return null;
  }

  return (
    <div data-no-drag className="da-rise flex flex-wrap items-center gap-1.5 px-1">
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-full border border-[var(--as-border)] bg-[var(--as-surface)]/70 px-2.5 py-1 text-xs opacity-80 transition-colors hover:opacity-100"
        onClick={insertClipboard}
      >
        <Clipboard className="h-3 w-3" aria-hidden />
        {TEXT.CONTEXT_CLIPBOARD}
        {clipboardChip.preview && (
          <span className="max-w-40 truncate opacity-60">— {clipboardChip.preview}</span>
        )}
      </button>
    </div>
  );
}
