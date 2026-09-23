import { useCallback, useEffect, useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { SegmentedTabs } from '@neuronection/assistant-ui/segmented-tabs';
import { CheckCircle2, Download, ExternalLink, Pencil, Plus, Sparkles, Trash2, XCircle } from 'lucide-react';
import {
  DECISION_ENGINE_NAMES,
  DECISION_RULES_MAX,
  DECISION_RULE_TEXT_MAX,
  isValidHttpUrl,
  type DecisionEngineSetting,
  type DecisionRouteTool,
  type DecisionRule,
  type DecisionRuleAction,
  type DecisionRuleSpeakTarget,
  type DecisionSettings,
  type DecisionSettingsState,
  type DecisionTestRun,
  type EngineReadiness,
  type JevEndpoint,
} from '@shared/ai/decisions';
import {
  DECISION_ACT_THRESHOLD_DEFAULT,
  DECISION_CONFIRM_THRESHOLD_DEFAULT,
  DECISION_PROMPT_MAX_CHARS,
  DECISION_ROUTE_TOOL_NAME_PATTERN,
  NEEDLE_MODEL_PAGE_URL,
  mergeDecisionSettings,
} from '@shared/ai/decisions';
import type { AppConfig } from '@shared/config/AppConfig';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { fastPathEligible } from '@shared/app-presets';
import { TEXT, interpolate } from '@shared/constants/text';
import { Label, SelectField } from './fields';
import { Combobox } from '@neuronection/assistant-ui/combobox';
import { Switch } from '../tools/shared';

const ENGINE_OPTIONS: { value: DecisionEngineSetting; label: string; hint: string }[] = [
  { value: 'off', label: TEXT.DECISION_ENGINE_OFF, hint: TEXT.DECISION_ENGINE_OFF_HINT },
  { value: 'llm', label: TEXT.DECISION_ENGINE_LLM, hint: TEXT.DECISION_ENGINE_LLM_HINT },
  { value: 'needle', label: TEXT.DECISION_ENGINE_NEEDLE, hint: TEXT.DECISION_ENGINE_NEEDLE_HINT },
  { value: 'jev', label: TEXT.DECISION_ENGINE_JEV, hint: TEXT.DECISION_ENGINE_JEV_HINT },
];

const JEV_ENDPOINT_OPTIONS: { value: JevEndpoint; label: string }[] = [
  { value: 'openrouter', label: TEXT.DECISION_JEV_ENDPOINT_OPENROUTER },
  { value: 'typesafe', label: TEXT.DECISION_JEV_ENDPOINT_TYPESAFE },
  { value: 'custom', label: TEXT.DECISION_JEV_ENDPOINT_CUSTOM },
];

const THRESHOLD_PRESETS = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];

function thresholdOptions(current: number): { value: number; label: string }[] {
  const values = [...new Set([...THRESHOLD_PRESETS, current])].sort((a, b) => a - b);
  return values.map((value) => ({ value, label: `${Math.round(value * 100)}%` }));
}

function bandLabel(band: 'act' | 'confirm' | 'refuse'): string {
  if (band === 'act') {
    return TEXT.DECISION_TEST_BAND_ACT;
  }
  if (band === 'confirm') {
    return TEXT.DECISION_TEST_BAND_CONFIRM;
  }
  return TEXT.DECISION_TEST_BAND_REFUSE;
}

function readinessText(readiness: EngineReadiness): string {
  if (readiness.state === 'ready') {
    return TEXT.DECISION_ENGINE_STATUS_READY;
  }
  if (readiness.state === 'needs-key') {
    return TEXT.DECISION_ENGINE_STATUS_NEEDS_KEY;
  }
  if (readiness.state === 'needs-download') {
    return TEXT.DECISION_ENGINE_STATUS_NEEDS_DOWNLOAD;
  }
  return interpolate(TEXT.DECISION_ENGINE_STATUS_UNAVAILABLE, { reason: readiness.reason });
}

interface ScopeAppRow {
  id: string;
  name: string;
  enabled: boolean;
  presetId?: string;
}

interface ModelOption {
  id: string;
  label: string;
}

