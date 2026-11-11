import { useCallback, useEffect, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import type { FileRevertError, FileSnapshotListEntry } from '@shared/files';
import { TEXT, interpolate } from '@shared/constants/text';

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return interpolate(TEXT.FILE_CHANGES_UNIT_B, { value: String(bytes) });
  }
  if (bytes < 1024 * 1024) {
    return interpolate(TEXT.FILE_CHANGES_UNIT_KB, { value: (bytes / 1024).toFixed(1) });
  }
  return interpolate(TEXT.FILE_CHANGES_UNIT_MB, { value: (bytes / (1024 * 1024)).toFixed(1) });
}

const ERROR_TEXT: Record<FileRevertError, string> = {
  'not-found': TEXT.FILE_CHANGES_ERROR_NOT_FOUND,
  'blob-missing': TEXT.FILE_CHANGES_ERROR_BLOB_MISSING,
  'outside-granted-roots': TEXT.FILE_CHANGES_ERROR_OUTSIDE_GRANTED_ROOTS,
  'not-a-file': TEXT.FILE_CHANGES_ERROR_NOT_A_FILE,
  'write-failed': TEXT.FILE_CHANGES_ERROR_WRITE_FAILED,
  'snapshot-failed': TEXT.FILE_CHANGES_ERROR_SNAPSHOT_FAILED,
};

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
        setError(interpolate(TEXT.FILE_CHANGES_ERROR, { error: ERROR_TEXT[result.error] }));
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
                      {!row.existed && (
                        <span className="text-[11px]" style={{ color: 'var(--as-danger)' }}>
                          {TEXT.FILE_CHANGES_DELETE_HINT}
                        </span>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setConfirmId(null)}>
                        {TEXT.FILE_CHANGES_CANCEL}
                      </Button>
                      <Button size="sm" onClick={() => void revert(row.id)}>
                        {row.existed ? TEXT.FILE_CHANGES_CONFIRM_RESTORE : TEXT.FILE_CHANGES_CONFIRM_DELETE}
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
