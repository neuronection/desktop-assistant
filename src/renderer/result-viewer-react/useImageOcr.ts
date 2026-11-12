import { useCallback, useEffect, useState } from 'react';
import type { OcrOutcome } from '@shared/ai/ocr';

export type ImageTextAction = 'copy' | 'insert' | 'search' | 'translate';

export interface ImageOcrState {
  result: OcrOutcome | null;
  busy: boolean;
  translated: string | null;
  notice: string | null;
  read: () => Promise<void>;
  act: (action: ImageTextAction, text: string) => Promise<void>;
  copyImage: () => Promise<void>;
  reset: () => void;
}

/**
 * OCR for the image viewer (plan 82, revised): one implementation for every
 * image the app shows — a draft capture, an upload, a transcript image or a
 * stored tool result. The engine choice and every action live in main; this
 * hook only holds the panel's state.
 */
export function useImageOcr(source: string | null, labels: {
  copied: string;
  inserted: string;
  search: string;
}): ImageOcrState {
  const [result, setResult] = useState<OcrOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [translated, setTranslated] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reset = useCallback((): void => {
    setResult(null);
    setTranslated(null);
    setNotice(null);
    setBusy(false);
  }, []);

  useEffect(() => {
    reset();
  }, [source, reset]);

  const read = useCallback(async (): Promise<void> => {
    if (!source || busy) {
      return;
    }
    const api = window.electronAPI;
    if (typeof api?.runImageOcr !== 'function') {
      return;
    }
    setBusy(true);
    setNotice(null);
    setTranslated(null);
    try {
      const outcome = (await api.runImageOcr(source)) as OcrOutcome;
      setResult(outcome);
    } catch {
      setResult({ ok: false, reason: 'failed' });
    } finally {
      setBusy(false);
    }
  }, [busy, source]);

  const act = useCallback(
    async (action: ImageTextAction, text: string): Promise<void> => {
      const api = window.electronAPI;
      if (typeof api?.runImageTextAction !== 'function' || !text.trim()) {
        return;
      }
      const outcome = await api.runImageTextAction({ action, text });
      if (action === 'translate') {
        setTranslated(outcome.ok ? outcome.text ?? '' : null);
        return;
      }
      if (!outcome.ok) {
        return;
      }
      if (action === 'copy') {
        setNotice(labels.copied);
      } else if (action === 'insert') {
        setNotice(labels.inserted);
      } else {
        setNotice(labels.search);
      }
    },
    [labels]
  );

  const copyImage = useCallback(async (): Promise<void> => {
    const api = window.electronAPI;
    if (!source || typeof api?.copyImage !== 'function') {
      return;
    }
    if (await api.copyImage(source)) {
      setNotice(labels.copied);
    }
  }, [labels.copied, source]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const timer = setTimeout(() => setNotice(null), 1800);
    return () => clearTimeout(timer);
  }, [notice]);

  return { result, busy, translated, notice, read, act, copyImage, reset };
}
