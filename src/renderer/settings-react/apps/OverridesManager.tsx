import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { TEXT, interpolate } from '@shared/constants/text';

/**
 * The stored-overrides manager (plan 26 S5) + the rule-learning
 * affordance (plan 51 S6.3): a user-initiated suggestion pass over the
 * stored overrides — deterministic pattern inference first, one model
 * call only when that is ambiguous — rendered as an accept/reject card.
 * Accepting writes the globs into the pack's keep rules through the
 * normal save-config path; nothing is ever learned automatically.
 */
export function OverridesManager({ packId }: { packId: string }): ReactElement | null {
  const [rows, setRows] = useState<{ relPath: string; rootPath: string; verdict: string; source: string }[] | null>(null);
  const [suggestion, setSuggestion] = useState<{ globs: string[]; source: 'pattern' | 'model' } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await window.electronAPI.listMiniAppFeedback(packId));
  }, [packId]);

  useEffect(() => {
    void load();
  }, [load]);

  const suggest = useCallback(async () => {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const result = await window.electronAPI.learnMiniAppRules(packId);
      if (result.ok) {
        setSuggestion({ globs: result.globs, source: result.source });
      } else {
        setSuggestError(result.error);
      }
    } catch (error) {
      setSuggestError(error instanceof Error ? error.message : String(error));
    } finally {
      setSuggesting(false);
    }
  }, [packId]);

  const accept = useCallback(async () => {
    if (!suggestion) {
      return;
    }
    const state = await window.electronAPI.getMiniApps();
    const view = state.packs.find((pack) => pack.id === packId);
    const keepKey = view?.ruleBindings?.find((binding) => binding.list === 'keep')?.configKey;
    if (!view || !keepKey) {
      setSuggestion(null);
      return;
    }
    const existing = Array.isArray(view.configValues[keepKey]) ? (view.configValues[keepKey] as string[]) : [];
    const result = await window.electronAPI.saveMiniAppConfig(packId, {
      ...view.configValues,
      [keepKey]: [...existing, ...suggestion.globs.filter((glob) => !existing.includes(glob))],
    });
    setSuggestion(null);
    if (!result.ok) {
      setSuggestError(result.error);
    }
  }, [packId, suggestion]);

  if (rows === null || rows.length === 0) {
    return null;
  }

  return (
    <section aria-label={TEXT.MINIAPPS_OVERRIDES_SECTION} className="space-y-2 rounded-xl border border-[var(--as-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-medium">{TEXT.MINIAPPS_OVERRIDES_SECTION}</h4>
        <span className="flex items-center gap-1">
          <Button size="sm" variant="outline" disabled={suggesting} onClick={() => void suggest()} data-testid="overrides-suggest">
            {TEXT.MINIAPPS_OVERRIDES_SUGGEST}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { void (async () => { await window.electronAPI.clearMiniAppFeedback(packId); await load(); })(); }}>
            {TEXT.MINIAPPS_OVERRIDES_CLEAR_ALL}
          </Button>
        </span>
      </div>
      {suggestError && (
        <p role="alert" className="text-xs text-[var(--as-danger)]">
          {suggestError}
        </p>
      )}
      {suggestion && (
        <div className="space-y-1.5 rounded-lg border border-[var(--as-border)] p-2" data-testid="overrides-suggestion">
          <p className="text-xs font-medium">{interpolate(TEXT.MINIAPPS_OVERRIDES_SUGGESTED, { source: suggestion.source })}</p>
          <p className="text-[10px] text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_AI_LABEL}</p>
          <ul className="flex flex-wrap gap-1.5">
            {suggestion.globs.map((glob) => (
              <li key={glob} className="rounded-full border border-[var(--as-border)] bg-[var(--as-muted)] px-2 py-0.5 font-mono text-[11px]">
                {glob}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={() => void accept()} data-testid="overrides-suggestion-accept">
              {TEXT.MINIAPPS_OVERRIDES_ACCEPT}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)} data-testid="overrides-suggestion-reject">
              {TEXT.MINIAPPS_OVERRIDES_REJECT}
            </Button>
          </div>
        </div>
      )}
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
