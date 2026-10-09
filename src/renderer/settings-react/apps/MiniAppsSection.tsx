import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { Card } from '@neuronection/assistant-ui/card';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { EmptyState } from '@neuronection/assistant-ui/empty-state';
import { Trash2 } from 'lucide-react';
import { Switch } from '../tools/shared';
import { PackRuns } from './PackRuns';
import { TEXT, interpolate } from '@shared/constants/text';
import type { MiniAppConfigFieldView, MiniAppView, MiniAppsState } from '@shared/app-pack';const CAPABILITY_LABELS: Record<string, string> = {
  'fs-read': TEXT.MINIAPPS_CAP_FS_READ,
  'fs-write-quarantine': TEXT.MINIAPPS_CAP_FS_QUARANTINE,
  decision: TEXT.MINIAPPS_CAP_DECISION,
  llm: TEXT.MINIAPPS_CAP_LLM,
  run: TEXT.MINIAPPS_CAP_RUN,
  report: TEXT.MINIAPPS_CAP_REPORT,
  propose: TEXT.MINIAPPS_CAP_PROPOSE,
  ui: TEXT.MINIAPPS_CAP_UI,
};

function kindLabel(view: MiniAppView): string {
  return view.kind === 'assessment' ? TEXT.MINIAPPS_KIND_ASSESSMENT : TEXT.MINIAPPS_KIND_SURFACE;
}

function capabilityLabel(id: string): string {
  return CAPABILITY_LABELS[id] ?? id;
}

type Draft = Record<string, unknown>;

function draftFrom(view: MiniAppView): Draft {
  const draft: Draft = {};
  for (const field of view.configFields) {
    const value = view.configValues[field.name] ?? field.default;
    draft[field.name] = field.type === 'array' && Array.isArray(value) ? [...(value as string[])] : value;
  }
  return draft;
}

