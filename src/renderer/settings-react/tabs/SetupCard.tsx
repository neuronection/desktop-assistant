import { useEffect, useRef, useState, type ClipboardEvent, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { Check, Copy, ExternalLink, RotateCcw } from 'lucide-react';
import { PROVIDER_PRESET_ORDER, PROVIDER_SETUP_PRESETS, guessPresetForKey, type ProviderPresetKey } from '@shared/ai/providerPresets';
import { LLMProvider, LLMProviderType, SetupProviderResult } from '@shared/types';
import { TEXT, interpolate } from '@shared/constants/text';

export interface SetupCardProps {
  onSetupComplete: () => void;
  onDismiss: () => void;
}

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

export function SetupCard({ onSetupComplete, onDismiss }: SetupCardProps): JSX.Element {
  const [phase, setPhase] = useState<SetupPhase>('tiles');
  const [selectedKey, setSelectedKey] = useState<ProviderPresetKey | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [keyReady, setKeyReady] = useState(false);
  const [ollamaDetected, setOllamaDetected] = useState(false);
  const [result, setResult] = useState<SetupProviderResult | null>(null);
  const [boundModelId, setBoundModelId] = useState<string | null>(null);
  const [pickedModel, setPickedModel] = useState('');
  const [binding, setBinding] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);
  const keyInputRef = useRef<HTMLInputElement | null>(null);

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

  const openForm = (key: ProviderPresetKey, prefillKey = ''): void => {
    setSelectedKey(key);
    setApiKey(prefillKey);
    setKeyReady(false);
    setResult(null);
    setPhase('form');
  };

  const bindModel = async (): Promise<void> => {
    if (!result?.provider || !pickedModel || binding) {
      return;
    }
    setBinding(true);
    setBindError(null);
    try {
      await window.electronAPI.setDefaultModel(result.provider.id, pickedModel);
      setBoundModelId(pickedModel);
    } catch (error) {
      setBindError(error instanceof Error ? error.message : String(error));
    } finally {
      setBinding(false);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const guess = guessPresetForKey(event.clipboardData.getData('text'));
    if (guess && guess !== selectedKey) {
      openForm(guess, event.clipboardData.getData('text').trim());
    }
  };

  const submit = async (): Promise<void> => {
    if (!selectedKey || checking) {
      return;
    }
    setChecking(true);
    try {
      const setupResult = await window.electronAPI.setupProviderFromPreset(selectedKey, apiKey);
      setResult(setupResult);
      if (setupResult.ok) {
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

  const vendorLabel = (key: string): string => {
    const preset = PROVIDER_SETUP_PRESETS[key as ProviderPresetKey];
    return preset ? preset.label : key;
  };

  const errorCopy = (): string => {
    if (!result) {
      return '';
    }
    if (result.errorCode === 'unknown' || !result.errorCode) {
      return interpolate(TEXT.SETUP_ERROR_UNKNOWN, { message: result.vendorMessage ?? '' });
    }
    return ERROR_COPY[result.errorCode] ?? interpolate(TEXT.SETUP_ERROR_UNKNOWN, { message: result.vendorMessage ?? '' });
  };

  return (
    <section
      data-setup-card
      aria-labelledby="setup-card-title"
      onPaste={handlePaste}
      className="space-y-3 rounded-md border border-[var(--as-border)] p-4"
    >
      <div className="space-y-1">
        <h3 id="setup-card-title" className="text-base font-semibold">{TEXT.SETUP_CARD_TITLE}</h3>
        <p className="text-sm opacity-60">{TEXT.SETUP_CARD_SUBTITLE}</p>
      </div>

      {ollamaDetected && phase === 'tiles' && (
        <div role="status" className="flex items-center justify-between gap-2 rounded-md border border-[var(--as-border)] bg-[var(--as-muted)] px-3 py-2">
          <span className="text-sm">{TEXT.SETUP_OLLAMA_DETECTED}</span>
          <Button size="sm" variant="outline" onClick={() => openForm('ollama')}>{TEXT.SETUP_OLLAMA_CONNECT}</Button>
        </div>
      )}

      {phase === 'tiles' && (
        <div role="group" aria-label={TEXT.SETUP_TILES_ARIA} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PROVIDER_PRESET_ORDER.map((key) => (
            <Button key={key} variant="outline" size="sm" aria-pressed={selectedKey === key} onClick={() => openForm(key)}>
              {PROVIDER_SETUP_PRESETS[key].label}
            </Button>
          ))}
        </div>
      )}

      {phase === 'form' && selectedKey && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">{PROVIDER_SETUP_PRESETS[selectedKey].label}</h4>
            <Button variant="ghost" size="sm" onClick={() => setPhase('tiles')}>{TEXT.SETUP_BACK_TILES}</Button>
          </div>

          <ol aria-label={TEXT.SETUP_CHECKLIST_ARIA} className="list-inside list-decimal space-y-1 text-sm opacity-80">
            {SETUP_STEPS[selectedKey].map((step, index) => (
              <li key={index} className="flex items-start justify-between gap-2">
                <span>{interpolate(step, { url: PROVIDER_SETUP_PRESETS[selectedKey].keyUrl ?? '' })}</span>
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

          {PROVIDER_SETUP_PRESETS[selectedKey].keyUrl && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setKeyReady(true);
                  void window.electronAPI.openExternal(PROVIDER_SETUP_PRESETS[selectedKey].keyUrl!);
                }}
              >
                <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                {TEXT.SETUP_GET_KEY}
              </Button>
              {keyReady && !PROVIDER_SETUP_PRESETS[selectedKey].local && (
                <Button variant="ghost" size="sm" onClick={() => keyInputRef.current?.focus()}>{TEXT.SETUP_KEY_READY}</Button>
              )}
            </div>
          )}

          {FREE_TIER_HINTS[selectedKey] && (
            <p className="text-xs opacity-70">{FREE_TIER_HINTS[selectedKey]}</p>
          )}

          {PROVIDER_SETUP_PRESETS[selectedKey].local ? (
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

          {PROVIDER_SETUP_PRESETS[selectedKey].fixedBase && (
            <div className="space-y-1">
              <label htmlFor="setup-api-base" className="text-sm font-medium">{TEXT.SETUP_BASE_LABEL}</label>
              <input
                id="setup-api-base"
                type="text"
                readOnly={true}
                className="w-full cursor-default rounded-md border border-[var(--as-border)] bg-[var(--as-muted)] px-3 py-2 text-sm opacity-80"
                value={PROVIDER_SETUP_PRESETS[selectedKey].apiBase}
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" disabled={checking} loading={checking} onClick={() => void submit()}>
              {PROVIDER_SETUP_PRESETS[selectedKey].local ? TEXT.SETUP_OLLAMA_CONNECT : TEXT.SETUP_SUBMIT}
            </Button>
            {checking && <span className="text-sm opacity-60">{TEXT.SETUP_CHECKING}</span>}
          </div>
        </div>
      )}

      {phase === 'success' && result && (
        <div role="status" className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Check className="h-4 w-4" aria-hidden />
            {TEXT.SETUP_SUCCESS_TITLE}
          </p>
          <p className="text-sm opacity-80">
            {interpolate(TEXT.SETUP_SUCCESS_SUMMARY, { name: result.provider?.name ?? '', count: result.catalogCount })}
          </p>
          {result.assignedModelId || boundModelId ? (
            <p className="text-sm opacity-80">
              {interpolate(TEXT.SETUP_SUCCESS_ASSIGNED, { model: result.assignedModelId ?? boundModelId ?? '' })}
            </p>
          ) : (
            <div className="space-y-2">
              <span className="block text-sm opacity-80">{TEXT.SETUP_SUCCESS_UNASSIGNED}</span>
              {bindError && <p className="text-sm">{interpolate(TEXT.SETUP_ERROR_UNKNOWN, { message: bindError })}</p>}
              <div className="flex items-center gap-2">
                <select
                  aria-label={TEXT.SETUP_SUCCESS_PICK}
                  className="rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                  value={pickedModel}
                  onChange={(event) => setPickedModel(event.target.value)}
                >
                  <option value="">{TEXT.SETUP_SUCCESS_PICK}</option>
                  {(result.provider?.availableModels ?? []).map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name === model.id ? model.id : `${model.name} (${model.id})`}
                    </option>
                  ))}
                </select>
                <Button variant="outline" size="sm" disabled={!pickedModel || binding} loading={binding} onClick={() => void bindModel()}>
                  {TEXT.SETUP_SUCCESS_APPLY}
                </Button>
              </div>
            </div>
          )}
          <div>
            <Button variant="ghost" size="sm" onClick={onDismiss}>{TEXT.SETUP_SUCCESS_DONE}</Button>
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
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={checking} onClick={() => void submit()}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden />
              {TEXT.SETUP_RETRY}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPhase('tiles')}>{TEXT.SETUP_BACK_TILES}</Button>
          </div>
        </div>
      )}
    </section>
  );
}
