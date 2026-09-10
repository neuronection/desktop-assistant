import { useEffect, useRef, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { ScreenSource } from '@shared/types';
import { TEXT } from '@shared/constants/text';

export interface ScreenPickerProps {
  onClose: () => void;
  onSelect: (sourceId: string) => void;
}

export function ScreenPicker({ onClose, onSelect }: ScreenPickerProps): JSX.Element {
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    (async () => {
      setSources(await window.electronAPI.getScreenSources());
    })();
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label={TEXT.PICKER_DIALOG_LABEL}>
      <div className="max-h-[80vh] w-[36rem] overflow-y-auto rounded-xl border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{TEXT.PICKER_TITLE}</h2>
          <Button ref={closeRef} variant="ghost" size="icon" onClick={onClose} aria-label={TEXT.CLOSE_BUTTON}>×</Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {sources.map((source) => (
            <button
              key={source.id}
              type="button"
              className="overflow-hidden rounded-lg border border-[var(--as-border)] text-left hover:border-[var(--as-primary)]"
              onClick={() => onSelect(source.id)}
            >
              {source.thumbnail ? (
                <img src={source.thumbnail} alt="" className="h-32 w-full object-cover" />
              ) : (
                <div className="flex h-32 items-center justify-center opacity-40">{TEXT.PICKER_NO_PREVIEW}</div>
              )}
              <span className="block truncate px-2 py-1 text-xs">{source.name}</span>
            </button>
          ))}
          {sources.length === 0 && <p className="col-span-2 text-sm opacity-50">{TEXT.PICKER_NO_SOURCES}</p>}
        </div>
      </div>
    </div>
  );
}
