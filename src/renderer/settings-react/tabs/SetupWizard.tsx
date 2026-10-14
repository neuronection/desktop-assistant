import { useEffect, useState, type ClipboardEvent, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { Combobox } from '@neuronection/assistant-ui/combobox';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@neuronection/assistant-ui/modal';
import { ProviderSetupTiles, ProviderSetupManualTile, type ProviderSetupTileChip } from '@neuronection/assistant-ui/provider-setup-tiles';
import { ProviderSetupForm, type ProviderSetupFormValue } from '@neuronection/assistant-ui/provider-setup-form';
import { SetupFirstRunCard as SetupFirstRunCardSurface } from '@neuronection/assistant-ui/setup-first-run-card';
import { SetupReview } from '@neuronection/assistant-ui/setup-review';
import { SetupSteps } from '@neuronection/assistant-ui/setup-steps';
import { SetupAssignments } from '@neuronection/assistant-ui/setup-assignments';
import { Check, RotateCcw } from 'lucide-react';
import { PROVIDER_PRESET_ORDER, PROVIDER_SETUP_PRESETS, ALL_PROVIDER_PRESETS, guessPresetForKey, type AnyPresetKey, type ProviderPresetKey } from '@shared/ai/providerPresets';
import { inferModelCaps } from '@shared/ai/tasks';
import { LLMProvider, LLMProviderType, Model, SetupProviderResult, AiTask, type SetupPresetOptions, type TaskAssignmentMap } from '@shared/types';
import { DECISION_DEFAULT_SLOT, DECISION_SLOTS } from '@shared/ai/decisions';
import { TEXT, interpolate } from '@shared/constants/text';

type SetupPhase = 'tiles' | 'form' | 'review' | 'success';

/** Decision-capable rows the setup created (plan 26 S3): sparse `decision` cap rows. */
const decisionCapable = (model: Model): boolean => {
  const caps = model.caps && model.caps.length > 0 ? model.caps : inferModelCaps(model.id);
  return caps.includes('decision');
};

/**
 * Capability chips for a preset tile (plan 26 §13.3 follow-up): derived
 * from the synced preset data — wire type → chat (+ vision/stt as the
 * data supports), decision_models → decision, keyless-local → local.
 * Labels ride TEXT (translated at the call site, per the family rule).
 */
function chipsForPreset(key: ProviderPresetKey): ProviderSetupTileChip[] {
  const preset = ALL_PROVIDER_PRESETS[key];
  const chips: ProviderSetupTileChip[] = [];
  const servesChat = preset.type !== LLMProviderType.DECISION;
  if (servesChat) {
    chips.push({ key: 'chat', label: TEXT.SETUP_CHIP_CHAT });
    if (preset.preferredModel?.caps.includes('vision')) {
      chips.push({ key: 'vision', label: TEXT.SETUP_CHIP_VISION });
    }
    if (preset.sttModel) {
      chips.push({ key: 'stt', label: TEXT.SETUP_CHIP_STT });
    }
  }
  if (preset.decisionModels && preset.decisionModels.length > 0) {
    chips.push({ key: 'decision', label: TEXT.SETUP_CHIP_DECISION });
  }
  if (preset.local) {
    chips.push({ key: 'local', label: TEXT.SETUP_CHIP_LOCAL });
  }
  return chips;
}

/**
 * Two-step wizard progress ("Connect provider" → "Choose defaults") —
 * rendered by the library `SetupSteps`; the preset tiles and the key form
 * are one mental unit (step 1), the review is step 2.
 */

const ERROR_COPY: Record<string, string> = {
  invalid_key: TEXT.SETUP_ERROR_INVALID_KEY,
  insufficient_credit: TEXT.SETUP_ERROR_INSUFFICIENT_CREDIT,
  new_user_quota: TEXT.SETUP_ERROR_NEW_USER_QUOTA,
  region_unavailable: TEXT.SETUP_ERROR_REGION,
  timeout: TEXT.SETUP_ERROR_TIMEOUT,
  local_not_running: TEXT.SETUP_ERROR_LOCAL_NOT_RUNNING,
};

export function setupErrorText(code: string | undefined, vendorMessage: string | null | undefined): string {
  if (code && code !== 'unknown' && ERROR_COPY[code]) {
    return ERROR_COPY[code];
  }
  return interpolate(TEXT.SETUP_ERROR_UNKNOWN, { message: vendorMessage ?? '' });
}

const ollamaProbeProvider = (): LLMProvider => ({
  id: 'setup-ollama-probe',
  name: 'Ollama probe',
  type: LLMProviderType.OLLAMA,
  apiKey: '',
  apiBase: PROVIDER_SETUP_PRESETS.ollama.apiBase,
  timeout: 4000,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: '',
});

const visionCapable = (model: Model): boolean => {
  const caps = model.caps && model.caps.length > 0 ? model.caps : inferModelCaps(model.id);
  return caps.includes('vision');
};

export interface SetupFirstRunCardProps {
  onOpenWizard: (preset?: AnyPresetKey) => void;
}

export function SetupFirstRunCard({ onOpenWizard }: SetupFirstRunCardProps): JSX.Element {
  const [probing, setProbing] = useState(true);
  const [ollamaDetected, setOllamaDetected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const probe = await window.electronAPI.testProvider(ollamaProbeProvider());
        if (!cancelled) {
          setOllamaDetected(Boolean(probe?.ok));
        }
      } catch {
        if (!cancelled) {
          setOllamaDetected(false);
        }
      } finally {
        if (!cancelled) {
          setProbing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SetupFirstRunCardSurface
      title={TEXT.SETUP_CARD_TITLE}
      body={TEXT.SETUP_CARD_SUBTITLE}
      localProbing={probing}
      setupLabel={TEXT.SETUP_GET_STARTED}
      onSetup={() => onOpenWizard()}
    >
      {ollamaDetected && (
        <div role="status" className="flex items-center justify-between gap-2 rounded-md border border-[var(--as-border)] bg-[var(--as-muted)] px-3 py-2">
          <span className="text-sm">{TEXT.SETUP_OLLAMA_DETECTED}</span>
          <Button size="sm" variant="outline" onClick={() => onOpenWizard('ollama')}>{TEXT.SETUP_OLLAMA_CONNECT}</Button>
        </div>
      )}
    </SetupFirstRunCardSurface>
  );
}

/** One "Default assignments" row in the review step: label, the
 * now/fills sub-line, the resolvable candidate (null → disabled row) and
 * its per-task switch state. */
interface ReviewAssignmentRow {
  id: string;
  label: string;
  sub: string;
  candidate: string | null;
  bind: boolean;
  set: (next: boolean) => void;
}

export interface SetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSetupComplete: () => void;
  onOpenManualForm: (partial: Partial<LLMProvider>) => void;
  initialPreset?: AnyPresetKey | null;
  /** Live task assignments (threaded from ApiTab's config) — powers the
   * review rows' honest "now:" context like career's re-setup dialog. */
  currentAssignments?: TaskAssignmentMap | null;
}

export function SetupWizard({ open, onOpenChange, onSetupComplete, onOpenManualForm, initialPreset = null, currentAssignments = null }: SetupWizardProps): JSX.Element {
  const [phase, setPhase] = useState<SetupPhase>('tiles');
  const [selectedKey, setSelectedKey] = useState<AnyPresetKey | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [advancedBase, setAdvancedBase] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<SetupProviderResult | null>(null);
  const [formError, setFormError] = useState<SetupProviderResult | null>(null);
  const [boundTextModelId, setBoundTextModelId] = useState<string | null>(null);
  const [boundVisionModelId, setBoundVisionModelId] = useState<string | null>(null);
  const [boundSttModelId, setBoundSttModelId] = useState<string | null>(null);
  const [boundEmbeddingsModelId, setBoundEmbeddingsModelId] = useState<string | null>(null);
  const [boundDecisionSlots, setBoundDecisionSlots] = useState<Record<string, string>>({});
  const [pickedTextModel, setPickedTextModel] = useState('');
  const [pickedVisionModel, setPickedVisionModel] = useState('');
  const [pickedSttModel, setPickedSttModel] = useState('');
  const [pickedEmbeddingsModel, setPickedEmbeddingsModel] = useState('');
  const [pickedDecisionModel, setPickedDecisionModel] = useState('');
  const [bindingTask, setBindingTask] = useState<'text' | 'vision' | 'stt' | 'embed' | 'decision' | null>(null);
  const [bindError, setBindError] = useState<string | null>(null);
  // Review step (parity with re-setup's SetupReview modal): connect first
  // binds nothing — what fills the defaults is chosen per capability here.
  const [reviewSelection, setReviewSelection] = useState<string[]>([]);
  const [fillText, setFillText] = useState(true);
  const [fillVision, setFillVision] = useState(true);
  const [fillStt, setFillStt] = useState(true);
  const [fillEmbed, setFillEmbed] = useState(true);
  const [fillDecision, setFillDecision] = useState(true);
  const [applying, setApplying] = useState(false);
  const [reviewError, setReviewError] = useState<SetupProviderResult | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (initialPreset) {
      openForm(initialPreset);
    } else {
      setPhase('tiles');
      setSelectedKey(null);
      setResult(null);
      setFormError(null);
      setReviewSelection([]);
      setReviewError(null);
    }
  }, [open, initialPreset]);

  const openForm = (key: AnyPresetKey, prefillKey = ''): void => {
    setSelectedKey(key);
    setApiKey(prefillKey);
    setConnectionName(ALL_PROVIDER_PRESETS[key].label);
    setAdvancedBase(ALL_PROVIDER_PRESETS[key].apiBase);
    setResult(null);
    setFormError(null);
    setBoundTextModelId(null);
    setBoundVisionModelId(null);
    setBoundSttModelId(null);
    setBoundEmbeddingsModelId(null);
    setBoundDecisionSlots({});
    setPickedTextModel('');
    setPickedVisionModel('');
    setPickedSttModel('');
    setPickedEmbeddingsModel('');
    setPickedDecisionModel('');
    setBindError(null);
    setReviewSelection([]);
    setFillText(true);
    setFillVision(true);
    setFillStt(true);
    setFillEmbed(true);
    setReviewError(null);
    setPhase('form');
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const text = event.clipboardData.getData('text');
    const guess = guessPresetForKey(text);
    if (guess && guess !== selectedKey) {
      openForm(guess, text.trim());
    }
  };

  const baseEdited = (): boolean => {
    if (!selectedKey) {
      return false;
    }
    const preset = ALL_PROVIDER_PRESETS[selectedKey];
    return !preset.fixedBase && advancedBase.trim().length > 0 && advancedBase.trim() !== preset.apiBase;
  };

  const saveViaManualForm = (): void => {
    if (!selectedKey) {
      return;
    }
    const preset = ALL_PROVIDER_PRESETS[selectedKey];
    onOpenChange(false);
    onOpenManualForm({
      name: connectionName.trim() || preset.label,
      type: preset.type,
      apiBase: advancedBase.trim() || preset.apiBase,
      apiKey,
    });
  };

  const submit = async (): Promise<void> => {
    if (!selectedKey || checking) {
      return;
    }
    setChecking(true);
    try {
      // Connect + persist only — all binds stay off so the review step
      // decides what fills the defaults (same options contract re-setup
      // uses). Omitting `curatedIds` keeps the preset's catalog behavior.
      const setupResult = await window.electronAPI.setupProviderFromPreset(
        selectedKey,
        apiKey,
        connectionName.trim() || ALL_PROVIDER_PRESETS[selectedKey].label,
        { bindChat: false, bindVision: false, bindStt: false, bindEmbeddings: false, bindDecision: false }
      );
      if (setupResult.ok) {
        setResult(setupResult);
        setFormError(null);
        const preset = ALL_PROVIDER_PRESETS[selectedKey];
        setReviewSelection(preset.curatedModels ?? []);
        setFillText(true);
        setFillVision(true);
        setFillStt(true);
        setFillEmbed(true);
        setFillDecision(Boolean(preset.decisionModels?.length));
        setReviewError(null);
        setPhase('review');
        onSetupComplete();
      } else {
        setFormError(setupResult);
      }
    } catch (error) {
      setFormError({
        ok: false,
        assignedModelId: null,
        catalogCount: 0,
        errorCode: 'unknown',
        vendorMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setChecking(false);
    }
  };

  /** Apply the reviewed choices (second pass over the same preset): the
   * "Models to add" selection plus the per-capability gap-fill switches.
   * Binding stays gap-fill main-side — only empty defaults are filled. */
  const applyReview = async (): Promise<void> => {
    if (!selectedKey || applying) {
      return;
    }
    setApplying(true);
    setReviewError(null);
    try {
      const options: SetupPresetOptions = {
        curatedIds: reviewSelection,
        bindChat: fillText,
        bindVision: fillVision,
        bindStt: fillStt,
        bindEmbeddings: fillEmbed,
        bindDecision: fillDecision,
      };
      const applied = await window.electronAPI.setupProviderFromPreset(
        selectedKey,
        apiKey,
        connectionName.trim() || ALL_PROVIDER_PRESETS[selectedKey].label,
        options
      );
      if (applied.ok) {
        setResult(applied);
        setBoundTextModelId(applied.assignedModelId);
        setBoundVisionModelId(applied.assignedVisionModelId ?? null);
        setBoundSttModelId(applied.assignedSttModelId ?? null);
        setBoundEmbeddingsModelId(applied.assignedEmbeddingsModel ?? null);
        setBoundDecisionSlots(applied.assignedDecisionSlots ?? {});
        setPhase('success');
        onSetupComplete();
      } else {
        setReviewError(applied);
      }
    } catch (error) {
      setReviewError({
        ok: false,
        assignedModelId: null,
        catalogCount: 0,
        errorCode: 'unknown',
        vendorMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setApplying(false);
    }
  };

  const bindModel = async (task: 'text' | 'vision' | 'stt' | 'embed' | 'decision', decisionSlot?: string): Promise<void> => {
    if (!result?.provider || bindingTask) {
      return;
    }
    const modelId =
      task === 'text'
        ? pickedTextModel
        : task === 'vision'
          ? pickedVisionModel
          : task === 'stt'
            ? pickedSttModel
            : task === 'embed'
              ? pickedEmbeddingsModel
              : pickedDecisionModel;
    if (!modelId || (task === 'decision' && !decisionSlot)) {
      return;
    }
    setBindingTask(task);
    setBindError(null);
    try {
      if (task === 'decision') {
        await window.electronAPI.setDefaultModel(result.provider.id, modelId, decisionSlot);
        setBoundDecisionSlots((current) => ({ ...current, [decisionSlot as string]: modelId }));
      } else {
        await window.electronAPI.setDefaultModel(result.provider.id, modelId, task === 'text' ? 'chat' : task);
        if (task === 'text') {
          setBoundTextModelId(modelId);
        } else if (task === 'vision') {
          setBoundVisionModelId(modelId);
        } else if (task === 'stt') {
          setBoundSttModelId(modelId);
        } else {
          setBoundEmbeddingsModelId(modelId);
        }
      }
    } catch (error) {
      setBindError(error instanceof Error ? error.message : String(error));
    } finally {
      setBindingTask(null);
    }
  };

  const vendorLabel = (key: string): string => {
    const preset = ALL_PROVIDER_PRESETS[key];
    return preset ? preset.label : key;
  };

  const catalogModels = result?.provider?.availableModels ?? [];
  const visionModels = catalogModels.filter(visionCapable);
  const sttModels = catalogModels.filter((model) => {
    const caps = model.caps && model.caps.length > 0 ? model.caps : inferModelCaps(model.id);
    return caps.includes('stt');
  });
  const embeddingsModels = catalogModels.filter((model) => {
    const caps = model.caps && model.caps.length > 0 ? model.caps : inferModelCaps(model.id);
    return caps.includes('embeddings');
  });
  const decisionModels = catalogModels.filter(decisionCapable);
  const preset = selectedKey ? ALL_PROVIDER_PRESETS[selectedKey] : null;
  const formValue: ProviderSetupFormValue = { name: connectionName, apiKey, baseUrl: advancedBase };

  // Review step data (family's two-step, task-centric review): curated
  // "Models to add" cards from the preset, plus one assignment row per
  // task in a "Default assignments" list. Effective candidates mirror the
  // main-side gap-fill resolution: preferred model (when its card stays
  // selected) → first selected text-capable curated card; vision rides
  // that model when vision-capable, else the first selected
  // vision-capable card; stt must keep its curated card; embeddings
  // rides its curated card when the preset lists one (always available
  // when it sits outside the card list); decision binds the preset's
  // decisionDefault only, so a decision section without one stays hidden.
  const selectedCurated = (preset?.curatedModels ?? []).filter((modelId) => reviewSelection.includes(modelId));
  const preferredId = preset?.preferredModel?.modelId ?? null;
  const textCandidate =
    (preferredId !== null && selectedCurated.includes(preferredId) ? preferredId : null) ??
    selectedCurated.find((modelId) => inferModelCaps(modelId).includes('text')) ??
    selectedCurated[0] ??
    null;
  const visionCandidate =
    (textCandidate !== null && inferModelCaps(textCandidate).includes('vision') ? textCandidate : null) ??
    selectedCurated.find((modelId) => inferModelCaps(modelId).includes('vision')) ??
    null;
  const sttCandidate = preset?.sttModel && selectedCurated.includes(preset.sttModel) ? preset.sttModel : null;
  const embedCandidate = ((): string | null => {
    const modelId = preset?.embeddingsModel;
    if (!modelId) {
      return null;
    }
    const cards = preset?.curatedModels ?? [];
    return cards.includes(modelId) && !selectedCurated.includes(modelId) ? null : modelId;
  })();
  const decisionCandidate =
    preset?.decisionModels?.find((entry) => entry.modelId === preset.decisionDefault) ?? null;
  const reviewCards = (preset?.curatedModels ?? []).map((modelId) => ({
    id: modelId,
    name: modelId,
    caps: inferModelCaps(modelId),
    selected: reviewSelection.includes(modelId),
  }));
  // "now:" context for the rows — live assignments threaded from ApiTab
  // (unset on a first provider), then what the reviewed selection fills.
  const nowLine = (task: string): string =>
    interpolate(TEXT.SETUP_REVIEW_CURRENT, {
      model: currentAssignments?.[task] || TEXT.API_DEFAULT_MODEL_UNSET,
    });
  const fillsLine = (candidate: string | null, task: string): string =>
    candidate === null
      ? TEXT.SETUP_DEFAULTS_NO_CANDIDATE
      : `${nowLine(task)} · ${interpolate(TEXT.SETUP_REVIEW_FILLS, { model: candidate })}`;
  const assignmentRows: ReviewAssignmentRow[] = [
    ...(preset && preset.type !== LLMProviderType.DECISION
      ? [
          {
            id: 'chat',
            label: TEXT.SETUP_DEFAULTS_TEXT,
            sub: fillsLine(textCandidate, AiTask.CHAT),
            candidate: textCandidate,
            bind: fillText,
            set: setFillText,
          },
          {
            id: 'vision',
            label: TEXT.SETUP_DEFAULTS_VISION,
            sub: fillsLine(visionCandidate, AiTask.VISION),
            candidate: visionCandidate,
            bind: fillVision,
            set: setFillVision,
          },
          ...(preset.sttModel
            ? [
                {
                  id: 'stt',
                  label: TEXT.SETUP_DEFAULTS_STT,
                  sub: fillsLine(sttCandidate, AiTask.STT),
                  candidate: sttCandidate,
                  bind: fillStt,
                  set: setFillStt,
                },
              ]
            : []),
        ]
      : []),
    ...(preset?.embeddingsModel
      ? [
          {
            id: 'embed',
            label: TEXT.SETUP_DEFAULTS_EMBED,
            sub: fillsLine(embedCandidate, AiTask.EMBED),
            candidate: embedCandidate,
            bind: fillEmbed,
            set: setFillEmbed,
          },
        ]
      : []),
    ...(decisionCandidate
      ? [
          {
            id: 'decision',
            label: TEXT.API_DECISION_DEFAULT_ROW_LABEL,
            sub: fillsLine(decisionCandidate.name, DECISION_DEFAULT_SLOT),
            candidate: decisionCandidate.name,
            bind: fillDecision,
            set: setFillDecision,
          },
        ]
      : []),
  ];

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="lg">
        <ModalHeader>
          <ModalTitle>{TEXT.SETUP_CARD_TITLE}</ModalTitle>
        </ModalHeader>
        <ModalBody className="space-y-3" data-setup-wizard onPaste={handlePaste}>
          {phase === 'tiles' && (
            <>
              <SetupSteps
                steps={[
                  { id: 'connect', label: TEXT.SETUP_STEP_CONNECT },
                  { id: 'defaults', label: TEXT.SETUP_STEP_DEFAULTS },
                ]}
                current={0}
                label={TEXT.SETUP_STEP_PROGRESS}
              />
              <ProviderSetupTiles
                presets={PROVIDER_PRESET_ORDER.map((key) => ({
                  key,
                  name: ALL_PROVIDER_PRESETS[key].label,
                  chips: chipsForPreset(key),
                }))}
                onSelect={openForm}
                label={TEXT.SETUP_TILES_ARIA}
              >
                <ProviderSetupManualTile onClick={() => { onOpenChange(false); onOpenManualForm({}); }}>
                  {TEXT.SETUP_MANUAL_CARD}
                </ProviderSetupManualTile>
              </ProviderSetupTiles>
            </>
          )}

          {phase === 'form' && selectedKey && preset && (
            <div className="space-y-3">
              <SetupSteps
                steps={[
                  { id: 'connect', label: TEXT.SETUP_STEP_CONNECT },
                  { id: 'defaults', label: TEXT.SETUP_STEP_DEFAULTS },
                ]}
                current={0}
                label={TEXT.SETUP_STEP_PROGRESS}
              />
              <ProviderSetupForm
                preset={{
                  name: preset.label,
                  keyUrl: preset.keyUrl,
                  steps: preset.steps,
                  freeTierNote: preset.freeTierNote,
                  fixedBase: preset.fixedBase,
                  baseUrl: preset.apiBase,
                  local: preset.local,
                }}
                value={formValue}
                onChange={(value) => {
                  setConnectionName(value.name);
                  setApiKey(value.apiKey);
                  setAdvancedBase(value.baseUrl ?? '');
                }}
                testing={checking}
                error={formError ? { code: formError.errorCode ?? 'unknown', suspectedVendor: formError.suspectedVendor ? vendorLabel(formError.suspectedVendor) : null } : null}
                errorLabels={{
                  ...ERROR_COPY,
                  unknown: interpolate(TEXT.SETUP_ERROR_UNKNOWN, { message: formError?.vendorMessage ?? '' }),
                }}
                suspectedVendorHint={TEXT.SETUP_SUSPECTED_PREFIX}
                onCopyStep={(step) => void window.electronAPI.writeToClipboard(step)}
                onOpenKeyUrl={(url) => void window.electronAPI.openExternal(url)}
                checklistLabel={TEXT.SETUP_CHECKLIST_ARIA}
                copyLabel={TEXT.COPY_BUTTON}
                getKeyLabel={TEXT.SETUP_GET_KEY}
                nameLabel={TEXT.SETUP_CONNECTION_NAME}
                apiKeyLabel={TEXT.SETUP_KEY_LABEL}
                keyPlaceholder={TEXT.SETUP_KEY_PLACEHOLDER}
                noKeyLabel={TEXT.SETUP_OLLAMA_LOCAL_ONLY}
                advancedLabel={TEXT.SETUP_ADVANCED}
                baseUrlLabel={TEXT.SETUP_BASE_LABEL}
                baseUrlHint={TEXT.SETUP_BASE_EDIT_HINT}
                submitLabel={
                  baseEdited()
                    ? TEXT.API_SAVE_PROVIDER
                    : preset.local
                      ? TEXT.SETUP_OLLAMA_CONNECT
                      : TEXT.SETUP_SUBMIT
                }
                cancelLabel={TEXT.SETUP_BACK_TILES}
                onSubmit={() => {
                  if (baseEdited()) {
                    saveViaManualForm();
                  } else {
                    void submit();
                  }
                }}
                onCancel={() => setPhase('tiles')}
              />

              {preset.type === LLMProviderType.DECISION && checking && (
                <p role="status" className="text-xs opacity-70">
                  {TEXT.SETUP_PROBE_PENDING}
                </p>
              )}

              {formError && (
                <div className="flex items-center gap-2">
                  {formError.suspectedVendor && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openForm(formError.suspectedVendor as ProviderPresetKey, apiKey)}
                    >
                      {interpolate(TEXT.SETUP_SUSPECTED_SWITCH, { vendor: vendorLabel(formError.suspectedVendor) })}
                    </Button>
                  )}
                  {!baseEdited() && (
                    <Button variant="outline" size="sm" disabled={checking} onClick={() => void submit()}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden />
                      {TEXT.SETUP_RETRY}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {phase === 'review' && result && preset && (
            <div className="space-y-3">
              <SetupSteps
                steps={[
                  { id: 'connect', label: TEXT.SETUP_STEP_CONNECT },
                  { id: 'defaults', label: TEXT.SETUP_STEP_DEFAULTS },
                ]}
                current={1}
                label={TEXT.SETUP_STEP_PROGRESS}
              />
              {(preset.curatedModels ?? []).length > 0 && (
                <section className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold">{TEXT.SETUP_REVIEW_MODELS_LABEL}</h3>
                    <p className="text-xs text-[var(--as-muted-fg)]">{TEXT.SETUP_REVIEW_MODELS_HINT}</p>
                  </div>
                  <SetupReview
                    models={reviewCards}
                    slots={[]}
                    modelsLabel={TEXT.SETUP_REVIEW_MODELS_LABEL}
                    footnote={TEXT.SETUP_REVIEW_FOOTNOTE}
                    onOptionsChange={(options) => setReviewSelection(options.curatedIds)}
                  />
                </section>
              )}
              <SetupAssignments
                title={TEXT.SETUP_REVIEW_ASSIGNMENTS_TITLE}
                hint={TEXT.SETUP_REVIEW_ASSIGNMENTS_HINT}
                rows={assignmentRows.map((row) => ({
                  id: row.id,
                  label: row.label,
                  hint: row.sub,
                  checked: row.bind,
                  disabled: row.candidate === null,
                  onCheckedChange: row.set,
                }))}
              />
              {reviewError && (
                <p role="alert" className="text-sm opacity-80">
                  {setupErrorText(reviewError.errorCode, reviewError.vendorMessage)}
                </p>
              )}
            </div>
          )}

          {phase === 'success' && result && (
            <div role="status" className="space-y-3">
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Check className="h-4 w-4" aria-hidden />
                  {TEXT.SETUP_SUCCESS_TITLE}
                </p>
                <p className="text-sm opacity-80">
                  {interpolate(TEXT.SETUP_SUCCESS_SUMMARY, { name: result.provider?.name ?? '', count: result.catalogCount })}
                </p>
                {result.curatedMissed && (
                  <p className="rounded-md border border-[var(--as-border)] bg-[var(--as-muted)] px-2 py-1.5 text-xs opacity-80">
                    {TEXT.SETUP_CURATED_MISSED}
                  </p>
                )}
                {bindError && <p className="text-sm">{interpolate(TEXT.SETUP_ERROR_UNKNOWN, { message: bindError })}</p>}
              </div>

              <div className="space-y-2 rounded-md border border-[var(--as-border)] p-3">
                <h3 className="text-sm font-semibold">{TEXT.SETUP_DEFAULTS_TITLE}</h3>
                <div className="flex items-center gap-2">
                  <label htmlFor="setup-default-text" className="w-36 shrink-0 text-sm opacity-80">{TEXT.SETUP_DEFAULTS_TEXT}</label>
                  <Combobox
                    id="setup-default-text"
                    hideLabel
                    label={TEXT.SETUP_DEFAULTS_TEXT}
                    className="min-w-0 flex-1"
                    value={pickedTextModel || boundTextModelId || ''}
                    onChange={(value) => setPickedTextModel(value)}
                    options={[
                      { value: '', label: TEXT.SETUP_SUCCESS_PICK },
                      ...catalogModels.map((model) => ({
                        value: model.id,
                        label: model.name === model.id ? model.id : `${model.name} (${model.id})`,
                      })),
                    ]}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pickedTextModel || bindingTask !== null}
                    loading={bindingTask === 'text'}
                    onClick={() => void bindModel('text')}
                  >
                    {TEXT.SETUP_DEFAULTS_SET}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="setup-default-vision" className="w-36 shrink-0 text-sm opacity-80">{TEXT.SETUP_DEFAULTS_VISION}</label>
                  <Combobox
                    id="setup-default-vision"
                    hideLabel
                    label={TEXT.SETUP_DEFAULTS_VISION}
                    className="min-w-0 flex-1"
                    value={pickedVisionModel || boundVisionModelId || ''}
                    onChange={(value) => setPickedVisionModel(value)}
                    options={[
                      { value: '', label: TEXT.SETUP_SUCCESS_PICK },
                      ...visionModels.map((model) => ({
                        value: model.id,
                        label: model.name === model.id ? model.id : `${model.name} (${model.id})`,
                      })),
                    ]}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pickedVisionModel || bindingTask !== null}
                    loading={bindingTask === 'vision'}
                    onClick={() => void bindModel('vision')}
                  >
                    {TEXT.SETUP_DEFAULTS_SET}
                  </Button>
                </div>
                {sttModels.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label htmlFor="setup-default-stt" className="w-36 shrink-0 text-sm opacity-80">{TEXT.SETUP_DEFAULTS_STT}</label>
                    <Combobox
                      id="setup-default-stt"
                      hideLabel
                      label={TEXT.SETUP_DEFAULTS_STT}
                      className="min-w-0 flex-1"
                      value={pickedSttModel || boundSttModelId || ''}
                      onChange={(value) => setPickedSttModel(value)}
                      options={[
                        { value: '', label: TEXT.SETUP_SUCCESS_PICK },
                        ...sttModels.map((model) => ({
                          value: model.id,
                          label: model.name === model.id ? model.id : `${model.name} (${model.id})`,
                        })),
                      ]}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!pickedSttModel || bindingTask !== null}
                      loading={bindingTask === 'stt'}
                      onClick={() => void bindModel('stt')}
                    >
                      {TEXT.SETUP_DEFAULTS_SET}
                    </Button>
                  </div>
                )}
                {preset?.embeddingsModel && embeddingsModels.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label htmlFor="setup-default-embed" className="w-36 shrink-0 text-sm opacity-80">{TEXT.SETUP_DEFAULTS_EMBED}</label>
                    <Combobox
                      id="setup-default-embed"
                      hideLabel
                      label={TEXT.SETUP_DEFAULTS_EMBED}
                      className="min-w-0 flex-1"
                      value={pickedEmbeddingsModel || boundEmbeddingsModelId || ''}
                      onChange={(value) => setPickedEmbeddingsModel(value)}
                      options={[
                        { value: '', label: TEXT.SETUP_SUCCESS_PICK },
                        ...embeddingsModels.map((model) => ({
                          value: model.id,
                          label: model.name === model.id ? model.id : `${model.name} (${model.id})`,
                        })),
                      ]}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!pickedEmbeddingsModel || bindingTask !== null}
                      loading={bindingTask === 'embed'}
                      onClick={() => void bindModel('embed')}
                    >
                      {TEXT.SETUP_DEFAULTS_SET}
                    </Button>
                  </div>
                )}
                {decisionModels.length > 0 &&
                  DECISION_SLOTS.map((slot) => (
                    <div key={slot} className="flex items-center gap-2">
                      <label htmlFor={`setup-default-${slot}`} className="w-36 shrink-0 text-sm opacity-80">
                        {TEXT.SETUP_DEFAULTS_DECISION}
                      </label>
                      <Combobox
                        id={`setup-default-${slot}`}
                        hideLabel
                        label={TEXT.SETUP_DEFAULTS_DECISION}
                        className="min-w-0 flex-1"
                        value={pickedDecisionModel || boundDecisionSlots[slot] || ''}
                        onChange={(value) => setPickedDecisionModel(value)}
                        options={[
                          { value: '', label: TEXT.SETUP_SUCCESS_PICK },
                          ...decisionModels.map((model) => ({
                            value: model.id,
                            label: model.name === model.id ? model.id : `${model.name} (${model.id})`,
                          })),
                        ]}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!pickedDecisionModel || bindingTask !== null}
                        loading={bindingTask === 'decision'}
                        onClick={() => void bindModel('decision', slot)}
                      >
                        {TEXT.SETUP_DEFAULTS_SET}
                      </Button>
                    </div>
                  ))}
                <p id="setup-default-vision-hint" className="text-xs opacity-70">{TEXT.SETUP_DEFAULTS_HINT}</p>
                {boundTextModelId && <p className="text-sm opacity-80">{interpolate(TEXT.SETUP_SUCCESS_ASSIGNED, { model: boundTextModelId })}</p>}
                {boundVisionModelId && <p className="text-sm opacity-80">{interpolate(TEXT.SETUP_SUCCESS_ASSIGNED_VISION, { model: boundVisionModelId })}</p>}
                {boundSttModelId && <p className="text-sm opacity-80">{interpolate(TEXT.SETUP_SUCCESS_ASSIGNED_STT, { model: boundSttModelId })}</p>}
                {boundEmbeddingsModelId && <p className="text-sm opacity-80">{interpolate(TEXT.SETUP_SUCCESS_ASSIGNED_EMBED, { model: boundEmbeddingsModelId })}</p>}
                {Object.entries(boundDecisionSlots).map(([slot, model]) => (
                  <p key={slot} className="text-sm opacity-80">
                    {interpolate(TEXT.SETUP_SUCCESS_ASSIGNED_DECISION, { slot, model })}
                  </p>
                ))}
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter className="flex justify-end gap-2">
          {phase === 'tiles' && (
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{TEXT.CLOSE_BUTTON}</Button>
          )}
          {phase === 'review' && (
            <>
              <Button variant="outline" size="sm" disabled={applying} onClick={() => setPhase('form')}>
                {TEXT.SETUP_REVIEW_BACK}
              </Button>
              <Button size="sm" loading={applying} disabled={applying} onClick={() => void applyReview()}>
                {TEXT.SETUP_APPLY}
              </Button>
            </>
          )}
          {phase === 'success' && (
            <Button size="sm" onClick={() => onOpenChange(false)}>{TEXT.SETUP_SUCCESS_DONE}</Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
