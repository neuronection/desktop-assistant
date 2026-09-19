import { useCallback, useEffect, useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { CheckCircle2, Download, Pencil, Plus, Sparkles, Trash2, XCircle } from 'lucide-react';
import type {
  DecisionEngineKind,
  DecisionRouteTool,
  DecisionSettings,
  DecisionSettingsState,
  DecisionTestRun,
} from '@shared/ai/decisions';
import {
  DECISION_ACT_THRESHOLD_DEFAULT,
  DECISION_CONFIRM_THRESHOLD_DEFAULT,
  DECISION_PROMPT_MAX_CHARS,
  DECISION_ROUTE_TOOL_NAME_PATTERN,
  mergeDecisionSettings,
} from '@shared/ai/decisions';
import type { AppConfig } from '@shared/config/AppConfig';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT, interpolate } from '@shared/constants/text';
import { Label } from './fields';
import { Switch } from '../tools/shared';

const ENGINE_OPTIONS: { value: DecisionEngineKind; label: string; hint: string }[] = [
  { value: 'off', label: TEXT.DECISION_ENGINE_OFF, hint: TEXT.DECISION_ENGINE_OFF_HINT },
  { value: 'llm', label: TEXT.DECISION_ENGINE_LLM, hint: TEXT.DECISION_ENGINE_LLM_HINT },
  { value: 'needle', label: TEXT.DECISION_ENGINE_NEEDLE, hint: TEXT.DECISION_ENGINE_NEEDLE_HINT },
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

function engineName(engine: 'llm' | 'needle'): string {
  return engine === 'needle' ? TEXT.DECISION_ENGINE_NAME_NEEDLE : TEXT.DECISION_ENGINE_NAME_LLM;
}

interface ScopeAppRow {
  id: string;
  name: string;
  enabled: boolean;
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

export function DecisionSection(): JSX.Element {
  const [settings, setSettings] = useState<DecisionSettings>(DEFAULT_CONFIG.decision);
  const [state, setState] = useState<DecisionSettingsState | null>(null);
  const [apps, setApps] = useState<ScopeAppRow[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [testInput, setTestInput] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<DecisionTestRun | null>(null);
  const [routeForm, setRouteForm] = useState<RouteFormState | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState('');

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
    setPromptDraft(decision.prompt);
    setModels(modelOptions(config));
    setState(decisionState);
    setApps(
      appRows.apps.map((view) => ({ id: view.app.id, name: view.app.name, enabled: view.app.enabled }))
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

  const needle = state?.needle;
  const scopeIdle = settings.scope.apps.length === 0 && !settings.scope.includeNatives;
  const modelNameOf = (modelId: string): string => models.find((model) => model.id === modelId)?.label ?? modelId;

  return (
    <section className="space-y-3 rounded-xl border border-[var(--as-border)] p-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="h-4 w-4" aria-hidden />
        {TEXT.DECISION_TITLE}
      </div>
      <p className="text-xs opacity-50">{TEXT.DECISION_HINT}</p>

      <div className="space-y-1">
        <Label htmlFor="decision-engine">{TEXT.DECISION_ENGINE_LABEL}</Label>
        <select
          id="decision-engine"
          aria-label={TEXT.DECISION_ENGINE_ARIA}
          className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
          value={settings.engine}
          onChange={(e) => persist({ ...settings, engine: e.target.value as DecisionEngineKind })}
        >
          {ENGINE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="text-xs opacity-50">{selectedEngine.hint}</p>
      </div>

      {settings.engine !== 'off' && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="decision-act-threshold">{TEXT.DECISION_ACT_THRESHOLD_LABEL}</Label>
            <select
              id="decision-act-threshold"
              className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
              value={settings.actThreshold}
              onChange={(e) => persist({ ...settings, actThreshold: Number(e.target.value) })}
            >
              {thresholdOptions(settings.actThreshold || DECISION_ACT_THRESHOLD_DEFAULT).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="decision-confirm-threshold">{TEXT.DECISION_CONFIRM_THRESHOLD_LABEL}</Label>
            <select
              id="decision-confirm-threshold"
              className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
              value={settings.confirmThreshold}
              onChange={(e) => persist({ ...settings, confirmThreshold: Number(e.target.value) })}
            >
              {thresholdOptions(settings.confirmThreshold || DECISION_CONFIRM_THRESHOLD_DEFAULT).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <p className="col-span-2 text-xs opacity-50">{TEXT.DECISION_THRESHOLDS_HINT}</p>
        </div>
      )}

      {settings.engine === 'needle' && needle && (
        <div className="space-y-1.5 rounded-lg border border-[var(--as-border)] p-2">
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
                      {engineName(testResult.result.engine)}
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
                {apps.map((app) => (
                  <label key={app.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label={`${TEXT.DECISION_SCOPE_APPS_LABEL}: ${app.name}`}
                      checked={settings.scope.apps.includes(app.id)}
                      onChange={(e) => persistScopeApps(app.id, e.target.checked)}
                    />
                    <span className={app.enabled ? '' : 'opacity-50'}>{app.name}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs opacity-50">{TEXT.DECISION_SCOPE_APPS_HINT}</p>
            {scopeIdle && <p className="text-xs text-amber-500">{TEXT.DECISION_SCOPE_IDLE_HINT}</p>}
          </div>
        </div>
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
              <div className="space-y-1">
                <Label htmlFor="decision-route-model">{TEXT.DECISION_ROUTE_MODEL_LABEL}</Label>
                <select
                  id="decision-route-model"
                  aria-label={TEXT.DECISION_ROUTE_MODEL_ARIA}
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                  value={routeForm.modelId}
                  onChange={(e) => setRouteForm({ ...routeForm, modelId: e.target.value })}
                >
                  <option value="">—</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>
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
    </section>
  );
}