function ConfigField({
  field,
  value,
  onChange,
}: {
  field: MiniAppConfigFieldView;
  value: unknown;
  onChange: (next: unknown) => void;
}): ReactElement {
  const label = `config.${field.name}`;
  if (field.type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-3 py-1.5">
        <span className="text-sm">{label}</span>
        <Switch checked={value === true} onCheckedChange={onChange} label={label} hideLabel />
      </div>
    );
  }
  if (field.type === 'array') {
    const text = Array.isArray(value) ? (value as string[]).join('\n') : '';
    return (
      <label className="block space-y-1 py-1.5">
        <span className="text-sm">{label}</span>
        <textarea
          className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-background)] px-2 py-1.5 text-sm"
          rows={3}
          value={text}
          placeholder={TEXT.MINIAPPS_CONFIG_ARRAY_HINT}
          onChange={(event) => onChange(event.target.value.split('\n').filter((line) => line.trim().length > 0))}
        />
        <span className="block text-[11px] text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_CONFIG_ARRAY_HINT}</span>
      </label>
    );
  }
  if (field.type === 'number') {
    return (
      <label className="block space-y-1 py-1.5">
        <span className="text-sm">{label}</span>
        <input
          type="number"
          className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-background)] px-2 py-1.5 text-sm"
          value={typeof value === 'number' ? value : ''}
          {...(field.minimum !== undefined ? { min: field.minimum } : {})}
          {...(field.maximum !== undefined ? { max: field.maximum } : {})}
          onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
        />
      </label>
    );
  }
  if (field.enum) {
    return (
      <label className="block space-y-1 py-1.5">
        <span className="text-sm">{label}</span>
        <select
          className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-background)] px-2 py-1.5 text-sm"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.enum.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="block space-y-1 py-1.5">
      <span className="text-sm">{label}</span>
      <input
        type="text"
        className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-background)] px-2 py-1.5 text-sm"
        value={typeof value === 'string' ? value : ''}
        {...(field.pattern ? { pattern: field.pattern } : {})}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function PackCard({
  view,
  onEnabledChange,
  onRemove,
  onConfigSave,
}: {
  view: MiniAppView;
  onEnabledChange: (enabled: boolean) => void;
  onRemove: () => void;
  onConfigSave: (values: Draft) => Promise<string | null>;
}): ReactElement {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(view));
  const [configError, setConfigError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(draftFrom(view));
  }, [view]);

  const save = useCallback(async () => {
    setConfigError(null);
    setSaved(false);
    const error = await onConfigSave(draft);
    if (error) {
      setConfigError(error);
    } else {
      setSaved(true);
    }
  }, [draft, onConfigSave]);

  return (
    <Card className="h-full p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium">{view.title}</h3>
            <Badge variant="outline" className="text-[10px]">
              {`v${view.version}`}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {kindLabel(view)}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {view.originKind === 'bundled' ? TEXT.MINIAPPS_ORIGIN_BUNDLED : TEXT.MINIAPPS_ORIGIN_IMPORTED}
            </Badge>
          </div>
          {view.description && <p className="text-xs text-[var(--as-muted-foreground)]">{view.description}</p>}
          <div className="flex flex-wrap gap-1.5 pt-0.5" aria-label={TEXT.MINIAPPS_CAPABILITIES}>
            {view.capabilities.map((capability) => (
              <Badge key={capability} variant="secondary" className="text-[10px]">
                {capabilityLabel(capability)}
              </Badge>
            ))}
          </div>
          {view.error && (
            <p className="text-xs text-[var(--as-destructive)]">
              {interpolate(TEXT.MINIAPPS_DISABLED_REASON, { reason: view.error })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={view.enabled} onCheckedChange={onEnabledChange} label={view.title} hideLabel />
          <Button variant="outline" size="sm" onClick={onRemove} aria-label={TEXT.MINIAPPS_REMOVE}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>
      {view.configFields.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-[var(--as-border)] pt-2.5">
          <h4 className="text-xs font-medium text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_CONFIG_TITLE}</h4>
          {view.configFields.map((field) => (
            <ConfigField
              key={field.name}
              field={field}
              value={draft[field.name]}
              onChange={(next) => setDraft((current) => ({ ...current, [field.name]: next }))}
            />
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={() => void save()}>
              {TEXT.MINIAPPS_CONFIG_SAVE}
            </Button>
            {saved && <span className="text-xs text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_CONFIG_SAVED}</span>}
            {configError && <span className="text-xs text-[var(--as-destructive)]">{configError}</span>}
          </div>
        </div>
      )}
      {view.kind === 'assessment' && view.capabilities.includes('run') && <PackRuns packId={view.id} />}
    </Card>
  );
}

export function MiniAppsSection(): ReactElement {
  const [state, setState] = useState<MiniAppsState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<MiniAppView | null>(null);

  const refresh = useCallback(async () => {
    setState(await window.electronAPI.getMiniApps());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importPack = useCallback(async () => {
    setNotice(null);
    const picked = await window.electronAPI.openFile({
      title: TEXT.MINIAPPS_IMPORT_PICK_TITLE,
      filters: [{ name: 'Pack JSON', extensions: ['json'] }],
    });
    if (!picked?.content) {
      return;
    }
    const result = await window.electronAPI.importMiniApp(picked.content, picked.filePath);
    if (!result.ok) {
      setNotice(interpolate(TEXT.MINIAPPS_IMPORT_FAILED, { error: result.error }));
    }
    await refresh();
  }, [refresh]);

  const setEnabled = useCallback(
    async (id: string | null, enabled: boolean) => {
      const result = await window.electronAPI.setMiniAppEnabled(id, enabled);
      if (!result.ok) {
        setNotice(
          interpolate(id === null ? TEXT.MINIAPPS_IMPORT_FAILED : TEXT.MINIAPPS_ENABLE_REJECTED, { error: result.error })
        );
      }
      await refresh();
    },
    [refresh]
  );

  const removePack = useCallback(
    async (id: string) => {
      await window.electronAPI.removeMiniApp(id);
      setRemoving(null);
      await refresh();
    },
    [refresh]
  );

  const saveConfig = useCallback(
    async (view: MiniAppView, values: Draft): Promise<string | null> => {
      const result = await window.electronAPI.saveMiniAppConfig(view.id, values);
      await refresh();
      return result.ok ? null : interpolate(TEXT.MINIAPPS_CONFIG_FAILED, { error: result.error });
    },
    [refresh]
  );

  const packs = useMemo(() => state?.packs ?? [], [state]);

  return (
    <div role="tabpanel" aria-label={TEXT.MINIAPPS_VIEW} className="space-y-5">
      <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_LIST_HINT}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm">{TEXT.MINIAPPS_MASTER}</span>
          <Switch
            checked={state?.masterEnabled ?? true}
            onCheckedChange={(next) => void setEnabled(null, next)}
            label={TEXT.MINIAPPS_MASTER}
            hideLabel
          />
        </div>
        <Button size="sm" onClick={() => void importPack()}>
          {TEXT.MINIAPPS_IMPORT}
        </Button>
      </div>
      {notice && (
        <p role="alert" className="rounded-md border border-[var(--as-destructive)]/40 bg-[var(--as-destructive)]/10 px-3 py-2 text-xs text-[var(--as-destructive)]">
          {notice}
        </p>
      )}
      {packs.length === 0 ? (
        <EmptyState title={TEXT.MINIAPPS_EMPTY} description={TEXT.MINIAPPS_EMPTY_HINT} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {packs.map((view) => (
            <li key={view.id} className="min-w-0">
              <PackCard
                view={view}
                onEnabledChange={(next) => void setEnabled(view.id, next)}
                onRemove={() => setRemoving(view)}
                onConfigSave={(values) => saveConfig(view, values)}
              />
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <ConfirmationModal
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title={TEXT.MINIAPPS_REMOVE_CONFIRM_TITLE}
          description={interpolate(TEXT.MINIAPPS_REMOVE_CONFIRM_BODY, { title: removing.title })}
          confirmLabel={TEXT.MINIAPPS_REMOVE}
          destructive
          onConfirm={() => void removePack(removing.id)}
        />
      )}
    </div>
  );
}
