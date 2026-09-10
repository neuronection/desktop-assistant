import { useEffect, useState } from 'react';

/**
 * Shared mount/unmount pattern for exit animations (plan 12 D7): keep a
 * node mounted while its `.da-presence.da-exiting` leave transition
 * plays, then unmount. Render `mounted && <div className="da-presence"
 * + (visible ? '' : 'da-exiting')>`.
 */
export function usePresence(visible: boolean, exitMs = 200): boolean {
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [visible, exitMs]);

  return mounted;
}

/** Class for the exit frame of the shared presence pattern. */
export function presenceClass(visible: boolean, base = 'da-presence'): string {
  return visible ? base : `${base} da-exiting`;
}
