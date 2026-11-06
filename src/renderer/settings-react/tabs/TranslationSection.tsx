import { useCallback, useEffect, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@neuronection/assistant-ui/modal';
import {
  TranslationProvidersList,
  TranslationProviderSettingsForm,
  TranslationProviderWizard,
  type TranslationProbeView,
  type TranslationProviderFormValue,
  type TranslationProviderSaveInput as CardSaveInput,
  type TranslationProviderView as CardView,
} from '@neuronection/assistant-ui/translation-providers';
import { Languages, Trash2 } from 'lucide-react';
import type {
  TranslationMode,
  TranslationProviderSaveInput,
  TranslationProviderTestResult,
  TranslationProviderType,
  TranslationProviderView,
  TranslationSettings,
} from '@shared/translation';
import type { CustomLanguageEntry } from '@shared/languages';
import { LANGUAGES, isLanguageCode, normalizeCustomLanguageCode } from '@shared/languages';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT, interpolate } from '@shared/constants/text';
import { SelectField } from './fields';
import { TRANSLATION_CATALOG, TRANSLATION_EXTRA_FIELDS } from '../translation-catalog';
import { PackPageShell } from '../apps/PackPageShell';

/** Translation settings: the desktop-specific configuration (engine mode,
 * default target, custom languages) around the family
 * `translation-providers` module — configured engines as provider cards
 * with a `⋯` management menu, add = tiles → settings-form wizard in a
 * modal, edit = a detail page. All persistence rides the translation
 * IPC; keys stay in the keyring. */

const MODE_OPTIONS: { value: TranslationMode; label: string }[] = [
  { value: 'auto', label: TEXT.TRANSLATION_MODE_AUTO },
  { value: 'service', label: TEXT.TRANSLATION_MODE_SERVICE },
  { value: 'llm', label: TEXT.TRANSLATION_MODE_LLM },
];

const wizardLabels = {
  chooseStepLabel: TEXT.TRANSLATION_STEP_CHOOSE,
  configureStepLabel: TEXT.TRANSLATION_STEP_CONFIGURE,
  stepsLabel: TEXT.TRANSLATION_STEPS_ARIA,
  tilesLabel: TEXT.TRANSLATION_TILES_ARIA,
  keyChipLabel: TEXT.TRANSLATION_CHIP_KEY,
  keylessChipLabel: TEXT.TRANSLATION_CHIP_KEYLESS,
  cloudChipLabel: TEXT.TRANSLATION_CHIP_CLOUD,
  selfHostedChipLabel: TEXT.TRANSLATION_CHIP_SELF_HOSTED,
  backLabel: TEXT.TRANSLATION_BACK_TO_LIST,
  nameLabel: TEXT.TRANSLATION_NAME_LABEL,
  apiKeyLabel: TEXT.TRANSLATION_KEY_LABEL,
  keyOptionalLabel: TEXT.TRANSLATION_KEY_OPTIONAL,
  keyStoredLabel: TEXT.TRANSLATION_KEY_SAVED,
  noKeyLabel: TEXT.TRANSLATION_NO_KEY_NEEDED,
  apiBaseLabel: TEXT.TRANSLATION_API_BASE_LABEL,
  apiBaseRequiredLabel: TEXT.TRANSLATION_API_BASE_REQUIRED_LABEL,
  advancedLabel: TEXT.SETUP_ADVANCED,
  getKeyLabel: TEXT.TRANSLATION_GET_KEY,
  saveLabel: TEXT.TRANSLATION_SAVE,
  cancelLabel: TEXT.CANCEL_BUTTON,
};

