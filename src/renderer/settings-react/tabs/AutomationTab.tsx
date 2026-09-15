import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { EmptyState } from '@neuronection/assistant-ui/empty-state';
import { Modal, ModalContent, ModalHeader, ModalTitle } from '@neuronection/assistant-ui/modal';
import { CalendarClock, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { ScheduleSpec, ScheduleView } from '@shared/schedules';
import { isValidScheduleSpec, isValidTimezone } from '@shared/schedules';
import { TEXT, interpolate } from '@shared/constants/text';
import { Switch } from '../tools/shared';

const MINUTES_DAY = 1440;

type RhythmKind = 'interval' | 'daily' | 'weekly' | 'cron';

interface WizardState {
  id: string | null;
  name: string;
  prompt: string;
  rhythm: RhythmKind;
  minutes: string;
  time: string;
  cron: string;
  timezone: string;
}

const RHYTHM_KINDS: { kind: RhythmKind; label: string }[] = [
  { kind: 'interval', label: TEXT.AUTOMATION_WIZARD_RHYTHM_INTERVAL },
  { kind: 'daily', label: TEXT.AUTOMATION_WIZARD_RHYTHM_DAILY },
  { kind: 'weekly', label: TEXT.AUTOMATION_WIZARD_RHYTHM_WEEKDAYS },
  { kind: 'cron', label: TEXT.AUTOMATION_WIZARD_RHYTHM_CRON },
];

function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function freshWizard(): WizardState {
  return {
    id: null,
    name: '',
    prompt: '',
    rhythm: 'daily',
    minutes: '30',
    time: '09:00',
    cron: '0 9 * * 1-5',
    timezone: systemTimezone(),
  };
}

function wizardToSpec(wizard: WizardState): ScheduleSpec | null {
  switch (wizard.rhythm) {
    case 'interval': {
      const minutes = Number(wizard.minutes);
      return Number.isInteger(minutes) && minutes >= 1 ? { kind: 'interval', minutes } : null;
    }
    case 'daily':
      return /^\d{2}:\d{2}$/.test(wizard.time) ? { kind: 'daily', time: wizard.time } : null;
    case 'weekly':
      return /^\d{2}:\d{2}$/.test(wizard.time) ? { kind: 'weekly', days: [1, 2, 3, 4, 5], time: wizard.time } : null;
    case 'cron':
      return wizard.cron.trim() ? { kind: 'cron', expr: wizard.cron.trim() } : null;
  }
}

function specToWizard(view: ScheduleView): WizardState {
  const spec = view.spec;
  const base: WizardState = {
    id: view.id,
    name: view.name,
    prompt: view.prompt,
    rhythm: 'daily',
    minutes: '30',
    time: '09:00',
    cron: '0 9 * * 1-5',
    timezone: view.timezone,
  };
  if (spec.kind === 'interval') {
    return { ...base, rhythm: 'interval', minutes: String(spec.minutes) };
  }
  if (spec.kind === 'daily') {
    return { ...base, rhythm: 'daily', time: spec.time };
  }
  if (spec.kind === 'weekly') {
    return { ...base, rhythm: 'weekly', time: spec.time };
  }
  return { ...base, rhythm: 'cron', cron: spec.expr };
}

function relativeNextRun(iso: string | null, nowMs: number): string {
  if (!iso) {
    return TEXT.AUTOMATION_NEVER_RUN;
  }
  const deltaMs = new Date(iso).getTime() - nowMs;
  if (deltaMs < 60_000) {
    return TEXT.AUTOMATION_RELATIVE_NOW;
  }
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) {
    return interpolate(TEXT.AUTOMATION_RELATIVE_MINUTES, { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return interpolate(TEXT.AUTOMATION_RELATIVE_HOURS, { hours, minutes: minutes % 60 });
  }
  const days = Math.floor(hours / 24);
  return interpolate(TEXT.AUTOMATION_RELATIVE_DAYS, { days, hours: hours % 24 });
}

export function AutomationTab(): JSX.Element {
  const [rows, setRows] = useState<ScheduleView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ScheduleView | null>(null);
  const [runQueuedId, setRunQueuedId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      setRows(await window.electronAPI.listSchedules());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const timezones = useMemo<string[]>(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return [systemTimezone(), 'UTC'];
    }
  }, []);

  const saveWizard = useCallback(async (): Promise<void> => {
    if (!wizard) {
      return;
    }
    const spec = wizardToSpec(wizard);
    if (!spec || !isValidScheduleSpec(spec) || !wizard.prompt.trim() || !isValidTimezone(wizard.timezone)) {
      setWizardError(TEXT.AUTOMATION_WIZARD_INVALID);
      return;
    }
    const input = {
      name: wizard.name.trim() || wizard.prompt.trim().slice(0, 40),
      prompt: wizard.prompt.trim(),
      spec,
      timezone: wizard.timezone,
    };
    try {
      if (wizard.id) {
        await window.electronAPI.updateSchedule(wizard.id, input);
      } else {
        await window.electronAPI.createSchedule(input);
      }
      setWizard(null);
      setWizardError(null);
      await load();
    } catch (error) {
      setWizardError(error instanceof Error ? error.message : String(error));
    }
  }, [wizard, load]);

  const toggleEnabled = useCallback(
    async (view: ScheduleView, enabled: boolean): Promise<void> => {
      setRows((current) => current.map((row) => (row.id === view.id ? { ...row, enabled } : row)));
      try {
        await window.electronAPI.updateSchedule(view.id, { enabled });
      } finally {
        await load();
      }
    },
    [load]
  );

  const runNow = useCallback(async (view: ScheduleView): Promise<void> => {
    setRunQueuedId(view.id);
    try {
      await window.electronAPI.runScheduleNow(view.id);
    } finally {
      setTimeout(() => setRunQueuedId((current) => (current === view.id ? null : current)), 4000);
    }
  }, []);

  if (loading) {
    return (
      <section aria-label={TEXT.AUTOMATION_TITLE} className="flex flex-col gap-3">
        <p className="text-sm opacity-60" role="status">
          {TEXT.AUTOMATION_LOADING}
        </p>
      </section>
    );
  }

  if (loadError) {
    return (
      <section aria-label={TEXT.AUTOMATION_TITLE} className="flex flex-col items-start gap-3">
        <p className="text-sm text-[var(--as-danger)]" role="alert">
          {TEXT.AUTOMATION_LOAD_ERROR}
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {TEXT.AUTOMATION_RETRY}
        </Button>
      </section>
    );
  }

  return (
    <section aria-label={TEXT.AUTOMATION_TITLE} className="flex flex-col gap-4">
      <header className="flex items-start gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{TEXT.AUTOMATION_TITLE}</h3>
          <p className="text-xs opacity-60">{TEXT.AUTOMATION_DESCRIPTION}</p>
        </div>
        <Button
          size="sm"
          className="ml-auto shrink-0"
          onClick={() => {
            setWizardError(null);
            setWizard(freshWizard());
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
          {TEXT.AUTOMATION_NEW}
        </Button>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={TEXT.AUTOMATION_TITLE}
          description={TEXT.AUTOMATION_EMPTY}
          action={
            <Button
              size="sm"
              onClick={() => {
                setWizardError(null);
                setWizard(freshWizard());
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
              {TEXT.AUTOMATION_EMPTY_CTA}
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label={TEXT.AUTOMATION_TITLE}>
          {rows.map((row) => (
            <li
              key={row.id}
              data-no-drag
              className="da-rise rounded-xl border border-[var(--as-border)] bg-[var(--as-surface)]/60 p-3 text-sm transition-colors hover:border-[var(--as-primary)]/40"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate font-medium" title={row.name}>
                  {row.name}
                </span>
                <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                  {row.specLabel}
                </Badge>
                {row.enabled ? (
                  <span className="shrink-0 text-xs tabular-nums opacity-70">
                    {interpolate(TEXT.AUTOMATION_NEXT_RUN, { when: relativeNextRun(row.nextRunAt, nowMs) })}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs opacity-50">{TEXT.AUTOMATION_NEVER_RUN}</span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  <Switch
                    checked={row.enabled}
                    onCheckedChange={(checked) => void toggleEnabled(row, checked)}
                    label={`${row.name} — ${TEXT.AUTOMATION_ENABLED}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`${TEXT.AUTOMATION_RUN_NOW} — ${row.name}`}
                    onClick={() => void runNow(row)}
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`${TEXT.AUTOMATION_EDIT} — ${row.name}`}
                    onClick={() => {
                      setWizardError(null);
                      setWizard(specToWizard(row));
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-[var(--as-danger)]"
                    aria-label={`${TEXT.AUTOMATION_DELETE} — ${row.name}`}
                    onClick={() => setDeleting(row)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs opacity-60" title={row.prompt}>
                {row.prompt}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] opacity-50">
                <span>{row.timezone}</span>
                {row.lastOutcome && <span>{interpolate(TEXT.AUTOMATION_LAST_RUN, { outcome: row.lastOutcome })}</span>}
                {runQueuedId === row.id && (
                  <span role="status" className="text-[var(--as-primary)]">
                    {TEXT.AUTOMATION_RUN_QUEUED}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      {wizard && (
        <Modal open onOpenChange={(open) => !open && setWizard(null)}>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>{wizard.id ? TEXT.AUTOMATION_EDIT : TEXT.AUTOMATION_NEW}</ModalTitle>
            </ModalHeader>
            <form
              className="flex flex-col gap-3 text-sm"
              onSubmit={(event) => {
                event.preventDefault();
                void saveWizard();
              }}
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium opacity-70">{TEXT.AUTOMATION_WIZARD_NAME}</span>
                <input
                  className="rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1.5 outline-none focus:border-[var(--as-primary)]"
                  value={wizard.name}
                  placeholder={TEXT.AUTOMATION_WIZARD_NAME_PLACEHOLDER}
                  onChange={(event) => setWizard({ ...wizard, name: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium opacity-70">{TEXT.AUTOMATION_WIZARD_PROMPT}</span>
                <textarea
                  className={`h-24 resize-y rounded-md border bg-transparent px-2 py-1.5 outline-none focus:border-[var(--as-primary)] ${
                    wizard.prompt.trim() ? 'border-[var(--as-border)]' : 'border-[var(--as-danger)]/60'
                  }`}
                  value={wizard.prompt}
                  placeholder={TEXT.AUTOMATION_WIZARD_PROMPT_PLACEHOLDER}
                  onChange={(event) => setWizard({ ...wizard, prompt: event.target.value })}
                />
              </label>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-xs font-medium opacity-70">{TEXT.AUTOMATION_WIZARD_RHYTHM}</legend>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={TEXT.AUTOMATION_WIZARD_RHYTHM}>
                  {RHYTHM_KINDS.map((entry) => (
                    <button
                      key={entry.kind}
                      type="button"
                      role="radio"
                      aria-checked={wizard.rhythm === entry.kind}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        wizard.rhythm === entry.kind
                          ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10 text-[var(--as-primary)]'
                          : 'border-[var(--as-border)] opacity-70 hover:opacity-100'
                      }`}
                      onClick={() => setWizard({ ...wizard, rhythm: entry.kind })}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
                {wizard.rhythm === 'interval' && (
                  <label className="flex items-center gap-2 text-xs">
                    <span className="opacity-70">{TEXT.AUTOMATION_WIZARD_MINUTES}</span>
                    <input
                      type="number"
                      min={1}
                      max={MINUTES_DAY * 365}
                      className="w-24 rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 outline-none focus:border-[var(--as-primary)]"
                      value={wizard.minutes}
                      onChange={(event) => setWizard({ ...wizard, minutes: event.target.value })}
                    />
                  </label>
                )}
                {(wizard.rhythm === 'daily' || wizard.rhythm === 'weekly') && (
                  <label className="flex items-center gap-2 text-xs">
                    <span className="opacity-70">{TEXT.AUTOMATION_WIZARD_TIME}</span>
                    <input
                      type="time"
                      className="rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 outline-none focus:border-[var(--as-primary)]"
                      value={wizard.time}
                      onChange={(event) => setWizard({ ...wizard, time: event.target.value })}
                    />
                  </label>
                )}
                {wizard.rhythm === 'cron' && (
                  <div className="flex flex-col gap-1">
                    <input
                      className={`rounded-md border bg-transparent px-2 py-1 font-mono text-xs outline-none focus:border-[var(--as-primary)] ${
                        isValidScheduleSpec({ kind: 'cron', expr: wizard.cron.trim() })
                          ? 'border-[var(--as-border)]'
                          : 'border-[var(--as-danger)]/60'
                      }`}
                      aria-label={TEXT.AUTOMATION_WIZARD_RHYTHM_CRON}
                      value={wizard.cron}
                      onChange={(event) => setWizard({ ...wizard, cron: event.target.value })}
                    />
                    <p className="text-[11px] opacity-50">{TEXT.AUTOMATION_WIZARD_CRON_HINT}</p>
                  </div>
                )}
              </fieldset>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium opacity-70">{TEXT.AUTOMATION_WIZARD_TIMEZONE}</span>
                <select
                  className="rounded-md border border-[var(--as-border)] bg-[var(--as-surface)] px-2 py-1.5 text-xs outline-none focus:border-[var(--as-primary)]"
                  value={wizard.timezone}
                  onChange={(event) => setWizard({ ...wizard, timezone: event.target.value })}
                >
                  {timezones.includes(wizard.timezone) ? null : <option value={wizard.timezone}>{wizard.timezone}</option>}
                  {timezones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </label>
              {wizardError && (
                <p role="alert" className="text-xs text-[var(--as-danger)]">
                  {wizardError}
                </p>
              )}
              <div className="flex items-center justify-end gap-1.5">
                <Button type="button" variant="ghost" size="sm" onClick={() => setWizard(null)}>
                  {TEXT.AUTOMATION_WIZARD_CANCEL}
                </Button>
                <Button type="submit" size="sm">
                  {TEXT.AUTOMATION_WIZARD_SAVE}
                </Button>
              </div>
            </form>
          </ModalContent>
        </Modal>
      )}

      {deleting && (
        <ConfirmationModal
          open
          title={TEXT.AUTOMATION_DELETE_CONFIRM_TITLE}
          description={interpolate(TEXT.AUTOMATION_DELETE_CONFIRM_BODY, { name: deleting.name })}
          confirmLabel={TEXT.AUTOMATION_DELETE}
          destructive
          onConfirm={async () => {
            await window.electronAPI.deleteSchedule(deleting.id);
            setDeleting(null);
            await load();
          }}
          onOpenChange={(open) => !open && setDeleting(null)}
        />
      )}
    </section>
  );
}
