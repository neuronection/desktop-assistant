import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { ConfirmationModal } from "@neuronection/assistant-ui/confirmation-modal";
import { SegmentedTabs } from "@neuronection/assistant-ui/segmented-tabs";
import { MiniAppsSection } from "../apps/MiniAppsSection";
import type { SettingsDetailRoute } from "../apps/route";
import { presetCatalogEntries, toolAppGroups } from "../apps/integration-views";
import { AppDetailPage } from "../apps/sections/AppDetailPage";
import { AppPresetModal } from "../apps/sections/AppPresetModal";
import { AppsListSection } from "../apps/sections/AppsListSection";
import type {
  ConnectionPatch,
  SaveConnectionResult,
  ScopePreview,
  StatusFilter,
} from "../apps/sections/shared";
import {
  healthOf,
  parseJsonStringMap,
  parsePositiveInt,
} from "../apps/sections/shared";
import type {
  EntityScopeRule,
  ToolAppSpec,
  ToolAppToolState,
  ToolAppView,
} from "@shared/apps";
import type { McpPromptInfo, McpResourceInfo } from "@shared/mcp";
import type { ToolAppPreset } from "@shared/app-presets";
import type { ToolRiskClass } from "@shared/turns";
import { TEXT, interpolate } from "@shared/constants/text";
import { CommandsTab } from "./CommandsTab";
import type { AppConfig } from "@shared/config/AppConfig";

export interface AppsTabProps {
  miniAppRunFocus?: { packId: string; runId: string; at: number } | null;
  config: AppConfig;
  updateConfig: (updates: Partial<AppConfig>) => void;
  focusCommandId?: string | null;
  /** Detail-route state — controlled when both this and its setter are
   *  passed (SettingsApp wiring); otherwise the tab routes internally. */
  detailRoute?: SettingsDetailRoute | null;
  onDetailRouteChange?: (route: SettingsDetailRoute | null) => void;
}

