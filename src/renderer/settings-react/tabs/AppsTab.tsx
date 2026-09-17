import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { EmptyState } from '@neuronection/assistant-ui/empty-state';
import { Modal, ModalContent, ModalHeader, ModalTitle } from '@neuronection/assistant-ui/modal';
import { SearchInput } from '@neuronection/assistant-ui/search-input';
import { RISK_BADGE_CLASS, Switch } from '../tools/shared';
import type { EntityScopeRule, ToolAppSpec, ToolAppToolState, ToolAppView } from '@shared/apps';
import type { ToolAppPreset } from '@shared/app-presets';
import type { ReactElement } from 'react';
import type { ToolRiskClass } from '@shared/turns';
import { TEXT, interpolate } from '@shared/constants/text';

type StatusFilter = 'all' | 'healthy' | 'unavailable' | 'error' | 'disabled';

interface ScopePreview {
  entities: { id: string; allowed: boolean }[];
}

const RISK_ORDER: Record<ToolRiskClass, number> = { 'read-only': 0, 'state-changing': 1, destructive: 2 };

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

export function AppsTab(): ReactElement {
  const [views, setViews] = useState<ToolAppView[]>([]);
  const [deferredSupported, setDeferredSupported] = useState(false);
  const [nativeToolCount, setNativeToolCount] = useState(0);
  const [presets, setPresets] = useState<ToolAppPreset[]>([]);
  const [toolBudget, setToolBudget] = useState(25);
  const [needle, setNeedle] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [presetPreview, setPresetPreview] = useState<ToolAppPreset | null>(null);
  const [presetEndpoint, setPresetEndpoint] = useState('');
  const [presetToken, setPresetToken] = useState('');
  const [presetError, setPresetError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ToolAppView | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ appId: string; toolName: string; previous: ToolAppToolState | null; timer: number } | null>(null);
  const [scopeRules, setScopeRules] = useState<EntityScopeRule[]>([]);
  const [scopePreview, setScopePreview] = useState<ScopePreview | null>(null);

  const detail = useMemo(() => views.find((view) => view.app.id === detailId) ?? null, [views, detailId]);

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
  }, [detail]);

  const toggleApp = async (view: ToolAppView, enabled: boolean): Promise<void> => {
    await window.electronAPI.setToolAppEnabled(view.app.id, enabled);
    await refresh();
  };

  const requestRemove = (view: ToolAppView): void => {
    setRemoveTarget(view);
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

  const boundToolCount = useMemo(
    () =>
      views
        .filter((view) => view.app.enabled && !view.app.error)
        .reduce(
          (total, view) =>
            total +
            view.knownTools.filter((tool) => tool.state?.enabled !== false).length,
          0
        ),
    [views]
  );

  const saveBudget = async (value: number): Promise<void> => {
    const config = await window.electronAPI.loadConfig();
    if (!config.toolApps) {
      return;
    }
    await window.electronAPI.saveConfig({ toolApps: { ...config.toolApps, toolBudget: value } });
    setToolBudget(value);
  };

  const setExposure = async (view: ToolAppView, exposure: ToolAppSpec['exposure']): Promise<void> => {
    await window.electronAPI.saveToolApp({ ...view.app, exposure });
    await refresh();
  };

  const toggleTool = async (view: ToolAppView, toolName: string, enabled: boolean): Promise<void> => {
    const previous = view.knownTools.find((tool) => tool.name === toolName)?.state ?? null;
    if (undo) {
      clearTimeout(undo.timer);
      setUndo(null);
    }
    await window.electronAPI.setToolAppState(view.app.id, toolName, { enabled });
    await refresh();
    const timer = window.setTimeout(() => setUndo(null), 6000);
    setUndo({ appId: view.app.id, toolName, previous, timer });
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

  const setRiskOverride = async (view: ToolAppView, toolName: string, risk: ToolRiskClass | null): Promise<void> => {
    await window.electronAPI.setToolAppState(view.app.id, toolName, risk ? { riskOverride: risk } : null);
    await refresh();
  };

  const runTest = async (view: ToolAppView): Promise<void> => {
    const result = await window.electronAPI.testToolApp(view.app.id);
    setTestResult(
      result.ok
        ? interpolate(TEXT.APPS_TEST_OK, { latency: result.latencyMs ?? 0, count: result.toolCount ?? 0 })
        : interpolate(TEXT.APPS_TEST_FAIL, { error: result.error ?? 'unknown' })
    );
    await refresh();
  };

  const saveScope = async (view: ToolAppView): Promise<void> => {
    const hasRules = scopeRules.length > 0;
    await window.electronAPI.setToolAppEntityScope(view.app.id, hasRules ? { rules: scopeRules } : null);
    await refresh();
    await runScopePreview(view.app.id);
  };

  const runScopePreview = async (appId: string): Promise<void> => {
    const preview = await window.electronAPI.previewToolAppScope(appId, scopeRules);
    setScopePreview(preview);
  };

  const savePreset = async (): Promise<void> => {
    if (!presetPreview) {
      return;
    }
    const serverName = 'homeassistant';
    const result = await window.electronAPI.saveToolApp({
      id: '',
      name: presetPreview.name,
      description: presetPreview.description,
      enabled: true,
      exposure: 'relevance',
      sources: [
        {
          kind: 'mcp',
          server: {
            id: '',
            name: serverName,
            transport: { type: presetPreview.transport === 'stdio' ? 'stdio' : presetPreview.transport, url: presetEndpoint },
            enabled: true,
            defaultAction: 'allow',
          },
        },
      ],
      toolState: {},
      presetId: presetPreview.id,
      ...(presetToken ? { headers: { Authorization: `Bearer ${presetToken}` } } : {}),
    } as Parameters<typeof window.electronAPI.saveToolApp>[0]);
    if (!result.ok) {
      setPresetError(result.error);
      return;
    }
    setPresetPreview(null);
    setPresetToken('');
    setPresetError(null);
    await refresh();
  };

  const saveConnection = async (view: ToolAppView, endpoint: string, token: string): Promise<void> => {
    const sources = view.app.sources.map((source) =>
      source.kind === 'mcp' && source.server.transport.type !== 'stdio'
        ? { kind: 'mcp' as const, server: { ...source.server, transport: { type: source.server.transport.type, url: endpoint } } }
        : source
    );
    await window.electronAPI.saveToolApp({
      ...view.app,
      sources,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    } as Parameters<typeof window.electronAPI.saveToolApp>[0]);
    await refresh();
  };

  const visibleApps = useMemo(() => {
    const needleLower = needle.trim().toLowerCase();
    return views.filter((view) => {
      if (needleLower && !`${view.app.name} ${view.app.description ?? ''}`.toLowerCase().includes(needleLower)) {
        return false;
      }
      if (statusFilter === 'disabled') {
        return !view.app.enabled;
      }
      if (statusFilter !== 'all') {
        return view.app.enabled && healthOf(view) === statusFilter;
      }
      return true;
    });
  }, [views, needle, statusFilter]);

  const detailView = detail;

  return (
    <div className="space-y-6">
      <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_NAV_MATCHING_HELP}</p>

      <section aria-label={TEXT.SETTINGS_NAV_APPS} className="space-y-3">
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
        </div>

        {visibleApps.length === 0 ? (
          <EmptyState icon={undefined} title={TEXT.APPS_EMPTY} compact />
        ) : (
          <ul className="space-y-2">
            {visibleApps.map((view) => (
              <li key={view.app.id} className="flex items-center gap-3 rounded-lg border border-[var(--as-border)] p-3">
                <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--as-muted)] text-sm font-semibold">
                  {view.app.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{view.app.name}</p>
                  <p className="truncate text-xs text-[var(--as-muted-foreground)]">{view.app.description}</p>
                  {view.app.error && (
                    <p role="alert" className="text-xs text-[var(--as-danger)]">
                      {view.app.error}
                    </p>
                  )}
                </div>
                <Badge variant="outline" className="text-[10px]">{sourceChip(view)}</Badge>
                <Badge
                  variant="outline"
                  className={`text-[10px] ${healthOf(view) === 'error' ? 'text-[var(--as-danger)]' : ''}`}
                  title={view.status?.lastError ?? undefined}
                >
                  {healthLabel(view)}
                </Badge>
                <Switch checked={view.app.enabled} onCheckedChange={(enabled) => void toggleApp(view, enabled)} label={interpolate(TEXT.APPS_ENABLED_LABEL, { name: view.app.name })} />
                <Button size="sm" variant="outline" onClick={() => setDetailId(view.app.id)}>
                  {TEXT.APPS_DETAILS}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => requestRemove(view)}>
                  {TEXT.APPS_REMOVE}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={TEXT.APPS_PRESETS_TITLE} className="space-y-2 rounded-lg border border-[var(--as-border)] p-4">
        <h3 className="text-sm font-semibold">{TEXT.APPS_PRESETS_TITLE}</h3>
        <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_PRESETS_DESCRIPTION}</p>
        <ul className="space-y-2">
          {presets.map((preset) => (
            <li key={preset.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{preset.name}</p>
                <p className="truncate text-xs text-[var(--as-muted-foreground)]">{preset.description}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => { setPresetPreview(preset); setPresetEndpoint(preset.defaultEndpoint); setPresetError(null); }}>
                {interpolate(TEXT.APPS_PRESET_ADD, { name: preset.name })}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={TEXT.APPS_BUDGET_TITLE} className="space-y-2 rounded-lg border border-[var(--as-border)] p-4">
        <h3 className="text-sm font-semibold">{TEXT.APPS_BUDGET_TITLE}</h3>
        <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_BUDGET_DESCRIPTION}</p>
        <p role="status" className="text-xs">
          {interpolate(TEXT.APPS_BUDGET_BOUND, { count: nativeToolCount + boundToolCount })}
        </p>
        {nativeToolCount + boundToolCount > toolBudget && (
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

      {detailView && (
        <Modal open onOpenChange={(open) => !open && setDetailId(null)}>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>{interpolate(TEXT.APPS_DETAIL_TITLE, { name: detailView.app.name })}</ModalTitle>
            </ModalHeader>
            <div className="space-y-5">
              <section aria-label={TEXT.APPS_CONNECTION_TITLE} className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--as-muted-foreground)]">{TEXT.APPS_CONNECTION_TITLE}</h4>
                <ConnectionEditor view={detailView} onSave={saveConnection} />
                {detailView.app.sources[0]?.kind === 'mcp' && (
                  <div className="text-xs text-[var(--as-muted-foreground)]">
                    <p>{interpolate(TEXT.APPS_SECRETS_KEYS, { keys: [...detailView.envKeys, ...detailView.headerKeys].join(', ') || '—' })}</p>
                    {testResult && (
                      <p role="status">{testResult}</p>
                    )}
                    <Button size="sm" variant="outline" onClick={() => void runTest(detailView)}>
                      {TEXT.APPS_TEST_ACTION}
                    </Button>
                  </div>
                )}
              </section>

              <section aria-label={TEXT.APPS_EXPOSURE_TITLE} className="space-y-2">
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
              </section>

              <section aria-label={TEXT.APPS_TOOLS_TITLE} className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--as-muted-foreground)]">{TEXT.APPS_TOOLS_TITLE}</h4>
                <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_TOOLS_AUTOSAVE}</p>
                <ul className="space-y-1">
                  {detailView.knownTools.map((tool) => {
                    const base = tool.state?.baseRisk ?? 'state-changing';
                    const effective = tool.state?.riskOverride ?? base;
                    return (
                      <li key={tool.name} className="flex items-center gap-2 rounded-md border border-[var(--as-border)] px-2 py-1.5">
                        <Switch
                          checked={tool.state?.enabled !== false}
                          onCheckedChange={(enabled) => void toggleTool(detailView, tool.name, enabled)}
                          label={interpolate(TEXT.APPS_TOOL_ENABLED_LABEL, { name: tool.name })}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{tool.name}</span>
                        {tool.state === null && (
                          <Badge variant="outline" className="text-[10px]">{TEXT.APPS_TOOL_NEW_BADGE}</Badge>
                        )}
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${RISK_BADGE_CLASS[effective]}`}>{effective}</span>
                        <label className="text-xs">
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
                      </li>
                    );
                  })}
                </ul>
                {undo && (
                  <div role="status" className="flex items-center gap-2 text-xs">
                    <span>{interpolate(TEXT.APPS_TOOL_UNDO, { name: undo.toolName })}</span>
                    <Button size="sm" variant="ghost" onClick={() => void undoToolToggle()}>
                      {TEXT.APPS_UNDO}
                    </Button>
                  </div>
                )}
              </section>

              {detailView.app.sources[0]?.kind === 'mcp' && (
                <section aria-label={TEXT.APPS_SCOPE_TITLE} className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--as-muted-foreground)]">{TEXT.APPS_SCOPE_TITLE}</h4>
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
                  <Button size="sm" variant="outline" onClick={() => setScopeRules((prev) => [...prev, { effect: 'deny', pattern: 'lock.*' }])}>
                    {TEXT.APPS_SCOPE_ADD}
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => void saveScope(detailView)}>
                      {TEXT.APPS_SCOPE_TITLE}
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
            </div>
          </ModalContent>
        </Modal>
      )}

      {presetPreview && (
        <Modal open onOpenChange={(open) => !open && setPresetPreview(null)}>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>{interpolate(TEXT.APPS_PRESET_PREVIEW_TITLE, { name: presetPreview.name })}</ModalTitle>
            </ModalHeader>
            <div className="space-y-3">
              <p className="text-xs font-semibold">{TEXT.APPS_PRESET_PREVIEW_RISKS}</p>
              <ul className="space-y-1">
                {presetPreview.toolDomains.map((domain) => (
                  <li key={domain.tool} className="flex items-center gap-2 text-xs">
                    <span className={`rounded px-1.5 py-0.5 ${RISK_BADGE_CLASS[domain.baseRisk]}`}>{domain.baseRisk}</span>
                    <span>{domain.tool}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs font-semibold">{TEXT.APPS_PRESET_PREVIEW_NOTES}</p>
              <p className="text-xs text-[var(--as-muted-foreground)]">{presetPreview.promptNotes}</p>
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

function ConnectionEditor({
  view,
  onSave,
}: {
  view: ToolAppView;
  onSave: (view: ToolAppView, endpoint: string, token: string) => Promise<void>;
}): ReactElement {
  const mcp = view.app.sources[0]?.kind === 'mcp' ? view.app.sources[0].server : null;
  const [endpoint, setEndpoint] = useState(mcp && mcp.transport.type !== 'stdio' ? mcp.transport.url : '');
  const [token, setToken] = useState('');
  if (!mcp || mcp.transport.type === 'stdio') {
    return <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_SOURCE_NATIVE}</p>;
  }
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
      <Button size="sm" variant="outline" onClick={() => void onSave(view, endpoint, token)}>
        {TEXT.APPS_CONNECTION_TITLE}
      </Button>
    </div>
  );
}
