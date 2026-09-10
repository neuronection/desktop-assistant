import type { JSX } from 'react';
import { ThemeType } from '@shared/constants/themes';
import { AppConfig } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';
import { Label } from './fields';

export interface GeneralTabProps {
  config: AppConfig;
  onChange: (updates: Partial<AppConfig>) => void;
  onThemeChange: (theme: ThemeType) => void;
}

export function GeneralTab({ config, onChange, onThemeChange }: GeneralTabProps): JSX.Element {
  const theme = config.theme || ThemeType.CLASSIC;
  const autostart = config.preferences?.autostart ?? false;
  const behavior = {
    defaultMode: config.behavior?.defaultMode ?? 'launcher',
    autoExpand: config.behavior?.autoExpand ?? true,
    notifyOnComplete: config.behavior?.notifyOnComplete ?? true,
    hideOnBlur: config.behavior?.hideOnBlur ?? false,
    traceDetails: config.behavior?.traceDetails ?? false,
    memoryContext: config.behavior?.memoryContext ?? true,
    selectionCapture: config.behavior?.selectionCapture ?? false,
    clipboardWatcher: config.behavior?.clipboardWatcher ?? false,
  };

  const setBehavior = (patch: Partial<typeof behavior>): void => {
    onChange({ behavior: { ...behavior, ...patch } });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h3 className="text-base font-semibold">{TEXT.GENERAL_TITLE}</h3>
        <p className="text-sm opacity-60">{TEXT.GENERAL_SUBTITLE}</p>
      </section>
      <div className="space-y-1">
        <Label htmlFor="theme-select">{TEXT.GENERAL_THEME}</Label>
        <select
          id="theme-select"
          className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-3 py-2 text-sm"
          value={theme}
          onChange={(e) => {
            const next = e.target.value as ThemeType;
            onChange({ theme: next });
            onThemeChange(next);
          }}
        >
          {Object.values(ThemeType).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={autostart}
          onChange={(e) => onChange({ preferences: { ...config.preferences, autostart: e.target.checked } })}
        />
        {TEXT.GENERAL_AUTOSTART}
      </label>
      <div className="space-y-1">
        <Label htmlFor="default-mode">{TEXT.GENERAL_OPEN_ON_SUMMON}</Label>
        <select
          id="default-mode"
          className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-3 py-2 text-sm"
          value={behavior.defaultMode}
          onChange={(e) => setBehavior({ defaultMode: e.target.value as 'launcher' | 'desktop' })}
        >
          <option value="launcher">{TEXT.GENERAL_MODE_LAUNCHER}</option>
          <option value="desktop">{TEXT.GENERAL_MODE_DESKTOP}</option>
        </select>
        <p className="text-xs opacity-60">{TEXT.GENERAL_MODE_HINT}</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={behavior.autoExpand}
          onChange={(e) => setBehavior({ autoExpand: e.target.checked })}
        />
        {TEXT.GENERAL_AUTO_EXPAND}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={behavior.notifyOnComplete}
          onChange={(e) => setBehavior({ notifyOnComplete: e.target.checked })}
        />
        {TEXT.GENERAL_NOTIFY_COMPLETE}
      </label>
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={behavior.hideOnBlur}
            onChange={(e) => setBehavior({ hideOnBlur: e.target.checked })}
          />
          {TEXT.GENERAL_HIDE_ON_BLUR}
        </label>
        <p className="text-xs opacity-60">{TEXT.GENERAL_HIDE_ON_BLUR_HINT}</p>
      </div>
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={behavior.traceDetails}
            onChange={(e) => setBehavior({ traceDetails: e.target.checked })}
          />
          {TEXT.GENERAL_TRACE_DETAILS}
        </label>
        <p className="text-xs opacity-60">{TEXT.GENERAL_TRACE_DETAILS_HINT}</p>
      </div>
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={behavior.memoryContext}
            onChange={(e) => setBehavior({ memoryContext: e.target.checked })}
          />
          {TEXT.GENERAL_MEMORY_CONTEXT}
        </label>
        <p className="text-xs opacity-60">{TEXT.GENERAL_MEMORY_CONTEXT_HINT}</p>
      </div>
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={behavior.clipboardWatcher}
            onChange={(e) => setBehavior({ clipboardWatcher: e.target.checked })}
          />
          {TEXT.GENERAL_CLIPBOARD_WATCHER}
        </label>
        <p className="text-xs opacity-60">{TEXT.GENERAL_CLIPBOARD_WATCHER_HINT}</p>
      </div>
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={behavior.selectionCapture}
            onChange={(e) => setBehavior({ selectionCapture: e.target.checked })}
          />
          {TEXT.GENERAL_SELECTION_CAPTURE}
        </label>
        <p className="text-xs opacity-60">{TEXT.GENERAL_SELECTION_CAPTURE_HINT}</p>
      </div>
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.window?.transparent ?? false}
            onChange={(e) =>
              onChange({ window: { ...config.window, transparent: e.target.checked, transparentSet: true } })
            }
          />
          {TEXT.GENERAL_TRANSPARENT}
        </label>
        <p className="text-xs opacity-60">{TEXT.GENERAL_TRANSPARENT_HINT}</p>
      </div>
    </div>
  );
}
