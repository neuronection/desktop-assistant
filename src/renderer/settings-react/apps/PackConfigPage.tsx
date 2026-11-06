import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { BookOpen } from 'lucide-react';
import { Button } from '@neuronection/assistant-ui/button';
import { IntegrationConfigForm } from '@neuronection/assistant-ui/integration-config-form';
import type { IntegrationConfigSaveInput, IntegrationConfigValues } from '@neuronection/assistant-ui/integration-contracts';
import { Switch } from '../tools/shared';
import { ConfigRulesEditor } from './ConfigRulesEditor';
import { PackDocsDialog } from './PackDocsDialog';
import { PackPageShell } from './PackPageShell';
import { PackPolicyEditor } from './PackPolicyEditor';
import { packConfigFields, packConfigValues, toConfigWire } from './integration-views';
import { TEXT, interpolate } from '@shared/constants/text';
import type { MiniAppView } from '@shared/app-pack';

/**
 * The pack configuration page (plan 49 phase 1): enable state, the pack
 * config form and its docs — everything that used to inline on the card.
 * This surface is also the future host slot for pack-declared settings
 * (T2 `ui:settings`, ADR-0030 pending).
 */
export function PackConfigPage({
  view,
  onBack,
  onEnabledChange,
  onConfigSave,
}: {
  view: MiniAppView;
  onBack: () => void;
  onEnabledChange: (enabled: boolean) => void;
  onConfigSave: (values: Record<string, unknown>) => Promise<string | null>;
}): ReactElement {
  const [values, setValues] = useState<IntegrationConfigValues>(() => packConfigValues(view));
  const [configError, setConfigError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [exportState, setExportState] = useState<'exported' | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);

  useEffect(() => {
    setValues(packConfigValues(view));
  }, [view]);

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

  const fields = useMemo(
    () => packConfigFields(view).filter((field) => !(view.ruleBindings ?? []).some((binding) => binding.configKey === field.name)),
    [view]
  );

  const hasPolicy = fields.some((field) => field.name === 'guidelines');
  const formFields = useMemo(
    () => fields.filter((field) => field.name !== 'guidelines'),
    [fields]
  );

  const exportConfig = useCallback(async () => {
    const exported = await window.electronAPI.saveFile({
      defaultPath: `${view.id}-config.json`,
      content: JSON.stringify(toConfigWire(values), null, 2),
    });
    setExportState(exported !== null ? 'exported' : null);
  }, [view.id, values]);

  const importConfig = useCallback(async () => {
    setConfigError(null);
    setExportState(null);
    const picked = await window.electronAPI.openFile({
      title: TEXT.MINIAPPS_CONFIG_IMPORT,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!picked) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(picked.content);
    } catch {
      setConfigError(interpolate(TEXT.MINIAPPS_CONFIG_IMPORT_FAILED, { error: 'not valid JSON' }));
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setConfigError(interpolate(TEXT.MINIAPPS_CONFIG_IMPORT_FAILED, { error: 'not a config object' }));
      return;
    }
    const merged = { ...toConfigWire(values), ...(parsed as Record<string, unknown>) };
    const error = await onConfigSave(merged);
    if (error) {
      setConfigError(interpolate(TEXT.MINIAPPS_CONFIG_IMPORT_FAILED, { error }));
      return;
    }
    setValues(packConfigValues({ ...view, configValues: merged }));
    setSaved(true);
  }, [onConfigSave, values, view]);

  return (
    <PackPageShell
      title={view.title}
      pageLabel={TEXT.MINIAPPS_CONFIG_PAGE_ARIA}
      onBack={onBack}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <span className="text-sm">{TEXT.MINIAPPS_ENABLE}</span>
          <Switch
            checked={view.enabled}
            onCheckedChange={onEnabledChange}
            label={interpolate(TEXT.MINIAPPS_ENABLE_ARIA, { title: view.title })}
            hideLabel
          />
        </div>
        {view.error && (
          <p className="text-xs text-[var(--as-danger)]">
            {interpolate(TEXT.MINIAPPS_DISABLED_REASON, { reason: view.error })}
          </p>
        )}
        {view.docs && (
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
        )}
        {fields.length > 0 && (
          <>
            <Button size="sm" variant="outline" data-testid="config-export" onClick={() => void exportConfig()}>
              {TEXT.MINIAPPS_CONFIG_EXPORT}
            </Button>
            <Button size="sm" variant="outline" data-testid="config-import" onClick={() => void importConfig()}>
              {TEXT.MINIAPPS_CONFIG_IMPORT}
            </Button>
            <Button size="sm" variant="outline" data-testid="config-restore" onClick={() => setValues(packConfigValues({ ...view, configValues: {} }))}>
              {TEXT.MINIAPPS_CONFIG_RESTORE}
            </Button>
          </>
        )}
      </div>
      {exportState === 'exported' && (
        <p role="status" className="text-xs text-[var(--as-success)]">
          {TEXT.MINIAPPS_CONFIG_EXPORTED}
        </p>
      )}
      {view.ruleBindings && view.ruleBindings.length > 0 && (
        <ConfigRulesEditor
          view={view}
          values={values as Record<string, unknown>}
          onValuesChange={(next) => setValues(next as IntegrationConfigValues)}
          onSave={async () => {
            const error = await onConfigSave(toConfigWire(values));
            if (error) {
              throw new Error(error);
            }
            setSaved(true);
          }}
        />
      )}
      {hasPolicy && (
        <PackPolicyEditor
          guidelines={typeof (values as Record<string, unknown>).guidelines === 'string' ? ((values as Record<string, unknown>).guidelines as string) : ''}
          onChange={(next) => setValues({ ...(values as Record<string, unknown>), guidelines: next } as IntegrationConfigValues)}
        />
      )}
      {formFields.length > 0 ? (
        <IntegrationConfigForm
          fields={formFields}
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
      ) : (
        <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_CONFIG_NONE}</p>
      )}
      {docsOpen && <PackDocsDialog packId={view.id} onClose={() => setDocsOpen(false)} />}
    </PackPageShell>
  );
}
