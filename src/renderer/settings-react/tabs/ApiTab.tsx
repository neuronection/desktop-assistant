import { useMemo, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { ConnectionTestRow } from '@neuronection/assistant-ui/connection-test-row';
import { ModelRegistry, type ModelRegistryDraft, type ModelRegistryModel, type ModelRegistryPatch } from '@neuronection/assistant-ui/model-registry';
import { TaskAssignmentPicker } from '@neuronection/assistant-ui/task-assignment-picker';
import type { ModelPickerProvider } from '@neuronection/assistant-ui/model-picker';
import { CapabilityDescriptor } from '@neuronection/assistant-ui/capability-chips';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@neuronection/assistant-ui/modal';
import { ProviderForm } from '@neuronection/assistant-ui/provider-form';
import { Boxes, Eye, MessageSquare, Mic, Send, Tag, Type, Wrench } from 'lucide-react';
import { AppConfig } from '@shared/config/AppConfig';
import { AiTask, LLMProvider, LLMProviderType, Model, ModelCapability, ProviderTestResult } from '@shared/types';
import { inferModelCaps, modelCaps } from '@shared/ai/tasks';
import { TEXT, interpolate } from '@shared/constants/text';
import { NotificationService } from '@renderer/services/NotificationService';
import { Field } from './fields';
import { VoiceSection } from './VoiceSection';

export interface ApiTabProps {
  config: AppConfig;
  onChange: (updates: Partial<AppConfig>) => void;
}

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
  { value: 'audio', label: TEXT.API_CAP_AUDIO, icon: Mic },
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
  caps: modelCaps(model),
  enabled: true,
  reasoningEffort: model.reasoningEffort,
  temperature: model.temperature ?? null,
  maxTokens: model.maxTokens ?? null,
});

export function ApiTab({ config, onChange }: ApiTabProps): JSX.Element {
  const [editing, setEditing] = useState<DraftProvider | null>(null);
  const [deleting, setDeleting] = useState<LLMProvider | null>(null);
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [remote, setRemote] = useState<Record<string, { state: 'loading' | 'error' | 'ready'; models: Model[]; error?: string }>>({});
  const [tests, setTests] = useState<Record<string, ProviderTestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const providers = config.providers ?? [];

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

  const saveDraft = (): void => {
    if (!editing) {
      return;
    }
    const draft: LLMProvider = { ...editing };
    delete (draft as DraftProvider).isNew;
    if (!draft.name.trim()) {
      NotificationService.showError(TEXT.API_NAME_REQUIRED);
      return;
    }
    const exists = providers.some((p) => p.id === draft.id);
    const next = exists ? providers.map((p) => (p.id === draft.id ? draft : p)) : [...providers, draft];
    const defaultProviderId = config.defaultProviderId ?? next[0]?.id ?? null;
    patchProviders(next, { defaultProviderId });
    setEditing(null);
  };

  const confirmDelete = (): void => {
    if (!deleting) {
      return;
    }
    const next = providers.filter((p) => p.id !== deleting.id);
    const updates: Partial<AppConfig> = { providers: next };
    if (config.defaultProviderId === deleting.id) {
      updates.defaultProviderId = next[0]?.id ?? null;
    }
    patchProviders(next, updates);
    setDeleting(null);
    NotificationService.showSuccess(TEXT.API_PROVIDER_DELETED);
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
          capabilities: modelCaps(m),
        })),
      })),
    [providers]
  );

  const handleAssign = (taskId: string, modelId: string | null): void => {
    onChange({ taskAssignments: { ...config.taskAssignments, [taskId]: modelId } });
  };

  return (
    <div className="space-y-8">
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
            return (
              <li key={p.id} className="space-y-1 rounded-md border border-[var(--as-border)] px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span aria-hidden={true} className={isDefault ? 'text-amber-400' : 'opacity-30'}>★</span>
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className="rounded bg-[var(--as-muted)] px-1.5 py-0.5 text-xs uppercase opacity-70">{p.type}</span>
                    {p.apiKeyHint && <span className="text-xs opacity-50">{interpolate(TEXT.API_KEY_HINT, { hint: p.apiKeyHint })}</span>}
                  </div>
                  <div className="flex gap-2">
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
        <Button size="sm" onClick={() => setEditing({ ...newProvider(), apiBase: PROVIDER_PRESETS[LLMProviderType.OPENAI] })}>{TEXT.API_ADD_PROVIDER}</Button>
      </section>

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

      <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{TEXT.API_TASKS_TITLE}</h3>
          <p className="text-sm opacity-60">{TEXT.API_TASKS_SUBTITLE}</p>
        </div>
        <TaskAssignmentPicker
          sections={[
            {
              id: 'tasks',
              label: TEXT.API_TASKS_TITLE,
              tasks: [
                { id: AiTask.CHAT, label: TEXT.API_TASK_CHAT, description: TEXT.API_TASK_CHAT_DESCRIPTION, requires: 'text', icon: MessageSquare },
                { id: AiTask.TITLES, label: TEXT.API_TASK_TITLES, description: TEXT.API_TASK_TITLES_DESCRIPTION, requires: 'text', icon: Tag },
                { id: AiTask.STT, label: TEXT.API_TASK_STT, description: TEXT.API_TASK_STT_DESCRIPTION, requires: 'audio', icon: Mic },
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

      <VoiceSection config={config} onChange={onChange} />

      <Modal open={editing !== null} onOpenChange={(open) => { if (!open) { setEditing(null); } }}>
        <ModalContent size="lg">
          <ModalHeader>
            <ModalTitle>{editing?.isNew ? TEXT.API_ADD_PROVIDER : TEXT.API_EDIT_PROVIDER}</ModalTitle>
          </ModalHeader>
          {editing && (
            <div className="space-y-4 px-6 pb-6">
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
                hideBaseUrl={FIXED_BASE_URL_TYPES.has(editing.type)}
                apiKey={editing.apiKey}
                onApiKeyChange={(value) => setEditing({ ...editing, apiKey: value })}
                hasStoredKey={!editing.isNew && Boolean(editing.apiKeyHint)}
                storedKeyLabel={interpolate(TEXT.API_STORED_KEY_LABEL, { hint: editing.apiKeyHint ?? '' })}
                apiKeyHelp={TEXT.API_KEY_HELP}
              />
            </div>
          )}
          <ModalFooter className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>{TEXT.CANCEL_BUTTON}</Button>
            <Button size="sm" onClick={saveDraft}>{TEXT.API_SAVE_PROVIDER}</Button>
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
    </div>
  );
}