const listLabels = {
  emptyLabel: TEXT.TRANSLATION_NO_PROVIDERS,
  orderLabel: (position: number): string => interpolate(TEXT.TRANSLATION_ORDER_LABEL, { position }),
  disabledBadge: TEXT.TRANSLATION_DISABLED_BADGE,
  noKeyLabel: TEXT.TRANSLATION_NO_KEY_BADGE,
  keyStoredLabel: TEXT.TRANSLATION_KEY_STORED,
  enableLabel: TEXT.MINIAPPS_ENABLE,
  disableLabel: TEXT.MINIAPPS_DISABLE,
  moveUpLabel: TEXT.TRANSLATION_MOVE_UP_ACTION,
  moveDownLabel: TEXT.TRANSLATION_MOVE_DOWN_ACTION,
  editLabel: TEXT.TRANSLATION_EDIT_ACTION,
  deleteLabel: TEXT.TRANSLATION_DELETE_ACTION,
  testLabel: TEXT.TRANSLATION_TEST_ACTION,
  idleLabel: TEXT.API_PROVIDERS_IDLE,
  okLabel: TEXT.TRANSLATION_PROBE_OK,
  failLabel: TEXT.TRANSLATION_TEST_FAILED,
  actionsLabel: (name: string): string => interpolate(TEXT.TRANSLATION_ACTIONS_ARIA, { name }),
};

const toCardView = (view: TranslationProviderView): CardView => ({
  id: view.config.id,
  name: view.config.name,
  type: view.config.type,
  enabled: view.config.enabled,
  apiBase: view.config.apiBase ?? null,
  keyHint: view.config.keyHint ?? null,
  keySet: view.hasKey,
});

const toProbe = (result: TranslationProviderTestResult): TranslationProbeView => ({
  status: result.ok ? 'ok' : 'error',
  latencyMs: result.latencyMs ?? null,
  detail: result.ok ? (result.translation ?? null) : null,
  error: result.ok ? null : (result.error ?? null),
});

/** Library save payload → app IPC input, preserving config fields the
 * form does not carry (enabled, keyHint) when editing an existing
 * instance. The apiBase persists only when it deviates from the catalog
 * default. */
const toAppInput = (input: CardSaveInput, existing?: TranslationProviderView['config']): TranslationProviderSaveInput => {
  const fields = input.fields ?? {};
  const numberField = (id: string): number | undefined => {
    const raw = (fields[id] ?? '').trim();
    return raw === '' ? undefined : Number(raw);
  };
  const entry = TRANSLATION_CATALOG.entries[input.type];
  const apiBase = input.apiBase?.trim() ?? '';
  const base: TranslationProviderView['config'] =
    existing ?? { id: crypto.randomUUID(), name: '', type: input.type as TranslationProviderType, enabled: true };
  return {
    ...base,
    name: (input.name ?? '').trim() || entry?.label || input.type,
    apiBase: apiBase !== '' && apiBase !== entry?.baseUrl ? apiBase : undefined,
    timeoutMs: numberField('timeout_ms'),
    ...(input.apiKey != null ? { key: input.apiKey } : {}),
  };
};

interface EditState {
  id: string;
  type: TranslationProviderType;
  value: TranslationProviderFormValue;
}

