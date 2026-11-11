import { useCallback, useEffect, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import type { AppConfig } from '@shared/config/AppConfig';
import type { ClipboardEntryView, ClipboardStatus } from '@shared/clipboard';
import { TEXT, interpolate } from '@shared/constants/text';

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function ClipboardSection(): JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<ClipboardStatus | null>(null);
  const [entries, setEntries] = useState<ClipboardEntryView[] | null>(null);
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const [loaded, nextStatus, nextEntries] = await Promise.all([
      window.electronAPI.loadConfig(),
      window.electronAPI.getClipboardStatus(),
      window.electronAPI.listClipboardEntries(query),
    ]);
    setConfig(loaded);
    setStatus(nextStatus);
    setEntries(nextEntries);
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Partial<AppConfig['clipboard']>): Promise<void> => {
    if (!config) {
      return;
    }
    const next = { ...config, clipboard: { ...config.clipboard, ...patch } };
    setConfig(next);
    await window.electronAPI.saveConfig(next);
    setStatus(await window.electronAPI.getClipboardStatus());
  };

  const clipboard = config?.clipboard;

  return (
    <section className="space-y-4" role="tabpanel" aria-label={TEXT.CLIPBOARD_TITLE}>
      <section className="space-y-1">
        <h3 className="text-base font-semibold">{TEXT.CLIPBOARD_TITLE}</h3>
        <p className="text-sm opacity-60">{TEXT.CLIPBOARD_HINT}</p>
      </section>

      {status && !status.encryptionAvailable && (
        <p className="text-xs" style={{ color: 'var(--as-danger)' }}>{TEXT.CLIPBOARD_SESSION_ONLY}</p>
      )}

      {clipboard && (
        <section className="space-y-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{TEXT.CLIPBOARD_ENABLE}</span>
            <input
              type="checkbox"
              checked={clipboard.enabled}
              onChange={(event) => void save({ enabled: event.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{TEXT.CLIPBOARD_PAUSE}</span>
            <input
              type="checkbox"
              checked={clipboard.paused}
              disabled={!clipboard.enabled}
              onChange={(event) => void save({ paused: event.target.checked })}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="opacity-70">{TEXT.CLIPBOARD_RETENTION}</span>
              <input
                className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                type="number"
                min={1}
                max={168}
                value={clipboard.retentionHours}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) {
                    void save({ retentionHours: Math.min(168, Math.max(1, Math.round(value))) });
                  }
                }}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="opacity-70">{TEXT.CLIPBOARD_MAX}</span>
              <input
                className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                type="number"
                min={10}
                max={500}
                value={clipboard.maxEntries}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) {
                    void save({ maxEntries: Math.min(500, Math.max(10, Math.round(value))) });
                  }
                }}
              />
            </label>
          </div>
        </section>
      )}

      {clipboard?.enabled ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
              aria-label={TEXT.CLIPBOARD_SEARCH}
              placeholder={TEXT.CLIPBOARD_SEARCH}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {confirmClear ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setConfirmClear(false)}>
                  {TEXT.CLIPBOARD_CANCEL}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    void window.electronAPI.clearClipboardHistory().then(() => {
                      setConfirmClear(false);
                      void load();
                    });
                  }}
                >
                  {TEXT.CLIPBOARD_CONFIRM_CLEAR}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirmClear(true)}>
                {TEXT.CLIPBOARD_CLEAR}
              </Button>
            )}
          </div>
          {entries !== null && entries.length === 0 && <p className="text-sm opacity-60">{TEXT.CLIPBOARD_EMPTY}</p>}
          {entries !== null && entries.length > 0 && (
            <ul className="space-y-2">
              {entries.map((entry) => (
                <li key={entry.id} className="space-y-1 rounded-md border border-[var(--as-border)] px-3 py-2">
                  <p className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-xs">{entry.text}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] opacity-60">
                    <span>
                      {interpolate(TEXT.CLIPBOARD_ENTRY_WHEN, { date: formatDate(entry.createdAt) })}
                      {entry.sessionOnly ? ` · ${TEXT.CLIPBOARD_SESSION_BADGE}` : ''}
                    </span>
                    <span className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => void window.electronAPI.pinClipboardEntry(entry.id, !entry.pinned).then(load)}>
                        {entry.pinned ? TEXT.CLIPBOARD_UNPIN : TEXT.CLIPBOARD_PIN}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void window.electronAPI.copyClipboardEntry(entry.id)}>
                        {TEXT.CLIPBOARD_COPY}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void window.electronAPI.removeClipboardEntry(entry.id).then(load)}>
                        {TEXT.CLIPBOARD_DELETE}
                      </Button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className="text-sm opacity-60">{TEXT.CLIPBOARD_OFF}</p>
      )}
    </section>
  );
}
