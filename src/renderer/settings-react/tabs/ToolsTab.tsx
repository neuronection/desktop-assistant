import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { EmptyState } from '@neuronection/assistant-ui/empty-state';
import { SearchInput } from '@neuronection/assistant-ui/search-input';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { FolderPlus, Plug, PlugZap, Settings2, ShieldCheck, Trash2 } from 'lucide-react';
import type { McpServerConfig, McpServerView, McpTestResult, McpToolInfo } from '@shared/mcp';
import type { ToolCatalogEntry, ToolCategory, ToolClassDefaults, ToolRiskClass, ToolVerificationSettings } from '@shared/turns';
import { Label } from './fields';
import { TEXT, interpolate } from '@shared/constants/text';
import { SearchSection } from './SearchSection';
import { MemoriesManager } from '../tools/MemoriesManager';
import { CATEGORY_META, RISK_BADGE_CLASS, RISK_LABEL, Switch, verificationBadge } from '../tools/shared';
import { ToolDetailsModal, type DetailTool } from '../tools/ToolDetailsModal';

interface ServerFormState {
  id: string | null;
  name: string;
  transportType: 'stdio' | 'http' | 'sse';
  command: string;
  args: string;
  url: string;
  envJson: string;
  headersJson: string;
  allowlist: string;
  timeoutMs: string;
  enabled: boolean;
}

const EMPTY_FORM: ServerFormState = {
  id: null,
  name: '',
  transportType: 'stdio',
  command: '',
  args: '',
  url: '',
  envJson: '',
  headersJson: '',
  allowlist: '',
  timeoutMs: '',
  enabled: true,
};

type RiskFilter = 'all' | ToolRiskClass;
type StatusFilter = 'all' | 'enabled' | 'disabled' | 'approved' | 'custom';
type CategoryFilter = 'all' | ToolCategory;

const RISK_FILTERS: { value: RiskFilter; label: string }[] = [
  { value: 'all', label: TEXT.TOOLS_FILTER_ALL },
  { value: 'read-only', label: TEXT.TOOLS_FILTER_READ_ONLY },
  { value: 'state-changing', label: TEXT.TOOLS_FILTER_STATE_CHANGING },
  { value: 'destructive', label: TEXT.TOOLS_FILTER_DESTRUCTIVE },
];

const STATUS_FILTERS: { value: StatusFilter; countKey: 'total' | 'enabled' | 'disabled' | 'granted' | 'overridden' }[] = [
  { value: 'all', countKey: 'total' },
  { value: 'enabled', countKey: 'enabled' },
  { value: 'disabled', countKey: 'disabled' },
  { value: 'approved', countKey: 'granted' },
  { value: 'custom', countKey: 'overridden' },
];

const STATUS_COUNT_KEYS: Record<StatusFilter, string> = {
  all: TEXT.TOOLS_TOTAL_COUNT,
  enabled: TEXT.TOOLS_ENABLED_COUNT,
  disabled: TEXT.TOOLS_DISABLED_COUNT,
  approved: TEXT.TOOLS_GRANTED_COUNT,
  custom: TEXT.TOOLS_OVERRIDES_COUNT,
};

const CATEGORY_FILTERS: (CategoryFilter | 'all')[] = ['all', 'files', 'system', 'desktop', 'network', 'power', 'memory'];

const PRESETS: Record<string, { label: string; hint: string; defaults: ToolClassDefaults }> = {
  cautious: { label: TEXT.TOOLS_PRESET_CAUTIOUS, hint: TEXT.TOOLS_PRESET_CAUTIOUS_HINT, defaults: {} },
  trusted: { label: TEXT.TOOLS_PRESET_TRUSTED, hint: TEXT.TOOLS_PRESET_TRUSTED_HINT, defaults: { stateChanging: 'never' } },
  manual: { label: TEXT.TOOLS_PRESET_MANUAL, hint: TEXT.TOOLS_PRESET_MANUAL_HINT, defaults: { readOnly: 'always_ask', stateChanging: 'always_ask' } },
};

