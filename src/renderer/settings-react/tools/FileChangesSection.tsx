import { useCallback, useEffect, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import type { FileSnapshotListEntry } from '@shared/files';
import { TEXT, interpolate } from '@shared/constants/text';

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} kB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileChangesSection(): JSX.Element {
  const [rows, setRows] = useState<FileSnapshotListEntry[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRows(await window.electronAPI.listFileSnapshots());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revert = async (id: string): Promise<void> => {
    setError(null);
    try {
      const result = await window.electronAPI.revertFileSnapshot(id);
      if (!result.ok) {
        setError(interpolate(TEXT.FILE_CHANGES_ERROR, { error: result.error }));
      }
    } catch (cause) {
      setError(interpolate(TEXT.FILE_CHANGES_ERROR, { error: (cause as Error).message }));
    }
    setConfirmId(null);
    await load();
  };

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{TEXT.FILE_CHANGES_TITLE}</h3>
      <p className="text-xs opacity-60">{TEXT.FILE_CHANGES_HINT}</p>
      {error && (
        <p role="alert" className="text-xs" style={{ color: 'var(--as-danger)' }}>
          {error}
        </p>
      )}
      {rows !== null && rows.length === 0 && <p className="text-sm opacity-60">{TEXT.FILE_CHANGES_EMPTY}</p>}
      {rows !== null && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row) => {
            const blocked = !row.allowed || !row.available;
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--as-border)] px-3 py-2"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate font-mono text-xs" title={row.path}>
                    {row.path}
                  </p>
                  <p className="text-[11px] opacity-60">
                    {interpolate(TEXT.FILE_CHANGES_WHEN, {
                      date: new Date(row.createdAt).toLocaleString(),
                      size: formatSize(row.size),
                    })}
                  </p>
                  {!row.allowed && <p className="text-[11px]" style={{ color: 'var(--as-danger)' }}>{TEXT.FILE_CHANGES_BLOCKED}</p>}
                  {row.allowed && !row.available && (
                    <p className="text-[11px]" style={{ color: 'var(--as-danger)' }}>{TEXT.FILE_CHANGES_UNAVAILABLE}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {confirmId === row.id ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setConfirmId(null)}>
                        {TEXT.FILE_CHANGES_CANCEL}
                      </Button>
                      <Button size="sm" onClick={() => void revert(row.id)}>
                        {TEXT.FILE_CHANGES_CONFIRM}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={blocked}
                      onClick={() => {
                        setError(null);
                        setConfirmId(row.id);
                      }}
                    >
                      {TEXT.FILE_CHANGES_REVERT}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