function modelOptions(config: AppConfig | null): ModelOption[] {
  if (!config) {
    return [];
  }
  return (config.providers ?? []).flatMap((provider) =>
    [...(provider.availableModels ?? []), ...(provider.customModels ?? [])].map((model) => ({
      id: model.id,
      label: `${model.name} (${provider.name})`,
    }))
  );
}

interface RouteFormState {
  name: string;
  description: string;
  modelId: string;
  examples: string;
}

const EMPTY_ROUTE_FORM: RouteFormState = { name: '', description: '', modelId: '', examples: '' };

const RULE_ACTION_OPTIONS: { value: DecisionRuleAction; label: string }[] = [
  { value: 'dispatch', label: TEXT.DECISION_RULE_ACTION_DISPATCH },
  { value: 'route', label: TEXT.DECISION_RULE_ACTION_ROUTE },
  { value: 'notify', label: TEXT.DECISION_RULE_ACTION_NOTIFY },
  { value: 'speak', label: TEXT.DECISION_RULE_ACTION_SPEAK },
  { value: 'tag', label: TEXT.DECISION_RULE_ACTION_TAG },
];

type DecisionSectionId = 'engine' | 'scope' | 'routing' | 'rules';

const DECISION_SECTIONS: { id: DecisionSectionId; label: string }[] = [
  { id: 'engine', label: TEXT.DECISION_TAB_ENGINE },
  { id: 'scope', label: TEXT.DECISION_TAB_SCOPE },
  { id: 'routing', label: TEXT.DECISION_TAB_ROUTING },
  { id: 'rules', label: TEXT.DECISION_TAB_RULES },
];

