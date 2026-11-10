import { useCallback, useId, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { Combobox } from '@neuronection/assistant-ui/combobox';
import { SwitchRow } from '@neuronection/assistant-ui/switch-row';
import { TEXT, interpolate } from '@shared/constants/text';
import type { CustomLanguageEntry } from '@shared/languages';
import type { MiniAppConfigFieldView, MiniAppView, PackLaunchOptionView } from '@shared/app-pack';
import { LanguagePicker } from './LanguagePicker';

export type PackLaunchValue = string | number | boolean;
export type PackLaunchValues = Record<string, PackLaunchValue>;

export interface PackLaunchError {
  optionId?: string;
  message: string;
}

export interface AssessmentLaunchStart {
  runId?: string;
  error?: PackLaunchError;
}

/** Shared assessment launch dispatch (plan 53 S3): the first path option is the run root; typed errors render under it. */
export async function startAssessmentLaunch(view: MiniAppView, values: PackLaunchValues): Promise<AssessmentLaunchStart> {
  const pathOption = view.launchOptions?.find((option) => option.type === 'path');
  const root = pathOption ? String(values[pathOption.id] ?? '').trim() : '';
  if (root.length === 0) {
    return { error: { optionId: pathOption?.id, message: TEXT.MINIAPPS_LAUNCH_REQUIRED } };
  }
  const started = await window.electronAPI.startMiniAppRun(view.id, root);
  return started.ok
    ? { runId: started.runId }
    : { error: { optionId: pathOption?.id, message: interpolate(TEXT.MINIAPPS_RUN_START_FAILED, { error: started.error }) } };
}

/** Persists the config-bound launch values through the ONE config store; false when the write failed. */
export async function persistPackConfigValues(view: MiniAppView, values: PackLaunchValues): Promise<boolean> {
  const patch: Record<string, unknown> = { ...view.configValues };
  let changed = false;
  for (const option of view.launchOptions ?? []) {
    if (option.configKey !== undefined && values[option.id] !== undefined) {
      patch[option.configKey] = values[option.id];
      changed = true;
    }
  }
  if (!changed || typeof window.electronAPI?.saveMiniAppConfig !== 'function') {
    return true;
  }
  try {
    const result = await window.electronAPI.saveMiniAppConfig(view.id, patch);
    return result.ok !== false;
  } catch {
    return false;
  }
}

export function hasLaunchMenu(view: Pick<MiniAppView, 'launchOptions' | 'capabilities'>): boolean {
  return (view.launchOptions?.length ?? 0) > 0 || view.capabilities.some((capability) => capability === 'run' || capability === 'ui:window');
}

/**
 * True when the pack cannot open without the user's input — a run start or a
 * required option. Everything else opens straight into its surface and the
 * same menu stays reachable from the pad (plan 68). `ui:window` needs no
 * check of its own: the validator requires it on report packs, which are
 * assessment packs and therefore carry `run`.
 */
export function needsLaunchMenu(view: Pick<MiniAppView, 'launchOptions' | 'capabilities'>): boolean {
  return view.capabilities.includes('run') || (view.launchOptions ?? []).some((option) => option.required === true);
}

function configFieldOf(view: MiniAppView, option: PackLaunchOptionView): MiniAppConfigFieldView | undefined {
  return option.configKey !== undefined ? view.configFields.find((field) => field.name === option.configKey) : undefined;
}

function initialValue(view: MiniAppView, option: PackLaunchOptionView): PackLaunchValue {
  const field = configFieldOf(view, option);
  const stored = option.configKey !== undefined ? view.configValues[option.configKey] : undefined;
  if (typeof stored === 'string' || typeof stored === 'number' || typeof stored === 'boolean') {
    return stored;
  }
  if (field?.default !== undefined && (typeof field.default === 'string' || typeof field.default === 'number' || typeof field.default === 'boolean')) {
    return field.default;
  }
  if (option.default !== undefined) {
    return option.default;
  }
  return option.type === 'switch' ? false : '';
}

function choiceList(view: MiniAppView, option: PackLaunchOptionView): { value: string; label: string }[] {
  if (option.choices !== undefined && option.choices.length > 0) {
    return option.choices;
  }
  const field = configFieldOf(view, option);
  return (field?.enum ?? []).map((value) => ({ value, label: value }));
}

function isMissing(option: PackLaunchOptionView, value: PackLaunchValue | undefined): boolean {
  return option.required === true && typeof value === 'string' && value.trim().length === 0;
}

function LaunchOptionRow({
  view,
  option,
  value,
  error,
  onBrowsePath,
  onChange,
  customLanguages,
  onAddCustomLanguage,
  pickerOpen = false,
  onPickerOpenChange,
}: {
  view: MiniAppView;
  option: PackLaunchOptionView;
  value: PackLaunchValue | undefined;
  error: PackLaunchError | null;
  onBrowsePath?: () => Promise<string | null>;
  onChange: (value: PackLaunchValue) => void;
  customLanguages?: CustomLanguageEntry[];
  onAddCustomLanguage?: (code: string) => Promise<CustomLanguageEntry | null>;
  pickerOpen?: boolean;
  onPickerOpenChange?: (open: boolean) => void;
}): ReactElement {
  const labelId = useId();
  const field = configFieldOf(view, option);
  const choices = useMemo(() => choiceList(view, option), [view, option]);
  const missing = isMissing(option, value);
  const optionError = error !== null && (error.optionId === undefined || error.optionId === option.id) ? error : null;

  if (option.vocabulary !== undefined) {
    return (
      <div className="flex flex-wrap items-start gap-2" data-testid={`launch-option-${option.id}`}>
        <span id={labelId} className="min-w-[6rem] pt-1 text-xs text-[var(--as-muted-fg)]">
          {option.label}
        </span>
        <LanguagePicker
          idPrefix={`launch-option-${option.id}`}
          value={typeof value === 'string' ? value : ''}
          labelId={labelId}
          withAuto={option.vocabulary.withAuto === true}
          allowCustom={option.vocabulary.allowCustom === true}
          {...(customLanguages !== undefined ? { customLanguages } : {})}
          {...(onAddCustomLanguage !== undefined ? { onAddCustom: onAddCustomLanguage } : {})}
          onChange={(next) => onChange(next)}
          open={pickerOpen}
          onOpenChange={(open) => onPickerOpenChange?.(open)}
        />
        {missing && <span className="text-[10px] text-[var(--as-muted-fg)]">{TEXT.MINIAPPS_LAUNCH_REQUIRED}</span>}
        {optionError && (
          <p role="alert" className="w-full text-[11px] text-[var(--as-destructive)]" data-testid="launch-error">
            {optionError.message}
          </p>
        )}
      </div>
    );
  }

  if (option.type === 'switch') {
    return (
      <div className="flex flex-col gap-1" data-testid={`launch-option-${option.id}`}>
        <SwitchRow
          label={option.label}
          checked={value === true}
          onCheckedChange={(next) => onChange(next)}
          data-testid={`launch-option-${option.id}-switch`}
        />
        {optionError && (
          <p role="alert" className="text-[11px] text-[var(--as-destructive)]" data-testid="launch-error">
            {optionError.message}
          </p>
        )}
      </div>
    );
  }

  const control = ((): ReactElement => {
    if (option.type === 'select' && choices.length > 0 && choices.length <= 4) {
      return (
        <span role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-1.5">
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={value === choice.value}
              data-testid={`launch-option-${option.id}-choice-${choice.value}`}
              onClick={() => onChange(choice.value)}
              className={`rounded-full border px-3 py-1 text-xs ${
                value === choice.value ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10' : 'border-[var(--as-border)]'
              }`}
            >
              {choice.label}
            </button>
          ))}
        </span>
      );
    }
    if (option.type === 'select' && choices.length > 0) {
      const current = typeof value === 'string' ? value : '';
      const listed = choices.some((choice) => choice.value === current) ? choices : current.length > 0 ? [{ value: current, label: current }, ...choices] : choices;
      return (
        <span data-testid={`launch-option-${option.id}-select`} aria-labelledby={labelId} className="flex min-w-0 flex-1 items-center">
          <Combobox
            hideLabel
            options={listed}
            value={current}
            onChange={(next) => onChange(next)}
            className="w-full min-w-0"
          />
        </span>
      );
    }
    if (option.type === 'path') {
      return (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <input
            type="text"
            aria-labelledby={labelId}
            data-testid={`launch-option-${option.id}-input`}
            className="min-w-[8rem] flex-1 rounded-md border border-[var(--as-border)] bg-[var(--as-background)] px-2 py-1 font-mono text-xs"
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
          {onBrowsePath && (
            <Button
              size="sm"
              variant="outline"
              data-testid={`launch-option-${option.id}-browse`}
              onClick={() => {
                void onBrowsePath().then((picked) => {
                  if (picked !== null) {
                    onChange(picked);
                  }
                });
              }}
            >
              {TEXT.MINIAPPS_LAUNCH_BROWSE}
            </Button>
          )}
        </span>
      );
    }
    return (
      <input
        type={field?.type === 'number' ? 'number' : 'text'}
        aria-labelledby={labelId}
        data-testid={`launch-option-${option.id}-input`}
        min={field?.minimum}
        max={field?.maximum}
        className="min-w-[8rem] flex-1 rounded-md border border-[var(--as-border)] bg-[var(--as-background)] px-2 py-1 text-xs"
        value={typeof value === 'string' || typeof value === 'number' ? value : ''}
        onChange={(event) => {
          const next = event.target.value;
          if (field?.type === 'number') {
            onChange(next === '' ? '' : Number(next));
          } else {
            onChange(next);
          }
        }}
      />
    );
  })();

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`launch-option-${option.id}`}>
      <span id={labelId} className="min-w-[6rem] text-xs text-[var(--as-muted-foreground)]">
        {option.label}
      </span>
      {control}
      {missing && <span className="text-[10px] text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_LAUNCH_REQUIRED}</span>}
      {optionError && (
        <p role="alert" className="w-full text-[11px] text-[var(--as-destructive)]" data-testid="launch-error">
          {optionError.message}
        </p>
      )}
    </div>
  );
}

