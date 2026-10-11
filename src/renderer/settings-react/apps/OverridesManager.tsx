import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { TEXT } from '@shared/constants/text';

export function OverridesManager({ packId }: { packId: string }): ReactElement | null {
  const [rows, setRows] = useState<{ relPath: string; rootPath: string; verdict: string; source: string }[] | null>(null);

  const load = useCallback(async () => {
    setRows(await window.electronAPI.listMiniAppFeedback(packId));
  }, [packId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows === null || rows.length === 0) {
    return null;
  }

  return (
    <section aria-label={TEXT.MINIAPPS_OVERRIDES_SECTION} className="space-y-2 rounded-xl border border-[var(--as-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-medium">{TEXT.MINIAPPS_OVERRIDES_SECTION}</h4>
        <Button size="sm" variant="outline" onClick={() => { void (async () => { await window.electronAPI.clearMiniAppFeedback(packId); await load(); })(); }}>
          {TEXT.MINIAPPS_OVERRIDES_CLEAR_ALL}
        </Button>
      </div>
      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
        {rows.map((row) => (
          <li key={`${row.rootPath}:${row.relPath}`} className="flex flex-wrap items-center gap-2">
            <span className="truncate" title={`${row.rootPath}/${row.relPath}`}>{row.relPath}</span>
            <Badge variant="outline" className="text-[10px]">{row.verdict}</Badge>
            <Badge variant="secondary" className="text-[10px]">{row.source}</Badge>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { void (async () => { await window.electronAPI.clearMiniAppFeedback(packId, row.relPath); await load(); })(); }}>
              {TEXT.MINIAPPS_OVERRIDES_CLEAR}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
