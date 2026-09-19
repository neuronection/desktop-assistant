import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { Card } from '@neuronection/assistant-ui/card';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { EmptyState } from '@neuronection/assistant-ui/empty-state';
import { Modal, ModalContent, ModalBody, ModalHeader, ModalTitle } from '@neuronection/assistant-ui/modal';
import { SearchInput } from '@neuronection/assistant-ui/search-input';
import { SegmentedTabs } from '@neuronection/assistant-ui/segmented-tabs';
import { Trash2 } from 'lucide-react';
import { AppIcon, IconPicker } from '../apps/app-icons';
import { AppUsageCard } from '../apps/AppUsageCard';
import { RISK_BADGE_CLASS, Switch } from '../tools/shared';
import type { EntityScopeRule, ToolAppSpec, ToolAppToolState, ToolAppView } from '@shared/apps';
import type { ToolAppPreset } from '@shared/app-presets';
import type { ToolRiskClass } from '@shared/turns';
import { TEXT, interpolate } from '@shared/constants/text';

type StatusFilter = 'all' | 'healthy' | 'unavailable' | 'error' | 'disabled';

interface ScopePreview {
  entities: { id: string; allowed: boolean }[];
}

interface ConnectionPatch {
  endpoint?: string;
  token?: string;
  allowlist?: string[];
  defaultAction?: 'allow' | 'deny';
  timeoutMs?: number;
  maxConcurrent?: number;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

const RISK_ORDER: Record<ToolRiskClass, number> = {
  'read-only': 0,
  'state-changing': 1,
  destructive: 2,
};

function healthOf(view: ToolAppView): 'healthy' | 'unavailable' | 'error' {
  if (view.status?.state === 'error') {
    return 'error';
  }
  if (view.status?.state === 'connected') {
    return 'healthy';
  }
  return 'unavailable';
}

function healthLabel(view: ToolAppView): string {
  if (!view.app.enabled) {
    return TEXT.APPS_HEALTH_DISABLED;
  }
  return healthOf(view) === 'healthy' ? TEXT.APPS_HEALTH_HEALTHY : healthOf(view) === 'error' ? TEXT.APPS_HEALTH_ERROR : TEXT.APPS_HEALTH_UNAVAILABLE;
}

function sourceChip(view: ToolAppView): string {
  return view.app.sources[0]?.kind === 'native-group' ? TEXT.APPS_SOURCE_NATIVE : TEXT.APPS_SOURCE_MCP;
}

function riskRank(risk: ToolRiskClass): number {
  return RISK_ORDER[risk];
}

function matchesToolNeedle(
  tool: ToolAppView['knownTools'][number],
  needle: string
): boolean {
  const needleLower = needle.trim().toLowerCase();
  if (!needleLower) {
    return true;
  }
  const haystack = `${tool.name} ${tool.description ?? ''} ${(tool.state?.keywordTags ?? []).join(' ')}`.toLowerCase();
  return haystack.includes(needleLower);
}

function parseJsonStringMap(text: string): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((value) => typeof value === 'string')
    ) {
      return { ok: true, value: parsed as Record<string, string> };
    }
    return { ok: false, error: 'must be a JSON object with string values' };
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
}

function parsePositiveInt(text: string): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, error: 'must be a positive whole number' };
  }
  return { ok: true, value };
}

function Monogram({ name }: { name: string }): ReactElement {
  return (
    <span
      aria-hidden
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--as-primary)]/25 to-[var(--as-primary)]/5 text-base font-semibold text-[var(--as-primary)]"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function HealthChip({ view }: { view: ToolAppView }): ReactElement {
  const dot = !view.app.enabled
    ? 'bg-[var(--as-muted-foreground)] opacity-50'
    : healthOf(view) === 'healthy'
      ? 'bg-emerald-500'
      : healthOf(view) === 'error'
        ? 'bg-[var(--as-danger)]'
        : 'bg-amber-500';
  return (
    <Badge variant="outline" className="gap-1.5 text-[10px]" title={view.status?.lastError ?? undefined}>
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      {healthLabel(view)}
    </Badge>
  );
}

