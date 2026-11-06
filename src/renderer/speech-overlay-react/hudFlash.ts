import { useEffect, useState } from 'react';

/** Terminal error flash (2 s) shared by every HUD style. */
export function useHudFlash(lastError: string | null, utteranceId: number): string | null {
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!lastError) {
      setFlash(null);
      return undefined;
    }
    setFlash(lastError);
    const timer = setTimeout(() => setFlash(null), 2000);
    return () => clearTimeout(timer);
  }, [lastError, utteranceId]);

  return flash;
}
