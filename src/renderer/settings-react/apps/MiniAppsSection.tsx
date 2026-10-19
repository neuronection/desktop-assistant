import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { BookOpen } from 'lucide-react';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { EmptyState } from '@neuronection/assistant-ui/empty-state';
import { IntegrationCard } from '@neuronection/assistant-ui/integration-card';
import { IntegrationConfigForm } from '@neuronection/assistant-ui/integration-config-form';
import type { IntegrationConfigSaveInput, IntegrationConfigValues } from '@neuronection/assistant-ui/integration-contracts';
import { Switch } from '../tools/shared';
import { PackRuns } from './PackRuns';
import { PackDocsDialog } from './PackDocsDialog';
import { ExtensionSourcesSection } from './ExtensionSourcesSection';
import { packCardView, packConfigFields, packConfigValues, toConfigWire } from './integration-views';
import { TEXT, interpolate } from '@shared/constants/text';
import type { MiniAppView, MiniAppsState } from '@shared/app-pack';

function PackCard({
  view,
  onEnabledChange,
  onRemove,
  onConfigSave,
  focusReportRunId,
}: {
  view: MiniAppView;
  onEnabledChange: (enabled: boolean) => void;
  onRemove: () => void;
  onConfigSave: (values: Record<string, unknown>) => Promise<string | null>;
  focusReportRunId?: { packId: string; runId: string; at: number } | null;
}): ReactElement {
  const [values, setValues] = useState<IntegrationConfigValues>(() => packConfigValues(view));
  const [configError, setConfigError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);

  useEffect(() => {
    setValues(packConfigValues(view));
  }, [view]);

  const cardView = useMemo(() => packCardView(view), [view]);

  const save = useCallback(
    async (input: IntegrationConfigSaveInput) => {
      setConfigError(null);
      setSaved(false);
      const error = await onConfigSave(toConfigWire(input.values));
      if (error) {
        setConfigError(error);
      } else {
        setSaved(true);
      }
    },
    [onConfigSave]
  );

  return (
    <IntegrationCard
      extension={cardView}
      labels={{
        capabilitiesLabel: TEXT.MINIAPPS_CAPABILITIES,
        enableLabel: TEXT.MINIAPPS_ENABLE,
        disableLabel: TEXT.MINIAPPS_DISABLE,
        removeLabel: TEXT.MINIAPPS_REMOVE,
        enabledAriaLabel: interpolate(TEXT.MINIAPPS_ENABLE_ARIA, { title: view.title }),
      }}
      enabled={view.enabled}
      onEnable={(_extension, enabled) => onEnabledChange(enabled)}
      onRemove={() => onRemove()}
    >
      {view.docs && (
        <div>
          <Button
            size="sm"
            variant="outline"
            data-testid={`pack-docs-${view.id}`}
            aria-label={interpolate(TEXT.MINIAPPS_DOCS_ARIA, { title: view.title })}
            onClick={() => setDocsOpen(true)}
          >
            <BookOpen className="w-4 h-4" />
            {TEXT.MINIAPPS_DOCS}
          </Button>
        </div>
      )}
      {view.error && (
        <p className="text-xs text-[var(--as-danger)]">
          {interpolate(TEXT.MINIAPPS_DISABLED_REASON, { reason: view.error })}
        </p>
      )}
      {view.configFields.length > 0 && (
        <IntegrationConfigForm
          fields={packConfigFields(view)}
          values={values}
          onValuesChange={setValues}
          onSave={(input) => void save(input)}
          validation={saved ? { state: 'success' } : null}
          error={configError}
          labels={{
            title: TEXT.MINIAPPS_CONFIG_TITLE,
            submitLabel: TEXT.MINIAPPS_CONFIG_SAVE,
            successLabel: TEXT.MINIAPPS_CONFIG_SAVED,
            chipAddLabel: TEXT.MINIAPPS_CONFIG_CHIP_ADD,
            chipRemoveLabel: TEXT.MINIAPPS_CONFIG_CHIP_REMOVE,
            enumPlaceholder: TEXT.MINIAPPS_CONFIG_ENUM_PLACEHOLDER,
          }}
        />
      )}
      {view.kind === 'assessment' && view.capabilities.includes('run') && (
        <PackRuns
          packId={view.id}
          packTitle={view.title}
          focusReportRunId={focusReportRunId && focusReportRunId.packId === view.id ? focusReportRunId : null}
        />
      )}
      {docsOpen && <PackDocsDialog packId={view.id} onClose={() => setDocsOpen(false)} />}
    </IntegrationCard>
  );
}

export function MiniAppsSection({ miniAppRunFocus }: { miniAppRunFocus?: { packId: string; runId: string; at: number } | null } = {}): ReactElement {
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

  const restoreBundled = useCallback(async () => {
    await window.electronAPI.restoreBundledMiniApps();
    await refresh();
  }, [refresh]);

  const saveConfig = useCallback(
    async (view: MiniAppView, values: Record<string, unknown>): Promise<string | null> => {
      const result = await window.electronAPI.saveMiniAppConfig(view.id, values);
      await refresh();
      return result.ok ? null : interpolate(TEXT.MINIAPPS_CONFIG_FAILED, { error: result.error });
    },
    [refresh]
  );

  const packs = useMemo(() => state?.packs ?? [], [state]);
  const manageable = useMemo(() => packs.filter((view) => view.kind === 'assessment'), [packs]);
  const surfaces = useMemo(() => packs.filter((view) => view.kind === 'surface'), [packs]);

  return (
    <div role="tabpanel" aria-label={TEXT.MINIAPPS_VIEW} className="space-y-5">
      <ExtensionSourcesSection />
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
      {manageable.length === 0 && surfaces.length === 0 ? (
        <EmptyState title={TEXT.MINIAPPS_EMPTY} description={TEXT.MINIAPPS_EMPTY_HINT} />
      ) : (
        <>
          {manageable.length > 0 && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {manageable.map((view) => (
                <li key={view.id} className="min-w-0">
                  <PackCard
                    view={view}
                    onEnabledChange={(next) => void setEnabled(view.id, next)}
                    onRemove={() => setRemoving(view)}
                    onConfigSave={(values) => saveConfig(view, values)}
                    focusReportRunId={miniAppRunFocus && miniAppRunFocus.packId === view.id ? miniAppRunFocus : null}
                  />
                </li>
              ))}
            </ul>
          )}
          {surfaces.length > 0 && (
            <section aria-label={TEXT.MINIAPPS_SURFACES_TITLE} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">{TEXT.MINIAPPS_SURFACES_TITLE}</h3>
                  <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_SURFACES_HINT}</p>
                </div>
                {(state?.removedBundled?.length ?? 0) > 0 && (
                  <Button size="sm" variant="outline" onClick={() => void restoreBundled()}>
                    {TEXT.MINIAPPS_RESTORE_BUNDLED}
                  </Button>
                )}
              </div>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {surfaces.map((view) => (
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
            </section>
          )}
        </>
      )}
      {removing && (
        <ConfirmationModal
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title={TEXT.MINIAPPS_REMOVE_CONFIRM_TITLE}
          description={
            removing.originKind === 'bundled'
              ? interpolate(TEXT.MINIAPPS_REMOVE_BUNDLED_BODY, { title: removing.title })
              : interpolate(TEXT.MINIAPPS_REMOVE_CONFIRM_BODY, { title: removing.title })
          }
          confirmLabel={TEXT.MINIAPPS_REMOVE}
          destructive
          onConfirm={() => void removePack(removing.id)}
        />
      )}
    </div>
  );
}
