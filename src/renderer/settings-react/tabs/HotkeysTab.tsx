import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { HotkeyConfig, HotkeySettings } from '@shared/types';
import { TEXT, interpolate } from '@shared/constants/text';

export interface HotkeysTabProps {
  hotkeys: HotkeySettings;
  onHotkeysChange: (settings: HotkeySettings) => void;
}

function acceleratorFromEvent(event: KeyboardEvent): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
    return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey) { parts.push('Control'); }
  if (event.altKey) { parts.push('Alt'); }
  if (event.shiftKey) { parts.push('Shift'); }
  if (event.metaKey) { parts.push('Command'); }
  let key = event.key.toUpperCase();
  if (key === ' ') { key = 'Space'; }
  if (key.startsWith('ARROW')) { key = key.substring(5); }
  parts.push(key);
  return parts.join('+');
}

export function HotkeysTab({ hotkeys, onHotkeysChange }: HotkeysTabProps): JSX.Element {
  const [recording, setRecording] = useState<HotkeyConfig | null>(null);
  const [pendingAccelerator, setPendingAccelerator] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) {
      return undefined;
    }
    const handler = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecording(null);
        return;
      }
      setPendingAccelerator(acceleratorFromEvent(event));
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recording]);

  const entries = Object.values(hotkeys);
  const editable = entries.filter((h) => h.isEditable);
  const fixed = entries.filter((h) => !h.isEditable);

  const saveRecording = (): void => {
    if (recording) {
      onHotkeysChange({
        ...hotkeys,
        [recording.action]: { ...recording, accelerator: pendingAccelerator },
      });
    }
    setRecording(null);
    setPendingAccelerator(null);
  };

  const renderList = (items: HotkeyConfig[], canEdit: boolean): JSX.Element => (
    <ul className="space-y-2">
      {items.map((hotkey) => (
        <li
          key={hotkey.action}
          className="flex items-center justify-between rounded-md border border-[var(--as-border)] px-3 py-2"
        >
          <span className="text-sm">{hotkey.label}</span>
          <div className="flex items-center gap-3">
            <kbd className="rounded border border-[var(--as-border)] bg-[var(--as-muted)] px-2 py-0.5 text-xs">
              {hotkey.accelerator || TEXT.HOTKEYS_NOT_SET}
            </kbd>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPendingAccelerator(hotkey.accelerator);
                  setRecording(hotkey);
                }}
              >
                {TEXT.HOTKEYS_RECORD}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h3 className="text-base font-semibold">{TEXT.HOTKEYS_TITLE}</h3>
        <p className="text-sm opacity-60">{TEXT.HOTKEYS_SUBTITLE}</p>
      </section>
      <section className="space-y-2">
        <h4 className="text-sm font-semibold">{TEXT.HOTKEYS_EDITABLE}</h4>
        {renderList(editable, true)}
      </section>
      <section className="space-y-2">
        <h4 className="text-sm font-semibold">{TEXT.HOTKEYS_FIXED}</h4>
        {renderList(fixed, false)}
      </section>

      {recording && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label={interpolate(TEXT.HOTKEYS_DIALOG_LABEL, { label: recording.label })}>
          <div className="w-96 space-y-4 rounded-lg border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-5">
            <div>
              <h4 className="text-sm font-semibold">{interpolate(TEXT.HOTKEYS_DIALOG_TITLE, { label: recording.label })}</h4>
              <p className="mt-1 text-xs opacity-60">{TEXT.HOTKEYS_DIALOG_HINT}</p>
            </div>
            <div className="rounded-md border border-[var(--as-border)] bg-[var(--as-muted)] p-3 text-center font-mono text-sm">
              {pendingAccelerator || TEXT.HOTKEYS_PRESS_KEYS}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPendingAccelerator(null)}>{TEXT.HOTKEYS_CLEAR}</Button>
              <Button variant="outline" size="sm" onClick={() => { setRecording(null); setPendingAccelerator(null); }}>{TEXT.CANCEL_BUTTON}</Button>
              <Button size="sm" onClick={saveRecording}>{TEXT.SAVE_BUTTON}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