export function PackLaunchMenu({
  view,
  primaryLabel,
  secondaryLabel,
  initialValues,
  error,
  notice,
  launching,
  onLaunch,
  onSecondary,
  onOpenRuns,
  onConfigure,
  onOpenWindow,
  onBrowsePath,
  customLanguages,
  onAddCustomLanguage,
  footerLink,
}: {
  view: MiniAppView;
  /** Overrides the capability-derived Run/Open label (e.g. Apply for a mid-session edit). */
  primaryLabel?: string;
  /** Optional secondary action beside the primary (e.g. Close on the live pad's menu). */
  secondaryLabel?: string;
  initialValues?: PackLaunchValues;
  error?: PackLaunchError | null;
  notice?: string | null;
  launching?: boolean;
  onLaunch: (values: PackLaunchValues) => void;
  onSecondary?: () => void;
  onOpenRuns?: () => void;
  onConfigure?: () => void;
  onOpenWindow?: () => void;
  onBrowsePath?: () => Promise<string | null>;
  /** The user's custom languages — merged into language-vocabulary options. */
  customLanguages?: CustomLanguageEntry[];
  /** Persists a typed code as a custom language (language-vocabulary options). */
  onAddCustomLanguage?: (code: string) => Promise<CustomLanguageEntry | null>;
  /** A pack-owned settings deep link rendered under the actions. */
  footerLink?: { label: string; onClick: () => void } | null;
}): ReactElement {
  const options = view.launchOptions ?? [];
  const [values, setValues] = useState<PackLaunchValues>(() => {
    const seeded: PackLaunchValues = {};
    for (const option of options) {
      seeded[option.id] = initialValues?.[option.id] ?? initialValue(view, option);
    }
    return seeded;
  });
  const [openOptionId, setOpenOptionId] = useState<string | null>(null);
  const handlePickerOpen = useCallback((optionId: string, open: boolean): void => {
    setOpenOptionId((current) => (open ? optionId : current === optionId ? null : current));
  }, []);
  const missingRequired = options.some((option) => isMissing(option, values[option.id]));
  const derivedLabel = view.capabilities.includes('run') ? TEXT.MINIAPPS_LAUNCH_RUN : TEXT.MINIAPPS_LAUNCH_OPEN;
  const label = primaryLabel ?? derivedLabel;
  const focusedError = error !== null && error !== undefined && error.optionId !== undefined ? error : null;
  const generalError = error !== null && error !== undefined && error.optionId === undefined ? error : null;

  return (
    <section
      aria-label={interpolate(TEXT.MINIAPPS_LAUNCH_ARIA, { title: view.title })}
      data-testid="pack-launch-menu"
      className="flex flex-col gap-2.5 rounded-[var(--as-radius-lg)] border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-3 text-[var(--as-fg)]"
      aria-busy={launching === true || undefined}
    >
      {options.map((option) => (
        <LaunchOptionRow
          key={option.id}
          view={view}
          option={option}
          value={values[option.id]}
          error={focusedError}
          onBrowsePath={option.type === 'path' ? onBrowsePath : undefined}
          onChange={(value) => setValues((current) => ({ ...current, [option.id]: value }))}
          {...(customLanguages !== undefined ? { customLanguages } : {})}
          {...(onAddCustomLanguage !== undefined ? { onAddCustomLanguage } : {})}
          {...(option.vocabulary !== undefined
            ? { pickerOpen: openOptionId === option.id, onPickerOpenChange: (open: boolean) => handlePickerOpen(option.id, open) }
            : {})}
        />
      ))}
      {notice && (
        <p role="status" className="text-[11px] text-[var(--as-muted-foreground)]">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--as-border)] pt-2.5">
        <Button size="sm" data-testid="launch-primary" disabled={missingRequired || launching === true} onClick={() => onLaunch(values)}>
          {label}
        </Button>
        {onSecondary && secondaryLabel && (
          <Button size="sm" variant="outline" data-testid="launch-secondary" onClick={onSecondary}>
            {secondaryLabel}
          </Button>
        )}
        {onOpenRuns && view.capabilities.includes('run') && (
          <Button size="sm" variant="outline" data-testid="launch-runs" onClick={onOpenRuns}>
            {TEXT.MINIAPPS_LAUNCH_RUNS}
          </Button>
        )}
        {onConfigure && (
          <Button size="sm" variant="outline" data-testid="launch-configure" onClick={onConfigure}>
            {TEXT.MINIAPPS_LAUNCH_CONFIGURE}
          </Button>
        )}
        {onOpenWindow && view.capabilities.includes('ui:window') && (
          <Button size="sm" variant="outline" data-testid="launch-window" onClick={onOpenWindow}>
            {TEXT.MINIAPPS_WINDOW_OPEN}
          </Button>
        )}
        {footerLink && (
          <Button size="sm" variant="ghost" data-testid="launch-footer-link" onClick={footerLink.onClick}>
            {footerLink.label}
          </Button>
        )}
        {generalError && (
          <p role="alert" className="w-full text-[11px] text-[var(--as-destructive)]" data-testid="launch-error">
            {generalError.message}
          </p>
        )}
      </div>
    </section>
  );
}