export function DecisionSection(): JSX.Element {
  const [section, setSection] = useState<DecisionSectionId>('engine');
  const [settings, setSettings] = useState<DecisionSettings>(DEFAULT_CONFIG.decision);
  const [state, setState] = useState<DecisionSettingsState | null>(null);
  const [voice, setVoice] = useState<AppConfig['voice'] | null>(null);
  const [apps, setApps] = useState<ScopeAppRow[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [testInput, setTestInput] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<DecisionTestRun | null>(null);
  const [routeForm, setRouteForm] = useState<RouteFormState | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [keyDraft, setKeyDraft] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    const emptyApps = { apps: [] as never[], deferredSupported: false, nativeToolCount: 0 };
    const [config, decisionState, appRows] = await Promise.all([
      window.electronAPI.loadConfig(),
      window.electronAPI.getDecisionState(),
      Promise.resolve()
        .then(() => window.electronAPI.getToolApps())
        .catch(() => emptyApps),
    ]);
    const decision = mergeDecisionSettings(config.decision);
    setSettings(decision);
    setVoice(config.voice);
    setPromptDraft(decision.prompt);
    setModels(modelOptions(config));
    setState(decisionState);
    setApps(
      appRows.apps.map((view) => ({
        id: view.app.id,
        name: view.app.name,
        enabled: view.app.enabled,
        ...(view.app.presetId ? { presetId: view.app.presetId } : {}),
      }))
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!state?.needle.downloading) {
      return;
    }
    const timer = setInterval(() => {
      void refresh();
    }, 500);
    return () => clearInterval(timer);
  }, [state?.needle.downloading, refresh]);

  const persist = useCallback((next: DecisionSettings): void => {
    setSettings(next);
    void window.electronAPI.saveConfig({ decision: next });
  }, []);

  const selectedEngine = ENGINE_OPTIONS.find((option) => option.value === settings.engine) ?? ENGINE_OPTIONS[0];

  const startDownload = async (): Promise<void> => {
    setDownloadError(null);
    const result = await window.electronAPI.downloadDecisionWeights();
    if (!result.ok) {
      setDownloadError(result.error ?? 'download failed');
    }
    await refresh();
  };

  const saveKey = async (): Promise<void> => {
    const key = keyDraft.trim();
    if (!key) {
      return;
    }
    await window.electronAPI.setDecisionKey(key);
    setKeyDraft('');
    await refresh();
  };

  const clearKey = async (): Promise<void> => {
    await window.electronAPI.clearDecisionKey();
    await refresh();
  };

  const runTest = async (): Promise<void> => {
    const input = testInput.trim();
    if (!input) {
      return;
    }
    setTestRunning(true);
    try {
      setTestResult(await window.electronAPI.testDecision(input));
    } finally {
      setTestRunning(false);
    }
  };

  const persistScopeApps = (appId: string, checked: boolean): void => {
    const nextApps = checked ? [...settings.scope.apps, appId] : settings.scope.apps.filter((id) => id !== appId);
    persist({ ...settings, scope: { ...settings.scope, apps: nextApps } });
  };

  const persistIncludeNatives = (checked: boolean): void => {
    persist({ ...settings, scope: { ...settings.scope, includeNatives: checked } });
  };

  const persistPrompt = (): void => {
    if (promptDraft.trim() === settings.prompt) {
      return;
    }
    persist({ ...settings, prompt: promptDraft.trim().slice(0, DECISION_PROMPT_MAX_CHARS) });
  };

  const openRouteForm = (tool?: DecisionRouteTool): void => {
    setRouteError(null);
    setRouteForm(
      tool
        ? { name: tool.name, description: tool.description, modelId: tool.modelId, examples: (tool.examples ?? []).join('\n') }
        : EMPTY_ROUTE_FORM
    );
  };

  const saveRouteForm = (): void => {
    if (!routeForm) {
      return;
    }
    const name = routeForm.name.trim();
    const description = routeForm.description.trim();
    const modelId = routeForm.modelId.trim();
    const isEditing = settings.routeTools.some((tool) => tool.name === name);
    if (
      !DECISION_ROUTE_TOOL_NAME_PATTERN.test(name) ||
      (!isEditing && settings.routeTools.some((tool) => tool.name === name))
    ) {
      setRouteError(TEXT.DECISION_ROUTE_NAME_INVALID);
      return;
    }
    if (!description || !modelId) {
      setRouteError(TEXT.DECISION_ROUTE_NAME_INVALID);
      return;
    }
    const examples = routeForm.examples
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6);
    const routeTools = isEditing
      ? settings.routeTools.map((tool) => (tool.name === name ? { name, description, modelId, examples } : tool))
      : [...settings.routeTools, { name, description, modelId, examples }];
    setRouteForm(null);
    setRouteError(null);
    persist({ ...settings, routeTools });
  };

  const removeRouteTool = (name: string): void => {
    persist({ ...settings, routeTools: settings.routeTools.filter((tool) => tool.name !== name) });
  };

  const addRule = (): void => {
    const id = `rule_${Date.now().toString(36)}`;
    persist({
      ...settings,
      rules: [...settings.rules, { id, enabled: true, matchTool: '', action: 'dispatch' }],
    });
  };

  const updateRule = (id: string, patch: Partial<DecisionRule>): void => {
    persist({ ...settings, rules: settings.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) });
  };

  const removeRule = (id: string): void => {
    persist({ ...settings, rules: settings.rules.filter((rule) => rule.id !== id) });
  };

  const needle = state?.needle;
  const selectedStatus = state?.engines?.find((engine) => engine.kind === settings.engine);
  const jevKeyLabel =
    settings.jev.endpoint === 'openrouter'
      ? TEXT.DECISION_JEV_KEY_LABEL_OPENROUTER
      : settings.jev.endpoint === 'typesafe'
        ? TEXT.DECISION_JEV_KEY_LABEL_TYPESAFE
        : TEXT.DECISION_JEV_KEY_LABEL;
  const jevKeyPlaceholder =
    settings.jev.endpoint === 'openrouter'
      ? TEXT.DECISION_JEV_KEY_PLACEHOLDER_OPENROUTER
      : TEXT.DECISION_JEV_KEY_PLACEHOLDER_DEFAULT;
  const scopeIdle = settings.scope.apps.length === 0 && !settings.scope.includeNatives;
  const modelNameOf = (modelId: string): string => models.find((model) => model.id === modelId)?.label ?? modelId;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="h-4 w-4" aria-hidden />
        {TEXT.DECISION_TITLE}
      </div>
      <p className="text-xs opacity-50">{TEXT.DECISION_HINT}</p>

      <SegmentedTabs
        ariaLabel={TEXT.DECISION_TABS_ARIA}
        items={DECISION_SECTIONS.map((entry) => ({ value: entry.id, label: entry.label }))}
        value={section}
        onValueChange={(next) => setSection(next as DecisionSectionId)}
      />

      {section === 'engine' && (
        <div role="tabpanel" aria-label={TEXT.DECISION_TAB_ENGINE} className="space-y-3">
      <div className="space-y-2 rounded-lg border border-[var(--as-border)] p-2">
        <SelectField
          id="decision-engine"
          label={TEXT.DECISION_ENGINE_LABEL}
          ariaLabel={TEXT.DECISION_ENGINE_ARIA}
          options={ENGINE_OPTIONS}
          value={settings.engine}
          onChange={(value) => persist({ ...settings, engine: value as DecisionEngineSetting })}
        />
        <p className="text-xs opacity-50">{selectedEngine.hint}</p>
        {settings.engine !== 'off' && selectedStatus && (
          <p className="text-xs opacity-50">{readinessText(selectedStatus.readiness)}</p>
        )}

        {settings.engine !== 'off' && (
          <div className="grid grid-cols-2 gap-2 border-t border-[var(--as-border)] pt-2">
            <SelectField
              id="decision-act-threshold"
              label={TEXT.DECISION_ACT_THRESHOLD_LABEL}
              options={thresholdOptions(settings.actThreshold || DECISION_ACT_THRESHOLD_DEFAULT).map((option) => ({
                value: String(option.value),
                label: option.label,
              }))}
              value={String(settings.actThreshold)}
              onChange={(value) => persist({ ...settings, actThreshold: Number(value) })}
            />
            <SelectField
              id="decision-confirm-threshold"
              label={TEXT.DECISION_CONFIRM_THRESHOLD_LABEL}
              options={thresholdOptions(settings.confirmThreshold || DECISION_CONFIRM_THRESHOLD_DEFAULT).map((option) => ({
                value: String(option.value),
                label: option.label,
              }))}
              value={String(settings.confirmThreshold)}
              onChange={(value) => persist({ ...settings, confirmThreshold: Number(value) })}
            />
            <p className="col-span-2 text-xs opacity-50">{TEXT.DECISION_THRESHOLDS_HINT}</p>
          </div>
        )}

        {settings.engine === 'jev' && (
          <div className="space-y-1.5 border-t border-[var(--as-border)] pt-2">
            <Label htmlFor="decision-jev-key">{jevKeyLabel}</Label>
            <input
              id="decision-jev-key"
              type="password"
              aria-label={jevKeyLabel}
              className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
              placeholder={jevKeyPlaceholder}
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
            />
            <p className="text-xs opacity-50">{TEXT.DECISION_JEV_KEY_HINT}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={!keyDraft.trim()} onClick={() => void saveKey()}>
                {TEXT.DECISION_JEV_KEY_SAVE}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void clearKey()}>
                {TEXT.DECISION_JEV_KEY_CLEAR}
              </Button>
            </div>
            <SelectField
              id="decision-jev-endpoint"
              label={TEXT.DECISION_JEV_ENDPOINT_LABEL}
              options={JEV_ENDPOINT_OPTIONS}
              value={settings.jev.endpoint}
              onChange={(value) => persist({ ...settings, jev: { ...settings.jev, endpoint: value as JevEndpoint } })}
            />
            {settings.jev.endpoint === 'custom' && (
              <>
                <input
                  type="text"
                  aria-label={TEXT.DECISION_JEV_BASE_URL_LABEL}
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                  placeholder={TEXT.DECISION_JEV_BASE_URL_PLACEHOLDER}
                  value={settings.jev.baseUrl}
                  onChange={(event) =>
                    persist({ ...settings, jev: { ...settings.jev, baseUrl: event.target.value } })
                  }
                />
                {!settings.jev.baseUrl.trim() || isValidHttpUrl(settings.jev.baseUrl) ? (
                  <p className="text-xs opacity-50">{TEXT.DECISION_JEV_BASE_URL_HINT}</p>
                ) : (
                  <p className="text-xs text-red-500">{TEXT.DECISION_JEV_BASE_URL_INVALID}</p>
                )}
              </>
            )}
          </div>
        )}

        {settings.engine === 'needle' && needle && (
          <div className="space-y-1.5 border-t border-[var(--as-border)] pt-2">
            {needle.downloading ? (
              <>
                <p className="text-sm">
                  {interpolate(TEXT.DECISION_DOWNLOAD_INPROGRESS, {
                    percent: needle.totalBytes > 0 ? Math.floor((needle.receivedBytes / needle.totalBytes) * 100) : 0,
                  })}
                </p>
                <Button variant="outline" size="sm" onClick={() => void window.electronAPI.cancelDecisionDownload()}>
                  {TEXT.DECISION_DOWNLOAD_CANCEL}
                </Button>
              </>
            ) : needle.weightsPresent ? (
              <p className="flex items-center gap-1.5 text-sm">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {TEXT.DECISION_WEIGHTS_PRESENT}
              </p>
            ) : (
              <>
                <p className="flex items-center gap-1.5 text-sm">
                  <XCircle className="h-4 w-4" aria-hidden />
                  {TEXT.DECISION_WEIGHTS_MISSING}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={TEXT.DECISION_DOWNLOAD_ARIA}
                  disabled={!needle.runtimePresent}
                  onClick={() => void startDownload()}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  {TEXT.DECISION_DOWNLOAD}
                </Button>
              </>
            )}
            {downloadError && (
              <p className="text-xs text-red-500">{interpolate(TEXT.DECISION_DOWNLOAD_ERROR, { error: downloadError })}</p>
            )}
            <button
              type="button"
              className="flex w-fit items-center gap-1 text-xs font-medium text-[var(--as-primary)] underline underline-offset-2 transition-opacity hover:opacity-80"
              aria-label={TEXT.DECISION_NEEDLE_CREDIT_ARIA}
              onClick={() => void window.electronAPI.openExternal(NEEDLE_MODEL_PAGE_URL)}
            >
              {TEXT.DECISION_NEEDLE_CREDIT}
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </button>
          </div>
        )}
      </div>

      {settings.engine !== 'off' && voice && (voice.autoSend || voice.speakOnRequest !== false) && (
        <div className="space-y-2 rounded-lg border border-[var(--as-border)] p-2">
          <p className="text-sm font-medium">{TEXT.DECISION_USED_BY_TITLE}</p>
          <p className="text-xs opacity-50">{TEXT.DECISION_USED_BY_HINT}</p>

          {voice.autoSend && (
            <div className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p>{TEXT.DECISION_USED_BY_AUTO_SEND}</p>
                <p className="text-xs opacity-50">{TEXT.DECISION_USED_BY_AUTO_SEND_DETAIL}</p>
              </div>
              <span className="shrink-0 text-right text-xs opacity-70">
                {voice.autoSendEngine === 'task'
                  ? TEXT.DECISION_USED_BY_ASSIGNED
                  : interpolate(TEXT.DECISION_USED_BY_USING, { engine: DECISION_ENGINE_NAMES[settings.engine] })}
              </span>
            </div>
          )}

          {voice.speakOnRequest !== false && (
            <div className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p>{TEXT.DECISION_USED_BY_SPEAK}</p>
                <p className="text-xs opacity-50">{TEXT.DECISION_USED_BY_SPEAK_DETAIL}</p>
              </div>
              <span className="shrink-0 text-right text-xs opacity-70">
                {interpolate(TEXT.DECISION_USED_BY_USING, { engine: DECISION_ENGINE_NAMES[settings.engine] })}
              </span>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => void window.electronAPI.onSettingsOpen({ tab: 'voice' })}
          >
            {TEXT.DECISION_USED_BY_MANAGE}
          </Button>
        </div>
      )}

      {settings.engine !== 'off' && (
        <div className="space-y-1.5 rounded-lg border border-[var(--as-border)] p-2">
          <p className="text-sm font-medium">{TEXT.DECISION_TEST_TITLE}</p>
          <p className="text-xs opacity-50">{TEXT.DECISION_TEST_HINT}</p>
          <div className="flex gap-2">
            <input
              aria-label={TEXT.DECISION_TEST_ARIA}
              placeholder={TEXT.DECISION_TEST_PLACEHOLDER}
              className="min-w-0 flex-1 rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
            />
            <Button size="sm" disabled={testRunning || !testInput.trim()} onClick={() => void runTest()}>
              {testRunning ? TEXT.DECISION_TEST_RUNNING : TEXT.DECISION_TEST_RUN}
            </Button>
          </div>
          {testResult && (
            <div className="space-y-1 text-xs">
              {testResult.result.status === 'decided' ? (
                <>
                  <p className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] font-normal uppercase">
                      {DECISION_ENGINE_NAMES[testResult.result.engine]}
                    </Badge>
                    {interpolate(TEXT.DECISION_TEST_RESULT, {
                      confidence: Math.round(testResult.result.confidence * 100),
                      band: bandLabel(testResult.result.band),
                    })}
                  </p>
                  {testResult.result.calls.length > 0 ? (
                    <p className="font-mono opacity-70">
                      {interpolate(TEXT.DECISION_TEST_CALLS, {
                        tools: testResult.result.calls.map((call) => call.tool).join(', '),
                      })}
                    </p>
                  ) : (
                    <p className="opacity-70">{TEXT.DECISION_TEST_NO_CALLS}</p>
                  )}
                  <p className="opacity-50">{testResult.durationMs} ms</p>
                </>
              ) : testResult.result.status === 'off' ? (
                <p className="opacity-70">{TEXT.DECISION_TEST_OFF}</p>
              ) : (
                <p className="text-red-500">
                  {interpolate(TEXT.DECISION_TEST_ERROR, { error: 'reason' in testResult.result ? testResult.result.reason : '' })}
                </p>
              )}
            </div>
          )}
        </div>
      )}

          {settings.engine !== 'off' && (
            <div className="space-y-1">
              <Label htmlFor="decision-prompt">{TEXT.DECISION_PROMPT_LABEL}</Label>
              <textarea
                id="decision-prompt"
                aria-label={TEXT.DECISION_PROMPT_ARIA}
                rows={3}
                maxLength={DECISION_PROMPT_MAX_CHARS}
                className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                onBlur={persistPrompt}
              />
              <p className="text-xs opacity-50">{TEXT.DECISION_PROMPT_HINT}</p>
            </div>
          )}
        </div>
      )}

      {section === 'scope' && (
        <div role="tabpanel" aria-label={TEXT.DECISION_TAB_SCOPE} className="space-y-3">
      {settings.engine === 'off' && (
        <p className="text-xs opacity-50">{TEXT.DECISION_SECTION_NEEDS_ENGINE}</p>
      )}
      {settings.engine !== 'off' && (
        <div className="space-y-1.5 rounded-lg border border-[var(--as-border)] p-2">
          <p className="text-sm font-medium">{TEXT.DECISION_SCOPE_TITLE}</p>

          <div className="space-y-1">
            <Label htmlFor="decision-scope-natives">{TEXT.DECISION_SCOPE_NATIVES_LABEL}</Label>
            <Switch
              checked={settings.scope.includeNatives}
              onCheckedChange={persistIncludeNatives}
              label={TEXT.DECISION_SCOPE_NATIVES_LABEL}
            />
            <p className="text-xs opacity-50">{TEXT.DECISION_SCOPE_NATIVES_HINT}</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="decision-scope-apps">{TEXT.DECISION_SCOPE_APPS_LABEL}</Label>
            {apps.length === 0 ? (
              <p className="text-xs opacity-50">{TEXT.DECISION_SCOPE_NO_APPS}</p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--as-border)] p-2">
                {apps.map((app) => {
                  const eligible = fastPathEligible(app.presetId);
                  return (
                    <label key={app.id} className={`flex items-center gap-2 text-sm${eligible ? '' : ' opacity-50'}`}>
                      <input
                        type="checkbox"
                        aria-label={`${TEXT.DECISION_SCOPE_APPS_LABEL}: ${app.name}`}
                        checked={eligible && settings.scope.apps.includes(app.id)}
                        disabled={!eligible}
                        onChange={(e) => persistScopeApps(app.id, e.target.checked)}
                      />
                      <span className={app.enabled ? '' : 'opacity-50'}>{app.name}</span>
                      {!eligible && (
                        <span className="text-xs opacity-50" title={TEXT.DECISION_SCOPE_INELIGIBLE_HINT}>
                          {TEXT.DECISION_SCOPE_INELIGIBLE}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            <p className="text-xs opacity-50">{TEXT.DECISION_SCOPE_APPS_HINT}</p>
            {scopeIdle && <p className="text-xs text-amber-500">{TEXT.DECISION_SCOPE_IDLE_HINT}</p>}
          </div>
        </div>
      )}
        </div>
      )}

      {section === 'routing' && (
        <div role="tabpanel" aria-label={TEXT.DECISION_TAB_ROUTING} className="space-y-3">
      {settings.engine === 'off' && (
        <p className="text-xs opacity-50">{TEXT.DECISION_SECTION_NEEDS_ENGINE}</p>
      )}
      {settings.engine !== 'off' && (
        <div className="space-y-1.5 rounded-lg border border-[var(--as-border)] p-2">
          <p className="text-sm font-medium">{TEXT.DECISION_ROUTE_TITLE}</p>
          <p className="text-xs opacity-50">{TEXT.DECISION_ROUTE_HINT}</p>

          {settings.routeTools.length === 0 && !routeForm && (
            <p className="text-xs opacity-50">{TEXT.DECISION_ROUTE_EMPTY}</p>
          )}
          {settings.routeTools.map((tool) => (
            <div key={tool.name} className="flex items-center justify-between gap-2 rounded-md border border-[var(--as-border)] p-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs">{tool.name}</p>
                <p className="truncate text-xs opacity-50">{modelNameOf(tool.modelId)}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="outline" size="sm" aria-label={`${TEXT.DECISION_ROUTE_EDIT}: ${tool.name}`} onClick={() => openRouteForm(tool)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button variant="outline" size="sm" aria-label={`${TEXT.DECISION_ROUTE_REMOVE}: ${tool.name}`} onClick={() => removeRouteTool(tool.name)}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </div>
          ))}

          {routeForm ? (
            <div className="space-y-2 rounded-md border border-[var(--as-border)] p-2">
              <div className="space-y-1">
                <Label htmlFor="decision-route-name">{TEXT.DECISION_ROUTE_NAME_LABEL}</Label>
                <input
                  id="decision-route-name"
                  aria-label={TEXT.DECISION_ROUTE_NAME_ARIA}
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 font-mono text-sm"
                  value={routeForm.name}
                  onChange={(e) => setRouteForm({ ...routeForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="decision-route-description">{TEXT.DECISION_ROUTE_DESCRIPTION_LABEL}</Label>
                <input
                  id="decision-route-description"
                  aria-label={TEXT.DECISION_ROUTE_DESCRIPTION_ARIA}
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                  value={routeForm.description}
                  onChange={(e) => setRouteForm({ ...routeForm, description: e.target.value })}
                />
              </div>
              <SelectField
                id="decision-route-model"
                label={TEXT.DECISION_ROUTE_MODEL_LABEL}
                ariaLabel={TEXT.DECISION_ROUTE_MODEL_ARIA}
                options={[{ value: '', label: '—' }, ...models.map((model) => ({ value: model.id, label: model.label }))]}
                value={routeForm.modelId}
                onChange={(value) => setRouteForm({ ...routeForm, modelId: value })}
              />
              <div className="space-y-1">
                <Label htmlFor="decision-route-examples">{TEXT.DECISION_ROUTE_EXAMPLES_LABEL}</Label>
                <textarea
                  id="decision-route-examples"
                  aria-label={TEXT.DECISION_ROUTE_EXAMPLES_ARIA}
                  rows={3}
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                  value={routeForm.examples}
                  onChange={(e) => setRouteForm({ ...routeForm, examples: e.target.value })}
                />
                <p className="text-xs opacity-50">{TEXT.DECISION_ROUTE_EXAMPLES_HINT}</p>
              </div>
              {routeError && <p className="text-xs text-red-500">{routeError}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={saveRouteForm}>
                  {TEXT.DECISION_ROUTE_SAVE}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRouteForm(null)}>
                  {TEXT.DECISION_ROUTE_CANCEL}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => openRouteForm()}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {TEXT.DECISION_ROUTE_ADD}
            </Button>
          )}
        </div>
      )}
        </div>
      )}

      {section === 'rules' && (
        <div role="tabpanel" aria-label={TEXT.DECISION_TAB_RULES} className="space-y-3">
      {settings.engine === 'off' && (
        <p className="text-xs opacity-50">{TEXT.DECISION_SECTION_NEEDS_ENGINE}</p>
      )}
      {settings.engine !== 'off' && (
        <div className="space-y-2 rounded-lg border border-[var(--as-border)] p-2">
          <p className="text-sm font-medium">{TEXT.DECISION_RULES_TITLE}</p>
          <p className="text-xs opacity-50">{TEXT.DECISION_RULES_HINT}</p>

          {settings.rules.length === 0 && <p className="text-xs opacity-50">{TEXT.DECISION_RULES_EMPTY}</p>}

          {settings.rules.map((rule) => (
            <div key={rule.id} className="space-y-1.5 rounded-md border border-[var(--as-border)] p-2">
              <div className="flex items-center justify-between gap-2">
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={(enabled) => updateRule(rule.id, { enabled })}
                  label={`${TEXT.DECISION_RULES_TITLE}: ${rule.matchTool || rule.id}`}
                />
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`${TEXT.DECISION_RULE_REMOVE}: ${rule.matchTool || rule.id}`}
                  onClick={() => removeRule(rule.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`decision-rule-match-${rule.id}`}>
                  {TEXT.DECISION_RULE_MATCH_LABEL}
                </Label>
                <input
                  id={`decision-rule-match-${rule.id}`}
                  aria-label={TEXT.DECISION_RULE_MATCH_ARIA}
                  className="min-w-0 flex-1 rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1 font-mono text-sm"
                  value={rule.matchTool}
                  onChange={(e) => updateRule(rule.id, { matchTool: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`decision-rule-action-${rule.id}`}>
                  {TEXT.DECISION_RULE_ACTION_LABEL}
                </Label>
                <Combobox
                  id={`decision-rule-action-${rule.id}`}
                  hideLabel
                  label={TEXT.DECISION_RULE_ACTION_ARIA}
                  className="min-w-0 flex-1"
                  options={RULE_ACTION_OPTIONS}
                  value={rule.action}
                  onChange={(value) => updateRule(rule.id, { action: value as DecisionRuleAction })}
                />
              </div>
              {rule.action === 'route' && (
                <Combobox
                  hideLabel
                  label={TEXT.DECISION_RULE_MODEL_ARIA}
                  options={[{ value: '', label: '—' }, ...models.map((model) => ({ value: model.id, label: model.label }))]}
                  value={rule.modelId ?? ''}
                  onChange={(value) => updateRule(rule.id, { modelId: value })}
                />
              )}
              {rule.action === 'speak' && (
                <Combobox
                  hideLabel
                  label={TEXT.DECISION_RULE_SPEAK_TARGET_ARIA}
                  options={[
                    { value: 'reply', label: TEXT.DECISION_RULE_SPEAK_REPLY },
                    { value: 'text', label: TEXT.DECISION_RULE_SPEAK_TEXT },
                  ]}
                  value={rule.speakTarget ?? 'reply'}
                  onChange={(value) => updateRule(rule.id, { speakTarget: value as DecisionRuleSpeakTarget })}
                />
              )}
              {(rule.action === 'notify' || rule.action === 'tag' || (rule.action === 'speak' && rule.speakTarget === 'text')) && (
                <input
                  aria-label={TEXT.DECISION_RULE_TEXT_ARIA}
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1 text-sm"
                  placeholder={TEXT.DECISION_RULE_TEXT_LABEL}
                  maxLength={DECISION_RULE_TEXT_MAX}
                  value={rule.text ?? ''}
                  onChange={(e) => updateRule(rule.id, { text: e.target.value })}
                />
              )}
            </div>
          ))}

          <Button variant="outline" size="sm" disabled={settings.rules.length >= DECISION_RULES_MAX} onClick={addRule}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {TEXT.DECISION_RULE_ADD}
          </Button>
        </div>
      )}
        </div>
      )}
    </section>
  );
}