export function AppsTab(): ReactElement {
  const [view, setView] = useState<'apps' | 'settings'>('apps');
  const [views, setViews] = useState<ToolAppView[]>([]);
  const [deferredSupported, setDeferredSupported] = useState(false);
  const [nativeToolCount, setNativeToolCount] = useState(0);
  const [presets, setPresets] = useState<ToolAppPreset[]>([]);
  const [toolBudget, setToolBudget] = useState(25);
  const [needle, setNeedle] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<'preset' | 'custom'>('preset');
  const [selectedPreset, setSelectedPreset] = useState<ToolAppPreset | null>(null);
  const [presetEndpoint, setPresetEndpoint] = useState('');
  const [presetToken, setPresetToken] = useState('');
  const [presetError, setPresetError] = useState<string | null>(null);
  const [customName, setCustomName] = useState('');
  const [customType, setCustomType] = useState<'http' | 'sse' | 'stdio'>('http');
  const [customUrl, setCustomUrl] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [customArgs, setCustomArgs] = useState('');
  const [customToken, setCustomToken] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const [customAllowlist, setCustomAllowlist] = useState('');
  const [customTimeout, setCustomTimeout] = useState('');
  const [customMaxConcurrent, setCustomMaxConcurrent] = useState('');
  const [customEnv, setCustomEnv] = useState('');
  const [customHeaders, setCustomHeaders] = useState('');
  const [customDirectives, setCustomDirectives] = useState('');
  const [customExposure, setCustomExposure] = useState<ToolAppSpec['exposure']>('relevance');
  const [cardTests, setCardTests] = useState<Record<string, string>>({});
  const [removeTarget, setRemoveTarget] = useState<ToolAppView | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ appId: string; toolName: string; previous: ToolAppToolState | null; timer: number } | null>(null);
  const [scopeRules, setScopeRules] = useState<EntityScopeRule[]>([]);
  const [scopePreview, setScopePreview] = useState<ScopePreview | null>(null);
  const [detailTab, setDetailTab] = useState<'connection' | 'tools' | 'scope'>('connection');
  const [toolNeedle, setToolNeedle] = useState('');

  const detail = useMemo(() => views.find((candidate) => candidate.app.id === detailId) ?? null, [views, detailId]);

  const refresh = useCallback(async () => {
    const [state, presetRows, config] = await Promise.all([
      window.electronAPI.getToolApps(),
      window.electronAPI.listToolAppPresets().catch(() => []),
      window.electronAPI.loadConfig(),
    ]);
    setViews(state.apps);
    setDeferredSupported(state.deferredSupported);
    setNativeToolCount(state.nativeToolCount ?? 0);
    setPresets(presetRows);
    setToolBudget(config.toolApps?.toolBudget ?? 25);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!detail) {
      setScopeRules([]);
      setScopePreview(null);
      setTestResult(null);
    } else {
      setScopeRules(detail.app.entityScope?.rules ?? []);
    }
    setDetailTab('connection');
    setToolNeedle('');
  }, [detail?.app.id]);

  const toggleApp = async (target: ToolAppView, enabled: boolean): Promise<void> => {
    await window.electronAPI.setToolAppEnabled(target.app.id, enabled);
    await refresh();
  };

  const setMasterEnabled = async (enabled: boolean): Promise<void> => {
    await window.electronAPI.setToolAppEnabled(null, enabled);
    await refresh();
  };

  const confirmRemove = async (): Promise<void> => {
    if (!removeTarget) {
      return;
    }
    await window.electronAPI.removeToolApp(removeTarget.app.id);
    setRemoveTarget(null);
    if (detailId === removeTarget.app.id) {
      setDetailId(null);
    }
    await refresh();
  };

  const runCardTest = async (target: ToolAppView): Promise<void> => {
    const result = await window.electronAPI.testToolApp(target.app.id);
    setCardTests((prev) => ({
      ...prev,
      [target.app.id]: result.ok
        ? interpolate(TEXT.APPS_TEST_OK, { latency: result.latencyMs ?? 0, count: result.toolCount ?? 0 })
        : interpolate(TEXT.APPS_TEST_FAIL, { error: result.error ?? 'unknown' }),
    }));
  };

  const boundToolCount = useMemo(
    () =>
      views
        .filter((candidate) => candidate.app.enabled && !candidate.app.error)
        .reduce(
          (total, candidate) => total + candidate.knownTools.filter((tool) => tool.state?.enabled !== false).length,
          0
        ),
    [views]
  );

  const totalToolCount = nativeToolCount + boundToolCount;

  const saveBudget = async (value: number): Promise<void> => {
    const config = await window.electronAPI.loadConfig();
    if (!config.toolApps) {
      return;
    }
    await window.electronAPI.saveConfig({ toolApps: { ...config.toolApps, toolBudget: value } });
    setToolBudget(value);
  };

  const setExposure = async (target: ToolAppView, exposure: ToolAppSpec['exposure']): Promise<void> => {
    await window.electronAPI.saveToolApp({ ...target.app, exposure });
    await refresh();
  };

  const saveIcon = async (target: ToolAppView, icon: string | undefined): Promise<void> => {
    const { icon: _ignored, ...rest } = target.app;
    await window.electronAPI.saveToolApp({ ...rest, ...(icon ? { icon } : {}) } as Parameters<typeof window.electronAPI.saveToolApp>[0]);
    await refresh();
  };

  const toggleTool = async (target: ToolAppView, toolName: string, enabled: boolean): Promise<void> => {
    const previous = target.knownTools.find((tool) => tool.name === toolName)?.state ?? null;
    if (undo) {
      clearTimeout(undo.timer);
      setUndo(null);
    }
    await window.electronAPI.setToolAppState(target.app.id, toolName, { enabled });
    await refresh();
    const timer = window.setTimeout(() => setUndo(null), 6000);
    setUndo({ appId: target.app.id, toolName, previous, timer });
  };

  const undoToolToggle = async (): Promise<void> => {
    if (!undo) {
      return;
    }
    clearTimeout(undo.timer);
    const { appId, toolName, previous } = undo;
    setUndo(null);
    await window.electronAPI.setToolAppState(appId, toolName, previous ? { enabled: previous.enabled } : null);
    await refresh();
  };

  const setRiskOverride = async (target: ToolAppView, toolName: string, risk: ToolRiskClass | null): Promise<void> => {
    await window.electronAPI.setToolAppState(target.app.id, toolName, risk ? { riskOverride: risk } : null);
    await refresh();
  };

  const saveToolTags = async (appId: string, toolName: string, tags: string[]): Promise<void> => {
    await window.electronAPI.setToolAppState(appId, toolName, { keywordTags: tags });
    await refresh();
  };

  const runTest = async (target: ToolAppView): Promise<void> => {
    const result = await window.electronAPI.testToolApp(target.app.id);
    setTestResult(
      result.ok
        ? interpolate(TEXT.APPS_TEST_OK, { latency: result.latencyMs ?? 0, count: result.toolCount ?? 0 })
        : interpolate(TEXT.APPS_TEST_FAIL, { error: result.error ?? 'unknown' })
    );
    await refresh();
  };

  const saveScope = async (target: ToolAppView): Promise<void> => {
    const hasRules = scopeRules.length > 0;
    await window.electronAPI.setToolAppEntityScope(target.app.id, hasRules ? { rules: scopeRules } : null);
    await refresh();
    await runScopePreview(target.app.id);
  };

  const runScopePreview = async (appId: string): Promise<void> => {
    const preview = await window.electronAPI.previewToolAppScope(appId, scopeRules);
    setScopePreview(preview);
  };

  const saveDirectives = async (target: ToolAppView, directives: string): Promise<void> => {
    const trimmed = directives.trim();
    await window.electronAPI.saveToolApp({ ...target.app, ...(trimmed ? { directives: trimmed } : { directives: undefined }) } as Parameters<typeof window.electronAPI.saveToolApp>[0]);
    await refresh();
  };

  const saveConnection = async (target: ToolAppView, patch: ConnectionPatch): Promise<void> => {
    const sources = target.app.sources.map((source) => {
      if (source.kind !== 'mcp' || source.server.transport.type === 'stdio') {
        return source;
      }
      return {
        kind: 'mcp' as const,
        server: {
          ...source.server,
          transport: { type: source.server.transport.type, ...(patch.endpoint ? { url: patch.endpoint } : {}) },
          ...(patch.allowlist ? { allowlist: patch.allowlist } : {}),
          ...(patch.defaultAction ? { defaultAction: patch.defaultAction } : {}),
          ...(patch.timeoutMs !== undefined ? { timeoutMs: patch.timeoutMs } : {}),
          ...(patch.maxConcurrent !== undefined ? { maxConcurrent: patch.maxConcurrent } : {}),
        },
      };
    });
    await window.electronAPI.saveToolApp({
      ...target.app,
      sources,
      ...(patch.env ? { env: patch.env } : {}),
      ...(patch.headers ? { headers: patch.headers } : {}),
    } as Parameters<typeof window.electronAPI.saveToolApp>[0]);
    await refresh();
  };

  const savePreset = async (): Promise<void> => {
    if (!selectedPreset) {
      return;
    }
    const serverName = 'homeassistant';
    const result = await window.electronAPI.saveToolApp({
      id: '',
      name: selectedPreset.name,
      description: selectedPreset.description,
      enabled: true,
      exposure: 'relevance',
      sources: [
        {
          kind: 'mcp',
          server: {
            id: '',
            name: serverName,
            transport: { type: selectedPreset.transport === 'stdio' ? 'stdio' : selectedPreset.transport, url: presetEndpoint },
            enabled: true,
            defaultAction: 'allow',
          },
        },
      ],
      toolState: {},
      presetId: selectedPreset.id,
      ...(presetToken ? { headers: { Authorization: `Bearer ${presetToken}` } } : {}),
    } as Parameters<typeof window.electronAPI.saveToolApp>[0]);
    if (!result.ok) {
      setPresetError(result.error);
      return;
    }
    setSelectedPreset(null);
    setPresetToken('');
    setPresetError(null);
    setAddOpen(false);
    await refresh();
  };

  const saveCustomApp = async (): Promise<void> => {
    const name = customName.trim();
    if (!name) {
      setCustomError('App name is required.');
      return;
    }
    let env: Record<string, string> | undefined;
    let headersJson: Record<string, string> | undefined;
    if (customEnv.trim()) {
      const parsed = parseJsonStringMap(customEnv);
      if (!parsed.ok) {
        setCustomError(interpolate(TEXT.APPS_CUSTOM_JSON_ERROR, { field: TEXT.APPS_CUSTOM_ENV, error: parsed.error }));
        return;
      }
      env = parsed.value;
    }
    if (customHeaders.trim()) {
      const parsed = parseJsonStringMap(customHeaders);
      if (!parsed.ok) {
        setCustomError(interpolate(TEXT.APPS_CUSTOM_JSON_ERROR, { field: TEXT.APPS_CUSTOM_HEADERS, error: parsed.error }));
        return;
      }
      headersJson = parsed.value;
    }
    const timeout = parsePositiveInt(customTimeout);
    if (!timeout.ok) {
      setCustomError(interpolate(TEXT.APPS_CUSTOM_NUMBER_ERROR, { field: TEXT.APPS_CUSTOM_TIMEOUT }));
      return;
    }
    const concurrency = parsePositiveInt(customMaxConcurrent);
    if (!concurrency.ok) {
      setCustomError(interpolate(TEXT.APPS_CUSTOM_NUMBER_ERROR, { field: TEXT.APPS_CUSTOM_MAXCONC }));
      return;
    }
    const allowlistTools = customAllowlist.split(',').map((entry) => entry.trim()).filter(Boolean);
    const serverName = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom';
    const transport =
      customType === 'stdio'
        ? { type: 'stdio' as const, command: customCommand.trim(), args: customArgs.trim() ? customArgs.trim().split(/\s+/) : undefined }
        : { type: customType, url: customUrl.trim() };
    const headers = { ...headersJson, ...(customToken ? { Authorization: `Bearer ${customToken}` } : {}) };
    const result = await window.electronAPI.saveToolApp({
      id: '',
      name,
      enabled: true,
      sources: [
        {
          kind: 'mcp',
          server: {
            id: '',
            name: serverName,
            transport,
            enabled: true,
            defaultAction: allowlistTools.length > 0 ? 'deny' : 'allow',
            ...(allowlistTools.length > 0 ? { allowlist: allowlistTools } : {}),
            ...(timeout.value !== undefined ? { timeoutMs: timeout.value } : {}),
            ...(concurrency.value !== undefined ? { maxConcurrent: concurrency.value } : {}),
          },
        },
      ],
      toolState: {},
      exposure: 'relevance',
      ...(env ? { env } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    } as Parameters<typeof window.electronAPI.saveToolApp>[0]);
    if (!result.ok) {
      setCustomError(result.error);
      return;
    }
    setAddOpen(false);
    setCustomName('');
    setCustomUrl('');
    setCustomCommand('');
    setCustomArgs('');
    setCustomToken('');
    setCustomAllowlist('');
    setCustomTimeout('');
    setCustomMaxConcurrent('');
    setCustomEnv('');
    setCustomHeaders('');
    setCustomError(null);
    await refresh();
  };

  
  const visibleApps = useMemo(() => {
    const needleLower = needle.trim().toLowerCase();
    return views.filter((candidate) => {
      if (needleLower && !`${candidate.app.name} ${candidate.app.description ?? ''}`.toLowerCase().includes(needleLower)) {
        return false;
      }
      if (statusFilter === 'disabled') {
        return !candidate.app.enabled;
      }
      if (statusFilter !== 'all') {
        return candidate.app.enabled && healthOf(candidate) === statusFilter;
      }
      return true;
    });
  }, [views, needle, statusFilter]);

  const detailView = detail;
  const boundChip = (candidate: ToolAppView): string =>
    interpolate(TEXT.APPS_CARD_TOOLS, {
      count: candidate.knownTools.filter((tool) => tool.state?.enabled !== false).length,
    });

  return (
    <div className="space-y-5">
      <SegmentedTabs
        ariaLabel={TEXT.SETTINGS_NAV_APPS}
        items={[
          { value: 'apps', label: TEXT.APPS_VIEW_APPS },
          { value: 'settings', label: TEXT.APPS_VIEW_SETTINGS },
        ]}
        value={view}
        onValueChange={(next) => setView(next as 'apps' | 'settings')}
      />

      {view === 'apps' && (
        <div role="tabpanel" aria-label={TEXT.APPS_VIEW_APPS} className="space-y-5">
          <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_NAV_MATCHING_HELP}</p>

          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={needle} onChange={setNeedle} placeholder={TEXT.APPS_SEARCH_PLACEHOLDER} ariaLabel={TEXT.APPS_SEARCH_PLACEHOLDER} clearLabel={TEXT.APPS_UNDO} />
            {(['all', 'healthy', 'unavailable', 'error', 'disabled'] as StatusFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={statusFilter === filter}
                onClick={() => setStatusFilter(filter)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  statusFilter === filter ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10' : 'border-[var(--as-border)]'
                }`}
              >
                {filter === 'all'
                  ? TEXT.APPS_FILTER_ALL
                  : filter === 'healthy'
                    ? TEXT.APPS_HEALTH_HEALTHY
                    : filter === 'unavailable'
                      ? TEXT.APPS_HEALTH_UNAVAILABLE
                      : filter === 'error'
                        ? TEXT.APPS_HEALTH_ERROR
                        : TEXT.APPS_HEALTH_DISABLED}
              </button>
            ))}
            <Button size="sm" onClick={() => { setAddOpen(true); setAddMode('preset'); setSelectedPreset(null); setPresetError(null); }}>
              {TEXT.APPS_ADD_APP}
            </Button>
          </div>

          {visibleApps.length === 0 ? (
            <EmptyState icon={undefined} title={TEXT.APPS_EMPTY} compact />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {visibleApps.map((candidate) => (
                <li key={candidate.app.id} className="min-w-0">
                  <Card className="h-full p-4 transition-all hover:border-[var(--as-primary)]/40 hover:shadow-md">
                    <div className="flex items-start gap-3">
                      <AppIcon view={candidate} name={candidate.app.name} />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="truncate text-sm font-semibold" title={candidate.app.name}>{candidate.app.name}</p>
                        <div className="flex flex-wrap items-center gap-1">
                          <HealthChip view={candidate} />
                          <Badge variant="outline" className="text-[10px]">{sourceChip(candidate)}</Badge>
                          <Badge variant="outline" className="text-[10px]">{boundChip(candidate)}</Badge>
                        </div>
                      </div>
                      <Switch
                        checked={candidate.app.enabled}
                        onCheckedChange={(enabled) => void toggleApp(candidate, enabled)}
                        label={interpolate(TEXT.APPS_ENABLED_LABEL, { name: candidate.app.name })}
                        hideLabel
                      />
                    </div>
                    <p className="mt-2 line-clamp-2 min-h-8 text-xs leading-4 text-[var(--as-muted-foreground)]">
                      {candidate.app.description}
                    </p>
                    {cardTests[candidate.app.id] && (
                      <p role="status" className="mt-1.5 text-xs">
                        {cardTests[candidate.app.id]}
                      </p>
                    )}
                    {candidate.app.error && (
                      <p role="alert" className="mt-1.5 text-xs text-[var(--as-danger)]">
                        {candidate.app.error}
                      </p>
                    )}
                    <div className="mt-3 flex items-center gap-1 border-t border-[var(--as-border)] pt-2.5">
                      <Button size="sm" variant="outline" onClick={() => setDetailId(candidate.app.id)}>
                        {TEXT.APPS_DETAILS}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void runCardTest(candidate)}>
                        {TEXT.APPS_TEST_ACTION}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto text-[var(--as-danger)] hover:bg-[var(--as-danger)]/10 hover:text-[var(--as-danger)]"
                        onClick={() => setRemoveTarget(candidate)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        {TEXT.APPS_REMOVE}
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view === 'settings' && (
        <div role="tabpanel" aria-label={TEXT.APPS_VIEW_SETTINGS} className="space-y-5">
          <section aria-label={TEXT.APPS_BUDGET_TITLE} className="space-y-2 rounded-xl border border-[var(--as-border)] p-4">
            <h3 className="text-sm font-semibold">{TEXT.APPS_BUDGET_TITLE}</h3>
            <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_BUDGET_DESCRIPTION}</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--as-muted)]">
              <div
                className={`h-full rounded-full ${totalToolCount > toolBudget ? 'bg-[var(--as-danger)]' : 'bg-[var(--as-primary)]'}`}
                style={{ width: `${Math.min(100, Math.round((totalToolCount / Math.max(1, toolBudget)) * 100))}%` }}
              />
            </div>
            <p role="status" className="text-xs">
              {interpolate(TEXT.APPS_BUDGET_BOUND, { count: totalToolCount })} · {TEXT.APPS_BUDGET_LABEL}: {toolBudget}
            </p>
            {totalToolCount > toolBudget && (
              <p role="alert" className="text-xs text-[var(--as-danger)]">
                {TEXT.APPS_BUDGET_OVER}
              </p>
            )}
            <label className="block text-xs" htmlFor="apps-budget-input">
              {TEXT.APPS_BUDGET_LABEL}
              <input
                id="apps-budget-input"
                type="number"
                min={1}
                max={200}
                className="mt-1 w-24 rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                value={toolBudget}
                onChange={(event) => setToolBudget(Number(event.target.value))}
                onBlur={() => void saveBudget(toolBudget)}
              />
            </label>
          </section>

          <section aria-label={TEXT.APPS_MASTER_SWITCH_TITLE} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--as-border)] p-4">
            <div>
              <h3 className="text-sm font-semibold">{TEXT.APPS_MASTER_SWITCH_TITLE}</h3>
              <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_MASTER_SWITCH_HINT}</p>
            </div>
            <Switch
              checked={views.some((candidate) => candidate.app.enabled) || views.length === 0}
              onCheckedChange={(enabled) => void setMasterEnabled(enabled)}
              label={TEXT.APPS_MASTER_SWITCH_TITLE}
            />
          </section>

          <section aria-label={TEXT.APPS_NAV_MATCHING_HELP} className="rounded-xl border border-[var(--as-border)] p-4">
            <h3 className="text-sm font-semibold">{TEXT.APPS_MATCHING_HELP_TITLE}</h3>
            <p className="mt-1 text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_NAV_MATCHING_HELP}</p>
          </section>

          <AppUsageCard />
        </div>
      )}

      {detailView && (
        <Modal open onOpenChange={(open) => !open && setDetailId(null)}>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>{interpolate(TEXT.APPS_DETAIL_TITLE, { name: detailView.app.name })}</ModalTitle>
            </ModalHeader>
            <ModalBody className="space-y-5">
              <SegmentedTabs
                ariaLabel={interpolate(TEXT.APPS_DETAIL_TITLE, { name: detailView.app.name })}
                items={[
                  { value: 'connection', label: TEXT.APPS_CONNECTION_TITLE },
                  { value: 'tools', label: TEXT.APPS_TOOLS_TITLE },
                  { value: 'scope', label: TEXT.APPS_SCOPE_TAB },
                ]}
                value={detailTab}
                onValueChange={(next) => setDetailTab(next as 'connection' | 'tools' | 'scope')}
              />

              {detailTab === 'connection' && (
                <section aria-label={TEXT.APPS_CONNECTION_TITLE} className="space-y-4">
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--as-muted-foreground)]">{TEXT.APPS_ICON_PICKER_LABEL}</h4>
                    <IconPicker current={detailView.app.icon} onPick={(icon) => void saveIcon(detailView, icon)} />
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--as-muted-foreground)]">{TEXT.APPS_CONNECTION_TITLE}</h4>
                    <ConnectionEditor view={detailView} onSave={saveConnection} />
                    {detailView.app.sources[0]?.kind === 'mcp' && (
                      <div className="space-y-1 text-xs text-[var(--as-muted-foreground)]">
                        <p>{interpolate(TEXT.APPS_SECRETS_KEYS, { keys: [...detailView.envKeys, ...detailView.headerKeys].join(', ') || '—' })}</p>
                        {testResult && (
                          <p role="status">{testResult}</p>
                        )}
                        <Button size="sm" variant="outline" onClick={() => void runTest(detailView)}>
                          {TEXT.APPS_TEST_ACTION}
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--as-muted-foreground)]">{TEXT.APPS_EXPOSURE_TITLE}</h4>
                    <fieldset className="space-y-1">
                      <legend className="sr-only">{TEXT.APPS_EXPOSURE_TITLE}</legend>
                      {(['always', 'relevance', 'deferred'] as const).map((exposure) => {
                        if (exposure === 'deferred' && !deferredSupported) {
                          return null;
                        }
                        return (
                          <label key={exposure} className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name={`exposure-${detailView.app.id}`}
                              checked={detailView.app.exposure === exposure}
                              onChange={() => void setExposure(detailView, exposure)}
                            />
                            {exposure === 'always' ? TEXT.APPS_EXPOSURE_ALWAYS : exposure === 'relevance' ? TEXT.APPS_EXPOSURE_RELEVANCE : TEXT.APPS_EXPOSURE_DEFERRED}
                          </label>
                        );
                      })}
                    </fieldset>
                    {!deferredSupported && (
                      <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_EXPOSURE_DEFERRED_REASON}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--as-muted-foreground)]">{TEXT.APPS_DIRECTIVES_TITLE}</h4>
                    <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_DIRECTIVES_HINT}</p>
                    <DirectivesEditor view={detailView} onSave={saveDirectives} />
                  </div>
                </section>
              )}

              {detailTab === 'tools' && (
                <section aria-label={TEXT.APPS_TOOLS_TITLE} className="space-y-2">
                  <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_TOOLS_AUTOSAVE}</p>
        <SearchInput
          value={toolNeedle}
          onChange={setToolNeedle}
          placeholder={TEXT.APPS_TOOLS_SEARCH_PLACEHOLDER}
          ariaLabel={TEXT.APPS_TOOLS_SEARCH_PLACEHOLDER}
          clearLabel={TEXT.APPS_UNDO}
        />
                  {detailView.knownTools.length === 0 ? (
                    <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_TOOLS_EMPTY}</p>
                  ) : (
                    (['read-only', 'state-changing', 'destructive'] as ToolRiskClass[]).map((risk) => {
                      const group = detailView.knownTools.filter((tool) => {
                        const effective = tool.state?.riskOverride ?? (tool.state?.baseRisk ?? 'state-changing');
                        return effective === risk && matchesToolNeedle(tool, toolNeedle);
                      });
                      if (group.length === 0) {
                        return null;
                      }
                      return (
                        <div key={risk} className="space-y-2">
                          <h5 className="text-xs font-medium text-[var(--as-muted-foreground)]">
                            {interpolate(TEXT.APPS_TOOLS_GROUP_LABEL, {
                              group: risk === 'read-only' ? TEXT.TOOLS_FILTER_READ_ONLY : risk === 'state-changing' ? TEXT.TOOLS_FILTER_STATE_CHANGING : TEXT.TOOLS_FILTER_DESTRUCTIVE,
                              count: group.length,
                            })}
                          </h5>
                          <ul className="space-y-2">
                            {group.map((tool) => {
                              const base = tool.state?.baseRisk ?? 'state-changing';
                              const effective = tool.state?.riskOverride ?? base;
                              return (
                                <li key={tool.name} className="space-y-2 rounded-xl border border-[var(--as-border)] p-3">
                                  <div className="flex items-center gap-2">
                                    <Switch
                                      checked={tool.state?.enabled !== false}
                                      onCheckedChange={(enabled) => void toggleTool(detailView, tool.name, enabled)}
                                      label={interpolate(TEXT.APPS_TOOL_ENABLED_LABEL, { name: tool.name })}
                                    />
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium" title={tool.name}>
                                      {tool.name}
                                    </span>
                                    {tool.state === null && (
                                      <Badge variant="outline" className="text-[10px]">{TEXT.APPS_TOOL_NEW_BADGE}</Badge>
                                    )}
                                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${RISK_BADGE_CLASS[effective]}`}>{effective}</span>
                                  </div>
                                  {tool.description && (
                                    <p className="line-clamp-2 text-xs leading-4 text-[var(--as-muted-foreground)]">{tool.description}</p>
                                  )}
                                  <div className="flex flex-wrap items-center gap-2">
                                    <ToolTagsEditor appId={detailView.app.id} toolName={tool.name} tags={tool.state?.keywordTags ?? []} onSave={saveToolTags} />
                                    <label className="ml-auto text-xs">
                                      <span className="sr-only">{interpolate(TEXT.APPS_TOOL_RISK_LABEL, { name: tool.name })}</span>
                                      <select
                                        value={tool.state?.riskOverride ?? ''}
                                        onChange={(event) => void setRiskOverride(detailView, tool.name, (event.target.value || null) as ToolRiskClass | null)}
                                        className="rounded border border-[var(--as-border)] bg-transparent px-1 py-0.5"
                                      >
                                        <option value="">{base}</option>
                                        {(Object.keys(RISK_ORDER) as ToolRiskClass[])
                                          .filter((risk) => riskRank(risk) > riskRank(base))
                                          .map((risk) => (
                                            <option key={risk} value={risk}>{risk}</option>
                                          ))}
                                      </select>
                                    </label>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })
                  )}
                  {detailView.knownTools.length > 0 && toolNeedle.trim() && detailView.knownTools.every((tool) => !matchesToolNeedle(tool, toolNeedle)) && (
                    <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_TOOLS_FILTER_EMPTY}</p>
                  )}
                  {undo && (
                    <div role="status" className="flex items-center gap-2 text-xs">
                      <span>{interpolate(TEXT.APPS_TOOL_UNDO, { name: undo.toolName })}</span>
                      <Button size="sm" variant="ghost" onClick={() => void undoToolToggle()}>
                        {TEXT.APPS_UNDO}
                      </Button>
                    </div>
                  )}
                </section>
              )}

              {detailTab === 'scope' && detailView.app.sources[0]?.kind === 'mcp' && (
                <section aria-label={TEXT.APPS_SCOPE_TITLE} className="space-y-2">
                  <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_SCOPE_HINT}</p>
                  <ul className="space-y-1">
                    {scopeRules.map((rule, index) => (
                      <li key={`${rule.pattern}-${index}`} className="flex items-center gap-2">
                        <select
                          aria-label={TEXT.APPS_SCOPE_EFFECT_LABEL}
                          value={rule.effect}
                          onChange={(event) =>
                            setScopeRules((prev) => prev.map((entry, i) => (i === index ? { ...entry, effect: event.target.value as 'allow' | 'deny' } : entry)))
                          }
                          className="rounded border border-[var(--as-border)] bg-transparent px-1 py-0.5 text-xs"
                        >
                          <option value="allow">{TEXT.APPS_SCOPE_ALLOW}</option>
                          <option value="deny">{TEXT.APPS_SCOPE_DENY}</option>
                        </select>
                        <input
                          aria-label={TEXT.APPS_SCOPE_PATTERN_LABEL}
                          value={rule.pattern}
                          onChange={(event) =>
                            setScopeRules((prev) => prev.map((entry, i) => (i === index ? { ...entry, pattern: event.target.value } : entry)))
                          }
                          className="flex-1 rounded border border-[var(--as-border)] bg-transparent px-2 py-0.5 text-xs"
                        />
                        <Button size="sm" variant="ghost" onClick={() => setScopeRules((prev) => prev.filter((_, i) => i !== index))}>
                          {TEXT.APPS_REMOVE}
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setScopeRules((prev) => [...prev, { effect: 'deny', pattern: 'lock.*' }])}>
                      {TEXT.APPS_SCOPE_ADD}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void saveScope(detailView)}>
                      {TEXT.APPS_SCOPE_SAVE}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void runScopePreview(detailView.app.id)}>
                      {TEXT.APPS_SCOPE_PREVIEW_ACTION}
                    </Button>
                  </div>
                  {scopePreview && (
                    <ul className="space-y-0.5" aria-label={TEXT.APPS_SCOPE_PREVIEW}>
                      {scopePreview.entities.length === 0 ? (
                        <li className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_SCOPE_PREVIEW_EMPTY}</li>
                      ) : (
                        scopePreview.entities.map((entity) => (
                          <li key={entity.id} className="flex items-center gap-2 text-xs">
                            <span className={entity.allowed ? '' : 'text-[var(--as-danger)]'}>{entity.id}</span>
                            <span className="text-[var(--as-muted-foreground)]">
                              {entity.allowed ? TEXT.APPS_SCOPE_PREVIEW_ALLOWED : TEXT.APPS_SCOPE_PREVIEW_BLOCKED}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </section>
              )}
            </ModalBody></ModalContent>
        </Modal>
      )}

      {addOpen && (
        <Modal open onOpenChange={(open) => !open && setAddOpen(false)}>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>{TEXT.APPS_ADD_APP}</ModalTitle>
            </ModalHeader>
            <ModalBody className="space-y-3">
              <div className="flex gap-1" role="tablist" aria-label={TEXT.APPS_ADD_APP}>
                {(['preset', 'custom'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={addMode === mode}
                    onClick={() => { setAddMode(mode); setSelectedPreset(null); setPresetError(null); setCustomError(null); }}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      addMode === mode ? 'bg-[var(--as-primary)]/15 text-[var(--as-primary)]' : 'text-[var(--as-muted-foreground)]'
                    }`}
                  >
                    {mode === 'preset' ? TEXT.APPS_ADD_MODE_PRESET : TEXT.APPS_ADD_MODE_CUSTOM}
                  </button>
                ))}
              </div>

              {addMode === 'preset' && !selectedPreset && (
                <ul className="space-y-2">
                  {presets.map((preset) => (
                    <li key={preset.id} className="flex items-start gap-3 rounded-lg border border-[var(--as-border)] p-3">
                      <Monogram name={preset.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{preset.name}</p>
                        <p className="line-clamp-2 text-xs text-[var(--as-muted-foreground)]">{preset.description}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {preset.toolDomains.map((domain) => (
                            <span key={domain.tool} className={`rounded px-1.5 py-0.5 text-[10px] ${RISK_BADGE_CLASS[domain.baseRisk]}`}>
                              {domain.tool}
                            </span>
                          ))}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setSelectedPreset(preset); setPresetEndpoint(preset.defaultEndpoint); setPresetError(null); }}
                      >
                        Add
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {addMode === 'preset' && selectedPreset && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold">{TEXT.APPS_PRESET_PREVIEW_RISKS}</p>
                  <ul className="space-y-1">
                    {selectedPreset.toolDomains.map((domain) => (
                      <li key={domain.tool} className="flex items-center gap-2 text-xs">
                        <span className={`rounded px-1.5 py-0.5 ${RISK_BADGE_CLASS[domain.baseRisk]}`}>{domain.baseRisk}</span>
                        <span>{domain.tool}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs font-semibold">{TEXT.APPS_PRESET_PREVIEW_NOTES}</p>
                  <p className="text-xs text-[var(--as-muted-foreground)]">{selectedPreset.promptNotes}</p>
                  <label className="block text-xs" htmlFor="preset-endpoint">
                    {TEXT.APPS_PRESET_ENDPOINT_LABEL}
                    <input
                      id="preset-endpoint"
                      className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                      value={presetEndpoint}
                      onChange={(event) => setPresetEndpoint(event.target.value)}
                    />
                  </label>
                  <label className="block text-xs" htmlFor="preset-token">
                    {TEXT.APPS_PRESET_TOKEN_LABEL}
                    <input
                      id="preset-token"
                      type="password"
                      className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                      value={presetToken}
                      onChange={(event) => setPresetToken(event.target.value)}
                    />
                  </label>
                  {presetError && (
                    <p role="alert" className="text-xs text-[var(--as-danger)]">
                      {presetError}
                    </p>
                  )}
                  <Button size="sm" onClick={() => void savePreset()}>
                    {TEXT.APPS_PRESET_SAVE}
                  </Button>
                </div>
              )}

              {addMode === 'custom' && (
                <div className="space-y-3">
                  <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_CUSTOM_HINT}</p>
                  <label className="block text-xs">
                    {TEXT.APPS_CUSTOM_NAME}
                    <input
                      className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                      value={customName}
                      onChange={(event) => setCustomName(event.target.value)}
                    />
                  </label>
                  <label className="block text-xs">
                    {TEXT.APPS_CUSTOM_TYPE}
                    <select
                      className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                      value={customType}
                      onChange={(event) => setCustomType(event.target.value as 'http' | 'sse' | 'stdio')}
                    >
                      <option value="http">Streamable HTTP</option>
                      <option value="sse">SSE</option>
                      <option value="stdio">stdio (local command)</option>
                    </select>
                  </label>
                  {customType === 'stdio' ? (
                    <>
                      <label className="block text-xs">
                        {TEXT.APPS_CUSTOM_COMMAND}
                        <input
                          className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                          value={customCommand}
                          onChange={(event) => setCustomCommand(event.target.value)}
                          placeholder="/usr/bin/npx"
                        />
                      </label>
                      <label className="block text-xs">
                        {TEXT.APPS_CUSTOM_ARGS}
                        <input
                          className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                          value={customArgs}
                          onChange={(event) => setCustomArgs(event.target.value)}
                        />
                      </label>
                    </>
                  ) : (
                    <label className="block text-xs">
                      {TEXT.APPS_CUSTOM_URL}
                      <input
                        className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                        value={customUrl}
                        onChange={(event) => setCustomUrl(event.target.value)}
                        placeholder="http://host:port/mcp"
                      />
                    </label>
                  )}
                  <label className="block text-xs">
                    {TEXT.APPS_CUSTOM_TOKEN}
                    <input
                      type="password"
                      className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                      value={customToken}
                      onChange={(event) => setCustomToken(event.target.value)}
                    />
                  </label>
                  <fieldset className="space-y-1">
                    <legend className="text-xs">{TEXT.APPS_EXPOSURE_TITLE}</legend>
                    {(['always', 'relevance', 'deferred'] as const).map((exposure) => {
                      if (exposure === 'deferred' && !deferredSupported) {
                        return null;
                      }
                      return (
                        <label key={exposure} className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name="custom-exposure"
                            checked={customExposure === exposure}
                            onChange={() => setCustomExposure(exposure)}
                          />
                          {exposure === 'always' ? TEXT.APPS_EXPOSURE_ALWAYS : exposure === 'relevance' ? TEXT.APPS_EXPOSURE_RELEVANCE : TEXT.APPS_EXPOSURE_DEFERRED}
                        </label>
                      );
                    })}
                  </fieldset>
                  <label className="block text-xs">
                    {TEXT.APPS_DIRECTIVES_LABEL}
                    <textarea
                      rows={2}
                      maxLength={500}
                      className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                      value={customDirectives}
                      onChange={(event) => setCustomDirectives(event.target.value)}
                      placeholder="e.g. For all smart-home tasks use the app tools — never shell commands."
                    />
                  </label>
                  <label className="block text-xs">
                    {TEXT.APPS_CUSTOM_ALLOWLIST}
                    <input
                      className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                      value={customAllowlist}
                      onChange={(event) => setCustomAllowlist(event.target.value)}
                    />
                  </label>
                  <div className="flex gap-2">
                    <label className="block flex-1 text-xs">
                      {TEXT.APPS_CUSTOM_TIMEOUT}
                      <input
                        type="number"
                        min={1000}
                        className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                        value={customTimeout}
                        onChange={(event) => setCustomTimeout(event.target.value)}
                      />
                    </label>
                    <label className="block flex-1 text-xs">
                      {TEXT.APPS_CUSTOM_MAXCONC}
                      <input
                        type="number"
                        min={1}
                        className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                        value={customMaxConcurrent}
                        onChange={(event) => setCustomMaxConcurrent(event.target.value)}
                      />
                    </label>
                  </div>
                  <label className="block text-xs">
                    {TEXT.APPS_CUSTOM_ENV}
                    <textarea
                      rows={2}
                      placeholder='{{ "KEY": "value" }}'
                      className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 font-mono text-xs"
                      value={customEnv}
                      onChange={(event) => setCustomEnv(event.target.value)}
                    />
                  </label>
                  <label className="block text-xs">
                    {TEXT.APPS_CUSTOM_HEADERS}
                    <textarea
                      rows={2}
                      placeholder='{{ "X-Custom": "value" }}'
                      className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 font-mono text-xs"
                      value={customHeaders}
                      onChange={(event) => setCustomHeaders(event.target.value)}
                    />
                  </label>
                  {customError && (
                    <p role="alert" className="text-xs text-[var(--as-danger)]">
                      {customError}
                    </p>
                  )}
                  <Button size="sm" onClick={() => void saveCustomApp()}>
                    {TEXT.APPS_CUSTOM_SAVE}
                  </Button>
                </div>
              )}
            </ModalBody>
          </ModalContent>
        </Modal>
      )}

      <ConfirmationModal
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={interpolate(TEXT.APPS_REMOVE_CONFIRM_TITLE, { name: removeTarget?.app.name ?? '' })}
        description={TEXT.APPS_REMOVE_CONFIRM_DESCRIPTION}
        confirmLabel={TEXT.APPS_REMOVE_CONFIRM_ACTION}
        destructive
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
}

function ToolTagsEditor({
  appId,
  toolName,
  tags,
  onSave,
}: {
  appId: string;
  toolName: string;
  tags: string[];
  onSave: (appId: string, toolName: string, tags: string[]) => Promise<void>;
}): ReactElement {
  const [draft, setDraft] = useState(tags.join(', '));
  useEffect(() => {
    setDraft(tags.join(', '));
  }, [tags.join(', ')]);
  return (
    <input
      aria-label={interpolate(TEXT.APPS_TOOL_TAGS_LABEL, { name: toolName })}
      value={draft}
      placeholder="keywords, comma separated"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const parsed = draft.split(',').map((tag) => tag.trim()).filter(Boolean);
        if (JSON.stringify(parsed) !== JSON.stringify(tags)) {
          void onSave(appId, toolName, parsed);
        }
      }}
      className="w-28 rounded border border-[var(--as-border)] bg-transparent px-1 py-0.5 text-xs"
    />
  );
}

function DirectivesEditor({
  view,
  onSave,
}: {
  view: ToolAppView;
  onSave: (view: ToolAppView, directives: string) => Promise<void>;
}): ReactElement {
  const [draft, setDraft] = useState(view.app.directives ?? '');
  useEffect(() => {
    setDraft(view.app.directives ?? '');
  }, [view.app.directives]);
  return (
    <div className="space-y-1">
      <label className="sr-only" htmlFor="app-directives">
        {TEXT.APPS_DIRECTIVES_LABEL}
      </label>
      <textarea
        id="app-directives"
        rows={3}
        maxLength={500}
        className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="e.g. For all smart-home tasks use the app tools — never shell commands."
      />
      <Button size="sm" variant="outline" onClick={() => void onSave(view, draft)}>
        {TEXT.APPS_DIRECTIVES_SAVE}
      </Button>
    </div>
  );
}

function ConnectionEditor({
  view,
  onSave,
}: {
  view: ToolAppView;
  onSave: (view: ToolAppView, patch: ConnectionPatch) => Promise<void>;
}): ReactElement {
  const mcp = view.app.sources[0]?.kind === 'mcp' ? view.app.sources[0].server : null;
  const [endpoint, setEndpoint] = useState(mcp && mcp.transport.type !== 'stdio' ? mcp.transport.url : '');
  const [token, setToken] = useState('');
  const [allowlist, setAllowlist] = useState((mcp?.allowlist ?? []).join(', '));
  const [timeoutMs, setTimeoutMs] = useState(mcp?.timeoutMs ? String(mcp.timeoutMs) : '');
  const [maxConcurrent, setMaxConcurrent] = useState(mcp?.maxConcurrent ? String(mcp.maxConcurrent) : '');
  const [envText, setEnvText] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!mcp || mcp.transport.type === 'stdio') {
    return <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_SOURCE_NATIVE}</p>;
  }
  const save = async (): Promise<void> => {
    setError(null);
    let env: Record<string, string> | undefined;
    let headers: Record<string, string> | undefined;
    if (envText.trim()) {
      const parsed = parseJsonStringMap(envText);
      if (!parsed.ok) {
        setError(interpolate(TEXT.APPS_CUSTOM_JSON_ERROR, { field: TEXT.APPS_CUSTOM_ENV, error: parsed.error }));
        return;
      }
      env = parsed.value;
    }
    if (headersText.trim()) {
      const parsed = parseJsonStringMap(headersText);
      if (!parsed.ok) {
        setError(interpolate(TEXT.APPS_CUSTOM_JSON_ERROR, { field: TEXT.APPS_CUSTOM_HEADERS, error: parsed.error }));
        return;
      }
      headers = parsed.value;
    }
    const timeout = parsePositiveInt(timeoutMs);
    if (!timeout.ok) {
      setError(interpolate(TEXT.APPS_CUSTOM_NUMBER_ERROR, { field: TEXT.APPS_CUSTOM_TIMEOUT }));
      return;
    }
    const concurrency = parsePositiveInt(maxConcurrent);
    if (!concurrency.ok) {
      setError(interpolate(TEXT.APPS_CUSTOM_NUMBER_ERROR, { field: TEXT.APPS_CUSTOM_MAXCONC }));
      return;
    }
    const allowlistTools = allowlist.split(',').map((entry) => entry.trim()).filter(Boolean);
    await onSave(view, {
      endpoint,
      ...(token ? { token } : {}),
      allowlist: allowlistTools,
      defaultAction: allowlistTools.length > 0 ? 'deny' : 'allow',
      ...(timeout.value !== undefined ? { timeoutMs: timeout.value } : {}),
      ...(concurrency.value !== undefined ? { maxConcurrent: concurrency.value } : {}),
      ...(env ? { env } : {}),
      ...(headers ? { headers } : {}),
    });
  };
  return (
    <div className="space-y-2">
      <label className="block text-xs" htmlFor="app-endpoint">
        {TEXT.APPS_ENDPOINT_LABEL}
        <input
          id="app-endpoint"
          className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
        />
      </label>
      <label className="block text-xs" htmlFor="app-token">
        {TEXT.APPS_TOKEN_LABEL}
        <input
          id="app-token"
          type="password"
          className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>
      <label className="block text-xs" htmlFor="app-allowlist">
        {TEXT.APPS_CUSTOM_ALLOWLIST}
        <input
          id="app-allowlist"
          className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
          value={allowlist}
          onChange={(event) => setAllowlist(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <label className="block flex-1 text-xs" htmlFor="app-timeout">
          {TEXT.APPS_CUSTOM_TIMEOUT}
          <input
            id="app-timeout"
            type="number"
            min={1000}
            className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
            value={timeoutMs}
            onChange={(event) => setTimeoutMs(event.target.value)}
          />
        </label>
        <label className="block flex-1 text-xs" htmlFor="app-maxconc">
          {TEXT.APPS_CUSTOM_MAXCONC}
          <input
            id="app-maxconc"
            type="number"
            min={1}
            className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
            value={maxConcurrent}
            onChange={(event) => setMaxConcurrent(event.target.value)}
          />
        </label>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold text-[var(--as-muted-foreground)]">{TEXT.APPS_ADVANCED_TITLE}</p>
        <label className="block text-xs" htmlFor="app-env">
          {TEXT.APPS_CUSTOM_ENV}
          <textarea
            id="app-env"
            rows={3}
            placeholder='{{ "KEY": "value" }}'
            className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 font-mono text-xs"
            value={envText}
            onChange={(event) => setEnvText(event.target.value)}
          />
        </label>
        <label className="block text-xs" htmlFor="app-headers">
          {TEXT.APPS_CUSTOM_HEADERS}
          <textarea
            id="app-headers"
            rows={3}
            placeholder='{{ "X-Custom": "value" }}'
            className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 font-mono text-xs"
            value={headersText}
            onChange={(event) => setHeadersText(event.target.value)}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--as-danger)]">
          {error}
        </p>
      )}
      <Button size="sm" variant="outline" onClick={() => void save()}>
        {TEXT.APPS_CONNECTION_SAVE}
      </Button>
    </div>
  );
}
