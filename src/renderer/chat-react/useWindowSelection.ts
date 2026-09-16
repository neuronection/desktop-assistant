import { useEffect, useState } from 'react';

/** Non-empty text selections inside the window (capped for speech). */
export function useWindowSelection(enabled: boolean, cap = 2000): string {
  const [selection, setSelection] = useState('');

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const handler = (): void => {
      const text = window.getSelection()?.toString().trim() ?? '';
      setSelection(text.length > 1 ? text.slice(0, cap) : '');
    };
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, [enabled, cap]);

  return selection;
}
