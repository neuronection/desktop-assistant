import { useEffect, useRef } from 'react';

export const PUSH_TO_TALK_ARM_MS = 200;

export interface UsePushToTalkOptions {
  enabled: boolean;
  onStart: () => Promise<unknown> | unknown;
  onStop: () => void;
  armDelayMs?: number;
}

export function usePushToTalk({
  enabled,
  onStart,
  onStop,
  armDelayMs = PUSH_TO_TALK_ARM_MS,
}: UsePushToTalkOptions): void {
  const onStartRef = useRef(onStart);
  const onStopRef = useRef(onStop);
  onStartRef.current = onStart;
  onStopRef.current = onStop;

  const ctrlHeldRef = useRef(false);
  const activeRef = useRef(false);
  const armTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const clearArm = (): void => {
      if (armTimerRef.current !== null) {
        window.clearTimeout(armTimerRef.current);
        armTimerRef.current = null;
      }
    };

    const stop = (): void => {
      clearArm();
      if (activeRef.current) {
        activeRef.current = false;
        onStopRef.current();
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Control') {
        if (event.repeat || ctrlHeldRef.current) {
          return;
        }
        ctrlHeldRef.current = true;
        clearArm();
        armTimerRef.current = window.setTimeout(() => {
          armTimerRef.current = null;
          if (ctrlHeldRef.current && !activeRef.current) {
            activeRef.current = true;
            void onStartRef.current();
          }
        }, armDelayMs);
        return;
      }
      if (ctrlHeldRef.current) {
        stop();
      }
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== 'Control') {
        return;
      }
      ctrlHeldRef.current = false;
      stop();
    };

    const onBlur = (): void => {
      ctrlHeldRef.current = false;
      stop();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      clearArm();
      stop();
      ctrlHeldRef.current = false;
    };
  }, [enabled, armDelayMs]);
}