export function TranslationSection(): JSX.Element {
  const [settings, setSettings] = useState<TranslationSettings>(DEFAULT_CONFIG.translation);
  const [providers, setProviders] = useState<TranslationProviderView[]>([]);
  const [adding, setAdding] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TranslationProviderView | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TranslationProviderTestResult>>({});
  const [customCode, setCustomCode] = useState('');
  const [customName, setCustomName] = useState('');
  const [customNative, setCustomNative] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [config, views] = await Promise.all([
      window.electronAPI.loadConfig(),
      window.electronAPI.getTranslationProviders(),
    ]);
    setSettings(config.translation ?? DEFAULT_CONFIG.translation);
    setProviders(views);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const persist = useCallback((next: TranslationSettings): void => {
    setSettings(next);
    void window.electronAPI.saveConfig({ translation: next });
  }, []);

  const addCustomLanguage = (): void => {
    const raw = customCode.trim();
    const name = customName.trim();
    if (!name) {
      setCustomError(TEXT.TRANSLATION_CUSTOM_NAME_REQUIRED);
      return;
    }
    if (isLanguageCode(raw)) {
      setCustomError(interpolate(TEXT.TRANSLATION_CUSTOM_COLLISION, { code: raw.toLowerCase() }));
      return;
    }
    const code = normalizeCustomLanguageCode(raw);
    if (!code) {
      setCustomError(TEXT.TRANSLATION_CUSTOM_INVALID_CODE);
      return;
    }
    if (settings.customLanguages.some((entry) => entry.code === code)) {
      setCustomError(interpolate(TEXT.TRANSLATION_CUSTOM_DUPLICATE, { code }));
      return;
    }
    const nativeName = customNative.trim();
    const entry: CustomLanguageEntry = nativeName ? { code, name, nativeName } : { code, name };
    persist({ ...settings, customLanguages: [...settings.customLanguages, entry] });
    setCustomCode('');
    setCustomName('');
    setCustomNative('');
    setCustomError(null);
  };

  const removeCustomLanguage = (code: string): void => {
    persist({
      ...settings,
      customLanguages: settings.customLanguages.filter((entry) => entry.code !== code),
      defaultTarget: settings.defaultTarget === code ? null : settings.defaultTarget,
    });
  };

  const upsert = (saved: TranslationProviderView): void => {
    setProviders((prev) => [...prev.filter((view) => view.config.id !== saved.config.id), saved]);
  };

  const editingView = editing ? (providers.find((view) => view.config.id === editing.id) ?? null) : null;

  const openEdit = (view: CardView): void => {
    const full = providers.find((candidate) => candidate.config.id === view.id);
    if (!full) {
      return;
    }
    const { config } = full;
    setEditError(null);
    setEditing({
      id: config.id,
      type: config.type,
      value: {
        name: config.name,
        apiKey: '',
        apiBase: config.apiBase ?? '',
        fields: {
          timeout_ms: config.timeoutMs != null ? String(config.timeoutMs) : '',
        },
      },
    });
  };

  const saveWizard = async (input: CardSaveInput): Promise<void> => {
    try {
      const saved = await window.electronAPI.saveTranslationProvider(toAppInput(input));
      upsert(saved);
      setAdding(false);
      setWizardError(null);
    } catch (error) {
      setWizardError(error instanceof Error ? error.message : String(error));
    }
  };

  const saveEdit = async (value: TranslationProviderFormValue): Promise<void> => {
    if (!editing || !editingView) {
      return;
    }
    try {
      const saved = await window.electronAPI.saveTranslationProvider(
        toAppInput(
          {
            id: editing.id,
            type: editing.type,
            name: value.name,
            apiBase: value.apiBase,
            apiKey: value.apiKey.trim() === '' ? null : value.apiKey,
            fields: value.fields,
          },
          editingView.config,
        ),
      );
      upsert(saved);
      setEditing(null);
      setEditError(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    }
  };

  const clearStoredKey = async (): Promise<void> => {
    if (!editingView) {
      return;
    }
    try {
      const saved = await window.electronAPI.saveTranslationProvider({ ...editingView.config, key: '' });
      upsert(saved);
      setEditing(null);
      setEditError(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    }
  };

  const testProvider = async (providerId: string): Promise<void> => {
    setTesting(providerId);
    try {
      const result = await window.electronAPI.testTranslationProvider(providerId);
      setTestResults((prev) => ({ ...prev, [providerId]: result }));
    } finally {
      setTesting(null);
    }
  };

  const generateDefaultName = (type: string): string | null => {
    const base = TRANSLATION_CATALOG.entries[type]?.label ?? type;
    const taken = new Set(providers.map((view) => view.config.name));
    if (!taken.has(base)) {
      return base;
    }
    let n = 2;
    while (taken.has(`${base} ${n}`)) {
      n += 1;
    }
    return `${base} ${n}`;
  };

  if (editing) {
    const entry = TRANSLATION_CATALOG.entries[editing.type];
    if (entry) {
      return (
        <PackPageShell
          title={TEXT.TRANSLATION_EDIT_TITLE}
          pageLabel={TEXT.TRANSLATION_PAGE_ARIA}
          onBack={() => setEditing(null)}
        >
          <TranslationProviderSettingsForm
            type={editing.type}
            entry={entry}
            mode="edit"
            value={editing.value}
            onChange={(value) => setEditing({ ...editing, value })}
            onSubmit={(value) => void saveEdit(value)}
            onCancel={() => setEditing(null)}
            storedKeyHint={editingView?.config.keyHint ?? null}
            error={editError}
            extraFields={TRANSLATION_EXTRA_FIELDS}
            labels={{ ...wizardLabels, cancelLabel: TEXT.CANCEL_BUTTON }}
            onOpenKeyUrl={(url) => void window.electronAPI.openExternal(url)}
          />
          {editingView?.hasKey && (
            <div className="flex justify-start">
              <Button variant="outline" size="sm" onClick={() => void clearStoredKey()}>
                {TEXT.TRANSLATION_KEY_CLEAR}
              </Button>
            </div>
          )}
        </PackPageShell>
      );
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          <Languages className="h-4 w-4" aria-hidden />
          {TEXT.TRANSLATION_TITLE}
        </h4>
        <Button variant="outline" size="sm" onClick={() => { setWizardError(null); setAdding(true); }}>
          {TEXT.TRANSLATION_ADD}
        </Button>
      </div>
      <p className="text-xs opacity-50">{TEXT.TRANSLATION_HINT}</p>

      <div className="grid grid-cols-2 gap-2">
        <SelectField
          id="translation-mode"
          label={TEXT.TRANSLATION_MODE_LABEL}
          ariaLabel={TEXT.TRANSLATION_MODE_ARIA}
          options={MODE_OPTIONS}
          value={settings.mode}
          onChange={(value) => persist({ ...settings, mode: value as TranslationMode })}
        />
        <SelectField
          id="translation-default-target"
          label={TEXT.TRANSLATION_DEFAULT_TARGET_LABEL}
          ariaLabel={TEXT.TRANSLATION_DEFAULT_TARGET_ARIA}
          options={[
            { value: '', label: TEXT.TRANSLATION_DEFAULT_TARGET_NONE },
            ...settings.customLanguages.map((entry) => ({ value: entry.code, label: `${entry.name} (${entry.code})` })),
            ...LANGUAGES.map((entry) => ({ value: entry.code, label: entry.flag ? `${entry.flag} ${entry.name} (${entry.code})` : `${entry.name} (${entry.code})` })),
          ]}
          value={settings.defaultTarget ?? ''}
          onChange={(value) => persist({ ...settings, defaultTarget: value || null })}
          hint={TEXT.TRANSLATION_DEFAULT_TARGET_HINT}
        />
      </div>
      <p className="text-xs opacity-50">{TEXT.TRANSLATION_MODE_HINT}</p>

      <p className="text-xs opacity-50">{TEXT.TRANSLATION_PAD_SETTINGS_MOVED}</p>

      <div className="space-y-1.5 rounded-lg border border-[var(--as-border)] p-2">
        <p className="text-sm font-medium">{TEXT.TRANSLATION_CUSTOM_TITLE}</p>
        <p className="text-xs opacity-50">{TEXT.TRANSLATION_CUSTOM_HINT}</p>
        {settings.customLanguages.length === 0 && <p className="text-xs opacity-50">{TEXT.TRANSLATION_CUSTOM_EMPTY}</p>}
        <ul className="space-y-1">
          {settings.customLanguages.map((entry) => (
            <li key={entry.code} className="flex items-center gap-2 text-sm">
              <span className="rounded border border-[var(--as-border)] px-1.5 py-0.5 font-mono text-[10px]">
                {entry.code}
              </span>
              <span>{entry.name}</span>
              {entry.nativeName && entry.nativeName !== entry.name && (
                <span className="text-xs opacity-50">{entry.nativeName}</span>
              )}
              <button
                type="button"
                aria-label={interpolate(TEXT.TRANSLATION_CUSTOM_REMOVE_ARIA, { code: entry.code })}
                className="ml-auto opacity-50 hover:opacity-100"
                onClick={() => removeCustomLanguage(entry.code)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-3 gap-1.5">
          <input
            aria-label={TEXT.TRANSLATION_CUSTOM_CODE_LABEL}
            placeholder={TEXT.TRANSLATION_CUSTOM_CODE_LABEL}
            className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 font-mono text-sm"
            value={customCode}
            onChange={(e) => setCustomCode(e.target.value)}
          />
          <input
            aria-label={TEXT.TRANSLATION_CUSTOM_NAME_LABEL}
            placeholder={TEXT.TRANSLATION_CUSTOM_NAME_LABEL}
            className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
          />
          <input
            aria-label={TEXT.TRANSLATION_CUSTOM_NATIVE_LABEL}
            placeholder={TEXT.TRANSLATION_CUSTOM_NATIVE_LABEL}
            className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
            value={customNative}
            onChange={(e) => setCustomNative(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" onClick={addCustomLanguage}>
          {TEXT.TRANSLATION_CUSTOM_ADD}
        </Button>
        {customError && <p className="text-xs text-red-500">{customError}</p>}
      </div>

      <TranslationProvidersList
        providers={providers.map(toCardView)}
        catalog={TRANSLATION_CATALOG}
        probes={Object.fromEntries(Object.entries(testResults).map(([id, result]) => [id, toProbe(result)]))}
        testingId={testing}
        labels={listLabels}
        onToggle={(id, enabled) => {
          void window.electronAPI.setTranslationProviderEnabled(id, enabled);
          setProviders((prev) =>
            prev.map((view) =>
              view.config.id === id
                ? { ...view, config: { ...view.config, enabled } }
                : view,
            ),
          );
        }}
        onMove={(id, direction) => {
          void window.electronAPI.moveTranslationProvider(id, direction);
          setProviders((prev) => {
            const index = prev.findIndex((view) => view.config.id === id);
            const target = direction === 'up' ? index - 1 : index + 1;
            if (index === -1 || target < 0 || target >= prev.length) {
              return prev;
            }
            const next = [...prev];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
          });
        }}
        onTest={(id) => void testProvider(id)}
        onEdit={openEdit}
        onDelete={(id) => {
          const view = providers.find((candidate) => candidate.config.id === id);
          if (view) {
            setDeleting(view);
          }
        }}
      />

      {adding && (
        <Modal open onOpenChange={(open) => { if (!open) { setAdding(false); } }}>
          <ModalContent size="lg">
            <ModalHeader>
              <ModalTitle>{TEXT.TRANSLATION_ADD}</ModalTitle>
            </ModalHeader>
            <ModalBody className="pb-4">
              <TranslationProviderWizard
                catalog={TRANSLATION_CATALOG}
                defaultName={generateDefaultName}
                extraFields={TRANSLATION_EXTRA_FIELDS}
                error={wizardError}
                labels={wizardLabels}
                onCancel={() => setAdding(false)}
                onSave={(input) => void saveWizard(input)}
              />
            </ModalBody>
          </ModalContent>
        </Modal>
      )}

      <ConfirmationModal
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) { setDeleting(null); } }}
        title={deleting?.config.name ?? ''}
        description={TEXT.TRANSLATION_DELETE_CONFIRM}
        confirmLabel={TEXT.REMOVE_BUTTON}
        destructive
        onConfirm={() => {
          if (deleting) {
            void window.electronAPI.deleteTranslationProvider(deleting.config.id);
            setProviders((prev) => prev.filter((view) => view.config.id !== deleting.config.id));
            setDeleting(null);
          }
        }}
      />
    </section>
  );
}
