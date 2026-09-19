import { useCallback, useEffect, useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { Modal, ModalContent, ModalBody, ModalHeader, ModalTitle, ModalFooter } from '@neuronection/assistant-ui/modal';
import { ArrowDown, ArrowUp, Languages, PlugZap, Trash2 } from 'lucide-react';
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
import { clampPadDebounce } from '@shared/translation';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT, interpolate } from '@shared/constants/text';
import { Label } from './fields';
import { Switch } from '../tools/shared';

const TYPE_LABELS: Record<TranslationProviderType, string> = {
  libretranslate: 'LibreTranslate',
  deepl: 'DeepL',
};

const MODE_OPTIONS: { value: TranslationMode; label: string }[] = [
  { value: 'auto', label: TEXT.TRANSLATION_MODE_AUTO },
  { value: 'service', label: TEXT.TRANSLATION_MODE_SERVICE },
  { value: 'llm', label: TEXT.TRANSLATION_MODE_LLM },
];

const PAD_DEBOUNCE_PRESETS = [500, 1000, 1500, 2500, 5000];

function padDebounceOptions(current: number): { value: number; label: string }[] {
  const values = [...new Set([...PAD_DEBOUNCE_PRESETS, current])].sort((a, b) => a - b);
  return values.map((value) => ({ value, label: value >= 1000 ? `${value / 1000} s` : `${value} ms` }));
}

interface ProviderFormState {
  id: string | null;
  name: string;
  type: TranslationProviderType;
  enabled: boolean;
  apiBase: string;
  key: string;
  timeoutMs: string;
}

const EMPTY_FORM: ProviderFormState = {
  id: null,
  name: '',
  type: 'libretranslate',
  enabled: true,
  apiBase: '',
  key: '',
  timeoutMs: '',
};

