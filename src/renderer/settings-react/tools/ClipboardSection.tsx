import { useCallback, useEffect, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import type { AppConfig } from '@shared/config/AppConfig';
import type { ClipboardEntryView, ClipboardStatus } from '@shared/clipboard';
import { TEXT, interpolate } from '@shared/constants/text';

export interface ClipboardSectionProps {
  config?: AppConfig;
  onChange?: (updates: Partial<AppConfig>) => void;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function ClipboardSection({ config: draft, onChange }: ClipboardSectionProps): JSX.Element {
  const [loaded, setLoaded] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<ClipboardStatus | null>(null);
  const [entries, setEntries] = useState<ClipboardEntryView[] | null>(null);
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retentionDraft, setRetentionDraft] = useState('');
  const [maxDraft, setMaxDraft] = useState('');
  const config = draft ?? loaded;

  const loadEntries = useCallback(async (): Promise<void> => {
    try {
      setEntries(await window.electronAPI.listClipboardEntries(query));
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
      setEntries([]);
    }
  }, [query]);

  useEffect(() => {
    void (async () => {
      const [nextStatus, nextConfig] = await Promise.all([
        window.electronAPI.getClipboardStatus(),
        draft ? Promise.resolve(draft) : window.electronAPI.loadConfig(),
      ]);
      setStatus(nextStatus);
      setLoaded(nextConfig);
    })().catch((cause) => setError((cause as Error).message));
  }, [draft]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (!config?.clipboard.enabled) {
      return undefined;
    }
    const timer = setInterval(() => void loadEntries(), 3_000);
    return () => clearInterval(timer);
  }, [config?.clipboard.enabled, loadEntries]);

  useEffect(() => {
    if (config) {
      setRetentionDraft(String(config.clipboard.retentionHours));
      setMaxDraft(String(config.clipboard.maxEntries));
    }
  }, [config]);

  const save = async (patch: Partial<AppConfig['clipboard']>): Promise<void> => {
    if (!config) {
      return;
    }
    const next = { ...config, clipboard: { ...config.clipboard, ...patch } };
    if (onChange) {
      onChange({ clipboard: next.clipboard });
      return;
    }
    setLoaded(next);
    await window.electronAPI.saveConfig(next);
    setStatus(await window.electronAPI.getClipboardStatus());
  };

  const commitNumber = (field: 'retentionHours' | 'maxEntries', raw: string, min: number, max: number): void => {
    const value = Number(raw);
    if (!Number.isFinite(value) || raw.trim() === '') {
      setRetentionDraft(String(config?.clipboard.retentionHours ?? 24));
      setMaxDraft(String(config?.clipboard.maxEntries ?? 200));
      return;
    }
    void save({ [field]: Math.min(max, Math.max(min, Math.round(value))) } as Partial<AppConfig['clipboard']>);
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
      {status && status.unreadable > 0 && (
        <p className="text-xs" style={{ color: 'var(--as-danger)' }}>
          {interpolate(TEXT.CLIPBOARD_UNREADABLE, { count: String(status.unreadable) })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs" style={{ color: 'var(--as-danger)' }}>{error}</p>
      )}

      {clipboard && (
        <section className="space-y-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{TEXT.CLIPBOARD_ENABLE}</span>
            <input type="checkbox" checked={clipboard.enabled} onChange={(event) => void save({ enabled: event.target.checked })} />
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
                value={retentionDraft}
                onChange={(event) => setRetentionDraft(event.target.value)}
                onBlur={() => commitNumber('retentionHours', retentionDraft, 1, 168)}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="opacity-70">{TEXT.CLIPBOARD_MAX}</span>
              <input
                className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                type="number"
                min={10}
                max={500}
                value={maxDraft}
                onChange={(event) => setMaxDraft(event.target.value)}
                onBlur={() => commitNumber('maxEntries', maxDraft, 10, 500)}
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
            <Button variant="ghost" size="sm" onClick={() => void loadEntries()}>
              {TEXT.DATA_COST_REFRESH}
            </Button>
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
                      void loadEntries();
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
              {entries.map((entry, index) => (
                <li key={entry.id} className="space-y-1 rounded-md border border-[var(--as-border)] px-3 py-2">
                  <p className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-xs">{entry.text}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] opacity-60">
                    <span>
                      {interpolate(TEXT.CLIPBOARD_ENTRY_WHEN, { date: formatDate(entry.createdAt) })}
                      {entry.sessionOnly ? ` · ${TEXT.CLIPBOARD_SESSION_BADGE}` : ''}
                    </span>
                    <span className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${entry.pinned ? TEXT.CLIPBOARD_UNPIN : TEXT.CLIPBOARD_PIN} ${index + 1}`}
                        onClick={() => void window.electronAPI.pinClipboardEntry(entry.id, !entry.pinned).then(loadEntries)}
                      >
                        {entry.pinned ? TEXT.CLIPBOARD_UNPIN : TEXT.CLIPBOARD_PIN}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${TEXT.CLIPBOARD_COPY} ${index + 1}`}
                        onClick={() => void window.electronAPI.copyClipboardEntry(entry.id)}
                      >
                        {TEXT.CLIPBOARD_COPY}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${TEXT.CLIPBOARD_DELETE} ${index + 1}`}
                        onClick={() => void window.electronAPI.removeClipboardEntry(entry.id).then(loadEntries)}
                      >
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
