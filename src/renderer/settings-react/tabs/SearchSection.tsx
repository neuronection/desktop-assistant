import { useCallback, useEffect, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@neuronection/assistant-ui/modal';
import {
  WebSearchProvidersList,
  WebSearchProviderSettingsForm,
  WebSearchProviderWizard,
  type WebSearchProviderFormValue,
  type WebSearchProviderProbeView,
  type WebSearchProviderView as CardView,
  type WebSearchProviderSaveInput as CardInput,
} from '@neuronection/assistant-ui/web-search-providers';
import { Globe } from 'lucide-react';
import type { SearchProviderConfig, SearchProviderSaveInput, SearchProviderTestResult, SearchProviderType, SearchProviderView } from '@shared/search';
import { TEXT, interpolate } from '@shared/constants/text';
import { SEARCH_CATALOG, SEARCH_EXTRA_FIELDS } from '../search-catalog';
import { PackPageShell } from '../apps/PackPageShell';

/** The AI-providers settings pattern applied to web search (family
 * web-search-providers module): configured instances as provider cards with
 * a `⋯` management menu, add = tiles → settings-form wizard in a modal,
 * edit = a detail page. All persistence rides the search IPC; keys stay in
 * the keyring. */

interface EditState {
  id: string;
  type: SearchProviderType;
  value: WebSearchProviderFormValue;
}

const wizardLabels = {
  chooseStepLabel: TEXT.SEARCH_STEP_CHOOSE,
  configureStepLabel: TEXT.SEARCH_STEP_CONFIGURE,
  stepsLabel: TEXT.SEARCH_STEPS_ARIA,
  tilesLabel: TEXT.SEARCH_TILES_ARIA,
  keyChipLabel: TEXT.SEARCH_CHIP_KEY,
  keylessChipLabel: TEXT.SEARCH_CHIP_KEYLESS,
  cloudChipLabel: TEXT.SEARCH_CHIP_CLOUD,
  selfHostedChipLabel: TEXT.SEARCH_CHIP_SELF_HOSTED,
  backLabel: TEXT.SEARCH_BACK_TO_LIST,
  nameLabel: TEXT.SEARCH_NAME_LABEL,
  apiKeyLabel: TEXT.SEARCH_KEY_LABEL,
  keyStoredLabel: TEXT.SEARCH_KEY_SAVED,
  noKeyLabel: TEXT.SEARCH_NO_KEY_NEEDED,
  baseUrlLabel: TEXT.SEARCH_BASE_URL_LABEL,
  baseUrlRequiredLabel: TEXT.SEARCH_BASE_URL_REQUIRED_LABEL,
  advancedLabel: TEXT.SETUP_ADVANCED,
  getKeyLabel: TEXT.SEARCH_GET_KEY,
  saveLabel: TEXT.SEARCH_SAVE,
  cancelLabel: TEXT.CANCEL_BUTTON,
};

const listLabels = {
  emptyLabel: TEXT.SEARCH_NO_PROVIDERS,
  orderLabel: (position: number): string => interpolate(TEXT.SEARCH_ORDER_LABEL, { position }),
  disabledBadge: TEXT.SEARCH_DISABLED_BADGE,
  noKeyLabel: TEXT.SEARCH_NO_KEY_BADGE,
  keyStoredLabel: TEXT.SEARCH_KEY_STORED,
  enableLabel: TEXT.MINIAPPS_ENABLE,
  disableLabel: TEXT.MINIAPPS_DISABLE,
  moveUpLabel: TEXT.SEARCH_MOVE_UP_ACTION,
  moveDownLabel: TEXT.SEARCH_MOVE_DOWN_ACTION,
  editLabel: TEXT.SEARCH_EDIT_ACTION,
  deleteLabel: TEXT.SEARCH_DELETE_ACTION,
  testLabel: TEXT.SEARCH_TEST_ACTION,
  idleLabel: TEXT.API_PROVIDERS_IDLE,
  okLabel: TEXT.SEARCH_PROBE_OK,
  failLabel: TEXT.SEARCH_TEST_FAILED,
  actionsLabel: (name: string): string => interpolate(TEXT.SEARCH_ACTIONS_ARIA, { name }),
};

const toCardView = (view: SearchProviderView): CardView => ({
  id: view.config.id,
  name: view.config.name,
  type: view.config.type,
  enabled: view.config.enabled,
  baseUrl: view.config.baseUrl ?? null,
  googleCx: view.config.googleCx ?? null,
  keyHint: view.config.keyHint ?? null,
  keySet: view.hasKey,
});

const toProbe = (result: SearchProviderTestResult): WebSearchProviderProbeView => ({
  status: result.ok ? 'ok' : 'error',
  latencyMs: result.latencyMs ?? null,
  error: result.ok ? null : (result.error ?? null),
});

/** Library save payload → app IPC input, preserving config fields the form
 * does not carry (enabled, keyHint) when editing an existing instance. The
 * base URL persists only when it deviates from the catalog default. */
const toAppInput = (input: CardInput, existing?: SearchProviderConfig): SearchProviderSaveInput => {
  const fields = input.fields ?? {};
  const numberField = (id: string): number | undefined => {
    const raw = (fields[id] ?? '').trim();
    return raw === '' ? undefined : Number(raw);
  };
  const entry = SEARCH_CATALOG.entries[input.type];
  const baseUrl = input.baseUrl?.trim() ?? '';
  const base: SearchProviderConfig =
    existing ?? { id: crypto.randomUUID(), name: '', type: input.type as SearchProviderType, enabled: true };
  return {
    ...base,
    name: (input.name ?? '').trim() || entry?.label || input.type,
    baseUrl: baseUrl !== '' && baseUrl !== entry?.baseUrl ? baseUrl : undefined,
    googleCx: (input.googleCx ?? '').trim() || undefined,
    timeoutMs: numberField('timeout_ms'),
    maxResults: numberField('max_results'),
    ...(input.apiKey != null ? { key: input.apiKey } : {}),
  };
};

export function SearchSection(): JSX.Element {
  const [providers, setProviders] = useState<SearchProviderView[]>([]);
  const [adding, setAdding] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SearchProviderView | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, SearchProviderTestResult>>({});

  const refresh = useCallback(async () => {
    setProviders(await window.electronAPI.getSearchProviders());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsert = (saved: SearchProviderView): void => {
    setProviders((prev) => [...prev.filter((view) => view.config.id !== saved.config.id), saved]);
  };

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
        baseUrl: config.baseUrl ?? '',
        fields: {
          google_cx: config.googleCx ?? '',
          timeout_ms: config.timeoutMs != null ? String(config.timeoutMs) : '',
          max_results: config.maxResults != null ? String(config.maxResults) : '',
        },
      },
    });
  };

  const editingView = editing ? (providers.find((view) => view.config.id === editing.id) ?? null) : null;

  const generateDefaultName = (type: string): string | null => {
    const base = SEARCH_CATALOG.entries[type]?.label ?? type;
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

  const saveWizard = async (input: CardInput): Promise<void> => {
    try {
      const saved = await window.electronAPI.saveSearchProvider(toAppInput(input));
      upsert(saved);
      setAdding(false);
      setWizardError(null);
    } catch (error) {
      setWizardError(error instanceof Error ? error.message : String(error));
    }
  };

  const saveEdit = async (value: WebSearchProviderFormValue): Promise<void> => {
    if (!editing || !editingView) {
      return;
    }
    try {
      const saved = await window.electronAPI.saveSearchProvider(
        toAppInput(
          {
            id: editing.id,
            type: editing.type,
            name: value.name,
            baseUrl: value.baseUrl,
            googleCx: value.fields['google_cx'] ?? '',
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
      const saved = await window.electronAPI.saveSearchProvider({ ...editingView.config, key: '' });
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
      const result = await window.electronAPI.testSearchProvider(providerId);
      setTestResults((prev) => ({ ...prev, [providerId]: result }));
    } finally {
      setTesting(null);
    }
  };

  if (editing) {
    const entry = SEARCH_CATALOG.entries[editing.type];
    if (entry) {
      return (
        <PackPageShell
          title={TEXT.SEARCH_EDIT_TITLE}
          pageLabel={TEXT.SEARCH_PAGE_ARIA}
          onBack={() => setEditing(null)}
        >
          <WebSearchProviderSettingsForm
            type={editing.type}
            entry={entry}
            mode="edit"
            value={editing.value}
            onChange={(value) => setEditing({ ...editing, value })}
            onSubmit={(value) => void saveEdit(value)}
            onCancel={() => setEditing(null)}
            storedKeyHint={editingView?.config.keyHint ?? null}
            error={editError}
            extraFields={SEARCH_EXTRA_FIELDS}
            labels={{ ...wizardLabels, cancelLabel: TEXT.CANCEL_BUTTON }}
            onOpenKeyUrl={(url) => void window.electronAPI.openExternal(url)}
          />
          {editingView?.hasKey && (
            <div className="flex justify-start">
              <Button variant="outline" size="sm" onClick={() => void clearStoredKey()}>
                {TEXT.SEARCH_KEY_CLEAR}
              </Button>
            </div>
          )}
        </PackPageShell>
      );
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          <Globe className="h-4 w-4" aria-hidden />
          {TEXT.SEARCH_TITLE}
        </h4>
        <Button variant="outline" size="sm" onClick={() => { setWizardError(null); setAdding(true); }}>
          {TEXT.SEARCH_ADD}
        </Button>
      </div>
      <p className="text-xs opacity-50">{TEXT.SEARCH_HINT}</p>
      <WebSearchProvidersList
        providers={providers.map(toCardView)}
        catalog={SEARCH_CATALOG}
        probes={Object.fromEntries(Object.entries(testResults).map(([id, result]) => [id, toProbe(result)]))}
        testingId={testing}
        labels={listLabels}
        onToggle={(id, enabled) => {
          void window.electronAPI.setSearchProviderEnabled(id, enabled);
          setProviders((prev) =>
            prev.map((view) =>
              view.config.id === id
                ? { ...view, config: { ...view.config, enabled } }
                : view,
            ),
          );
        }}
        onMove={(id, direction) => {
          void window.electronAPI.moveSearchProvider(id, direction);
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
              <ModalTitle>{TEXT.SEARCH_ADD}</ModalTitle>
            </ModalHeader>
            <ModalBody className="pb-4">
              <WebSearchProviderWizard
                catalog={SEARCH_CATALOG}
                defaultName={generateDefaultName}
                extraFields={SEARCH_EXTRA_FIELDS}
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
        description={TEXT.SEARCH_DELETE_CONFIRM}
        confirmLabel={TEXT.REMOVE_BUTTON}
        destructive
        onConfirm={() => {
          if (deleting) {
            void window.electronAPI.deleteSearchProvider(deleting.config.id);
            setProviders((prev) => prev.filter((view) => view.config.id !== deleting.config.id));
            setDeleting(null);
          }
        }}
      />
    </section>
  );
}