export function AppsTab({
  miniAppRunFocus,
  config,
  updateConfig,
  focusCommandId,
  detailRoute: routeProp,
  onDetailRouteChange,
}: AppsTabProps): ReactElement {
  const [view, setView] = useState<"apps" | "mini" | "commands">("apps");
  const [internalRoute, setInternalRoute] =
    useState<SettingsDetailRoute | null>(null);
  const detailRoute = routeProp ?? internalRoute;
  const onDetailRouteChangeOrDefault = onDetailRouteChange ?? setInternalRoute;
  const [views, setViews] = useState<ToolAppView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deferredSupported, setDeferredSupported] = useState(false);
  const [nativeToolCount, setNativeToolCount] = useState(0);
  const [presets, setPresets] = useState<ToolAppPreset[]>([]);
  const [toolBudget, setToolBudget] = useState(25);
  const [digestStats, setDigestStats] = useState<
    Record<string, { entities: number; ageMinutes: number }>
  >({});
  const [needle, setNeedle] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<"preset" | "custom">("preset");
  const [selectedPreset, setSelectedPreset] = useState<ToolAppPreset | null>(
    null,
  );
  const [presetSearch, setPresetSearch] = useState("");
  const [presetEndpoint, setPresetEndpoint] = useState("");
  const [presetToken, setPresetToken] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [customType, setCustomType] = useState<"http" | "sse" | "stdio">(
    "http",
  );
  const [customUrl, setCustomUrl] = useState("");
  const [customCommand, setCustomCommand] = useState("");
  const [customArgs, setCustomArgs] = useState("");
  const [customToken, setCustomToken] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const [customAllowlist, setCustomAllowlist] = useState("");
  const [customTimeout, setCustomTimeout] = useState("");
  const [customMaxConcurrent, setCustomMaxConcurrent] = useState("");
  const [customEnv, setCustomEnv] = useState("");
  const [customHeaders, setCustomHeaders] = useState("");
  const [customDirectives, setCustomDirectives] = useState("");
  const [customExposure, setCustomExposure] =
    useState<ToolAppSpec["exposure"]>("relevance");
  const [cardTests, setCardTests] = useState<Record<string, string>>({});
  const [removeTarget, setRemoveTarget] = useState<ToolAppView | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [undo, setUndo] = useState<{
    appId: string;
    toolName: string;
    previous: ToolAppToolState | null;
    timer: number;
  } | null>(null);
  const [scopeRules, setScopeRules] = useState<EntityScopeRule[]>([]);
  const [scopePreview, setScopePreview] = useState<ScopePreview | null>(null);
  const [detailTab, setDetailTab] = useState<
    "connection" | "tools" | "resources" | "prompts" | "scope"
  >("connection");
  const [content, setContent] = useState<{
    resources: McpResourceInfo[];
    prompts: McpPromptInfo[];
    error?: string;
  } | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [toolNeedle, setToolNeedle] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);
  const connectionSaveRef = useRef<
    ((directives: string) => Promise<boolean | void>) | null
  >(null);
  const directivesDraftRef = useRef<(() => string) | null>(null);

  const detail = useMemo(
    () =>
      detailRoute?.kind === "app-detail"
        ? (views.find((candidate) => candidate.app.id === detailRoute.appId) ??
          null)
        : null,
    [views, detailRoute],
  );

  useEffect(() => {
    if (detailRoute?.kind === "app-detail" && !loading && !detail) {
      onDetailRouteChangeOrDefault(null);
    }
  }, [detailRoute, loading, detail, onDetailRouteChangeOrDefault]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [state, presetRows, config, digestStats] = await Promise.all([
        window.electronAPI.getToolApps(),
        window.electronAPI.listToolAppPresets().catch(() => []),
        window.electronAPI.loadConfig(),
        window.electronAPI
          .getToolAppDigestStats()
          .catch(
            () =>
              ({}) as Record<string, { entities: number; ageMinutes: number }>,
          ),
      ]);
      setViews(state.apps);
      setDeferredSupported(state.deferredSupported);
      setNativeToolCount(state.nativeToolCount ?? 0);
      setPresets(presetRows);
      setToolBudget(config.toolApps?.toolBudget ?? 25);
      setDigestStats(digestStats);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : TEXT.APPS_EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (miniAppRunFocus) {
      setView("mini");
    }
  }, [miniAppRunFocus]);

  useEffect(() => {
    if (detailRoute) {
      setView(detailRoute.kind === "app-detail" ? "apps" : "mini");
    }
  }, [detailRoute]);

  const loadContent = useCallback(async (appId: string) => {
    setContentLoading(true);
    try {
      const result = await window.electronAPI.getToolAppContent(appId);
      setContent(result);
    } catch (error) {
      setContent({
        resources: [],
        prompts: [],
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setContentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!detail) {
      setScopeRules([]);
      setScopePreview(null);
      setTestResult(null);
      setContent(null);
    } else {
      setScopeRules(detail.app.entityScope?.rules ?? []);
    }
    setDetailTab("connection");
    setToolNeedle("");
  }, [detail?.app.id]);

  useEffect(() => {
    if (!detail) {
      return;
    }
    if (detailTab === "resources" || detailTab === "prompts") {
      if (!content) {
        void loadContent(detail.app.id);
      }
    }
  }, [detailTab, detail?.app.id, content, loadContent, detail]);

  const toggleApp = async (
    target: ToolAppView,
    enabled: boolean,
  ): Promise<void> => {
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
    await refresh();
  };

  const runCardTest = async (target: ToolAppView): Promise<void> => {
    const result = await window.electronAPI.testToolApp(target.app.id);
    setCardTests((prev) => ({
      ...prev,
      [target.app.id]: result.ok
        ? interpolate(TEXT.APPS_TEST_OK, {
            latency: result.latencyMs ?? 0,
            count: result.toolCount ?? 0,
          })
        : interpolate(TEXT.APPS_TEST_FAIL, {
            error: result.error ?? "unknown",
          }),
    }));
  };

  const boundToolCount = useMemo(
    () =>
      views
        .filter((candidate) => candidate.app.enabled && !candidate.app.error)
        .reduce(
          (total, candidate) =>
            total +
            candidate.knownTools.filter((tool) => tool.state?.enabled !== false)
              .length,
          0,
        ),
    [views],
  );

  const totalToolCount = nativeToolCount + boundToolCount;

  const saveBudget = async (value: number): Promise<void> => {
    const config = await window.electronAPI.loadConfig();
    if (!config.toolApps) {
      return;
    }
    await window.electronAPI.saveConfig({
      toolApps: { ...config.toolApps, toolBudget: value },
    });
    setToolBudget(value);
  };

  const setExposure = async (
    target: ToolAppView,
    exposure: ToolAppSpec["exposure"],
  ): Promise<void> => {
    await window.electronAPI.saveToolApp({ ...target.app, exposure });
    await refresh();
  };

  const saveIcon = async (
    target: ToolAppView,
    icon: string | undefined,
  ): Promise<void> => {
    const { icon: _ignored, ...rest } = target.app;
    await window.electronAPI.saveToolApp({
      ...rest,
      ...(icon ? { icon } : {}),
    } as Parameters<typeof window.electronAPI.saveToolApp>[0]);
    await refresh();
  };

  const toggleExposeResources = async (
    target: ToolAppView,
    expose: boolean,
  ): Promise<void> => {
    await window.electronAPI.saveToolApp({
      ...target.app,
      exposeResources: expose,
    } as Parameters<typeof window.electronAPI.saveToolApp>[0]);
    await refresh();
  };

  const toggleTool = async (
    target: ToolAppView,
    toolName: string,
    enabled: boolean,
  ): Promise<void> => {
    const previous =
      target.knownTools.find((tool) => tool.name === toolName)?.state ?? null;
    if (undo) {
      clearTimeout(undo.timer);
      setUndo(null);
    }
    await window.electronAPI.setToolAppState(target.app.id, toolName, {
      enabled,
    });
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
    await window.electronAPI.setToolAppState(
      appId,
      toolName,
      previous ? { enabled: previous.enabled } : null,
    );
    await refresh();
  };

  const setRiskOverride = async (
    target: ToolAppView,
    toolName: string,
    risk: ToolRiskClass | null,
  ): Promise<void> => {
    await window.electronAPI.setToolAppState(
      target.app.id,
      toolName,
      risk ? { riskOverride: risk } : null,
    );
    await refresh();
  };

  const saveToolTags = async (
    appId: string,
    toolName: string,
    tags: string[],
  ): Promise<void> => {
    await window.electronAPI.setToolAppState(appId, toolName, {
      keywordTags: tags,
    });
    await refresh();
  };

  const runTest = async (target: ToolAppView): Promise<void> => {
    const result = await window.electronAPI.testToolApp(target.app.id);
    setTestResult(
      result.ok
        ? interpolate(TEXT.APPS_TEST_OK, {
            latency: result.latencyMs ?? 0,
            count: result.toolCount ?? 0,
          })
        : interpolate(TEXT.APPS_TEST_FAIL, {
            error: result.error ?? "unknown",
          }),
    );
    await refresh();
  };

  const saveScope = async (target: ToolAppView): Promise<void> => {
    const hasRules = scopeRules.length > 0;
    await window.electronAPI.setToolAppEntityScope(
      target.app.id,
      hasRules ? { rules: scopeRules } : null,
    );
    await refresh();
    await runScopePreview(target.app.id);
  };

  const runScopePreview = async (appId: string): Promise<void> => {
    const preview = await window.electronAPI.previewToolAppScope(
      appId,
      scopeRules,
    );
    setScopePreview(preview);
  };

  const saveDirectives = async (
    target: ToolAppView,
    directives: string,
  ): Promise<void> => {
    const trimmed = directives.trim();
    await window.electronAPI.saveToolApp({
      ...target.app,
      ...(trimmed ? { directives: trimmed } : { directives: undefined }),
    } as Parameters<typeof window.electronAPI.saveToolApp>[0]);
    await refresh();
  };

  const saveConnection = async (
    target: ToolAppView,
    patch: ConnectionPatch,
  ): Promise<SaveConnectionResult> => {
    const sources = target.app.sources.map((source) => {
      if (source.kind !== "mcp") {
        return source;
      }
      const transport =
        source.server.transport.type === "stdio"
          ? {
              type: "stdio" as const,
              command: patch.command ?? source.server.transport.command,
              ...(patch.args
                ? { args: patch.args }
                : source.server.transport.args
                  ? { args: source.server.transport.args }
                  : {}),
            }
          : {
              type: source.server.transport.type,
              ...(patch.endpoint ? { url: patch.endpoint } : {}),
            };
      return {
        kind: "mcp" as const,
        server: {
          ...source.server,
          transport,
          ...(patch.allowlist ? { allowlist: patch.allowlist } : {}),
          ...(patch.defaultAction
            ? { defaultAction: patch.defaultAction }
            : {}),
          ...(patch.timeoutMs !== undefined
            ? { timeoutMs: patch.timeoutMs }
            : {}),
          ...(patch.maxConcurrent !== undefined
            ? { maxConcurrent: patch.maxConcurrent }
            : {}),
        },
      };
    });
    const result = await window.electronAPI.saveToolApp({
      ...target.app,
      sources,
      ...(patch.env ? { env: patch.env } : {}),
      ...(patch.headers ? { headers: patch.headers } : {}),
      ...(patch.token ? { authToken: patch.token } : {}),
      ...(patch.directives
        ? { directives: patch.directives }
        : { directives: undefined }),
    } as Parameters<typeof window.electronAPI.saveToolApp>[0]);
    await refresh();
    return result;
  };

  const savePreset = async (): Promise<void> => {
    if (!selectedPreset) {
      return;
    }
    const serverName =
      selectedPreset.id === "home-assistant"
        ? "homeassistant"
        : selectedPreset.id.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    const transport =
      selectedPreset.transport === "stdio"
        ? (() => {
            const [command, ...args] = presetEndpoint.trim().split(/\s+/);
            return {
              type: "stdio" as const,
              command,
              ...(args.length > 0 ? { args } : {}),
            };
          })()
        : { type: selectedPreset.transport, url: presetEndpoint };
    const credentials = presetToken
      ? selectedPreset.auth?.kind === "env" && selectedPreset.auth.key
        ? { env: { [selectedPreset.auth.key]: presetToken } }
        : { headers: { Authorization: `Bearer ${presetToken}` } }
      : {};
    const result = await window.electronAPI.saveToolApp({
      id: "",
      name: selectedPreset.name,
      description: selectedPreset.description,
      enabled: true,
      exposure: "relevance",
      ...(selectedPreset.icon ? { icon: selectedPreset.icon } : {}),
      sources: [
        {
          kind: "mcp",
          server: {
            id: "",
            name: serverName,
            transport,
            enabled: true,
            defaultAction: "allow",
          },
        },
      ],
      toolState: {},
      presetId: selectedPreset.id,
      ...credentials,
    } as Parameters<typeof window.electronAPI.saveToolApp>[0]);
    if (!result.ok) {
      setPresetError(result.error);
      return;
    }
    setSelectedPreset(null);
    setPresetToken("");
    setPresetError(null);
    setAddOpen(false);
    await refresh();
  };

  const saveCustomApp = async (): Promise<void> => {
    const name = customName.trim();
    if (!name) {
      setCustomError("App name is required.");
      return;
    }
    let env: Record<string, string> | undefined;
    let headersJson: Record<string, string> | undefined;
    if (customEnv.trim()) {
      const parsed = parseJsonStringMap(customEnv);
      if (!parsed.ok) {
        setCustomError(
          interpolate(TEXT.APPS_CUSTOM_JSON_ERROR, {
            field: TEXT.APPS_CUSTOM_ENV,
            error: parsed.error,
          }),
        );
        return;
      }
      env = parsed.value;
    }
    if (customHeaders.trim()) {
      const parsed = parseJsonStringMap(customHeaders);
      if (!parsed.ok) {
        setCustomError(
          interpolate(TEXT.APPS_CUSTOM_JSON_ERROR, {
            field: TEXT.APPS_CUSTOM_HEADERS,
            error: parsed.error,
          }),
        );
        return;
      }
      headersJson = parsed.value;
    }
    const timeout = parsePositiveInt(customTimeout);
    if (!timeout.ok) {
      setCustomError(
        interpolate(TEXT.APPS_CUSTOM_NUMBER_ERROR, {
          field: TEXT.APPS_CUSTOM_TIMEOUT,
        }),
      );
      return;
    }
    const concurrency = parsePositiveInt(customMaxConcurrent);
    if (!concurrency.ok) {
      setCustomError(
        interpolate(TEXT.APPS_CUSTOM_NUMBER_ERROR, {
          field: TEXT.APPS_CUSTOM_MAXCONC,
        }),
      );
      return;
    }
    const allowlistTools = customAllowlist
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const serverName =
      name
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "custom";
    const transport =
      customType === "stdio"
        ? {
            type: "stdio" as const,
            command: customCommand.trim(),
            args: customArgs.trim()
              ? customArgs.trim().split(/\s+/)
              : undefined,
          }
        : { type: customType, url: customUrl.trim() };
    const headers = {
      ...headersJson,
      ...(customToken ? { Authorization: `Bearer ${customToken}` } : {}),
    };
    const result = await window.electronAPI.saveToolApp({
      id: "",
      name,
      enabled: true,
      sources: [
        {
          kind: "mcp",
          server: {
            id: "",
            name: serverName,
            transport,
            enabled: true,
            defaultAction: allowlistTools.length > 0 ? "deny" : "allow",
            ...(allowlistTools.length > 0 ? { allowlist: allowlistTools } : {}),
            ...(timeout.value !== undefined
              ? { timeoutMs: timeout.value }
              : {}),
            ...(concurrency.value !== undefined
              ? { maxConcurrent: concurrency.value }
              : {}),
          },
        },
      ],
      toolState: {},
      exposure: "relevance",
      ...(env ? { env } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    } as Parameters<typeof window.electronAPI.saveToolApp>[0]);
    if (!result.ok) {
      setCustomError(result.error);
      return;
    }
    setAddOpen(false);
    setCustomName("");
    setCustomUrl("");
    setCustomCommand("");
    setCustomArgs("");
    setCustomToken("");
    setCustomAllowlist("");
    setCustomTimeout("");
    setCustomMaxConcurrent("");
    setCustomEnv("");
    setCustomHeaders("");
    setCustomError(null);
    await refresh();
  };

  const visibleApps = useMemo(() => {
    const needleLower = needle.trim().toLowerCase();
    return views.filter((candidate) => {
      if (
        needleLower &&
        !`${candidate.app.name} ${candidate.app.description ?? ""}`
          .toLowerCase()
          .includes(needleLower)
      ) {
        return false;
      }
      if (statusFilter === "disabled") {
        return !candidate.app.enabled;
      }
      if (statusFilter !== "all") {
        return candidate.app.enabled && healthOf(candidate) === statusFilter;
      }
      return true;
    });
  }, [views, needle, statusFilter]);

  const visibleGroups = useMemo(
    () => toolAppGroups(visibleApps),
    [visibleApps],
  );
  const catalogEntries = useMemo(
    () => presetCatalogEntries(presets, views),
    [presets, views],
  );

  return (
    <div className="space-y-5">
      {!detailRoute && (
        <SegmentedTabs
          ariaLabel={TEXT.SETTINGS_NAV_APPS}
          items={[
            { value: "apps", label: TEXT.INTEGRATIONS_MCP_APPS },
            { value: "mini", label: TEXT.INTEGRATIONS_PACKS },
            { value: "commands", label: TEXT.INTEGRATIONS_COMMANDS },
          ]}
          value={view}
          onValueChange={(next) =>
            setView(next as "apps" | "mini" | "commands")
          }
        />
      )}

      {detailRoute?.kind === "app-detail" && detail ? (
        <AppDetailPage
          detail={detail}
          onClose={() => onDetailRouteChangeOrDefault(null)}
          detailTab={detailTab}
          onDetailTabChange={setDetailTab}
          deferredSupported={deferredSupported}
          digestStats={digestStats}
          testResult={testResult}
          onTest={runTest}
          onSaveIcon={saveIcon}
          onSetExposure={setExposure}
          onToggleExposeResources={toggleExposeResources}
          onSaveConnection={saveConnection}
          onSaveDirectives={saveDirectives}
          connectionSaveRef={connectionSaveRef}
          directivesDraftRef={directivesDraftRef}
          toolNeedle={toolNeedle}
          onToolNeedleChange={setToolNeedle}
          undo={undo}
          onToggleTool={toggleTool}
          onUndoToolToggle={undoToolToggle}
          onSetRiskOverride={setRiskOverride}
          onSaveToolTags={saveToolTags}
          content={content}
          contentLoading={contentLoading}
          scopeRules={scopeRules}
          onScopeRulesChange={setScopeRules}
          scopePreview={scopePreview}
          onSaveScope={saveScope}
          onPreviewScope={runScopePreview}
          detailSaving={detailSaving}
          onDetailSavingChange={setDetailSaving}
        />
      ) : (
        <>
          {view === "apps" && (
            <AppsListSection
              needle={needle}
              onNeedleChange={setNeedle}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              loading={loading}
              error={loadError}
              groups={visibleGroups}
              views={views}
              cardTests={cardTests}
              toolBudget={toolBudget}
              totalToolCount={totalToolCount}
              onToolBudgetChange={setToolBudget}
              onSaveBudget={saveBudget}
              onToggleApp={toggleApp}
              onMasterToggle={setMasterEnabled}
              onConfigure={(id) =>
                onDetailRouteChangeOrDefault({ kind: "app-detail", appId: id })
              }
              onRemove={setRemoveTarget}
              onTest={runCardTest}
              onAdd={() => {
                setAddOpen(true);
                setAddMode("preset");
                setSelectedPreset(null);
                setPresetError(null);
              }}
            />
          )}

          {view === "mini" && (
            <MiniAppsSection
              miniAppRunFocus={miniAppRunFocus}
              route={detailRoute}
              onRouteChange={onDetailRouteChangeOrDefault}
            />
          )}

          {view === "commands" && (
            <CommandsTab
              config={config}
              updateConfig={updateConfig}
              focusCommandId={focusCommandId}
            />
          )}
        </>
      )}

      {addOpen && (
        <AppPresetModal
          onClose={() => setAddOpen(false)}
          addMode={addMode}
          onAddModeSelect={(mode) => {
            setAddMode(mode);
            setSelectedPreset(null);
            setPresetError(null);
            setCustomError(null);
          }}
          catalogEntries={catalogEntries}
          presetSearch={presetSearch}
          onPresetSearchChange={setPresetSearch}
          loading={loading}
          loadError={loadError}
          presets={presets}
          selectedPreset={selectedPreset}
          onSelectPreset={setSelectedPreset}
          presetEndpoint={presetEndpoint}
          onPresetEndpointChange={setPresetEndpoint}
          presetToken={presetToken}
          onPresetTokenChange={setPresetToken}
          presetError={presetError}
          onPresetErrorChange={setPresetError}
          onSavePreset={savePreset}
          customName={customName}
          onCustomNameChange={setCustomName}
          customType={customType}
          onCustomTypeChange={setCustomType}
          customUrl={customUrl}
          onCustomUrlChange={setCustomUrl}
          customCommand={customCommand}
          onCustomCommandChange={setCustomCommand}
          customArgs={customArgs}
          onCustomArgsChange={setCustomArgs}
          customToken={customToken}
          onCustomTokenChange={setCustomToken}
          customAllowlist={customAllowlist}
          onCustomAllowlistChange={setCustomAllowlist}
          customTimeout={customTimeout}
          onCustomTimeoutChange={setCustomTimeout}
          customMaxConcurrent={customMaxConcurrent}
          onCustomMaxConcurrentChange={setCustomMaxConcurrent}
          customEnv={customEnv}
          onCustomEnvChange={setCustomEnv}
          customHeaders={customHeaders}
          onCustomHeadersChange={setCustomHeaders}
          customDirectives={customDirectives}
          onCustomDirectivesChange={setCustomDirectives}
          customExposure={customExposure}
          onCustomExposureChange={setCustomExposure}
          customError={customError}
          deferredSupported={deferredSupported}
          onSaveCustomApp={saveCustomApp}
        />
      )}

      <ConfirmationModal
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={interpolate(TEXT.APPS_REMOVE_CONFIRM_TITLE, {
          name: removeTarget?.app.name ?? "",
        })}
        description={TEXT.APPS_REMOVE_CONFIRM_DESCRIPTION}
        confirmLabel={TEXT.APPS_REMOVE_CONFIRM_ACTION}
        destructive
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
}
