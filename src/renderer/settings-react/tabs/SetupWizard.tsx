import { useEffect, useRef, useState, type ClipboardEvent, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@neuronection/assistant-ui/modal';
import { Check, Copy, ExternalLink, RotateCcw, Settings2 } from 'lucide-react';
import { PROVIDER_PRESET_ORDER, PROVIDER_SETUP_PRESETS, guessPresetForKey, type ProviderPresetKey } from '@shared/ai/providerPresets';
import { inferModelCaps } from '@shared/ai/tasks';
import { LLMProvider, LLMProviderType, Model, SetupProviderResult } from '@shared/types';
import { TEXT, interpolate } from '@shared/constants/text';
import { ProviderLogo } from './ProviderLogo';

type SetupPhase = 'tiles' | 'form' | 'success' | 'error';

const SETUP_STEPS: Record<ProviderPresetKey, [string, string, string, string]> = {
  openai: [TEXT.SETUP_OPENAI_STEP_1, TEXT.SETUP_OPENAI_STEP_2, TEXT.SETUP_OPENAI_STEP_3, TEXT.SETUP_OPENAI_STEP_4],
  gemini: [TEXT.SETUP_GEMINI_STEP_1, TEXT.SETUP_GEMINI_STEP_2, TEXT.SETUP_GEMINI_STEP_3, TEXT.SETUP_GEMINI_STEP_4],
  openrouter: [TEXT.SETUP_OPENROUTER_STEP_1, TEXT.SETUP_OPENROUTER_STEP_2, TEXT.SETUP_OPENROUTER_STEP_3, TEXT.SETUP_OPENROUTER_STEP_4],
  anthropic: [TEXT.SETUP_ANTHROPIC_STEP_1, TEXT.SETUP_ANTHROPIC_STEP_2, TEXT.SETUP_ANTHROPIC_STEP_3, TEXT.SETUP_ANTHROPIC_STEP_4],
  groq: [TEXT.SETUP_GROQ_STEP_1, TEXT.SETUP_GROQ_STEP_2, TEXT.SETUP_GROQ_STEP_3, TEXT.SETUP_GROQ_STEP_4],
  mistral: [TEXT.SETUP_MISTRAL_STEP_1, TEXT.SETUP_MISTRAL_STEP_2, TEXT.SETUP_MISTRAL_STEP_3, TEXT.SETUP_MISTRAL_STEP_4],
  deepseek: [TEXT.SETUP_DEEPSEEK_STEP_1, TEXT.SETUP_DEEPSEEK_STEP_2, TEXT.SETUP_DEEPSEEK_STEP_3, TEXT.SETUP_DEEPSEEK_STEP_4],
  ollama: [TEXT.SETUP_OLLAMA_STEP_1, TEXT.SETUP_OLLAMA_STEP_2, TEXT.SETUP_OLLAMA_STEP_3, TEXT.SETUP_OLLAMA_STEP_4],
};

const FREE_TIER_HINTS: Partial<Record<ProviderPresetKey, string>> = {
  gemini: TEXT.SETUP_FREE_TIER_GEMINI,
  openrouter: TEXT.SETUP_FREE_TIER_OPENROUTER,
};

const ERROR_COPY: Partial<Record<string, string>> = {
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
  onOpenWizard: (preset?: ProviderPresetKey) => void;
}

export function SetupFirstRunCard({ onOpenWizard }: SetupFirstRunCardProps): JSX.Element {
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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section data-setup-first-run aria-labelledby="setup-card-title" className="space-y-3 rounded-md border border-[var(--as-border)] p-4">
      <div className="space-y-1">
        <h3 id="setup-card-title" className="text-base font-semibold">{TEXT.SETUP_CARD_TITLE}</h3>
        <p className="text-sm opacity-60">{TEXT.SETUP_CARD_SUBTITLE}</p>
      </div>
      {ollamaDetected && (
        <div role="status" className="flex items-center justify-between gap-2 rounded-md border border-[var(--as-border)] bg-[var(--as-muted)] px-3 py-2">
          <span className="text-sm">{TEXT.SETUP_OLLAMA_DETECTED}</span>
          <Button size="sm" variant="outline" onClick={() => onOpenWizard('ollama')}>{TEXT.SETUP_OLLAMA_CONNECT}</Button>
        </div>
      )}
      <div>
        <Button size="sm" onClick={() => onOpenWizard()}>{TEXT.SETUP_GET_STARTED}</Button>
      </div>
    </section>
  );
}

