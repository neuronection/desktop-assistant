import { useMemo, useState, type JSX } from "react";
import { Button } from "@neuronection/assistant-ui/button";
import { ConfirmationModal } from "@neuronection/assistant-ui/confirmation-modal";
import { PackPageShell } from "../apps/PackPageShell";
import type {
  ModelRegistryDraft,
  ModelRegistryPatch,
} from "@neuronection/assistant-ui/model-registry";
import type { ModelPickerProvider } from "@neuronection/assistant-ui/model-picker";
import {
  Modal,
  ModalContent,
  ModalBody,
  ModalHeader,
  ModalTitle,
  ModalFooter,
} from "@neuronection/assistant-ui/modal";
import { ProviderForm } from "@neuronection/assistant-ui/provider-form";
import { SegmentedTabs } from "@neuronection/assistant-ui/segmented-tabs";
import { TaskAssignmentMap } from "@shared/types";
import { AppConfig } from "@shared/config/AppConfig";
import {
  AiTask,
  LLMProvider,
  LLMProviderType,
  Model,
  ModelCapability,
  ProviderTestResult,
  SetupPresetOptions,
} from "@shared/types";
import { inferModelCaps } from "@shared/ai/tasks";
import { DECISION_DEFAULT_SLOT, DECISION_SLOTS } from "@shared/ai/decisions";
import {
  hasConfiguredProvider,
  presetKeyForProvider,
  PROVIDER_PRESET_ORDER,
  PROVIDER_SETUP_PRESETS,
  ALL_PROVIDER_PRESETS,
  type AnyPresetKey,
} from "@shared/ai/providerPresets";
import { TEXT, interpolate } from "@shared/constants/text";
import { NotificationService } from "@renderer/services/NotificationService";
import { Field } from "./fields";
import { Combobox } from "@neuronection/assistant-ui/combobox";
import { SetupReview } from "@neuronection/assistant-ui/setup-review";
import { SwitchRow } from "@neuronection/assistant-ui/switch-row";
import { ProviderLogo } from "@neuronection/assistant-ui/provider-logo";
import { SetupWizard, setupErrorText } from "./SetupWizard";
import { ApiProvidersGroup } from "../api/ApiProvidersGroup";
import { ApiModelsGroup } from "../api/ApiModelsGroup";
import { ApiTasksGroup } from "../api/ApiTasksGroup";
import {
  FIXED_BASE_URL_TYPES,
  newProvider,
  PROVIDER_PRESETS,
  PROVIDER_TYPE_LABELS,
  toRegistryModel,
  type DraftProvider,
} from "../api/shared";

export type ApiSection = "providers" | "models" | "tasks";

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
  { id: "providers", label: TEXT.API_PROVIDERS_SECTION },
  { id: "models", label: TEXT.API_MODELS_TITLE },
  { id: "tasks", label: TEXT.API_TASKS_TITLE },
];

