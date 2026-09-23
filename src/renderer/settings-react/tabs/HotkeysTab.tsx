import { useEffect, useMemo, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { HotkeyAction, HotkeyConfig, HotkeySettings } from '@shared/types';
import type { CommandHotkeyBinding } from '@shared/config/AppConfig';
import { TEXT, interpolate } from '@shared/constants/text';

export interface HotkeysTabProps {
  hotkeys: HotkeySettings;
  onHotkeysChange: (settings: HotkeySettings) => void;
  /** User-defined commands available for hotkey binding (plan 12 §4). */
  commandOptions?: { id: string; title: string }[];
  commandBindings?: Record<string, CommandHotkeyBinding>;
  onCommandBindingChange?: (commandId: string, accelerator: string | null) => void;
}

interface RecordingTarget {
  label: string;
  accelerator: string | null;
  action?: HotkeyAction;
  commandId?: string;
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

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform ?? '');

/** In-window keys that are not configurable global hotkeys (plan 25 settings note). */
const FIXED_IN_WINDOW_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Control', label: TEXT.HOTKEYS_FIXED_PUSH_TO_TALK },
  { keys: 'Escape', label: TEXT.HOTKEYS_FIXED_ESCAPE },
  { keys: 'Ctrl+E', label: TEXT.HOTKEYS_FIXED_EXPAND },
  { keys: 'Ctrl+D', label: TEXT.HOTKEYS_FIXED_DESKTOP },
  { keys: 'Ctrl+K', label: TEXT.HOTKEYS_FIXED_PALETTE },
];

function normalizeAccelerator(accelerator: string): string {
  return accelerator.replace(/CommandOrControl/gi, isMac ? 'Command' : 'Control');
}

export function HotkeysTab(props: HotkeysTabProps): JSX.Element {
  const { hotkeys, onHotkeysChange, commandOptions = [], commandBindings = {}, onCommandBindingChange } = props;
  const [recording, setRecording] = useState<RecordingTarget | null>(null);
  const [pendingAccelerator, setPendingAccelerator] = useState<string | null>(null);
  const [bindingError, setBindingError] = useState<string | null>(null);

  const takenByActions = useMemo(
    () =>
      new Set(
        Object.values(hotkeys)
          .map((hotkey) => hotkey.accelerator)
          .filter((accelerator): accelerator is string => Boolean(accelerator))
          .map(normalizeAccelerator)
      ),
    [hotkeys]
  );

  const takenByCommands = useMemo(
    () =>
      new Set(
        Object.entries(commandBindings)
          .filter(([commandId, binding]) => binding?.accelerator && commandId !== recording?.commandId)
          .map(([, binding]) => normalizeAccelerator(binding.accelerator))
      ),
    [commandBindings, recording]
  );

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

  const acceleratorTaken = (accelerator: string | null): boolean => {
    if (!accelerator) {
      return false;
    }
    const normalized = normalizeAccelerator(accelerator);
    if (recording?.commandId && takenByActions.has(normalized)) {
      return true;
    }
    if (recording?.commandId && takenByCommands.has(normalized)) {
      return true;
    }
    if (recording?.action && takenByCommands.has(normalized)) {
      return true;
    }
    if (recording?.action) {
      const owner = Object.values(hotkeys).find(
        (hotkey) => hotkey.action !== recording.action && hotkey.accelerator && normalizeAccelerator(hotkey.accelerator) === normalized
      );
      return Boolean(owner);
    }
    return false;
  };

  const saveRecording = (): void => {
    if (!recording) {
      return;
    }
    if (acceleratorTaken(pendingAccelerator)) {
      setBindingError(interpolate(TEXT.HOTKEYS_TAKEN, { accelerator: pendingAccelerator ?? '' }));
      return;
    }
    setBindingError(null);
    if (recording.action) {
      const action = recording.action;
      onHotkeysChange({
        ...hotkeys,
        [action]: { ...hotkeys[action], accelerator: pendingAccelerator },
      });
    } else if (recording.commandId && onCommandBindingChange) {
      onCommandBindingChange(recording.commandId, pendingAccelerator);
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
                  setBindingError(null);
                  setRecording({ label: hotkey.label, accelerator: hotkey.accelerator, action: hotkey.action });
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
      {commandOptions.length > 0 && onCommandBindingChange && (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">{TEXT.HOTKEYS_COMMANDS_TITLE}</h4>
          <p className="text-xs opacity-60">{TEXT.HOTKEYS_COMMANDS_HINT}</p>
          <ul className="space-y-2">
            {commandOptions.map((command) => {
              const binding = commandBindings[command.id];
              return (
                <li
                  key={command.id}
                  className="flex items-center justify-between rounded-md border border-[var(--as-border)] px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm" title={command.title}>
                    {command.title}
                  </span>
                  <div className="flex items-center gap-3">
                    <kbd className="rounded border border-[var(--as-border)] bg-[var(--as-muted)] px-2 py-0.5 text-xs">
                      {binding?.accelerator || TEXT.HOTKEYS_NOT_SET}
                    </kbd>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setPendingAccelerator(binding?.accelerator ?? null);
                        setBindingError(null);
                        setRecording({ label: command.title, accelerator: binding?.accelerator ?? null, commandId: command.id });
                      }}
                    >
                      {TEXT.HOTKEYS_RECORD}
                    </Button>
                    {binding?.accelerator && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onCommandBindingChange(command.id, null)}
                      >
                        {TEXT.HOTKEYS_CLEAR_BUTTON}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section className="space-y-2">
        <h4 className="text-sm font-semibold">{TEXT.HOTKEYS_FIXED}</h4>
        {renderList(fixed, false)}
        <ul className="space-y-2">
          {FIXED_IN_WINDOW_SHORTCUTS.map((shortcut) => (
            <li
              key={shortcut.label}
              className="flex items-center justify-between rounded-md border border-[var(--as-border)] px-3 py-2"
            >
              <span className="text-sm">{shortcut.label}</span>
              <kbd className="rounded border border-[var(--as-border)] bg-[var(--as-muted)] px-2 py-0.5 text-xs">
                {shortcut.keys}
              </kbd>
            </li>
          ))}
        </ul>
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
            {bindingError && (
              <p role="alert" className="text-xs text-[var(--as-danger)]">
                {bindingError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPendingAccelerator(null)}>{TEXT.HOTKEYS_CLEAR}</Button>
              <Button variant="outline" size="sm" onClick={() => { setRecording(null); setPendingAccelerator(null); setBindingError(null); }}>{TEXT.CANCEL_BUTTON}</Button>
              <Button size="sm" onClick={saveRecording}>{TEXT.SAVE_BUTTON}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
