import { useCallback, useEffect, useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { CheckCircle2, Download, Sparkles, XCircle } from 'lucide-react';
import type { DecisionEngineKind, DecisionSettings, DecisionSettingsState, DecisionTestRun } from '@shared/ai/decisions';
import { DECISION_ACT_THRESHOLD_DEFAULT, DECISION_CONFIRM_THRESHOLD_DEFAULT } from '@shared/ai/decisions';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT, interpolate } from '@shared/constants/text';
import { Label } from './fields';

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

export function DecisionSection(): JSX.Element {
  const [settings, setSettings] = useState<DecisionSettings>(DEFAULT_CONFIG.decision);
  const [state, setState] = useState<DecisionSettingsState | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [testInput, setTestInput] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<DecisionTestRun | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const [config, decisionState] = await Promise.all([
      window.electronAPI.loadConfig(),
      window.electronAPI.getDecisionState(),
    ]);
    setSettings(config.decision ?? DEFAULT_CONFIG.decision);
    setState(decisionState);
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

  const needle = state?.needle;

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
    </section>
  );
}