export interface SetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSetupComplete: () => void;
  onOpenManualForm: (partial: Partial<LLMProvider>) => void;
  initialPreset?: ProviderPresetKey | null;
}

export function SetupWizard({ open, onOpenChange, onSetupComplete, onOpenManualForm, initialPreset = null }: SetupWizardProps): JSX.Element {
  const [phase, setPhase] = useState<SetupPhase>('tiles');
  const [selectedKey, setSelectedKey] = useState<ProviderPresetKey | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [advancedBase, setAdvancedBase] = useState('');
  const [checking, setChecking] = useState(false);
  const [keyReady, setKeyReady] = useState(false);
  const [result, setResult] = useState<SetupProviderResult | null>(null);
  const [boundTextModelId, setBoundTextModelId] = useState<string | null>(null);
  const [boundVisionModelId, setBoundVisionModelId] = useState<string | null>(null);
  const [pickedTextModel, setPickedTextModel] = useState('');
  const [pickedVisionModel, setPickedVisionModel] = useState('');
  const [bindingTask, setBindingTask] = useState<'text' | 'vision' | null>(null);
  const [bindError, setBindError] = useState<string | null>(null);
  const keyInputRef = useRef<HTMLInputElement | null>(null);

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
    }
  }, [open, initialPreset]);

  const openForm = (key: ProviderPresetKey, prefillKey = ''): void => {
    setSelectedKey(key);
    setApiKey(prefillKey);
    setConnectionName(PROVIDER_SETUP_PRESETS[key].label);
    setAdvancedBase(PROVIDER_SETUP_PRESETS[key].apiBase);
    setKeyReady(false);
    setResult(null);
    setBoundTextModelId(null);
    setBoundVisionModelId(null);
    setPickedTextModel('');
    setPickedVisionModel('');
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
    const preset = PROVIDER_SETUP_PRESETS[selectedKey];
    return !preset.fixedBase && advancedBase.trim().length > 0 && advancedBase.trim() !== preset.apiBase;
  };

  const saveViaManualForm = (): void => {
    if (!selectedKey) {
      return;
    }
    const preset = PROVIDER_SETUP_PRESETS[selectedKey];
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
        connectionName.trim() || PROVIDER_SETUP_PRESETS[selectedKey].label
      );
      setResult(setupResult);
      if (setupResult.ok) {
        setBoundTextModelId(setupResult.assignedModelId);
        setBoundVisionModelId(setupResult.assignedVisionModelId ?? null);
        setPhase('success');
        onSetupComplete();
      } else {
        setPhase('error');
      }
    } catch (error) {
      setResult({
        ok: false,
        assignedModelId: null,
        catalogCount: 0,
        errorCode: 'unknown',
        vendorMessage: error instanceof Error ? error.message : String(error),
      });
      setPhase('error');
    } finally {
      setChecking(false);
    }
  };

  const bindModel = async (task: 'text' | 'vision'): Promise<void> => {
    if (!result?.provider || bindingTask) {
      return;
    }
    const modelId = task === 'text' ? pickedTextModel : pickedVisionModel;
    if (!modelId) {
      return;
    }
    setBindingTask(task);
    setBindError(null);
    try {
      await window.electronAPI.setDefaultModel(result.provider.id, modelId, task === 'vision' ? 'vision' : 'chat');
      if (task === 'text') {
        setBoundTextModelId(modelId);
      } else {
        setBoundVisionModelId(modelId);
      }
    } catch (error) {
      setBindError(error instanceof Error ? error.message : String(error));
    } finally {
      setBindingTask(null);
    }
  };

  const vendorLabel = (key: string): string => {
    const preset = PROVIDER_SETUP_PRESETS[key as ProviderPresetKey];
    return preset ? preset.label : key;
  };

  const errorCopy = (): string => {
    if (!result) {
      return '';
    }
    return setupErrorText(result.errorCode, result.vendorMessage);
  };

  const catalogModels = result?.provider?.availableModels ?? [];
  const visionModels = catalogModels.filter(visionCapable);
  const preset = selectedKey ? PROVIDER_SETUP_PRESETS[selectedKey] : null;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="lg">
        <ModalHeader>
          <ModalTitle>{TEXT.SETUP_CARD_TITLE}</ModalTitle>
        </ModalHeader>
        <ModalBody className="space-y-3" data-setup-wizard onPaste={handlePaste}>
          {phase === 'tiles' && (
            <div role="group" aria-label={TEXT.SETUP_TILES_ARIA} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PROVIDER_PRESET_ORDER.map((key) => (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  aria-pressed={selectedKey === key}
                  className="h-auto flex-col items-center gap-2 px-3 py-4"
                  onClick={() => openForm(key)}
                >
                  <ProviderLogo presetKey={key} label={PROVIDER_SETUP_PRESETS[key].label} />
                  <span>{PROVIDER_SETUP_PRESETS[key].label}</span>
                </Button>
              ))}
              <Button variant="outline" size="sm" className="h-auto flex-col items-center gap-2 px-3 py-4" onClick={() => { onOpenChange(false); onOpenManualForm({}); }}>
                <Settings2 className="h-5 w-5 shrink-0" aria-hidden />
                <span>{TEXT.SETUP_MANUAL_CARD}</span>
              </Button>
            </div>
          )}

          {phase === 'form' && selectedKey && preset && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">{preset.label}</h3>
              <ol aria-label={TEXT.SETUP_CHECKLIST_ARIA} className="list-inside list-decimal space-y-1 text-sm opacity-80">
                {SETUP_STEPS[selectedKey].map((step, index) => (
                  <li key={index} className="flex items-start justify-between gap-2">
                    <span>{interpolate(step, { url: preset.keyUrl ?? '' })}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0"
                      title={TEXT.COPY_BUTTON}
                      aria-label={TEXT.COPY_BUTTON}
                      onClick={() => void window.electronAPI.writeToClipboard(step)}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ol>

              {preset.keyUrl && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setKeyReady(true);
                      void window.electronAPI.openExternal(preset.keyUrl!);
                    }}
                  >
                    <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                    {TEXT.SETUP_GET_KEY}
                  </Button>
                  {keyReady && !preset.local && (
                    <Button variant="ghost" size="sm" onClick={() => keyInputRef.current?.focus()}>{TEXT.SETUP_KEY_READY}</Button>
                  )}
                </div>
              )}

              {FREE_TIER_HINTS[selectedKey] && (
                <p className="text-xs opacity-70">{FREE_TIER_HINTS[selectedKey]}</p>
              )}

              <div className="space-y-1">
                <label htmlFor="setup-connection-name" className="text-sm font-medium">{TEXT.SETUP_CONNECTION_NAME}</label>
                <input
                  id="setup-connection-name"
                  type="text"
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-3 py-2 text-sm"
                  value={connectionName}
                  onChange={(event) => setConnectionName(event.target.value)}
                />
              </div>

              {preset.local ? (
                <p className="text-sm opacity-70">{TEXT.SETUP_OLLAMA_LOCAL_ONLY}</p>
              ) : (
                <div className="space-y-1">
                  <label htmlFor="setup-api-key" className="text-sm font-medium">{TEXT.SETUP_KEY_LABEL}</label>
                  <input
                    id="setup-api-key"
                    ref={keyInputRef}
                    type="password"
                    autoComplete="off"
                    className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-3 py-2 text-sm"
                    placeholder={TEXT.SETUP_KEY_PLACEHOLDER}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </div>
              )}

              <details className="rounded-md border border-[var(--as-border)] px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">{TEXT.SETUP_ADVANCED}</summary>
                <div className="space-y-1 pt-2">
                  <label htmlFor="setup-api-base" className="text-sm font-medium">{TEXT.SETUP_BASE_LABEL}</label>
                  <input
                    id="setup-api-base"
                    type="text"
                    readOnly={preset.fixedBase}
                    className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-3 py-2 text-sm data-[readonly]:cursor-default data-[readonly]:opacity-80"
                    value={advancedBase}
                    onChange={(event) => setAdvancedBase(event.target.value)}
                  />
                  {!preset.fixedBase && (
                    <p className="text-xs opacity-70">{TEXT.SETUP_BASE_EDIT_HINT}</p>
                  )}
                </div>
              </details>
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
                  <select
                    id="setup-default-text"
                    className="min-w-0 flex-1 rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                    value={pickedTextModel || boundTextModelId || ''}
                    onChange={(event) => setPickedTextModel(event.target.value)}
                  >
                    <option value="">{TEXT.SETUP_SUCCESS_PICK}</option>
                    {catalogModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name === model.id ? model.id : `${model.name} (${model.id})`}
                      </option>
                    ))}
                  </select>
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
                  <select
                    id="setup-default-vision"
                    aria-describedby="setup-default-vision-hint"
                    className="min-w-0 flex-1 rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                    value={pickedVisionModel || boundVisionModelId || ''}
                    onChange={(event) => setPickedVisionModel(event.target.value)}
                  >
                    <option value="">{TEXT.SETUP_SUCCESS_PICK}</option>
                    {visionModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name === model.id ? model.id : `${model.name} (${model.id})`}
                      </option>
                    ))}
                  </select>
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
                <p id="setup-default-vision-hint" className="text-xs opacity-70">{TEXT.SETUP_DEFAULTS_HINT}</p>
                {boundTextModelId && <p className="text-sm opacity-80">{interpolate(TEXT.SETUP_SUCCESS_ASSIGNED, { model: boundTextModelId })}</p>}
                {boundVisionModelId && <p className="text-sm opacity-80">{interpolate(TEXT.SETUP_SUCCESS_ASSIGNED_VISION, { model: boundVisionModelId })}</p>}
              </div>
            </div>
          )}

          {phase === 'error' && result && (
            <div role="alert" className="space-y-2">
              <p className="text-sm">{errorCopy()}</p>
              {result.suspectedVendor && (
                <div className="flex items-center gap-2">
                  <span className="text-sm opacity-80">{interpolate(TEXT.SETUP_SUSPECTED_PREFIX, { vendor: vendorLabel(result.suspectedVendor) })}</span>
                  <Button variant="outline" size="sm" onClick={() => openForm(result.suspectedVendor as ProviderPresetKey, apiKey)}>
                    {interpolate(TEXT.SETUP_SUSPECTED_SWITCH, { vendor: vendorLabel(result.suspectedVendor) })}
                  </Button>
                </div>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter className="flex justify-end gap-2">
          {phase === 'tiles' && (
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{TEXT.CLOSE_BUTTON}</Button>
          )}
          {phase === 'form' && selectedKey && (
            <>
              <Button variant="outline" size="sm" onClick={() => setPhase('tiles')}>{TEXT.SETUP_BACK_TILES}</Button>
              {baseEdited() ? (
                <Button size="sm" onClick={saveViaManualForm}>{TEXT.API_SAVE_PROVIDER}</Button>
              ) : (
                <Button size="sm" disabled={checking} loading={checking} onClick={() => void submit()}>
                  {PROVIDER_SETUP_PRESETS[selectedKey].local ? TEXT.SETUP_OLLAMA_CONNECT : TEXT.SETUP_SUBMIT}
                </Button>
              )}
            </>
          )}
          {phase === 'success' && (
            <Button size="sm" onClick={() => onOpenChange(false)}>{TEXT.SETUP_SUCCESS_DONE}</Button>
          )}
          {phase === 'error' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setPhase('tiles')}>{TEXT.SETUP_BACK_TILES}</Button>
              <Button variant="outline" size="sm" disabled={checking} onClick={() => void submit()}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden />
                {TEXT.SETUP_RETRY}
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