export function ApiTab({
  config,
  onChange,
  section: sectionProp,
  onSectionChange,
  onSetupComplete,
}: ApiTabProps): JSX.Element {
  const [internalSection, setInternalSection] =
    useState<ApiSection>("providers");
  const section = sectionProp ?? internalSection;
  const setSection = onSectionChange ?? setInternalSection;
  const [editing, setEditing] = useState<DraftProvider | null>(null);
  const [deleting, setDeleting] = useState<LLMProvider | null>(null);
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(
    null,
  );
  const [remote, setRemote] = useState<
    Record<
      string,
      { state: "loading" | "error" | "ready"; models: Model[]; error?: string }
    >
  >({});
  const [tests, setTests] = useState<Record<string, ProviderTestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupInitialPreset, setSetupInitialPreset] =
    useState<AnyPresetKey | null>(null);

  const providers = config.providers ?? [];
  const firstRunCard = !hasConfiguredProvider(providers);

  const openSetupWizard = (preset?: AnyPresetKey): void => {
    setSetupInitialPreset(preset ?? null);
    setSetupOpen(true);
  };

  const patchProviders = (
    next: LLMProvider[],
    extra?: Partial<AppConfig>,
  ): void => {
    onChange({ providers: next, ...extra });
  };

  const updateProviderModels = (
    providerId: string,
    map: (models: Model[]) => Model[],
  ): void => {
    patchProviders(
      providers.map((p) =>
        p.id === providerId
          ? { ...p, availableModels: map(p.availableModels ?? []) }
          : p,
      ),
    );
  };

  const draftToModel = (
    provider: LLMProvider,
    draft: ModelRegistryDraft,
  ): Model => {
    const decisionProvider = provider.type === LLMProviderType.DECISION;
    const caps = draft.caps as ModelCapability[];
    return {
      id: draft.externalId,
      name: draft.label?.trim() || draft.externalId,
      providerType: provider.type,
      providerId: provider.id,
      caps: decisionProvider && caps.length === 0 ? ["decision"] : caps,
      ...(decisionProvider || caps.includes("decision")
        ? { decisionTransport: "systemone" as const }
        : {}),
      ...(draft.reasoningEffort
        ? { reasoningEffort: draft.reasoningEffort }
        : {}),
      ...(draft.temperature != null ? { temperature: draft.temperature } : {}),
      ...(draft.maxTokens != null ? { maxTokens: draft.maxTokens } : {}),
    };
  };

  const fetchRemoteModels = async (provider: LLMProvider): Promise<void> => {
    setRemote((prev) => ({
      ...prev,
      [provider.id]: {
        state: "loading",
        models: prev[provider.id]?.models ?? [],
      },
    }));
    try {
      const models = await window.electronAPI.fetchAvailableModels(provider);
      if (!models.success) {
        throw new Error(models.error || "Catalog fetch failed.");
      }
      const fetched = models.data ?? [];
      setRemote((prev) => ({
        ...prev,
        [provider.id]: { state: "ready", models: fetched },
      }));
    } catch (error) {
      setRemote((prev) => ({
        ...prev,
        [provider.id]: {
          state: "error",
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
      if (provider && provider.type !== LLMProviderType.DECISION) {
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
      NotificationService.showError(
        error instanceof Error ? error.message : String(error),
      );
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
      NotificationService.showError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const [reSettingUpId, setReSettingUpId] = useState<string | null>(null);
  const [clearingModels, setClearingModels] = useState(false);
  const [reSetupTarget, setReSetupTarget] = useState<LLMProvider | null>(null);
  const [reSetupModels, setReSetupModels] = useState<string[]>([]);
  const [reSetupFillText, setReSetupFillText] = useState(true);
  const [reSetupFillVision, setReSetupFillVision] = useState(true);
  const [reSetupFillStt, setReSetupFillStt] = useState(true);
  const [reSetupFillEmbed, setReSetupFillEmbed] = useState(true);
  const [reSetupFillDecision, setReSetupFillDecision] = useState(true);

  const openReSetupReview = (provider: LLMProvider): void => {
    const key = presetKeyForProvider(provider);
    setReSetupModels(
      key ? (PROVIDER_SETUP_PRESETS[key].curatedModels ?? []) : [],
    );
    setReSetupFillText(true);
    setReSetupFillVision(true);
    setReSetupFillStt(true);
    setReSetupFillEmbed(true);
    setReSetupFillDecision(
      Boolean(key && PROVIDER_SETUP_PRESETS[key]?.decisionModels?.length),
    );
    setReSetupTarget(provider);
  };

  const reRunSetup = async (
    provider: LLMProvider,
    options?: SetupPresetOptions,
  ): Promise<void> => {
    const key = presetKeyForProvider(provider);
    if (!key || reSettingUpId) {
      return;
    }
    setReSettingUpId(provider.id);
    try {
      const result = await window.electronAPI.setupProviderFromPreset(
        key,
        "",
        provider.name,
        options,
      );
      if (result.ok) {
        NotificationService.showSuccess(
          interpolate(TEXT.SETUP_REFRESH_OK, {
            name: result.provider?.name ?? provider.name,
            count: result.catalogCount,
          }),
        );
        if (result.assignedModelId) {
          NotificationService.showSuccess(
            interpolate(TEXT.SETUP_SUCCESS_ASSIGNED, {
              model: result.assignedModelId,
            }),
          );
        }
        if (result.assignedVisionModelId) {
          NotificationService.showSuccess(
            interpolate(TEXT.SETUP_SUCCESS_ASSIGNED_VISION, {
              model: result.assignedVisionModelId,
            }),
          );
        }
        if (result.assignedSttModelId) {
          NotificationService.showSuccess(
            interpolate(TEXT.SETUP_SUCCESS_ASSIGNED_STT, {
              model: result.assignedSttModelId,
            }),
          );
        }
        if (result.assignedEmbeddingsModel) {
          NotificationService.showSuccess(
            interpolate(TEXT.SETUP_SUCCESS_ASSIGNED_EMBED, {
              model: result.assignedEmbeddingsModel,
            }),
          );
        }
        onSetupComplete?.();
      } else {
        NotificationService.showError(
          setupErrorText(result.errorCode, result.vendorMessage),
        );
      }
    } catch (error) {
      NotificationService.showError(
        interpolate(TEXT.SETUP_REFRESH_FAILED, {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
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
    [providers],
  );

  const registryModels = useMemo(
    () =>
      providers.flatMap((p) =>
        (p.availableModels ?? []).map((m) => toRegistryModel(p, m)),
      ),
    [providers],
  );

  const expanded = expandedProviderId
    ? (providers.find((p) => p.id === expandedProviderId) ?? null)
    : null;
  const remoteState = expandedProviderId
    ? remote[expandedProviderId]
    : undefined;
  const registeredIds = new Set(
    expanded?.availableModels?.map((m) => m.id) ?? [],
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
          capabilities:
            m.caps && m.caps.length > 0 ? m.caps : inferModelCaps(m.id),
        })),
      })),
    [providers],
  );

  // Decision pickers offer only decision-declaring models (slot
  // separation, ADR-0032 D4).
  const decisionCatalog: ModelPickerProvider[] = useMemo(
    () =>
      taskCatalog
        .map((provider) => ({
          ...provider,
          models: provider.models.filter((model) =>
            model.capabilities?.includes("decision"),
          ),
        }))
        .filter((provider) => provider.models.length > 0),
    [taskCatalog],
  );

  // ADR-0036 §4 (2026-10-14 single-picker ruling): what an empty kind's
  // trigger placeholder names — the `decision` default row's model
  // (systemone declares all four kinds); bare "Inherits" when nothing is
  // assigned.
  // (systemone declares all four kinds); bare "Inherits" when nothing is
  // assigned.
  const decisionDefaultId: string | null =
    config.taskAssignments?.[DECISION_DEFAULT_SLOT] ?? null;
  const decisionDefaultName: string | null = decisionDefaultId
    ? (taskCatalog
        .flatMap((p) => p.models)
        .find((m) => m.id === decisionDefaultId)?.name ?? decisionDefaultId)
    : null;
  const defaultsToLine: JSX.Element | null = decisionDefaultName ? (
    <span className="text-xs opacity-60">
      {interpolate(TEXT.API_DECISION_DEFAULTS_TO, {
        model: decisionDefaultName,
      })}
    </span>
  ) : null;
  const inheritLabel: string = useMemo(() => {
    if (!decisionDefaultId) {
      return TEXT.API_DECISION_INHERITS_EMPTY;
    }
    const model = taskCatalog
      .flatMap((p) => p.models)
      .find((m) => m.id === decisionDefaultId);
    return interpolate(TEXT.API_DECISION_INHERITS, {
      model: model?.name ?? decisionDefaultId,
    });
  }, [taskCatalog, config.taskAssignments]);

  // ADR-0037: the default decision row is single-slot — no fallback leg.
  // 2026-10-14 ruling: kind rows are too — fallback stays config-only.

  const handleAssign = (taskId: string, modelId: string | null): void => {
    onChange({
      taskAssignments: { ...config.taskAssignments, [taskId]: modelId },
    });
  };

  const observedVersions = config.decision?.observedVersions ?? {};

  /**
   * Decision pre-suggestion (plan 26 embeddings wave): when the provider's
   * preset declares `decisionDefault`, show it as a muted hint on empty
   * decision rows. Display-only — never auto-assigns; the default provider
   * with a decision preset wins, else the first such provider.
   */
  const decisionSuggestion = useMemo((): string | null => {
    const candidates = providers.filter((p) =>
      Boolean(
        p.presetKey && ALL_PROVIDER_PRESETS[p.presetKey]?.decisionDefault,
      ),
    );
    const provider =
      candidates.find((p) => p.id === config.defaultProviderId) ??
      candidates[0];
    const key = provider?.presetKey;
    return (key && ALL_PROVIDER_PRESETS[key]?.decisionDefault) || null;
  }, [providers, config.defaultProviderId]);

  // D7 "Simplify": only when all four kinds resolve to one model and the
  // default is empty — a suggestion, never automatic.
  const simplifyModelId = useMemo((): string | null => {
    if (config.taskAssignments?.[DECISION_DEFAULT_SLOT]) {
      return null;
    }
    let resolved: string | null = null;
    for (const slot of DECISION_SLOTS) {
      const kindModel =
        config.taskAssignments?.[slot] ??
        config.taskFallbackAssignments?.[slot] ??
        null;
      if (!kindModel) {
        return null;
      }
      if (resolved === null) {
        resolved = kindModel;
      } else if (resolved !== kindModel) {
        return null;
      }
    }
    return resolved;
  }, [config.taskAssignments, config.taskFallbackAssignments]);

  /** The decision default row's meta: empty hint + suggestion, plus the
   * Simplify chip. Kind rows keep the pin affordances via their own meta. */
  const decisionDefaultMeta = (task: { id: string }): JSX.Element | null => {
    if (task.id !== DECISION_DEFAULT_SLOT) {
      return null;
    }
    const isEmpty = !config.taskAssignments?.[DECISION_DEFAULT_SLOT];
    return (
      <div className="space-y-1">
        {isEmpty ? (
          <p className="text-xs opacity-60">
            {TEXT.API_DECISION_DEFAULTS_EMPTY_HINT}
            {decisionSuggestion
              ? ` ${interpolate(TEXT.DECISION_SUGGESTED, { model: decisionSuggestion })}`
              : ""}
          </p>
        ) : null}
        {simplifyModelId ? (
          <button
            type="button"
            className="rounded-full bg-[var(--as-muted)] px-2.5 py-1 text-[11px] text-[var(--as-fg)] transition-colors hover:bg-[var(--as-secondary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--as-focus-ring)]"
            onClick={() =>
              onChange({
                taskAssignments: {
                  ...config.taskAssignments,
                  [DECISION_DEFAULT_SLOT]: simplifyModelId,
                },
              })
            }
          >
            {interpolate(TEXT.API_DECISION_SIMPLIFY, {
              model:
                decisionCatalog
                  .flatMap((p) => p.models)
                  .find((m) => m.id === simplifyModelId)?.name ??
                simplifyModelId,
            })}
          </button>
        ) : null}
      </div>
    );
  };

  const pinDecisionModel = (aliasId: string, version: string): void => {
    const nextProviders = providers.map((provider) => ({
      ...provider,
      availableModels: (provider.availableModels ?? []).map((model) =>
        model.id === aliasId ? { ...model, id: version } : model,
      ),
    }));
    const retarget = (id: string | null): string | null =>
      id === aliasId ? version : id;
    const assignments = { ...config.taskAssignments } as Record<
      string,
      string | null
    >;
    for (const key of Object.keys(assignments)) {
      assignments[key] = retarget(assignments[key] ?? null);
    }
    const fallbacks = { ...config.taskFallbackAssignments } as Record<
      string,
      string | null
    >;
    for (const key of Object.keys(fallbacks)) {
      fallbacks[key] = retarget(fallbacks[key] ?? null);
    }
    onChange({
      providers: nextProviders,
      taskAssignments: assignments as unknown as TaskAssignmentMap,
      taskFallbackAssignments: fallbacks,
    });
    NotificationService.showSuccess(
      interpolate(TEXT.API_DECISION_PINNED_TO, { version }),
    );
  };

  const unpinDecisionModel = (versionId: string): void => {
    const aliasEntry = Object.entries(observedVersions).find(
      ([, version]) => version === versionId,
    );
    if (!aliasEntry) {
      return;
    }
    const aliasId = aliasEntry[0];
    const nextProviders = providers.map((provider) => ({
      ...provider,
      availableModels: (provider.availableModels ?? []).map((model) =>
        model.id === versionId ? { ...model, id: aliasId } : model,
      ),
    }));
    const retarget = (id: string | null): string | null =>
      id === versionId ? aliasId : id;
    const assignments = { ...config.taskAssignments } as Record<
      string,
      string | null
    >;
    for (const key of Object.keys(assignments)) {
      assignments[key] = retarget(assignments[key] ?? null);
    }
    const fallbacks = { ...config.taskFallbackAssignments } as Record<
      string,
      string | null
    >;
    for (const key of Object.keys(fallbacks)) {
      fallbacks[key] = retarget(fallbacks[key] ?? null);
    }
    onChange({
      providers: nextProviders,
      taskAssignments: assignments as unknown as TaskAssignmentMap,
      taskFallbackAssignments: fallbacks,
    });
  };

  const decisionMeta = (slot: string): JSX.Element | null => {
    const assigned = config.taskAssignments?.[slot] ?? null;
    if (!assigned) {
      return decisionSuggestion ? (
        <span className="text-xs opacity-60">
          {interpolate(TEXT.DECISION_SUGGESTED, { model: decisionSuggestion })}
        </span>
      ) : null;
    }
    const observed = observedVersions[assigned];
    if (observed && observed !== assigned) {
      return (
        <button
          type="button"
          className="text-xs font-medium text-[var(--as-primary)] underline underline-offset-2"
          onClick={() => pinDecisionModel(assigned, observed)}
        >
          {interpolate(TEXT.API_DECISION_PIN_TO, { version: observed })}
        </button>
      );
    }
    const aliasOfVersion = Object.entries(observedVersions).find(
      ([, version]) => version === assigned,
    );
    if (aliasOfVersion) {
      return (
        <span className="flex items-center gap-2 text-xs opacity-70">
          <span>
            {interpolate(TEXT.API_DECISION_PINNED_TO, { version: assigned })}
          </span>
          <button
            type="button"
            className="font-medium text-[var(--as-primary)] underline underline-offset-2"
            onClick={() => unpinDecisionModel(assigned)}
          >
            {TEXT.API_DECISION_USE_ALIAS}
          </button>
        </span>
      );
    }
    return (
      <span className="text-xs opacity-60">{TEXT.API_DECISION_ALIAS_HINT}</span>
    );
  };

  if (editing) {
    const title = editing.isNew
      ? TEXT.API_ADD_PROVIDER
      : TEXT.API_EDIT_PROVIDER;
    return (
      <>
        <PackPageShell
          title={title}
          pageLabel={TEXT.API_PROVIDER_PAGE_ARIA}
          onBack={() => setEditing(null)}
        >
          <div
            className="flex items-center gap-2"
            data-testid="provider-edit-logo"
          >
            <ProviderLogo
              preset={
                presetKeyForProvider({
                  ...editing,
                  apiBase:
                    editing.apiBase || PROVIDER_PRESETS[editing.type] || "",
                }) ??
                PROVIDER_PRESET_ORDER.find(
                  (key) => PROVIDER_SETUP_PRESETS[key].type === editing.type,
                ) ??
                editing.name
              }
            />
            <span className="truncate font-mono text-sm font-medium">
              {editing.name || title}
            </span>
          </div>
          <div className="space-y-4">
            <Field label={TEXT.API_TYPE_LABEL} htmlFor="provider-type-select">
              {editing.isNew ? (
                <Combobox
                  id="provider-type-select"
                  hideLabel
                  label={TEXT.API_TYPE_LABEL}
                  options={Object.values(LLMProviderType).map((type) => ({
                    value: type,
                    label: PROVIDER_TYPE_LABELS[type] ?? type.toUpperCase(),
                  }))}
                  value={editing.type}
                  onChange={(value) => {
                    const type = value as LLMProviderType;
                    const preset = PROVIDER_PRESETS[type];
                    setEditing({
                      ...editing,
                      type,
                      apiBase: preset,
                      ...(!editing.name.trim()
                        ? {
                            name:
                              PROVIDER_TYPE_LABELS[type] ?? type.toUpperCase(),
                          }
                        : {}),
                    });
                  }}
                />
              ) : (
                <input
                  id="provider-type-select"
                  type="text"
                  readOnly={true}
                  className="w-full cursor-default rounded-md border border-[var(--as-border)] bg-[var(--as-muted)] px-3 py-2 text-sm opacity-80"
                  value={
                    PROVIDER_TYPE_LABELS[editing.type] ??
                    editing.type.toUpperCase()
                  }
                />
              )}
            </Field>
            <ProviderForm
              name={editing.name}
              onNameChange={(value) => setEditing({ ...editing, name: value })}
              nameLabel={TEXT.API_NAME_LABEL}
              namePlaceholder={TEXT.API_NAME_PLACEHOLDER}
              baseUrl={editing.apiBase}
              onBaseUrlChange={(value) =>
                setEditing({ ...editing, apiBase: value })
              }
              hideBaseUrl={true}
              apiKey={editing.apiKey}
              onApiKeyChange={(value) =>
                setEditing({ ...editing, apiKey: value })
              }
              hasStoredKey={!editing.isNew && Boolean(editing.apiKeyHint)}
              storedKeyLabel={interpolate(TEXT.API_STORED_KEY_LABEL, {
                hint: editing.apiKeyHint ?? "",
              })}
              apiKeyHelp={TEXT.API_KEY_HELP}
            />
            <details className="rounded-md border border-[var(--as-border)] px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">
                {TEXT.SETUP_ADVANCED}
              </summary>
              <div className="space-y-2 pt-2">
                <Field
                  label={TEXT.SETUP_BASE_LABEL}
                  htmlFor="provider-api-base"
                >
                  <input
                    id="provider-api-base"
                    type="text"
                    readOnly={FIXED_BASE_URL_TYPES.has(editing.type)}
                    className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-3 py-2 text-sm data-[readonly]:cursor-default data-[readonly]:opacity-80"
                    value={editing.apiBase}
                    onChange={(e) =>
                      setEditing({ ...editing, apiBase: e.target.value })
                    }
                  />
                </Field>
                {(editing.availableModels?.length ?? 0) > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setClearingModels(true)}
                  >
                    {interpolate(TEXT.SETUP_CLEAR_MODELS, {
                      count: editing.availableModels?.length ?? 0,
                    })}
                  </Button>
                )}
              </div>
            </details>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-[var(--as-border)] pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(null)}
            >
              {TEXT.CANCEL_BUTTON}
            </Button>
            <Button size="sm" onClick={() => void saveDraft()}>
              {TEXT.API_SAVE_PROVIDER}
            </Button>
          </div>
        </PackPageShell>
        <ConfirmationModal
          open={clearingModels}
          onOpenChange={setClearingModels}
          title={TEXT.SETUP_CLEAR_MODELS_TITLE}
          description={interpolate(TEXT.SETUP_CLEAR_MODELS_DESCRIPTION, {
            count: editing.availableModels?.length ?? 0,
            name: editing.name ?? "",
          })}
          confirmLabel={TEXT.REMOVE_BUTTON}
          destructive
          onConfirm={() => {
            setEditing({ ...editing, availableModels: [] });
            setClearingModels(false);
          }}
        />
      </>
    );
  }

  return (
    <div className="space-y-6" data-capture="bring-byo-model">
      <SegmentedTabs
        ariaLabel={TEXT.SETTINGS_NAV_API}
        items={API_SECTIONS.map((entry) => ({
          value: entry.id,
          label: entry.label,
        }))}
        value={section}
        onValueChange={(next) => setSection(next as ApiSection)}
      />

      {section === "providers" && (
        <ApiProvidersGroup
          firstRunCard={firstRunCard}
          onOpenWizard={openSetupWizard}
          providers={providers}
          defaultProviderId={config.defaultProviderId}
          tests={tests}
          testingId={testingId}
          reSettingUpId={reSettingUpId}
          onReSetup={openReSetupReview}
          onEdit={(p) => setEditing({ ...p, isNew: false })}
          onTest={testProvider}
          onDelete={setDeleting}
        />
      )}

      {section === "models" && (
        <ApiModelsGroup
          registryProviders={registryProviders}
          registryModels={registryModels}
          expandedProviderId={expandedProviderId}
          onExpandedProviderChange={handleExpandedProvider}
          remoteModels={remoteModels}
          remoteState={
            expandedProviderId ? (remoteState?.state ?? "loading") : "ready"
          }
          remoteError={remoteState?.error ?? null}
          onRetryRemote={() => expanded && void fetchRemoteModels(expanded)}
          onAddModel={(pid, draft) =>
            updateProviderModels(pid, (models) => [
              ...models,
              draftToModel(
                providers.find((p) => p.id === pid)!,
                draft,
              ),
            ])
          }
          onAddAll={(pid, drafts) =>
            updateProviderModels(pid, (models) => {
              const known = new Set(models.map((m) => m.id));
              return [
                ...models,
                ...drafts
                  .filter((d) => !known.has(d.externalId))
                  .map((d) =>
                    draftToModel(
                      providers.find((p) => p.id === pid)!,
                      d,
                    ),
                  ),
              ];
            })
          }
          onUpdateModel={(model, patch: ModelRegistryPatch) => {
            const [providerId, externalId] = [
              model.providerId,
              model.externalId,
            ];
            updateProviderModels(providerId, (models) =>
              models.map((m) =>
                m.id === externalId
                  ? {
                      ...m,
                      ...(patch.label !== undefined
                        ? { name: patch.label || externalId }
                        : {}),
                      ...(patch.caps !== undefined
                        ? { caps: patch.caps as ModelCapability[] }
                        : {}),
                      ...(patch.reasoningEffort !== undefined
                        ? {
                            reasoningEffort: patch.reasoningEffort || undefined,
                          }
                        : {}),
                      ...(patch.temperature !== undefined
                        ? { temperature: patch.temperature ?? undefined }
                        : {}),
                      ...(patch.maxTokens !== undefined
                        ? { maxTokens: patch.maxTokens ?? undefined }
                        : {}),
                      ...(patch.decisionTransport !== undefined
                        ? patch.decisionTransport
                          ? { decisionTransport: "systemone" as const }
                          : { decisionTransport: undefined }
                        : {}),
                    }
                  : m,
              ),
            );
          }}
          onDeleteModel={(model) =>
            updateProviderModels(model.providerId, (models) =>
              models.filter((m) => m.id !== model.externalId),
            )
          }
        />
      )}

      {section === "tasks" && (
        <ApiTasksGroup
          assignments={config.taskAssignments as Record<string, string | null>}
          taskCatalog={taskCatalog}
          onAssign={handleAssign}
          renderDefaultMeta={decisionDefaultMeta}
          decisionCatalog={decisionCatalog}
          defaultsToLine={defaultsToLine}
          renderDecisionMeta={decisionMeta}
        />
      )}

      <SetupWizard
        open={setupOpen}
        onOpenChange={setSetupOpen}
        onSetupComplete={() => onSetupComplete?.()}
        onOpenManualForm={(partial) =>
          setEditing({ ...newProvider(), ...partial, isNew: true })
        }
        initialPreset={setupInitialPreset}
        currentAssignments={config.taskAssignments}
      />

      <ConfirmationModal
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
          }
        }}
        title={TEXT.API_DELETE_TITLE}
        description={interpolate(TEXT.API_DELETE_DESCRIPTION, {
          name: deleting?.name ?? "",
        })}
        confirmLabel={TEXT.DELETE_BUTTON}
        destructive
        onConfirm={confirmDelete}
      />

      <Modal
        open={reSetupTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReSetupTarget(null);
          }
        }}
      >
        <ModalContent size="lg">
          <ModalHeader>
            <ModalTitle>{TEXT.SETUP_CONFIRM_TITLE}</ModalTitle>
          </ModalHeader>
          {reSetupTarget &&
            (() => {
              const reSetupKey = presetKeyForProvider(reSetupTarget);
              const reSetupPreset = reSetupKey
                ? PROVIDER_SETUP_PRESETS[reSetupKey]
                : null;
              const reviewModels = reSetupPreset?.curatedModels ?? [];
              const hasDecision = Boolean(
                reSetupPreset?.decisionModels?.length,
              );
              const decisionOnly =
                reSetupPreset?.type === LLMProviderType.DECISION;
              const nowLine = (model: string | null | undefined): string =>
                interpolate(TEXT.SETUP_REVIEW_CURRENT, {
                  model: model ?? TEXT.API_DEFAULT_MODEL_UNSET,
                });
              const reviewSlots = [
                ...(decisionOnly
                  ? []
                  : [
                      {
                        id: "chat",
                        label: TEXT.SETUP_REVIEW_FILL_TEXT,
                        bind: reSetupFillText,
                        currentValue: nowLine(
                          config.taskAssignments?.[AiTask.CHAT],
                        ),
                        optionsKey: "bindChat" as const,
                      },
                      {
                        id: "vision",
                        label: TEXT.SETUP_REVIEW_FILL_VISION,
                        bind: reSetupFillVision,
                        currentValue: nowLine(
                          config.taskAssignments?.[AiTask.VISION],
                        ),
                        optionsKey: "bindVision" as const,
                      },
                      ...(reSetupPreset?.sttModel
                        ? [
                            {
                              id: "stt",
                              label: TEXT.SETUP_REVIEW_FILL_STT,
                              bind: reSetupFillStt,
                              currentValue: nowLine(
                                config.taskAssignments?.[AiTask.STT],
                              ),
                              optionsKey: "bindStt" as const,
                            },
                          ]
                        : []),
                    ]),
                ...(hasDecision
                  ? [
                      {
                        id: "decision",
                        label: TEXT.SETUP_REVIEW_FILL_DECISION,
                        bind: reSetupFillDecision,
                        // ADR-0036 §3: setup binds the single `decision`
                        // default slot — its "now" value reads like the
                        // other rows.
                        currentValue: nowLine(
                          config.taskAssignments?.[DECISION_DEFAULT_SLOT],
                        ),
                        optionsKey: "bindDecision" as const,
                      },
                    ]
                  : []),
              ];
              return (
                <ModalBody className="space-y-4">
                  <p className="text-sm opacity-80">
                    {interpolate(TEXT.SETUP_REVIEW_KEY_NOTE, {
                      name: reSetupTarget.name,
                    })}
                  </p>
                  <SetupReview
                    models={reviewModels.map((modelId) => ({
                      id: modelId,
                      name: modelId,
                      caps: inferModelCaps(modelId),
                      selected: reSetupModels.includes(modelId),
                    }))}
                    slots={reviewSlots}
                    modelsLabel={TEXT.SETUP_REVIEW_MODELS_LABEL}
                    footnote={TEXT.SETUP_REVIEW_FOOTNOTE}
                    onOptionsChange={(options) => {
                      setReSetupModels(options.curatedIds);
                      const keys = new Set(
                        reviewSlots.map((slot) => slot.optionsKey),
                      );
                      if (keys.has("bindChat"))
                        setReSetupFillText(options.bindChat);
                      if (keys.has("bindVision"))
                        setReSetupFillVision(options.bindVision);
                      if (keys.has("bindStt"))
                        setReSetupFillStt(options.bindStt);
                      if (keys.has("bindDecision"))
                        setReSetupFillDecision(options.bindDecision);
                    }}
                  />
                  {/* Embeddings gap-fill rides outside SetupReview: the library
                    slot type is frozen at the plan-26 four-bind keys, and this
                    wave touches no library code. Same switch semantics. */}
                  {reSetupPreset?.embeddingsModel && (
                    <SwitchRow
                      label={TEXT.SETUP_REVIEW_FILL_EMBED}
                      checked={reSetupFillEmbed}
                      currentValue={nowLine(
                        config.taskAssignments?.[AiTask.EMBED],
                      )}
                      onCheckedChange={setReSetupFillEmbed}
                    />
                  )}
                </ModalBody>
              );
            })()}
          <ModalFooter className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReSetupTarget(null)}
            >
              {TEXT.CANCEL_BUTTON}
            </Button>
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
                    bindEmbeddings: reSetupFillEmbed,
                    bindDecision: reSetupFillDecision,
                  });
                }
              }}
            >
              {TEXT.SETUP_APPLY}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
