import { useMemo, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { ConnectionTestRow } from '@neuronection/assistant-ui/connection-test-row';
import { ModelRegistry, type ModelRegistryDraft, type ModelRegistryModel, type ModelRegistryPatch } from '@neuronection/assistant-ui/model-registry';
import { TaskAssignmentPicker } from '@neuronection/assistant-ui/task-assignment-picker';
import type { ModelPickerProvider } from '@neuronection/assistant-ui/model-picker';
import { CapabilityDescriptor } from '@neuronection/assistant-ui/capability-chips';
import { Modal, ModalContent, ModalBody, ModalHeader, ModalTitle, ModalFooter } from '@neuronection/assistant-ui/modal';
import { ProviderForm } from '@neuronection/assistant-ui/provider-form';
import { SegmentedTabs } from '@neuronection/assistant-ui/segmented-tabs';
import { Boxes, Check, Eye, Languages, MessageSquare, Mic, Send, Sparkles, Tag, Type, Volume2, Wrench } from 'lucide-react';
import { AppConfig } from '@shared/config/AppConfig';
import { AiTask, LLMProvider, LLMProviderType, Model, ModelCapability, ProviderTestResult, SetupPresetOptions } from '@shared/types';
import { inferModelCaps } from '@shared/ai/tasks';
import { hasConfiguredProvider, presetKeyForProvider, PROVIDER_PRESET_ORDER, PROVIDER_SETUP_PRESETS, type ProviderPresetKey } from '@shared/ai/providerPresets';
import { TEXT, interpolate } from '@shared/constants/text';
import { NotificationService } from '@renderer/services/NotificationService';
import { Field } from './fields';
import { ProviderLogo } from './ProviderLogo';
import { SetupFirstRunCard, SetupWizard, setupErrorText } from './SetupWizard';

export type ApiSection = 'providers' | 'models' | 'tasks';

export interface ApiTabProps {
  config: AppConfig;
  onChange: (updates: Partial<AppConfig>) => void;
  /** Controlled sub-tab; optional — the tab strip works standalone too. */
  section?: ApiSection;
  onSectionChange?: (section: ApiSection) => void;
  /** Setup-wizard persistence (plan 21): reload the main-owned config after a preset setup. */
  onSetupComplete?: () => void;
}

const API_SECTIONS: { id: ApiSection; label: string }[] = [
  { id: 'providers', label: TEXT.API_PROVIDERS_SECTION },
  { id: 'models', label: TEXT.API_MODELS_TITLE },
  { id: 'tasks', label: TEXT.API_TASKS_TITLE },
];

interface DraftProvider extends LLMProvider {
  isNew?: boolean;
}

const newProvider = (): DraftProvider => ({
  isNew: true,
  id: `new_${Date.now()}`,
  name: '',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: '',
  timeout: 120000,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: 'You are a helpful assistant.',
  availableModels: [],
  customModels: [],
});

const CAP_DESCRIPTORS: CapabilityDescriptor[] = [
  { value: 'text', label: TEXT.API_CAP_TEXT, icon: Type },
  { value: 'vision', label: TEXT.API_CAP_VISION, icon: Eye },
  { value: 'tools', label: TEXT.API_CAP_TOOLS, icon: Wrench },
  { value: 'stt', label: TEXT.API_CAP_STT, icon: Mic },
  { value: 'tts', label: TEXT.API_CAP_TTS, icon: Volume2 },
  { value: 'embeddings', label: TEXT.API_CAP_EMBEDDINGS, icon: Boxes },
];

const REASONING_EFFORT_OPTIONS = ['none', 'minimal', 'low', 'medium', 'high'];

const PROVIDER_PRESETS: Record<LLMProviderType, string> = {
  [LLMProviderType.OPENAI]: 'https://api.openai.com/v1',
  [LLMProviderType.ANTHROPIC]: 'https://api.anthropic.com',
  [LLMProviderType.GOOGLE]: 'https://generativelanguage.googleapis.com/v1beta',
  [LLMProviderType.GROQ]: 'https://api.groq.com/openai/v1',
  [LLMProviderType.TOGETHER]: 'https://api.together.xyz/v1',
  [LLMProviderType.FIREWORKS]: 'https://api.fireworks.ai/inference/v1',
  [LLMProviderType.OLLAMA]: 'http://localhost:11434/v1',
};

const PROVIDER_TYPE_LABELS: Partial<Record<LLMProviderType, string>> = {
  [LLMProviderType.ANTHROPIC]: 'Anthropic',
  [LLMProviderType.GOOGLE]: 'Google Gemini',
  [LLMProviderType.OLLAMA]: 'Ollama (local)',
};

const FIXED_BASE_URL_TYPES = new Set<LLMProviderType>([LLMProviderType.ANTHROPIC, LLMProviderType.GOOGLE]);

const compositeId = (providerId: string, modelId: string): string => `${providerId}:${modelId}`;

const toRegistryModel = (provider: LLMProvider, model: Model): ModelRegistryModel => ({
  id: compositeId(provider.id, model.id),
  providerId: provider.id,
  externalId: model.id,
  label: model.name !== model.id ? model.name : undefined,
  caps: model.caps && model.caps.length > 0 ? model.caps : inferModelCaps(model.id),
  enabled: true,
  reasoningEffort: model.reasoningEffort,
  temperature: model.temperature ?? null,
  maxTokens: model.maxTokens ?? null,
});

export function ApiTab({ config, onChange, section: sectionProp, onSectionChange, onSetupComplete }: ApiTabProps): JSX.Element {
  const [internalSection, setInternalSection] = useState<ApiSection>('providers');
  const section = sectionProp ?? internalSection;
  const setSection = onSectionChange ?? setInternalSection;
  const [editing, setEditing] = useState<DraftProvider | null>(null);
  const [deleting, setDeleting] = useState<LLMProvider | null>(null);
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [remote, setRemote] = useState<Record<string, { state: 'loading' | 'error' | 'ready'; models: Model[]; error?: string }>>({});
  const [tests, setTests] = useState<Record<string, ProviderTestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupInitialPreset, setSetupInitialPreset] = useState<ProviderPresetKey | null>(null);

  const providers = config.providers ?? [];
  const firstRunCard = !hasConfiguredProvider(providers);

  const openSetupWizard = (preset?: ProviderPresetKey): void => {
    setSetupInitialPreset(preset ?? null);
    setSetupOpen(true);
  };

  const patchProviders = (next: LLMProvider[], extra?: Partial<AppConfig>): void => {
    onChange({ providers: next, ...extra });
  };

  const updateProviderModels = (providerId: string, map: (models: Model[]) => Model[]): void => {
    patchProviders(
      providers.map((p) => (p.id === providerId ? { ...p, availableModels: map(p.availableModels ?? []) } : p))
    );
  };

  const draftToModel = (provider: LLMProvider, draft: ModelRegistryDraft): Model => ({
    id: draft.externalId,
    name: draft.label?.trim() || draft.externalId,
    providerType: provider.type,
    providerId: provider.id,
    caps: draft.caps as ModelCapability[],
    ...(draft.reasoningEffort ? { reasoningEffort: draft.reasoningEffort } : {}),
    ...(draft.temperature != null ? { temperature: draft.temperature } : {}),
    ...(draft.maxTokens != null ? { maxTokens: draft.maxTokens } : {}),
  });

  const fetchRemoteModels = async (provider: LLMProvider): Promise<void> => {
    setRemote((prev) => ({
      ...prev,
      [provider.id]: { state: 'loading', models: prev[provider.id]?.models ?? [] },
    }));
    try {
      const models = await window.electronAPI.fetchAvailableModels(provider);
      if (!models.success) {
        throw new Error(models.error || 'Catalog fetch failed.');
      }
      const fetched = models.data ?? [];
      setRemote((prev) => ({ ...prev, [provider.id]: { state: 'ready', models: fetched } }));
    } catch (error) {
      setRemote((prev) => ({
        ...prev,
        [provider.id]: {
          state: 'error',
          models: prev[provider.id]?.models ?? [],
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };

  const handleExpandedProvider = (providerId: string | null): void => {
    setExpandedProviderId(providerId);
    if (providerId) {
      const provider = providers.find((p) => p.id === providerId);
      if (provider) {
        void fetchRemoteModels(provider);
      }
    }
  };

  const testProvider = async (provider: LLMProvider): Promise<void> => {
    setTestingId(provider.id);
    try {
      const result = await window.electronAPI.testProvider(provider);
      setTests((prev) => ({ ...prev, [provider.id]: result }));
    } finally {
      setTestingId(null);
    }
  };

  const saveDraft = async (): Promise<void> => {
    if (!editing) {
      return;
    }
    const draft: LLMProvider = { ...editing };
    delete (draft as DraftProvider).isNew;
    if (!draft.name.trim()) {
      NotificationService.showError(TEXT.API_NAME_REQUIRED);
      return;
    }
    try {
      if (editing.isNew) {
        const result = await window.electronAPI.addProvider(draft);
        if (!result.success) {
          throw new Error(result.error ?? TEXT.API_UNKNOWN_ERROR);
        }
      } else {
        const result = await window.electronAPI.updateProvider(draft);
        if (!result.success) {
          throw new Error(result.error ?? TEXT.API_UNKNOWN_ERROR);
        }
      }
      setEditing(null);
      onSetupComplete?.();
    } catch (error) {
      NotificationService.showError(error instanceof Error ? error.message : String(error));
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleting) {
      return;
    }
    const target = deleting;
    setDeleting(null);
    try {
      const result = await window.electronAPI.deleteProvider(target.id);
      if (!result.success) {
        throw new Error(result.error ?? TEXT.API_UNKNOWN_ERROR);
      }
      NotificationService.showSuccess(TEXT.API_PROVIDER_DELETED);
      onSetupComplete?.();
    } catch (error) {
      NotificationService.showError(error instanceof Error ? error.message : String(error));
    }
  };

  const [reSettingUpId, setReSettingUpId] = useState<string | null>(null);
  const [clearingModels, setClearingModels] = useState(false);
  const [reSetupTarget, setReSetupTarget] = useState<LLMProvider | null>(null);
  const [reSetupModels, setReSetupModels] = useState<string[]>([]);
  const [reSetupFillText, setReSetupFillText] = useState(true);
  const [reSetupFillVision, setReSetupFillVision] = useState(true);
  const [reSetupFillStt, setReSetupFillStt] = useState(true);

  const openReSetupReview = (provider: LLMProvider): void => {
    const key = presetKeyForProvider(provider);
    setReSetupModels(key ? PROVIDER_SETUP_PRESETS[key].curatedModels ?? [] : []);
    setReSetupFillText(true);
    setReSetupFillVision(true);
    setReSetupFillStt(true);
    setReSetupTarget(provider);
  };

  const reRunSetup = async (provider: LLMProvider, options?: SetupPresetOptions): Promise<void> => {
    const key = presetKeyForProvider(provider);
    if (!key || reSettingUpId) {
      return;
    }
    setReSettingUpId(provider.id);
    try {
      const result = await window.electronAPI.setupProviderFromPreset(key, '', provider.name, options);
      if (result.ok) {
        NotificationService.showSuccess(
          interpolate(TEXT.SETUP_REFRESH_OK, { name: result.provider?.name ?? provider.name, count: result.catalogCount })
        );
        if (result.assignedModelId) {
          NotificationService.showSuccess(interpolate(TEXT.SETUP_SUCCESS_ASSIGNED, { model: result.assignedModelId }));
        }
        if (result.assignedVisionModelId) {
          NotificationService.showSuccess(interpolate(TEXT.SETUP_SUCCESS_ASSIGNED_VISION, { model: result.assignedVisionModelId }));
        }
        if (result.assignedSttModelId) {
          NotificationService.showSuccess(interpolate(TEXT.SETUP_SUCCESS_ASSIGNED_STT, { model: result.assignedSttModelId }));
        }
        onSetupComplete?.();
      } else {
        NotificationService.showError(setupErrorText(result.errorCode, result.vendorMessage));
      }
    } catch (error) {
      NotificationService.showError(interpolate(TEXT.SETUP_REFRESH_FAILED, { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      setReSettingUpId(null);
    }
  };

  const registryProviders = useMemo(
    () =>
      providers.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        baseUrl: p.apiBase || undefined,
      })),
    [providers]
  );

  const registryModels = useMemo(() => providers.flatMap((p) => (p.availableModels ?? []).map((m) => toRegistryModel(p, m))), [providers]);

  const expanded = expandedProviderId ? providers.find((p) => p.id === expandedProviderId) ?? null : null;
  const remoteState = expandedProviderId ? remote[expandedProviderId] : undefined;
  const registeredIds = new Set(
    expanded?.availableModels?.map((m) => m.id) ?? []
  );
  const remoteModels = (remoteState?.models ?? [])
    .filter((m) => !registeredIds.has(m.id))
    .map((m) => ({ id: m.id, caps: inferModelCaps(m.id) }));

  const taskCatalog: ModelPickerProvider[] = useMemo(
    () =>
      providers.map((p) => ({
        id: p.id,
        name: p.name,
        models: (p.availableModels ?? []).map((m) => ({
          id: m.id,
          name: m.name,
          capabilities: m.caps && m.caps.length > 0 ? m.caps : inferModelCaps(m.id),
        })),
      })),
    [providers]
  );

  const handleAssign = (taskId: string, modelId: string | null): void => {
    onChange({ taskAssignments: { ...config.taskAssignments, [taskId]: modelId } });
  };

  return (
    <div className="space-y-6">
      <SegmentedTabs
        ariaLabel={TEXT.SETTINGS_NAV_API}
        items={API_SECTIONS.map((entry) => ({ value: entry.id, label: entry.label }))}
        value={section}
        onValueChange={(next) => setSection(next as ApiSection)}
      />

      {section === 'providers' && (
        <div role="tabpanel" aria-label={TEXT.API_PROVIDERS_SECTION} className="space-y-8">
          {firstRunCard && <SetupFirstRunCard onOpenWizard={openSetupWizard} />}
          <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{TEXT.API_PROVIDERS_SECTION}</h3>
          <p className="text-sm opacity-60">{TEXT.API_PROVIDERS_HINT}</p>
        </div>
        <ul className="space-y-2">
          {providers.length === 0 && <li className="text-sm opacity-50">{TEXT.API_NO_PROVIDERS}</li>}
          {providers.map((p) => {
            const isDefault = config.defaultProviderId === p.id;
            const test = tests[p.id];
            const setupKey = presetKeyForProvider(p);
            return (
              <li key={p.id} className="space-y-1 rounded-md border border-[var(--as-border)] px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span aria-hidden={true} className={isDefault ? 'text-amber-400' : 'opacity-30'}>★</span>
                    <ProviderLogo presetKey={setupKey} label={p.name} />
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className="rounded bg-[var(--as-muted)] px-1.5 py-0.5 text-xs uppercase opacity-70">{p.type}</span>
                    {p.apiKeyHint && <span className="text-xs opacity-50">{interpolate(TEXT.API_KEY_HINT, { hint: p.apiKeyHint })}</span>}
                  </div>
                  <div className="flex gap-2">
                    {setupKey && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={reSettingUpId !== null}
                        loading={reSettingUpId === p.id}
                        title={interpolate(TEXT.SETUP_ROW_SETUP_ARIA, { name: p.name })}
                        aria-label={interpolate(TEXT.SETUP_ROW_SETUP_ARIA, { name: p.name })}
                        onClick={() => openReSetupReview(p)}
                      >
                        {TEXT.SETUP_SUBMIT}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setEditing({ ...p, isNew: false })}>{TEXT.EDIT_BUTTON}</Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={providers.length <= 1}
                      onClick={() => setDeleting(p)}
                    >
                      {TEXT.DELETE_BUTTON}
                    </Button>
                  </div>
                </div>
                <ConnectionTestRow
                  variant="inline"
                  label={TEXT.API_CONNECTION}
                  status={testingId === p.id ? 'testing' : test ? (test.ok ? 'ok' : 'fail') : 'idle'}
                  errorMessage={test?.error ?? null}
                  meta={test?.ok ? interpolate(TEXT.API_MODELS_COUNT, { count: test.modelCount }) : undefined}
                  latencyMs={test?.ok ? test.latencyMs : undefined}
                  testLabel={TEXT.API_TEST}
                  okLabel={TEXT.API_TEST_OK}
                  failLabel={TEXT.API_TEST_FAIL}
                  disabled={testingId === p.id}
                  onTest={() => void testProvider(p)}
                />
              </li>
            );
          })}
        </ul>
        {!firstRunCard && (
          <Button size="sm" onClick={() => openSetupWizard()}>
            {TEXT.API_ADD_PROVIDER}
          </Button>
        )}
          </section>
        </div>
      )}

      {section === 'models' && (
        <div role="tabpanel" aria-label={TEXT.API_MODELS_TITLE} className="space-y-8">
          <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{TEXT.API_MODELS_TITLE}</h3>
          <p className="text-sm opacity-60">{TEXT.API_MODELS_SUBTITLE}</p>
        </div>
        <ModelRegistry
          providers={registryProviders}
          models={registryModels}
          caps={CAP_DESCRIPTORS}
          capsHint={TEXT.API_CAPS_HINT}
          expandedProviderId={expandedProviderId}
          onExpandedProviderChange={handleExpandedProvider}
          remoteModels={remoteModels}
          remoteState={expandedProviderId ? remoteState?.state ?? 'loading' : 'ready'}
          remoteError={remoteState?.error ?? null}
          onRetryRemote={() => expanded && void fetchRemoteModels(expanded)}
          onAddModel={(pid, draft) => updateProviderModels(pid, (models) => [...models, draftToModel(providers.find((p) => p.id === pid)!, draft)])}
          onAddAll={(pid, drafts) =>
            updateProviderModels(pid, (models) => {
              const known = new Set(models.map((m) => m.id));
              return [...models, ...drafts.filter((d) => !known.has(d.externalId)).map((d) => draftToModel(providers.find((p) => p.id === pid)!, d))];
            })
          }
          onUpdateModel={(model, patch: ModelRegistryPatch) => {
            const [providerId, externalId] = [model.providerId, model.externalId];
            updateProviderModels(providerId, (models) =>
              models.map((m) =>
                m.id === externalId
                  ? {
                      ...m,
                      ...(patch.label !== undefined ? { name: patch.label || externalId } : {}),
                      ...(patch.caps !== undefined ? { caps: patch.caps as ModelCapability[] } : {}),
                      ...(patch.reasoningEffort !== undefined ? { reasoningEffort: patch.reasoningEffort || undefined } : {}),
                      ...(patch.temperature !== undefined ? { temperature: patch.temperature ?? undefined } : {}),
                      ...(patch.maxTokens !== undefined ? { maxTokens: patch.maxTokens ?? undefined } : {}),
                    }
                  : m
              )
            );
          }}
          onDeleteModel={(model) => updateProviderModels(model.providerId, (models) => models.filter((m) => m.id !== model.externalId))}
          reasoningEffortOptions={REASONING_EFFORT_OPTIONS}
          addLabel={TEXT.API_ADD_MODEL}
          addAllLabel={TEXT.API_ADD_ALL}
          editLabel={TEXT.EDIT_BUTTON}
          removeLabel={TEXT.REMOVE_BUTTON}
          selectModelLabel={TEXT.API_SELECT_MODEL}
          manualIdToggleLabel={TEXT.API_MANUAL_ID}
          searchPlaceholder={TEXT.API_MODEL_SEARCH}
          emptyProviderLabel={TEXT.API_PROVIDERS_EMPTY}
          externalIdRequiredLabel={TEXT.API_EXTERNAL_ID_REQUIRED}
          remoteEmptyLabel={TEXT.API_REMOTE_EMPTY}
          remoteLoadingLabel={TEXT.API_REMOTE_LOADING}
          retryLabel={TEXT.API_REMOTE_RETRY}
          temperatureLabel={TEXT.API_TEMPERATURE_LABEL}
          maxTokensLabel={TEXT.API_MAX_TOKENS_LABEL}
          labelLabel={TEXT.API_MODEL_LIST_LABEL}
          reasoningEffortLabel={TEXT.API_REASONING_EFFORT}
          saveLabel={TEXT.SAVE_BUTTON}
          cancelLabel={TEXT.CANCEL_BUTTON}
        />
          </section>
        </div>
      )}

      {section === 'tasks' && (
        <div role="tabpanel" aria-label={TEXT.API_TASKS_TITLE} className="space-y-8">
          <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{TEXT.API_TASKS_TITLE}</h3>
          <p className="text-sm opacity-60">{TEXT.API_TASKS_SUBTITLE}</p>
        </div>
        <TaskAssignmentPicker
          sections={[
            {
              id: 'defaults',
              label: TEXT.API_TASKS_DEFAULTS_SECTION,
              tasks: [
                { id: AiTask.CHAT, label: TEXT.API_TASK_CHAT, description: TEXT.API_TASK_CHAT_DESCRIPTION, requires: 'text', icon: MessageSquare },
                { id: AiTask.VISION, label: TEXT.API_TASK_VISION, description: TEXT.API_TASK_VISION_DESCRIPTION, requires: 'vision', icon: Eye },
                { id: AiTask.STT, label: TEXT.API_TASK_STT, description: TEXT.API_TASK_STT_DESCRIPTION, requires: 'stt', icon: Mic },
                { id: AiTask.TTS, label: TEXT.API_TASK_TTS, description: TEXT.API_TASK_TTS_DESCRIPTION, requires: 'tts', icon: Volume2 },
              ],
            },
            {
              id: 'other',
              label: TEXT.API_TASKS_OTHER_SECTION,
              tasks: [
                { id: AiTask.TITLES, label: TEXT.API_TASK_TITLES, description: TEXT.API_TASK_TITLES_DESCRIPTION, requires: 'text', icon: Tag },
                { id: AiTask.TRANSLATE, label: TEXT.API_TASK_TRANSLATE, description: TEXT.API_TASK_TRANSLATE_DESCRIPTION, requires: 'text', icon: Languages },
                { id: AiTask.PLUMBING, label: TEXT.API_TASK_PLUMBING, description: TEXT.API_TASK_PLUMBING_DESCRIPTION, requires: 'text', icon: Wrench },
                { id: AiTask.INTENT, label: TEXT.API_TASK_INTENT, description: TEXT.API_TASK_INTENT_DESCRIPTION, requires: 'text', icon: Sparkles },
                { id: AiTask.VOICE_ENDPOINT, label: TEXT.API_TASK_VOICE_ENDPOINT, description: TEXT.API_TASK_VOICE_ENDPOINT_DESCRIPTION, requires: 'text', icon: Send },
              ],
            },
          ]}
          providers={taskCatalog}
          value={config.taskAssignments}
          onAssign={handleAssign}
          clearLabel={TEXT.API_DEFAULT_MODEL_UNSET}
        />
          </section>
        </div>
      )}

      <SetupWizard
        open={setupOpen}
        onOpenChange={setSetupOpen}
        onSetupComplete={() => onSetupComplete?.()}
        onOpenManualForm={(partial) => setEditing({ ...newProvider(), ...partial, isNew: true })}
        initialPreset={setupInitialPreset}
      />

      <Modal open={editing !== null} onOpenChange={(open) => { if (!open) { setEditing(null); } }}>
        <ModalContent size="lg">
          <ModalHeader>
            <ModalTitle>
              <span className="flex items-center gap-2">
                {editing && (
                  <ProviderLogo
                    presetKey={
                      presetKeyForProvider({
                        ...editing,
                        apiBase: editing.apiBase || PROVIDER_PRESETS[editing.type] || '',
                      }) ??
                      (PROVIDER_PRESET_ORDER.find(
                        (key) => PROVIDER_SETUP_PRESETS[key].type === editing.type
                      ) ?? null)
                    }
                    label={editing.name || editing.type}
                  />
                )}
                {editing?.isNew ? TEXT.API_ADD_PROVIDER : TEXT.API_EDIT_PROVIDER}
              </span>
            </ModalTitle>
          </ModalHeader>
          {editing && (
            <ModalBody className="space-y-4">
              <Field label={TEXT.API_TYPE_LABEL} htmlFor="provider-type-select">
                {editing.isNew ? (
                  <select
                    id="provider-type-select"
                    className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-3 py-2 text-sm"
                    value={editing.type}
                    onChange={(e) => {
                      const type = e.target.value as LLMProviderType;
                      const preset = PROVIDER_PRESETS[type];
                      setEditing({
                        ...editing,
                        type,
                        apiBase: preset,
                        ...(!editing.name.trim() ? { name: PROVIDER_TYPE_LABELS[type] ?? type.toUpperCase() } : {}),
                      });
                    }}
                  >
                    {Object.values(LLMProviderType).map((type) => (
                      <option key={type} value={type}>{PROVIDER_TYPE_LABELS[type] ?? type.toUpperCase()}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="provider-type-select"
                    type="text"
                    readOnly={true}
                    className="w-full cursor-default rounded-md border border-[var(--as-border)] bg-[var(--as-muted)] px-3 py-2 text-sm opacity-80"
                    value={PROVIDER_TYPE_LABELS[editing.type] ?? editing.type.toUpperCase()}
                  />
                )}
              </Field>
              <ProviderForm
                name={editing.name}
                onNameChange={(value) => setEditing({ ...editing, name: value })}
                nameLabel={TEXT.API_NAME_LABEL}
                namePlaceholder={TEXT.API_NAME_PLACEHOLDER}
                baseUrl={editing.apiBase}
                onBaseUrlChange={(value) => setEditing({ ...editing, apiBase: value })}
                hideBaseUrl={true}
                apiKey={editing.apiKey}
                onApiKeyChange={(value) => setEditing({ ...editing, apiKey: value })}
                hasStoredKey={!editing.isNew && Boolean(editing.apiKeyHint)}
                storedKeyLabel={interpolate(TEXT.API_STORED_KEY_LABEL, { hint: editing.apiKeyHint ?? '' })}
                apiKeyHelp={TEXT.API_KEY_HELP}
              />
              <details className="rounded-md border border-[var(--as-border)] px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">{TEXT.SETUP_ADVANCED}</summary>
                <div className="space-y-2 pt-2">
                  <Field label={TEXT.SETUP_BASE_LABEL} htmlFor="provider-api-base">
                    <input
                      id="provider-api-base"
                      type="text"
                      readOnly={FIXED_BASE_URL_TYPES.has(editing.type)}
                      className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-3 py-2 text-sm data-[readonly]:cursor-default data-[readonly]:opacity-80"
                      value={editing.apiBase}
                      onChange={(e) => setEditing({ ...editing, apiBase: e.target.value })}
                    />
                  </Field>
                  {(editing.availableModels?.length ?? 0) > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setClearingModels(true)}
                    >
                      {interpolate(TEXT.SETUP_CLEAR_MODELS, { count: editing.availableModels?.length ?? 0 })}
                    </Button>
                  )}
                </div>
              </details>
            </ModalBody>
          )}
          <ModalFooter className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>{TEXT.CANCEL_BUTTON}</Button>
            <Button size="sm" onClick={() => void saveDraft()}>{TEXT.API_SAVE_PROVIDER}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ConfirmationModal
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) { setDeleting(null); } }}
        title={TEXT.API_DELETE_TITLE}
        description={interpolate(TEXT.API_DELETE_DESCRIPTION, { name: deleting?.name ?? '' })}
        confirmLabel={TEXT.DELETE_BUTTON}
        destructive
        onConfirm={confirmDelete}
      />

      <Modal open={reSetupTarget !== null} onOpenChange={(open) => { if (!open) { setReSetupTarget(null); } }}>
        <ModalContent size="lg">
          <ModalHeader>
            <ModalTitle>{TEXT.SETUP_CONFIRM_TITLE}</ModalTitle>
          </ModalHeader>
          {reSetupTarget && (() => {
            const reSetupKey = presetKeyForProvider(reSetupTarget);
            const reSetupPreset = reSetupKey ? PROVIDER_SETUP_PRESETS[reSetupKey] : null;
            const reviewModels = reSetupPreset?.curatedModels ?? [];
            const switchRow = (
              label: string,
              current: string,
              checked: boolean,
              onToggle: () => void
            ): JSX.Element => (
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                onClick={onToggle}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-[var(--as-border)] px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--as-muted)]"
              >
                <span className="flex min-w-0 flex-col">
                  <span>{label}</span>
                  <span className="truncate text-xs opacity-60">{current}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-[var(--as-focus-ring)]' : 'bg-[var(--as-border)]'}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--as-surface-raised)] shadow transition-all ${checked ? 'left-[1.125rem]' : 'left-0.5'}`} />
                </span>
              </button>
            );
            return (
              <ModalBody className="space-y-4">
                <p className="text-sm opacity-80">{interpolate(TEXT.SETUP_REVIEW_KEY_NOTE, { name: reSetupTarget.name })}</p>
                {reviewModels.length > 0 && (
                  <div role="group" aria-label={TEXT.SETUP_REVIEW_MODELS_LABEL} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {reviewModels.map((modelId) => {
                      const caps = inferModelCaps(modelId);
                      const selected = reSetupModels.includes(modelId);
                      return (
                        <button
                          type="button"
                          key={modelId}
                          aria-pressed={selected}
                          onClick={() =>
                            setReSetupModels((current) =>
                              selected ? current.filter((id) => id !== modelId) : [...current, modelId]
                            )
                          }
                          className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                            selected
                              ? 'border-[var(--as-focus-ring)] bg-[var(--as-muted)]'
                              : 'border-[var(--as-border)] opacity-70 hover:opacity-100'
                          }`}
                        >
                          <span className="flex min-w-0 flex-col gap-1">
                            <span className="truncate font-medium">{modelId}</span>
                            <span className="flex items-center gap-2 text-xs opacity-70">
                              {caps.includes('text') && <Type className="h-3.5 w-3.5" aria-hidden />}
                              {caps.includes('vision') && <Eye className="h-3.5 w-3.5" aria-hidden />}
                              {caps.includes('tools') && <Wrench className="h-3.5 w-3.5" aria-hidden />}
                              {caps.includes('stt') && <Mic className="h-3.5 w-3.5" aria-hidden />}
                              {caps.includes('tts') && <Volume2 className="h-3.5 w-3.5" aria-hidden />}
                            </span>
                          </span>
                          {selected && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="space-y-2">
                  {switchRow(
                    TEXT.SETUP_REVIEW_FILL_TEXT,
                    config.taskAssignments?.[AiTask.CHAT] ?? TEXT.API_DEFAULT_MODEL_UNSET,
                    reSetupFillText,
                    () => setReSetupFillText((value) => !value)
                  )}
                  {switchRow(
                    TEXT.SETUP_REVIEW_FILL_VISION,
                    config.taskAssignments?.[AiTask.VISION] ?? TEXT.API_DEFAULT_MODEL_UNSET,
                    reSetupFillVision,
                    () => setReSetupFillVision((value) => !value)
                  )}
                  {reSetupPreset?.sttModel &&
                    switchRow(
                      TEXT.SETUP_REVIEW_FILL_STT,
                      config.taskAssignments?.[AiTask.STT] ?? TEXT.API_DEFAULT_MODEL_UNSET,
                      reSetupFillStt,
                      () => setReSetupFillStt((value) => !value)
                    )}
                </div>
                <p className="text-xs opacity-70">{TEXT.SETUP_REVIEW_FOOTNOTE}</p>
              </ModalBody>
            );
          })()}
          <ModalFooter className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setReSetupTarget(null)}>{TEXT.CANCEL_BUTTON}</Button>
            <Button
              size="sm"
              disabled={reSettingUpId !== null}
              loading={reSettingUpId !== null}
              onClick={() => {
                const target = reSetupTarget;
                setReSetupTarget(null);
                if (target) {
                  void reRunSetup(target, {
                    curatedIds: reSetupModels,
                    bindChat: reSetupFillText,
                    bindVision: reSetupFillVision,
                    bindStt: reSetupFillStt,
                  });
                }
              }}
            >
              {TEXT.SETUP_APPLY}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ConfirmationModal
        open={clearingModels && editing !== null}
        onOpenChange={setClearingModels}
        title={TEXT.SETUP_CLEAR_MODELS_TITLE}
        description={interpolate(TEXT.SETUP_CLEAR_MODELS_DESCRIPTION, {
          count: editing?.availableModels?.length ?? 0,
          name: editing?.name ?? '',
        })}
        confirmLabel={TEXT.REMOVE_BUTTON}
        destructive
        onConfirm={() => {
          if (editing) {
            setEditing({ ...editing, availableModels: [] });
          }
          setClearingModels(false);
        }}
      />
    </div>
  );
}
