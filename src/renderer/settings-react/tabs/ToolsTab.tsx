import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { EmptyState } from '@neuronection/assistant-ui/empty-state';
import { SearchInput } from '@neuronection/assistant-ui/search-input';
import { FolderPlus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import type { ToolCatalogEntry, ToolCategory, ToolClassDefaults, ToolRiskClass, ToolVerificationSettings } from '@shared/turns';
import type { DocsRootView } from '@shared/docs';
import { Label } from './fields';
import { TEXT, interpolate } from '@shared/constants/text';
import { SearchSection } from './SearchSection';
import { MemoriesManager } from '../tools/MemoriesManager';
import { UsageSection } from '../tools/UsageSection';
import { CATEGORY_META, RISK_BADGE_CLASS, RISK_LABEL, Switch, verificationBadge } from '../tools/shared';
import { ToolDetailsModal, type DetailTool } from '../tools/ToolDetailsModal';

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

export function ToolsTab(): JSX.Element {
  const [catalog, setCatalog] = useState<ToolCatalogEntry[]>([]);
  const [classDefaults, setClassDefaults] = useState<ToolClassDefaults>({});
  const [roots, setRoots] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [detail, setDetail] = useState<DetailTool | null>(null);
  const [docs, setDocs] = useState<DocsRootView[]>([]);
  const [docsBusy, setDocsBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [catalogRows, config, docsRows] = await Promise.all([
      window.electronAPI.getToolCatalog(),
      window.electronAPI.loadConfig(),
      window.electronAPI.getDocsStatus().catch(() => []),
    ]);
    setCatalog(catalogRows.filter((row) => row.source === 'native'));
    setClassDefaults(config.tools.classDefaults ?? {});
    setRoots(config.tools.grantedRoots);
    setDocs(docsRows);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshCatalog = useCallback(async () => {
    const rows = await window.electronAPI.getToolCatalog();
    setCatalog(rows.filter((row) => row.source === 'native'));
  }, []);

  const toggleDocsIndex = useCallback(
    async (root: string, on: boolean): Promise<void> => {
      setDocsBusy(root);
      try {
        const result = await window.electronAPI.setDocsIndexed(root, on);
        setDocs((prev) => {
          const existing = prev.find((entry) => entry.root === root);
          const merged = { root, indexed: result.indexed, files: result.files, chunks: result.chunks };
          return existing ? prev.map((entry) => (entry.root === root ? merged : entry)) : [...prev, merged];
        });
      } finally {
        setDocsBusy(null);
      }
    },
    []
  );

  const reindexDocsRoot = useCallback(async (root: string): Promise<void> => {
    setDocsBusy(root);
    try {
      await window.electronAPI.reindexDocs(root);
      const rows = await window.electronAPI.getDocsStatus();
      setDocs(rows);
    } finally {
      setDocsBusy(null);
    }
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
      <UsageSection />

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
                    setDocs((prev) => prev.filter((entry) => entry.root !== root));
                  }}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <DocsIndexSection rows={docs} busyRoot={docsBusy} onToggle={toggleDocsIndex} onReindex={reindexDocsRoot} />
      </section>

      <SearchSection />

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
    </div>
  );
}

export function DocsIndexSection(props: {
  rows: DocsRootView[];
  busyRoot: string | null;
  onToggle: (root: string, on: boolean) => Promise<void>;
  onReindex: (root: string) => Promise<void>;
}): JSX.Element | null {
  if (props.rows.length === 0) {
    return null;
  }
  return (
    <div className="space-y-1.5 border-t border-[var(--as-border)] pt-2">
      <p className="text-xs font-medium opacity-70">{TEXT.DOCS_INDEX_TITLE}</p>
      <p className="text-[11px] opacity-50">{TEXT.DOCS_INDEX_HINT}</p>
      <ul className="space-y-1" aria-label={TEXT.DOCS_INDEX_TITLE}>
        {props.rows.map((row) => (
          <li
            key={row.root}
            data-no-drag
            className="flex items-center gap-2 rounded-md border border-[var(--as-border)] px-2 py-1 text-xs"
          >
            <span className="min-w-0 flex-1 truncate font-mono" title={row.root}>
              {row.root}
            </span>
            {props.busyRoot === row.root ? (
              <span role="status" className="flex items-center gap-1 opacity-70">
                <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
                {TEXT.DOCS_INDEX_BUSY}
              </span>
            ) : row.indexed ? (
              <>
                <span className="shrink-0 tabular-nums opacity-60">
                  {interpolate(TEXT.DOCS_INDEX_COUNTS, { files: row.files, chunks: row.chunks })}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={`${TEXT.DOCS_REINDEX} — ${row.root}`}
                  onClick={() => void props.onReindex(row.root)}
                >
                  <RefreshCw className="h-3 w-3" aria-hidden />
                </Button>
              </>
            ) : null}
            <Switch
              checked={row.indexed}
              onCheckedChange={(checked) => void props.onToggle(row.root, checked)}
              label={`${TEXT.DOCS_INDEX_TITLE} — ${row.root}`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
