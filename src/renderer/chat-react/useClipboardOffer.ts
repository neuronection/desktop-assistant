import { useEffect, useRef, useState } from 'react';

export interface ClipboardOffer {
  text: string;
  preview?: string;
}

/**
 * Summon-scoped clipboard offer (plan 12 §2): polls main once per
 * summon (150 ms debounce) and surfaces the clipboard only when it
 * changed since the previous summon. Content is read only in the
 * renderer; it enters the prompt when the user clicks the toolbar
 * button.
 */
export function useClipboardOffer(): ClipboardOffer | null {
  const [summons, setSummons] = useState(0);
  const [offer, setOffer] = useState<ClipboardOffer | null>(null);
  const summonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.clipboardChanged || !api?.onFocusInput) {
      return undefined;
    }
    const unsubscribe = api.onFocusInput(() => {
      setSummons((count) => count + 1);
    });
    return () => {
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
    setOffer(null);
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
          setOffer(change.changed && change.text ? { text: change.text, preview: change.preview } : null);
        })
        .catch(() => undefined);
    }, 150);
  }, [summons]);

  return offer;
}