function matchingPreset(defaults: ToolClassDefaults): string | null {
  for (const [key, preset] of Object.entries(PRESETS)) {
    if (JSON.stringify(preset.defaults) === JSON.stringify(defaults)) {
      return key;
    }
  }
  return null;
}

function parseJsonMap(raw: string, label: string): Record<string, string> | undefined {
  if (!raw.trim()) {
    return undefined;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(interpolate(TEXT.TOOLS_JSON_OBJECT_REQUIRED, { label }));
  }
  return parsed as Record<string, string>;
}

function mcpToolToDetail(tool: McpToolInfo): DetailTool {
  return {
    name: tool.namespaced,
    description: tool.description,
    risk: tool.risk,
    editableArgs: false,
    enabled: tool.enabled,
    granted: false,
    parameters: tool.parameters,
    verification: tool.verification,
    source: 'mcp',
  };
}

export function ToolsTab(): JSX.Element {
  const [catalog, setCatalog] = useState<ToolCatalogEntry[]>([]);
  const [classDefaults, setClassDefaults] = useState<ToolClassDefaults>({});
  const [roots, setRoots] = useState<string[]>([]);
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [form, setForm] = useState<ServerFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, McpTestResult>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [detail, setDetail] = useState<DetailTool | null>(null);
  const [serverTools, setServerTools] = useState<Record<string, { loading: boolean; ok: boolean; tools: McpToolInfo[]; error?: string }>>({});

  const refresh = useCallback(async () => {
    const [catalogRows, config, serverViews] = await Promise.all([
      window.electronAPI.getToolCatalog(),
      window.electronAPI.loadConfig(),
      window.electronAPI.getMcpServers(),
    ]);
    setCatalog(catalogRows);
    setClassDefaults(config.tools.classDefaults ?? {});
    setRoots(config.tools.grantedRoots);
    setServers(serverViews);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshCatalog = useCallback(async () => {
    setCatalog(await window.electronAPI.getToolCatalog());
  }, []);

  const stats = useMemo(
    () => ({
      total: catalog.length,
      enabled: catalog.filter((row) => row.enabled).length,
      disabled: catalog.filter((row) => !row.enabled).length,
      granted: catalog.filter((row) => row.granted).length,
      overridden: catalog.filter((row) => row.verificationCustom).length,
    }),
    [catalog]
  );

  const visibleTools = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter((row) => {
      if (riskFilter !== 'all' && row.risk !== riskFilter) {
        return false;
      }
      if (categoryFilter !== 'all' && row.category !== categoryFilter) {
        return false;
      }
      switch (statusFilter) {
        case 'enabled':
          if (!row.enabled) return false;
          break;
        case 'disabled':
          if (row.enabled) return false;
          break;
        case 'approved':
          if (!row.granted) return false;
          break;
        case 'custom':
          if (!row.verificationCustom) return false;
          break;
      }
      if (!needle) {
        return true;
      }
      return (
        row.name.toLowerCase().includes(needle) ||
        row.description.toLowerCase().includes(needle) ||
        row.parameters.some((parameter) => parameter.name.toLowerCase().includes(needle))
      );
    });
  }, [catalog, query, riskFilter, statusFilter, categoryFilter]);

  const applyClassDefaults = async (defaults: ToolClassDefaults): Promise<void> => {
    await window.electronAPI.setToolClassDefaults(defaults);
    setClassDefaults(defaults);
    await refreshCatalog();
  };

  const setEnabled = async (name: string, enabled: boolean): Promise<void> => {
    await window.electronAPI.setToolEnabled(name, enabled);
    await refreshCatalog();
  };

  const setGrant = async (name: string, granted: boolean): Promise<void> => {
    await window.electronAPI.setToolGrant(name, granted);
    await refreshCatalog();
  };

  const saveVerification = async (name: string, settings: ToolVerificationSettings): Promise<void> => {
    await window.electronAPI.setToolVerification(name, settings);
    await refreshCatalog();
  };

  const toggleServer = async (serverId: string, enabled: boolean): Promise<void> => {
    await window.electronAPI.setMcpEnabled(serverId, enabled);
    setServers((prev) =>
      prev.map((view) => (view.config.id === serverId ? { ...view, config: { ...view.config, enabled } } : view))
    );
  };

  const startEdit = (view: McpServerView): void => {
    const { config } = view;
    setFormError(null);
    setForm({
      id: config.id,
      name: config.name,
      transportType: config.transport.type,
      command: config.transport.type === 'stdio' ? config.transport.command : '',
      args: config.transport.type === 'stdio' ? (config.transport.args ?? []).join(' ') : '',
      url: config.transport.type !== 'stdio' ? config.transport.url : '',
      envJson: '',
      headersJson: '',
      allowlist: (config.allowlist ?? []).join(', '),
      timeoutMs: config.timeoutMs ? String(config.timeoutMs) : '',
      enabled: config.enabled,
    });
  };

  const saveForm = async (): Promise<void> => {
    if (!form || !form.name.trim()) {
      setFormError(TEXT.TOOLS_NAME_REQUIRED);
      return;
    }
    try {
      const input: Parameters<typeof window.electronAPI.saveMcpServer>[0] = {
        id: form.id ?? crypto.randomUUID(),
        name: form.name.trim(),
        enabled: form.enabled,
        defaultAction: 'allow',
        transport:
          form.transportType === 'stdio'
            ? {
                type: 'stdio',
                command: form.command.trim(),
                args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
              }
            : { type: form.transportType, url: form.url.trim() },
        allowlist: form.allowlist.trim()
          ? form.allowlist.split(',').map((entry) => entry.trim()).filter(Boolean)
          : undefined,
        timeoutMs: form.timeoutMs.trim() ? Number(form.timeoutMs) : undefined,
      };
      input.env = parseJsonMap(form.envJson, TEXT.TOOLS_ENV_LABEL);
      input.headers = parseJsonMap(form.headersJson, TEXT.TOOLS_HEADERS_LABEL);
      const saved = await window.electronAPI.saveMcpServer(input);
      setServers((prev) => {
        const next = prev.filter((view) => view.config.id !== saved.config.id);
        return [...next, saved];
      });
      setForm(null);
      setFormError(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteServer = async (serverId: string): Promise<void> => {
    await window.electronAPI.deleteMcpServer(serverId);
    setServers((prev) => prev.filter((view) => view.config.id !== serverId));
    setDeleting(null);
    setServerTools((prev) => {
      const { [serverId]: _removed, ...rest } = prev;
      return rest;
    });
    if (form?.id === serverId) {
      setForm(null);
    }
  };

  const testServer = async (serverId: string): Promise<void> => {
    setTesting(serverId);
    try {
      const result = await window.electronAPI.testMcpServer(serverId);
      setTestResults((prev) => ({ ...prev, [serverId]: result }));
      setServers((prev) =>
        prev.map((view) => (view.config.id === serverId ? { ...view, status: window.structuredClone(view.status) } : view))
      );
    } finally {
      setTesting(null);
    }
  };

  const loadServerTools = async (serverId: string): Promise<void> => {
    setServerTools((prev) => ({ ...prev, [serverId]: { loading: true, ok: true, tools: prev[serverId]?.tools ?? [] } }));
    const result = await window.electronAPI.listMcpTools(serverId);
    setServerTools((prev) => ({
      ...prev,
      [serverId]: { loading: false, ok: result.ok, tools: result.tools, error: result.error },
    }));
  };

  const openNativeDetail = (row: ToolCatalogEntry): DetailTool => ({
    name: row.name,
    description: row.description,
    risk: row.risk,
    editableArgs: row.editableArgs,
    enabled: row.enabled,
    granted: row.granted,
    parameters: row.parameters,
    verification: row.verification,
    source: 'native',
  });

  const transportSummary = (config: McpServerConfig): string => {
    if (config.transport.type === 'stdio') {
      return [config.transport.command, ...(config.transport.args ?? [])].join(' ');
    }
    return config.transport.url;
  };

  const activePreset = matchingPreset(classDefaults);

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h3 className="text-base font-semibold">{TEXT.TOOLS_TITLE}</h3>
        <p className="text-sm opacity-60">{TEXT.TOOLS_SUBTITLE}</p>
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--as-border)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">{TEXT.TOOLS_DEFAULTS_TITLE}</h4>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs opacity-60">{TEXT.TOOLS_PRESETS_LABEL}</span>
            {Object.entries(PRESETS).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                aria-label={interpolate(TEXT.TOOLS_PRESET_APPLY_ARIA, { name: preset.label })}
                title={preset.hint}
                aria-pressed={activePreset === key}
                className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                  activePreset === key
                    ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10 font-medium'
                    : 'border-[var(--as-border)] opacity-70 hover:opacity-100'
                }`}
                onClick={() => void applyClassDefaults(preset.defaults)}
              >
                {preset.label}
              </button>
            ))}
            {!activePreset && (
              <Badge variant="outline" className="text-[10px] font-normal" title={TEXT.TOOLS_PRESET_CUSTOM_HINT}>
                {TEXT.TOOLS_PRESET_CUSTOM}
              </Badge>
            )}
          </div>
        </div>
        <p className="text-xs opacity-60">{TEXT.TOOLS_DEFAULTS_HINT}</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="defaults-readonly">{TEXT.TOOLS_DEFAULTS_READONLY}</Label>
            <select
              id="defaults-readonly"
              aria-label={TEXT.TOOLS_DEFAULTS_READONLY_OPTIONS_ARIA}
              className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
              value={classDefaults.readOnly ?? 'run'}
              onChange={(e) =>
                void applyClassDefaults({ ...classDefaults, readOnly: e.target.value as ToolClassDefaults['readOnly'] })
              }
            >
              <option value="run">{TEXT.TOOLS_DEFAULTS_RUN_SILENTLY}</option>
              <option value="always_ask">{TEXT.TOOLS_DEFAULTS_ALWAYS_ASK}</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="defaults-state-changing">{TEXT.TOOLS_DEFAULTS_STATE_CHANGING}</Label>
            <select
              id="defaults-state-changing"
              aria-label={TEXT.TOOLS_DEFAULTS_STATE_CHANGING_OPTIONS_ARIA}
              className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
              value={classDefaults.stateChanging ?? 'standard'}
              onChange={(e) =>
                void applyClassDefaults({ ...classDefaults, stateChanging: e.target.value as ToolClassDefaults['stateChanging'] })
              }
            >
              <option value="standard">{TEXT.TOOLS_DEFAULTS_STANDARD}</option>
              <option value="never">{TEXT.TOOLS_DEFAULTS_NEVER}</option>
              <option value="always_ask">{TEXT.TOOLS_DEFAULTS_ALWAYS_ASK}</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="defaults-destructive">{TEXT.TOOLS_DEFAULTS_DESTRUCTIVE}</Label>
            <input
              id="defaults-destructive"
              readOnly
              className="w-full cursor-default rounded-md border border-[var(--as-border)] bg-[var(--as-muted)] px-2 py-1.5 text-sm opacity-70"
              value={TEXT.TOOLS_DEFAULTS_DESTRUCTIVE_LOCKED}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--as-border)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">{TEXT.TOOLS_NATIVE}</h4>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={TEXT.TOOLS_STATUS_FILTER_ARIA}>
            {STATUS_FILTERS.map(({ value, countKey }) => (
              <button
                key={value}
                type="button"
                aria-pressed={statusFilter === value}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  statusFilter === value
                    ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10 font-medium'
                    : 'border-[var(--as-border)] opacity-70 hover:opacity-100'
                }`}
                onClick={() => setStatusFilter((prev) => (prev === value ? 'all' : value))}
              >
                {interpolate(STATUS_COUNT_KEYS[value], { count: stats[countKey] })}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-44 flex-1">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={TEXT.TOOLS_SEARCH_PLACEHOLDER}
              ariaLabel={TEXT.TOOLS_SEARCH_ARIA}
              clearLabel={TEXT.TOOLS_SEARCH_CLEAR}
            />
          </div>
          <div role="group" aria-label={TEXT.TOOLS_CATEGORY_FILTER_ARIA} className="flex flex-wrap gap-1">
            {CATEGORY_FILTERS.map((value) => {
              const meta = value === 'all' ? null : CATEGORY_META[value];
              const Icon = meta?.icon;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={categoryFilter === value}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
                    categoryFilter === value
                      ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10 font-medium'
                      : 'border-[var(--as-border)] opacity-70 hover:opacity-100'
                  }`}
                  onClick={() => setCategoryFilter(value)}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
                  {value === 'all' ? TEXT.TOOLS_CAT_ALL : meta?.label}
                </button>
              );
            })}
          </div>
          <select
            aria-label={TEXT.TOOLS_RISK_FILTER_ARIA}
            className="rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-xs"
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value as RiskFilter)}
          >
            {RISK_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </div>

        {visibleTools.length === 0 ? (
          <EmptyState icon={Settings2} title={TEXT.TOOLS_NO_MATCHES} compact />
        ) : (
          <ul className="divide-y divide-[var(--as-border)] overflow-hidden rounded-lg border border-[var(--as-border)]">
            {visibleTools.map((row) => {
              const meta = CATEGORY_META[row.category];
              const Icon = meta.icon;
              const badge = verificationBadge(row.verification);
              return (
                <li
                  key={row.name}
                  className={`flex items-center gap-2 px-2.5 py-1.5 transition-colors ${
                    row.enabled ? '' : 'bg-[var(--as-muted)]/40 opacity-60'
                  }`}
                >
                  <button
                    type="button"
                    aria-label={interpolate(TEXT.TOOLS_CARD_DETAILS_ARIA, { name: row.name })}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-0.5 text-left"
                    onClick={() => setDetail(openNativeDetail(row))}
                  >
                    <Icon className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-mono text-sm font-medium">{row.name}</span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${RISK_BADGE_CLASS[row.risk]}`}>
                          {RISK_LABEL[row.risk]}
                        </span>
                        {badge && (
                          <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                            {badge}
                            {row.verificationCustom && ` · ${TEXT.TOOLS_BADGE_CUSTOM}`}
                          </Badge>
                        )}
                        {row.granted && (
                          <Badge variant="outline" className="shrink-0 text-[10px] font-normal text-emerald-500">
                            {TEXT.TOOLS_BADGE_GRANTED}
                          </Badge>
                        )}
                        {row.editableArgs && <Badge variant="outline" className="shrink-0 text-[10px] font-normal">{TEXT.TOOLS_BADGE_EDITABLE_ARGS}</Badge>}
                        {!row.enabled && <Badge variant="outline" className="shrink-0 text-[10px] font-normal">{TEXT.TOOLS_DISABLED_BADGE}</Badge>}
                      </span>
                      <span className="block truncate text-xs opacity-60">{row.description}</span>
                    </span>
                  </button>
                  <Switch
                    checked={row.enabled}
                    label={interpolate(TEXT.TOOLS_ENABLE_ARIA, { name: row.name })}
                    hideLabel
                    onCheckedChange={(checked) => void setEnabled(row.name, checked)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <MemoriesManager />

      <section className="space-y-2 rounded-xl border border-[var(--as-border)] p-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">{TEXT.TOOLS_FOLDERS}</h4>
          <Button variant="outline" size="sm" onClick={() => void window.electronAPI.pickGrantedRoot().then((root) => {
            if (root) {
              setRoots((prev) => (prev.includes(root) ? prev : [...prev, root]));
            }
          })}>
            <FolderPlus className="mr-1 h-3.5 w-3.5" aria-hidden />
            {TEXT.TOOLS_ADD_FOLDER}
          </Button>
        </div>
        <p className="text-xs opacity-50">{TEXT.TOOLS_FOLDERS_HINT}</p>
        {roots.length === 0 ? (
          <p className="text-xs opacity-50">{TEXT.TOOLS_NO_FOLDERS}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {roots.map((root) => (
              <li key={root} className="flex items-center gap-1 rounded-md bg-[var(--as-muted)] px-2 py-0.5 text-xs">
                <span className="max-w-64 truncate font-mono">{root}</span>
                <button
                  type="button"
                  aria-label={interpolate(TEXT.TOOLS_REMOVE_FOLDER_ARIA, { root })}
                  className="opacity-50 hover:opacity-100"
                  onClick={() => {
                    void window.electronAPI.removeGrantedRoot(root);
                    setRoots((prev) => prev.filter((existing) => existing !== root));
                  }}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SearchSection />

      <section className="space-y-2 rounded-xl border border-[var(--as-border)] p-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">{TEXT.TOOLS_MCP}</h4>
          <Button variant="outline" size="sm" onClick={() => { setFormError(null); setForm({ ...EMPTY_FORM }); }}>
            {TEXT.TOOLS_ADD_SERVER}
          </Button>
        </div>
        <p className="text-xs opacity-50">{TEXT.TOOLS_MCP_HINT}</p>
        {servers.length === 0 && !form && <p className="text-xs opacity-50">{TEXT.TOOLS_NO_SERVERS}</p>}
        <ul className="space-y-2">
          {servers.map((view) => {
            const test = testResults[view.config.id];
            const tools = serverTools[view.config.id];
            return (
              <li key={view.config.id} className="space-y-2 rounded-lg border border-[var(--as-border)] p-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    checked={view.config.enabled}
                    label={interpolate(TEXT.TOOLS_ENABLE_ARIA, { name: view.config.name })}
                    hideLabel
                    onCheckedChange={(checked) => void toggleServer(view.config.id, checked)}
                  />
                  <span className="font-medium">{view.config.name}</span>
                  <Badge variant="outline" className="text-[10px] font-normal uppercase">
                    {view.config.transport.type}
                  </Badge>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                      view.status.state === 'connected'
                        ? 'bg-emerald-500/15 text-emerald-500'
                        : view.status.state === 'error'
                          ? 'bg-red-500/15 text-red-500'
                          : 'bg-[var(--as-muted)]'
                    }`}
                  >
                    {view.status.state}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs opacity-50">
                    {transportSummary(view.config)}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => startEdit(view)}>
                    {TEXT.EDIT_BUTTON}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title={TEXT.TOOLS_TEST_CONNECTION}
                    disabled={testing === view.config.id}
                    onClick={() => void testServer(view.config.id)}
                  >
                    <PlugZap className="h-3.5 w-3.5" aria-hidden />
                    {test ? (test.ok ? ` ${interpolate(TEXT.TOOLS_TEST_RESULT, { count: test.toolCount ?? '', latency: test.latencyMs ?? '' })}` : ` ${TEXT.TOOLS_TEST_FAILED}`) : ''}
                  </Button>
                  <Button variant="ghost" size="sm" title={TEXT.TOOLS_DELETE_SERVER} onClick={() => setDeleting(view.config.id)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs opacity-60">
                  <span className="flex items-center gap-1">
                    <Plug className="h-3 w-3" aria-hidden />
                    {interpolate(TEXT.TOOLS_SERVER_TOOLS_COUNT, { count: view.status.toolCount })}
                    {view.envKeys.length > 0 && ` · ${interpolate(TEXT.TOOLS_SERVER_ENV, { keys: view.envKeys.join(', ') })}`}
                    {view.headerKeys.length > 0 && ` · ${interpolate(TEXT.TOOLS_SERVER_HEADERS, { keys: view.headerKeys.join(', ') })}`}
                  </span>
                  {view.status.lastError && <span className="text-red-500">{view.status.lastError}</span>}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-xs font-semibold">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                      {TEXT.TOOLS_MCP_TOOLS_TITLE}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={tools?.loading}
                      onClick={() => void loadServerTools(view.config.id)}
                    >
                      {tools?.loading ? TEXT.TOOLS_MCP_TOOLS_LOADING : TEXT.TOOLS_MCP_TOOLS_LOAD}
                    </Button>
                  </div>
                  {tools && !tools.loading && !tools.ok && tools.error && (
                    <p className="text-xs text-red-500">{interpolate(TEXT.TOOLS_MCP_TOOLS_LOAD_FAILED, { error: tools.error })}</p>
                  )}
                  {tools && !tools.loading && tools.ok && tools.tools.length === 0 && (
                    <p className="text-xs opacity-50">{TEXT.TOOLS_MCP_TOOLS_EMPTY}</p>
                  )}
                  {tools && tools.tools.length > 0 && (
                    <ul className="divide-y divide-[var(--as-border)] rounded-md border border-[var(--as-border)]">
                      {tools.tools.map((tool) => (
                        <li key={tool.namespaced} className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 text-xs">
                          <span className="min-w-0 flex-1 truncate font-mono">{tool.rawName}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${RISK_BADGE_CLASS[tool.risk]}`}>
                            {RISK_LABEL[tool.risk]}
                          </span>
                          {!tool.enabled && <Badge variant="outline" className="text-[10px] font-normal">{TEXT.TOOLS_DISABLED_BADGE}</Badge>}
                          <span className="min-w-0 flex-[2] truncate opacity-50">{tool.description}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={interpolate(TEXT.TOOLS_MCP_TOOL_CONFIGURE_ARIA, { name: tool.rawName })}
                            onClick={() => setDetail(mcpToolToDetail(tool))}
                          >
                            {TEXT.TOOLS_MCP_TOOL_CONFIGURE}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {form && (
          <div className="space-y-2 rounded-lg border border-[var(--as-border)] bg-[var(--as-muted)]/40 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="mcp-name">{TEXT.TOOLS_NAME_LABEL}</Label>
                <input
                  id="mcp-name"
                  aria-label={TEXT.TOOLS_NAME_ARIA}
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={TEXT.TOOLS_NAME_PLACEHOLDER}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mcp-transport">{TEXT.TOOLS_TRANSPORT}</Label>
                <select
                  id="mcp-transport"
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                  value={form.transportType}
                  onChange={(e) => setForm({ ...form, transportType: e.target.value as ServerFormState['transportType'] })}
                >
                  <option value="stdio">{TEXT.TOOLS_TRANSPORT_STDIO}</option>
                  <option value="http">{TEXT.TOOLS_TRANSPORT_HTTP}</option>
                  <option value="sse">{TEXT.TOOLS_TRANSPORT_SSE}</option>
                </select>
              </div>
            </div>
            {form.transportType === 'stdio' ? (
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <Label htmlFor="mcp-command">{TEXT.TOOLS_COMMAND}</Label>
                  <input
                    id="mcp-command"
                    className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 font-mono text-sm"
                    value={form.command}
                    onChange={(e) => setForm({ ...form, command: e.target.value })}
                    placeholder={TEXT.TOOLS_COMMAND_PLACEHOLDER}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mcp-args">{TEXT.TOOLS_ARGS}</Label>
                  <input
                    id="mcp-args"
                    className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 font-mono text-sm"
                    value={form.args}
                    onChange={(e) => setForm({ ...form, args: e.target.value })}
                    placeholder={TEXT.TOOLS_ARGS_PLACEHOLDER}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="mcp-url">{TEXT.TOOLS_URL}</Label>
                <input
                  id="mcp-url"
                  aria-label={TEXT.TOOLS_URL_ARIA}
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 font-mono text-sm"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder={TEXT.TOOLS_URL_PLACEHOLDER}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="mcp-env">{TEXT.TOOLS_ENV_LABEL + (form.id ? TEXT.TOOLS_ENV_LABEL_STORED : '')}</Label>
                <textarea
                  id="mcp-env"
                  aria-label={TEXT.TOOLS_ENV_ARIA}
                  className="h-16 w-full resize-y rounded-md border border-[var(--as-border)] bg-[var(--as-input)] p-2 font-mono text-xs"
                  value={form.envJson}
                  onChange={(e) => setForm({ ...form, envJson: e.target.value })}
                  placeholder={TEXT.TOOLS_ENV_PLACEHOLDER}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mcp-headers">{TEXT.TOOLS_HEADERS_LABEL + (form.id ? TEXT.TOOLS_ENV_LABEL_STORED : '')}</Label>
                <textarea
                  id="mcp-headers"
                  aria-label={TEXT.TOOLS_HEADERS_ARIA}
                  className="h-16 w-full resize-y rounded-md border border-[var(--as-border)] bg-[var(--as-input)] p-2 font-mono text-xs"
                  value={form.headersJson}
                  onChange={(e) => setForm({ ...form, headersJson: e.target.value })}
                  placeholder={TEXT.TOOLS_HEADERS_PLACEHOLDER}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="mcp-allowlist">{TEXT.TOOLS_ALLOWLIST}</Label>
                <input
                  id="mcp-allowlist"
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                  value={form.allowlist}
                  onChange={(e) => setForm({ ...form, allowlist: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mcp-timeout">{TEXT.TOOLS_TIMEOUT}</Label>
                <input
                  id="mcp-timeout"
                  type="number"
                  min={1000}
                  className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                  value={form.timeoutMs}
                  onChange={(e) => setForm({ ...form, timeoutMs: e.target.value })}
                />
              </div>
            </div>
            {formError && <p className="text-xs text-red-500">{formError}</p>}
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setForm(null)}>
                {TEXT.CANCEL_BUTTON}
              </Button>
              <Button size="sm" onClick={() => void saveForm()}>
                {TEXT.TOOLS_SAVE_SERVER}
              </Button>
            </div>
          </div>
        )}
      </section>

      {detail && detail.source === 'native' && (
        <ToolDetailsModal
          key={`native-${detail.name}`}
          tool={detail}
          onClose={() => setDetail(null)}
          onToggleEnabled={async (enabled) => {
            await setEnabled(detail.name, enabled);
            setDetail((prev) => (prev ? { ...prev, enabled } : prev));
          }}
          onToggleGrant={async (granted) => {
            await setGrant(detail.name, granted);
            setDetail((prev) => (prev ? { ...prev, granted } : prev));
          }}
          onSaveVerification={async (settings) => {
            await saveVerification(detail.name, settings);
            setDetail((prev) => (prev ? { ...prev, verification: settings } : prev));
          }}
        />
      )}

      {detail && detail.source === 'mcp' && (
        <ToolDetailsModal
          key={`mcp-${detail.name}`}
          tool={detail}
          onClose={() => setDetail(null)}
          onToggleEnabled={async (enabled) => {
            await window.electronAPI.setMcpToolOverride(detail.name, { enabled });
            setDetail((prev) => (prev ? { ...prev, enabled } : prev));
            await refresh();
          }}
          onSaveVerification={async (settings) => {
            await saveVerification(detail.name, settings);
            setDetail((prev) => (prev ? { ...prev, verification: settings } : prev));
          }}
          onRiskChange={async (risk) => {
            await window.electronAPI.setMcpToolOverride(detail.name, { risk });
            setDetail((prev) => (prev ? { ...prev, risk } : prev));
            await refresh();
          }}
        />
      )}

      <ConfirmationModal
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) { setDeleting(null); } }}
        title={TEXT.TOOLS_DELETE_SERVER}
        description={TEXT.TOOLS_REMOVE_CONFIRM}
        confirmLabel={TEXT.REMOVE_BUTTON}
        destructive
        onConfirm={() => { if (deleting) { void deleteServer(deleting); } }}
      />
    </div>
  );
}