export function TranslationSection(): JSX.Element {
  const [settings, setSettings] = useState<TranslationSettings>(DEFAULT_CONFIG.translation);
  const [providers, setProviders] = useState<TranslationProviderView[]>([]);
  const [form, setForm] = useState<ProviderFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
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

  const startEdit = (view: TranslationProviderView): void => {
    const { config } = view;
    setFormError(null);
    setForm({
      id: config.id,
      name: config.name,
      type: config.type,
      enabled: config.enabled,
      apiBase: config.apiBase ?? '',
      key: '',
      timeoutMs: config.timeoutMs ? String(config.timeoutMs) : '',
    });
  };

  const saveForm = async (): Promise<void> => {
    if (!form || !form.name.trim()) {
      setFormError(TEXT.TRANSLATION_NAME_REQUIRED);
      return;
    }
    if (form.type === 'libretranslate' && !form.apiBase.trim()) {
      setFormError(TEXT.TRANSLATION_API_BASE_REQUIRED);
      return;
    }
    try {
      const input: TranslationProviderSaveInput = {
        id: form.id ?? crypto.randomUUID(),
        name: form.name.trim(),
        type: form.type,
        enabled: form.enabled,
        timeoutMs: form.timeoutMs.trim() ? Number(form.timeoutMs) : undefined,
        ...(form.apiBase.trim() ? { apiBase: form.apiBase.trim() } : {}),
        ...(form.key.trim() !== '' ? { key: form.key.trim() } : {}),
      };
      const saved = await window.electronAPI.saveTranslationProvider(input);
      setProviders((prev) => {
        const next = prev.filter((view) => view.config.id !== saved.config.id);
        return [...next, saved];
      });
      setForm(null);
      setFormError(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
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

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          <Languages className="h-4 w-4" aria-hidden />
          {TEXT.TRANSLATION_TITLE}
        </h4>
        <Button variant="outline" size="sm" onClick={() => { setFormError(null); setForm({ ...EMPTY_FORM }); }}>
          {TEXT.TRANSLATION_ADD}
        </Button>
      </div>
      <p className="text-xs opacity-50">{TEXT.TRANSLATION_HINT}</p>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="translation-mode">{TEXT.TRANSLATION_MODE_LABEL}</Label>
          <select
            id="translation-mode"
            aria-label={TEXT.TRANSLATION_MODE_ARIA}
            className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
            value={settings.mode}
            onChange={(e) => persist({ ...settings, mode: e.target.value as TranslationMode })}
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="translation-default-target">{TEXT.TRANSLATION_DEFAULT_TARGET_LABEL}</Label>
          <select
            id="translation-default-target"
            aria-label={TEXT.TRANSLATION_DEFAULT_TARGET_ARIA}
            className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
            value={settings.defaultTarget ?? ''}
            onChange={(e) => persist({ ...settings, defaultTarget: e.target.value || null })}
          >
            <option value="">{TEXT.TRANSLATION_DEFAULT_TARGET_NONE}</option>
            {settings.customLanguages.map((entry) => (
              <option key={`custom-${entry.code}`} value={entry.code}>
                {entry.name} ({entry.code})
              </option>
            ))}
            {LANGUAGES.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name} ({entry.code})
              </option>
            ))}
          </select>
          <p className="text-xs opacity-50">{TEXT.TRANSLATION_DEFAULT_TARGET_HINT}</p>
        </div>
      </div>
      <p className="text-xs opacity-50">{TEXT.TRANSLATION_MODE_HINT}</p>

      <div className="space-y-1">
        <Label htmlFor="translation-pad-debounce">{TEXT.TRANSLATION_PAD_DEBOUNCE_LABEL}</Label>
        <select
          id="translation-pad-debounce"
          aria-label={TEXT.TRANSLATION_PAD_DEBOUNCE_ARIA}
          className="w-56 rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
          value={clampPadDebounce(settings.padDebounceMs)}
          onChange={(e) => persist({ ...settings, padDebounceMs: Number(e.target.value) })}
        >
          {padDebounceOptions(clampPadDebounce(settings.padDebounceMs)).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="text-xs opacity-50">{TEXT.TRANSLATION_PAD_DEBOUNCE_HINT}</p>
      </div>

      <div className="space-y-1.5 rounded-lg border border-[var(--as-border)] p-2">
        <p className="text-sm font-medium">{TEXT.TRANSLATION_CUSTOM_TITLE}</p>
        <p className="text-xs opacity-50">{TEXT.TRANSLATION_CUSTOM_HINT}</p>
        {settings.customLanguages.length === 0 && <p className="text-xs opacity-50">{TEXT.TRANSLATION_CUSTOM_EMPTY}</p>}
        <ul className="space-y-1">
          {settings.customLanguages.map((entry) => (
            <li key={entry.code} className="flex items-center gap-2 text-sm">
              <Badge variant="outline" className="font-mono text-[10px]">
                {entry.code}
              </Badge>
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

      {providers.length === 0 && !form && <p className="text-xs opacity-50">{TEXT.TRANSLATION_NO_PROVIDERS}</p>}
      <ul className="space-y-1.5">
        {providers.map((view, index) => {
          const test = testResults[view.config.id];
          return (
            <li key={view.config.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--as-border)] p-2 text-sm">
              <Switch
                checked={view.config.enabled}
                label={interpolate(TEXT.TRANSLATION_ENABLE_ARIA, { name: view.config.name })}
                hideLabel
                onCheckedChange={(checked) => {
                  void window.electronAPI.setTranslationProviderEnabled(view.config.id, checked);
                  setProviders((prev) =>
                    prev.map((candidate) =>
                      candidate.config.id === view.config.id
                        ? { ...candidate, config: { ...candidate.config, enabled: checked } }
                        : candidate
                    )
                  );
                }}
              />
              <span className="font-medium">{view.config.name}</span>
              <Badge variant="outline" className="text-[10px] font-normal uppercase">
                {TYPE_LABELS[view.config.type]}
              </Badge>
              <Badge variant="outline" className="text-[10px] font-normal">
                {interpolate(TEXT.TRANSLATION_ORDER_LABEL, { position: index + 1 })}
              </Badge>
              {view.hasKey && (
                <span className="text-xs opacity-50">
                  {interpolate(TEXT.TRANSLATION_KEY_HINT, { hint: view.config.keyHint ?? '' })}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-xs opacity-50">
                {view.config.apiBase ?? ''}
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={interpolate(TEXT.TRANSLATION_MOVE_UP_ARIA, { name: view.config.name })}
                disabled={index === 0}
                onClick={() => {
                  void window.electronAPI.moveTranslationProvider(view.config.id, 'up');
                  setProviders((prev) => {
                    if (index === 0) return prev;
                    const next = [...prev];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    return next;
                  });
                }}
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={interpolate(TEXT.TRANSLATION_MOVE_DOWN_ARIA, { name: view.config.name })}
                disabled={index === providers.length - 1}
                onClick={() => {
                  void window.electronAPI.moveTranslationProvider(view.config.id, 'down');
                  setProviders((prev) => {
                    if (index === prev.length - 1) return prev;
                    const next = [...prev];
                    [next[index + 1], next[index]] = [next[index], next[index + 1]];
                    return next;
                  });
                }}
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => startEdit(view)}>
                {TEXT.EDIT_BUTTON}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={interpolate(TEXT.TRANSLATION_TEST_ARIA, { name: view.config.name })}
                disabled={testing === view.config.id}
                onClick={() => void testProvider(view.config.id)}
              >
                <PlugZap className="h-3.5 w-3.5" aria-hidden />
                {test
                  ? test.ok
                    ? ` ${interpolate(TEXT.TRANSLATION_TEST_OK, { translation: test.translation ?? '', latency: test.latencyMs ?? '' })}`
                    : ` ${TEXT.TRANSLATION_TEST_FAILED}`
                  : ''}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={interpolate(TEXT.TRANSLATION_DELETE_ARIA, { name: view.config.name })}
                onClick={() => setDeleting(view)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
              {test && !test.ok && test.error && <p className="w-full text-xs text-red-500">{test.error}</p>}
            </li>
          );
        })}
      </ul>

      {form && (
        <Modal open onOpenChange={(open) => { if (!open) { setForm(null); } }}>
          <ModalContent size="md">
            <ModalHeader>
              <ModalTitle>{form.id ? TEXT.EDIT_BUTTON : TEXT.TRANSLATION_ADD}</ModalTitle>
            </ModalHeader>
            <ModalBody className="pb-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="translation-name">{TEXT.TRANSLATION_NAME_LABEL}</Label>
                  <input
                    id="translation-name"
                    aria-label={TEXT.TRANSLATION_NAME_ARIA}
                    className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="translation-type">{TEXT.TRANSLATION_TYPE_LABEL}</Label>
                  <select
                    id="translation-type"
                    className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as TranslationProviderType })}
                  >
                    {(Object.keys(TYPE_LABELS) as TranslationProviderType[]).map((type) => (
                      <option key={type} value={type}>
                        {TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="translation-apibase">{TEXT.TRANSLATION_API_BASE_LABEL}</Label>
                <p className="text-xs opacity-50">
                  {form.type === 'libretranslate' ? TEXT.TRANSLATION_API_BASE_HINT_LT : TEXT.TRANSLATION_API_BASE_HINT_DEEPL}
                </p>
                <input
                  id="translation-apibase"
                  aria-label={TEXT.TRANSLATION_API_BASE_ARIA}
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 font-mono text-sm"
                  value={form.apiBase}
                  onChange={(e) => setForm({ ...form, apiBase: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="translation-key">
                  {TEXT.TRANSLATION_KEY_LABEL + (form.id ? TEXT.TRANSLATION_KEY_LABEL_STORED : '')}
                </Label>
                <input
                  id="translation-key"
                  type="password"
                  aria-label={TEXT.TRANSLATION_KEY_LABEL}
                  autoComplete="off"
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 font-mono text-sm"
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="translation-timeout">{TEXT.TRANSLATION_TIMEOUT_LABEL}</Label>
                <input
                  id="translation-timeout"
                  type="number"
                  min={1000}
                  max={30000}
                  aria-label={TEXT.TRANSLATION_TIMEOUT_ARIA}
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                  value={form.timeoutMs}
                  onChange={(e) => setForm({ ...form, timeoutMs: e.target.value })}
                />
              </div>
              {formError && <p className="text-xs text-red-500">{formError}</p>}
            </ModalBody>
            <ModalFooter className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setForm(null)}>
                {TEXT.CANCEL_BUTTON}
              </Button>
              <Button size="sm" onClick={() => void saveForm()}>
                {TEXT.TRANSLATION_SAVE}
              </Button>
            </ModalFooter>
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
