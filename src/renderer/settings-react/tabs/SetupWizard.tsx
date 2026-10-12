import { useEffect, useState, type ClipboardEvent, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { Combobox } from '@neuronection/assistant-ui/combobox';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@neuronection/assistant-ui/modal';
import { ProviderSetupTiles, ProviderSetupManualTile } from '@neuronection/assistant-ui/provider-setup-tiles';
import { ProviderSetupForm, type ProviderSetupFormValue } from '@neuronection/assistant-ui/provider-setup-form';
import { SetupFirstRunCard as SetupFirstRunCardSurface } from '@neuronection/assistant-ui/setup-first-run-card';
import { Check, RotateCcw } from 'lucide-react';
import { PROVIDER_PRESET_ORDER, PROVIDER_SETUP_PRESETS, ALL_PROVIDER_PRESETS, guessPresetForKey, type AnyPresetKey, type ProviderPresetKey } from '@shared/ai/providerPresets';
import { inferModelCaps } from '@shared/ai/tasks';
import { LLMProvider, LLMProviderType, Model, SetupProviderResult } from '@shared/types';
import { DECISION_SLOTS } from '@shared/ai/decisions';
import { TEXT, interpolate } from '@shared/constants/text';

type SetupPhase = 'tiles' | 'form' | 'success';

/** Decision-capable rows the setup created (plan 26 S3): sparse `decision` cap rows. */
const decisionCapable = (model: Model): boolean => {
  const caps = model.caps && model.caps.length > 0 ? model.caps : inferModelCaps(model.id);
  return caps.includes('decision');
};

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

export interface SetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSetupComplete: () => void;
  onOpenManualForm: (partial: Partial<LLMProvider>) => void;
  initialPreset?: AnyPresetKey | null;
}

export function SetupWizard({ open, onOpenChange, onSetupComplete, onOpenManualForm, initialPreset = null }: SetupWizardProps): JSX.Element {
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
  const [boundDecisionSlots, setBoundDecisionSlots] = useState<Record<string, string>>({});
  const [pickedTextModel, setPickedTextModel] = useState('');
  const [pickedVisionModel, setPickedVisionModel] = useState('');
  const [pickedSttModel, setPickedSttModel] = useState('');
  const [pickedDecisionModel, setPickedDecisionModel] = useState('');
  const [bindingTask, setBindingTask] = useState<'text' | 'vision' | 'stt' | 'decision' | null>(null);
  const [bindError, setBindError] = useState<string | null>(null);

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
    setBoundDecisionSlots({});
    setPickedTextModel('');
    setPickedVisionModel('');
    setPickedSttModel('');
    setPickedDecisionModel('');
    setBindError(null);
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
      const setupResult = await window.electronAPI.setupProviderFromPreset(
        selectedKey,
        apiKey,
        connectionName.trim() || ALL_PROVIDER_PRESETS[selectedKey].label
      );
      if (setupResult.ok) {
        setResult(setupResult);
        setFormError(null);
        setBoundTextModelId(setupResult.assignedModelId);
        setBoundVisionModelId(setupResult.assignedVisionModelId ?? null);
        setBoundSttModelId(setupResult.assignedSttModelId ?? null);
        setBoundDecisionSlots(setupResult.assignedDecisionSlots ?? {});
        setPhase('success');
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

  const bindModel = async (task: 'text' | 'vision' | 'stt' | 'decision', decisionSlot?: string): Promise<void> => {
    if (!result?.provider || bindingTask) {
      return;
    }
    const modelId =
      task === 'text' ? pickedTextModel : task === 'vision' ? pickedVisionModel : task === 'stt' ? pickedSttModel : pickedDecisionModel;
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
        } else {
          setBoundSttModelId(modelId);
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
  const decisionModels = catalogModels.filter(decisionCapable);
  const preset = selectedKey ? ALL_PROVIDER_PRESETS[selectedKey] : null;
  const formValue: ProviderSetupFormValue = { name: connectionName, apiKey, baseUrl: advancedBase };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="lg">
        <ModalHeader>
          <ModalTitle>{TEXT.SETUP_CARD_TITLE}</ModalTitle>
        </ModalHeader>
        <ModalBody className="space-y-3" data-setup-wizard onPaste={handlePaste}>
          {phase === 'tiles' && (
            <ProviderSetupTiles
              presets={PROVIDER_PRESET_ORDER.map((key) => ({ key, name: ALL_PROVIDER_PRESETS[key].label }))}
              onSelect={openForm}
              label={TEXT.SETUP_TILES_ARIA}
            >
              <ProviderSetupManualTile onClick={() => { onOpenChange(false); onOpenManualForm({}); }}>
                {TEXT.SETUP_MANUAL_CARD}
              </ProviderSetupManualTile>
            </ProviderSetupTiles>
          )}

          {phase === 'form' && selectedKey && preset && (
            <div className="space-y-3">
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
          {phase === 'success' && (
            <Button size="sm" onClick={() => onOpenChange(false)}>{TEXT.SETUP_SUCCESS_DONE}</Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
