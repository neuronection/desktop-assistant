import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { Modal, ModalContent, ModalHeader, ModalTitle } from '@neuronection/assistant-ui/modal';
import { SearchInput } from '@neuronection/assistant-ui/search-input';
import { Download, Plus, Puzzle, RefreshCw, Trash2 } from 'lucide-react';
import type { CommandCategory, CommandCatalogSnapshot, CommandEntry } from '@shared/commands';
import { parseIntegrationManifest, manifestSecretRefs } from '@shared/commands';
import type { AppConfig, CustomCommandDef } from '@shared/config/AppConfig';
import { commandIcon } from '@renderer/shared/commandIcons';
import { AliasListEditor, sanitizeAliases } from '../tools/shared';

function CommandGlyph({ entry }: { entry: CommandEntry }): JSX.Element {
  const Icon = commandIcon(entry.icon);
  return <Icon className="h-3 w-3 shrink-0 opacity-60" aria-hidden />;
}

import { TEXT, interpolate } from '@shared/constants/text';
import { invalidateCommandCatalog, loadCommandCatalog } from '@renderer/chat-react/commandSource';
import { Switch } from '../tools/shared';

export interface CommandsTabProps {
  config: AppConfig;
  updateConfig: (updates: Partial<AppConfig>) => void;
  /** Deep-link focus (plan 14 §6 row menu → Configure). */
  focusCommandId?: string | null;
}

const CATEGORY_FILTERS: (CommandCategory | 'all')[] = ['all', 'apps', 'tools', 'web', 'navigation', 'custom', 'integrations'];

const SOURCE_LABELS: Record<string, string> = {
  native: 'Native',
  mcp: 'MCP',
  app: 'App',
  system: 'System',
  user: 'Custom',
  integration: 'Pack',
};

export function CommandsTab({ config, updateConfig, focusCommandId }: CommandsTabProps): JSX.Element {
  const commands = config.commands;
  const [catalog, setCatalog] = useState<CommandCatalogSnapshot | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CommandCategory | 'all'>('all');
  const [detailId, setDetailId] = useState<string | null>(focusCommandId ?? null);
  const [customFormOpen, setCustomFormOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customKind, setCustomKind] = useState<'tool' | 'prompt'>('tool');
  const [customTool, setCustomTool] = useState('');
  const [customTemplates, setCustomTemplates] = useState<Record<string, string>>({});
  const [customPrompt, setCustomPrompt] = useState('');
  const [customAliases, setCustomAliases] = useState<string[]>([]);
  const [customError, setCustomError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importSecrets, setImportSecrets] = useState<Record<string, string>>({});
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);

  const patch = useCallback(
    (updates: Partial<AppConfig['commands']>) => {
      updateConfig({ commands: { ...commands, ...updates } });
    },
    [commands, updateConfig]
  );

  const reloadCatalog = useCallback(() => {
    invalidateCommandCatalog();
    void loadCommandCatalog(true)
      .then(setCatalog)
      .catch(() => setCatalog(null));
  }, []);

  useEffect(() => {
    void loadCommandCatalog(true)
      .then(setCatalog)
      .catch(() => setCatalog(null));
  }, []);

  const entries = catalog?.entries ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (categoryFilter !== 'all' && entry.category !== categoryFilter) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return (
        entry.title.toLowerCase().includes(needle) ||
        entry.id.toLowerCase().includes(needle) ||
        (entry.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle))
      );
    });
  }, [entries, search, categoryFilter]);

  const detail = detailId ? entries.find((entry) => entry.id === detailId) ?? null : null;
  const agentCount = Object.values(commands.agentCallable).filter(Boolean).length;

  const rescan = useCallback(async () => {
    try {
      const result = await window.electronAPI.refreshApps();
      setLastScan(interpolate(TEXT.COMMANDS_APPS_COUNT, { count: result.count }));
      reloadCatalog();
    } catch {
      setLastScan(null);
    }
  }, [reloadCatalog]);

  const saveCustom = useCallback(async () => {
    setCustomError(null);
    const def: CustomCommandDef = {
      id: '',
      name: customName.trim(),
      kind: customKind,
      toolName: customKind === 'tool' ? customTool : undefined,
      argTemplate: customKind === 'tool' ? customTemplates : undefined,
      promptTemplate: customKind === 'prompt' ? customPrompt : undefined,
      aliases: sanitizeAliases(customAliases),
    };
    const result = await window.electronAPI.saveCustomCommand(def);
    if (!result.ok) {
      setCustomError(result.error ?? 'Failed to save.');
      return;
    }
    setCustomFormOpen(false);
    setCustomName('');
    setCustomTool('');
    setCustomTemplates({});
    setCustomPrompt('');
    setCustomAliases([]);
    reloadCatalog();
  }, [customName, customKind, customTool, customTemplates, customPrompt, customAliases, reloadCatalog]);

  const openInstanceEditor = useCallback((entry: CommandEntry): void => {
    setDetailId(null);
    setCustomKind('tool');
    setCustomTool(entry.toolName ?? '');
    setCustomName('');
    setCustomTemplates({});
    setCustomPrompt('');
    setCustomAliases([]);
    setCustomError(null);
    setCustomFormOpen(true);
  }, []);

  const runImport = useCallback(async () => {
    setImportError(null);
    const result = await window.electronAPI.importIntegration(importJson, importSecrets);
    if (!result.ok) {
      setImportError(result.error ?? 'Import failed.');
      return;
    }
    setImportOpen(false);
    setImportJson('');
    setImportSecrets({});
    reloadCatalog();
  }, [importJson, importSecrets, reloadCatalog]);

  const importPreview = useMemo(() => parseIntegrationManifest(importJson), [importJson]);
  const importSecretNames = useMemo(
    () => (importPreview.ok ? importPreview.manifest.commands.flatMap(manifestSecretRefs) : []),
    [importPreview]
  );

  return (
    <div className="flex flex-col gap-4" data-testid="commands-tab">
      <section className="rounded-xl border border-[var(--as-border)] p-3">
        <h3 className="mb-2 text-sm font-semibold">{TEXT.COMMANDS_PALETTE_TITLE}</h3>
        <Switch
          label={TEXT.COMMANDS_ENABLED_LABEL}
          checked={commands.enabled}
          onCheckedChange={(enabled) => patch({ enabled })}
        />
        <p className="mt-2 text-xs opacity-60">{TEXT.COMMANDS_CONFIGURE_HINT}</p>
      </section>

      <section className="rounded-xl border border-[var(--as-border)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{TEXT.COMMANDS_APPS_TITLE}</h3>
          <Button variant="outline" size="sm" onClick={() => void rescan()}>
            <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
            {TEXT.COMMANDS_APPS_RESCAN}
          </Button>
        </div>
        <Switch
          label={TEXT.COMMANDS_APPS_LAUNCH}
          checked={commands.apps.launchEnabled}
          onCheckedChange={(launchEnabled) => patch({ apps: { ...commands.apps, launchEnabled } })}
        />
        <Switch
          label={TEXT.COMMANDS_APPS_DISCOVERY}
          checked={commands.apps.discovery}
          onCheckedChange={(discovery) => patch({ apps: { ...commands.apps, discovery } })}
        />
        {lastScan && (
          <p className="mt-1 text-xs opacity-60" role="status">
            {lastScan}
          </p>
        )}
        {commands.apps.hiddenApps.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-medium opacity-70">{TEXT.COMMANDS_APPS_HIDDEN}</p>
            <ul className="mt-1 flex flex-wrap gap-1">
              {commands.apps.hiddenApps.map((id) => (
                <li key={id}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => patch({ apps: { ...commands.apps, hiddenApps: commands.apps.hiddenApps.filter((hidden) => hidden !== id) } })}
                  >
                    {id} · {TEXT.COMMANDS_APPS_RESTORE}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[var(--as-border)] p-3">
        <h3 className="mb-2 text-sm font-semibold">{TEXT.COMMANDS_HISTORY_TITLE}</h3>
        <Switch
          label={TEXT.COMMANDS_HISTORY_ENABLED}
          checked={commands.history.enabled}
          onCheckedChange={(enabled) => patch({ history: { ...commands.history, enabled } })}
        />
        <label className="mt-2 flex items-center gap-2 text-xs">
          {interpolate(TEXT.COMMANDS_HISTORY_RETENTION, { days: commands.history.retentionDays })}
          <input
            type="range"
            min={7}
            max={365}
            step={1}
            value={commands.history.retentionDays}
            onChange={(event) => patch({ history: { ...commands.history, retentionDays: Number(event.target.value) } })}
          />
        </label>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setConfirmClear(true)}>
          <Trash2 className="mr-1 h-3 w-3" aria-hidden />
          {TEXT.COMMANDS_HISTORY_CLEAR}
        </Button>
      </section>

      <section className="rounded-xl border border-[var(--as-border)] p-3">
        <h3 className="mb-2 text-sm font-semibold">{TEXT.COMMANDS_WEB_TITLE}</h3>
        <div className="flex gap-1">
          {(['inline', 'browser'] as const).map((mode) => (
            <Button
              key={mode}
              variant={commands.web.behavior === mode ? 'default' : 'outline'}
              size="sm"
              aria-pressed={commands.web.behavior === mode}
              onClick={() => patch({ web: { ...commands.web, behavior: mode } })}
            >
              {mode === 'inline' ? TEXT.COMMANDS_WEB_INLINE : TEXT.COMMANDS_WEB_BROWSER}
            </Button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--as-border)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{TEXT.COMMANDS_INTEGRATIONS_TITLE}</h3>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Download className="mr-1 h-3 w-3" aria-hidden />
            {TEXT.COMMANDS_INTEGRATIONS_IMPORT}
          </Button>
        </div>
        {commands.integrations.length === 0 && <p className="text-xs opacity-60">{TEXT.COMMANDS_INTEGRATIONS_EMPTY}</p>}
        <ul className="flex flex-col gap-1">
          {commands.integrations.map((pack) => (
            <li key={pack.id} className="flex items-center gap-2 rounded-lg border border-[var(--as-border)] px-2 py-1.5">
              <Puzzle className="h-3.5 w-3.5 opacity-60" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="text-xs font-medium">{pack.name}</span>
                {pack.error ? (
                  <Badge variant="danger" className="ml-1">
                    {pack.error}
                  </Badge>
                ) : (
                  <span className="ml-1 text-[10px] opacity-60">
                    {interpolate(TEXT.COMMANDS_INTEGRATIONS_COMMANDS, { count: pack.commands.length })}
                  </span>
                )}
              </span>
              <Switch
                label={`Toggle ${pack.name}`}
                hideLabel
                checked={pack.enabled}
                onCheckedChange={(enabled) =>
                  patch({ integrations: commands.integrations.map((candidate) => (candidate.id === pack.id ? { ...candidate, enabled } : candidate)) })
                }
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={`${TEXT.DELETE_BUTTON} ${pack.name}`}
                onClick={() => void window.electronAPI.removeIntegration(pack.id).then(() => reloadCatalog())}
              >
                <Trash2 className="h-3 w-3" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-[var(--as-border)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{TEXT.COMMANDS_CUSTOM_TITLE}</h3>
          <Button variant="outline" size="sm" onClick={() => setCustomFormOpen(true)}>
            <Plus className="mr-1 h-3 w-3" aria-hidden />
            {TEXT.COMMANDS_CUSTOM_NEW}
          </Button>
        </div>
        {commands.custom.length === 0 && <p className="text-xs opacity-60">{TEXT.COMMANDS_INTEGRATIONS_EMPTY}</p>}
        <ul className="flex flex-col gap-1">
          {commands.custom.map((def) => (
            <li key={def.id} className="flex items-center gap-2 rounded-lg border border-[var(--as-border)] px-2 py-1.5">
              <span className="min-w-0 flex-1 text-xs font-medium">
                {def.name}
                <span className="ml-1 text-[10px] opacity-60">{def.kind}</span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={`${TEXT.DELETE_BUTTON} ${def.name}`}
                onClick={() => void window.electronAPI.deleteCustomCommand(def.id).then(() => reloadCatalog())}
              >
                <Trash2 className="h-3 w-3" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-[var(--as-border)] p-3">
        <h3 className="mb-2 text-sm font-semibold">{TEXT.COMMANDS_LIST_TITLE}</h3>
        <SearchInput value={search} onChange={(value) => setSearch(value)} ariaLabel={TEXT.COMMANDS_LIST_SEARCH} placeholder={TEXT.COMMANDS_LIST_SEARCH} />
        <div className="mt-2 flex flex-wrap gap-1">
          {CATEGORY_FILTERS.map((category) => (
            <Button
              key={category}
              variant={categoryFilter === category ? 'default' : 'outline'}
              size="sm"
              aria-pressed={categoryFilter === category}
              onClick={() => setCategoryFilter(category)}
            >
              {category}
            </Button>
          ))}
        </div>
        <ul className="mt-2 flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {filtered.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-[var(--as-secondary)]"
                onClick={() => setDetailId(entry.id)}
              >
                <CommandGlyph entry={entry} />
                <span className="flex-1 truncate">
                  {entry.title}
                  <span className="ml-1 text-[10px] uppercase opacity-50">{SOURCE_LABELS[entry.source] ?? entry.source}</span>
                </span>
                {commands.pins.includes(entry.id) && <Badge variant="secondary">{TEXT.COMMAND_PIN}</Badge>}
                {(entry.aliases.length > 0 || commands.extraAliases[entry.id]?.length) && (
                  <span className="text-[10px] opacity-60">{(entry.aliases.length ?? 0) + (commands.extraAliases[entry.id]?.length ?? 0)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {detail && (
        <CommandDetailsModal
          entry={detail}
          commands={commands}
          patch={patch}
          agentCount={agentCount}
          instances={commands.custom.filter((def) => def.kind === 'tool' && def.toolName === detail.toolName)}
          onAddInstance={() => openInstanceEditor(detail)}
          onDeleteInstance={(id) => void window.electronAPI.deleteCustomCommand(id).then(() => reloadCatalog())}
          onClose={() => setDetailId(null)}
        />
      )}

      <Modal open={customFormOpen} onOpenChange={setCustomFormOpen}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>{TEXT.COMMANDS_CUSTOM_NEW}</ModalTitle>
          </ModalHeader>
          <div className="flex flex-col gap-2 px-6 pb-6">
            <label className="text-xs">
              {TEXT.COMMANDS_CUSTOM_NAME}
              <input className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm" value={customName} onChange={(event) => setCustomName(event.target.value)} />
            </label>
            <label className="text-xs">
              {TEXT.COMMANDS_CUSTOM_KIND}
              <select className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm" value={customKind} onChange={(event) => setCustomKind(event.target.value as 'tool' | 'prompt')}>
                <option value="tool">{TEXT.COMMANDS_CUSTOM_KIND_TOOL}</option>
                <option value="prompt">{TEXT.COMMANDS_CUSTOM_KIND_PROMPT}</option>
              </select>
            </label>
            {customKind === 'tool' && (
              <>
                <label className="text-xs">
                  {TEXT.COMMANDS_CUSTOM_TOOL}
                  <select
                    className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                    value={customTool}
                    onChange={(event) => {
                      setCustomTool(event.target.value);
                      setCustomTemplates({});
                    }}
                  >
                    <option value="">—</option>
                    {entries
                      .filter((entry) => entry.kind === 'tool')
                      .map((entry) => (
                        <option key={entry.id} value={entry.toolName ?? ''}>
                          {entry.title}
                        </option>
                      ))}
                  </select>
                </label>
                {customTool &&
                  (entries.find((entry) => entry.toolName === customTool)?.args ?? []).map((arg) => (
                    <label key={arg.name} className="text-xs">
                      {arg.name}
                      <input
                        className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                        placeholder={TEXT.COMMANDS_CUSTOM_ARGS_HINT}
                        value={customTemplates[arg.name] ?? ''}
                        onChange={(event) => setCustomTemplates((prev) => ({ ...prev, [arg.name]: event.target.value }))}
                      />
                    </label>
                  ))}
              </>
            )}
            {customKind === 'prompt' && (
              <label className="text-xs">
                {TEXT.COMMANDS_CUSTOM_PROMPT}
                <textarea
                  className="mt-1 min-h-20 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                  value={customPrompt}
                  onChange={(event) => setCustomPrompt(event.target.value)}
                />
              </label>
            )}
            <AliasListEditor
              label={TEXT.COMMANDS_CUSTOM_ALIASES}
              aliases={customAliases}
              onChange={setCustomAliases}
              addLabel={TEXT.COMMANDS_ALIASES_ADD}
              removeLabel={TEXT.COMMANDS_ALIASES_REMOVE}
            />
            {customError && (
              <p role="alert" className="text-xs text-[var(--as-danger)]">
                {customError}
              </p>
            )}
            <Button size="sm" onClick={() => void saveCustom()}>
              {TEXT.SAVE_BUTTON}
            </Button>
          </div>
        </ModalContent>
      </Modal>

      <Modal open={importOpen} onOpenChange={setImportOpen}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>{TEXT.COMMANDS_INTEGRATIONS_IMPORT}</ModalTitle>
          </ModalHeader>
          <div className="flex flex-col gap-2 px-6 pb-6">
            <label className="text-xs">
              {TEXT.COMMANDS_INTEGRATIONS_JSON}
              <textarea
                className="mt-1 min-h-32 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 font-mono text-xs"
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
              />
            </label>
            {importPreview.ok && (
              <p className="text-xs" role="status">
                {importPreview.manifest.name} ·{' '}
                {interpolate(TEXT.COMMANDS_INTEGRATIONS_COMMANDS, { count: importPreview.manifest.commands.length })}
              </p>
            )}
            {importSecretNames.map((name) => (
              <label key={name} className="text-xs">
                {name}
                <input
                  type="password"
                  className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                  value={importSecrets[name] ?? ''}
                  onChange={(event) => setImportSecrets((prev) => ({ ...prev, [name]: event.target.value }))}
                />
              </label>
            ))}
            {importError && (
              <p role="alert" className="text-xs text-[var(--as-danger)]">
                {importError}
              </p>
            )}
            <Button size="sm" disabled={!importJson.trim()} onClick={() => void runImport()}>
              {TEXT.COMMANDS_INTEGRATIONS_IMPORT}
            </Button>
          </div>
        </ModalContent>
      </Modal>

      <ConfirmationModal
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={TEXT.COMMANDS_HISTORY_CLEAR}
        description={TEXT.COMMANDS_HISTORY_ENABLED}
        confirmLabel={TEXT.COMMANDS_HISTORY_CLEAR}
        destructive
        onConfirm={() => void window.electronAPI.clearCommandHistory()}
      />
    </div>
  );
}

function CommandDetailsModal({
  entry,
  commands,
  patch,
  agentCount,
  instances,
  onAddInstance,
  onDeleteInstance,
  onClose,
}: {
  entry: CommandEntry;
  commands: AppConfig['commands'];
  patch: (updates: Partial<AppConfig['commands']>) => void;
  agentCount: number;
  instances: CustomCommandDef[];
  onAddInstance: () => void;
  onDeleteInstance: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  const defaults = commands.argDefaults[entry.id] ?? {};
  const [testResult, setTestResult] = useState<string | null>(null);
  const agentOn = commands.agentCallable[entry.id] === true;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{entry.title}</ModalTitle>
        </ModalHeader>
        <div className="flex flex-col gap-3 px-6 pb-6 text-xs">
          <div className="flex items-center gap-1">
            <Badge variant="secondary">{SOURCE_LABELS[entry.source] ?? entry.source}</Badge>
            {entry.risk && <Badge variant="outline">{entry.risk}</Badge>}
            {entry.slash && <kbd className="rounded border border-[var(--as-border)] px-1 py-0.5">/{entry.slash}</kbd>}
          </div>
          {entry.subtitle && <p className="opacity-70">{entry.subtitle}</p>}
          {entry.args.length > 0 && (
            <div>
              <p className="mb-1 font-medium">{TEXT.COMMANDS_DETAIL_DEFAULTS}</p>
              <div className="flex flex-col gap-1">
                {entry.args.map((arg) => (
                  <label key={arg.name} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate">{arg.name}</span>
                    <input
                      className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1"
                      value={String(defaults[arg.name] ?? '')}
                      onChange={(event) =>
                        patch({
                          argDefaults: {
                            ...commands.argDefaults,
                            [entry.id]: { ...defaults, [arg.name]: event.target.value },
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
          <AliasListEditor
            label={TEXT.COMMANDS_DETAIL_ALIASES}
            aliases={commands.extraAliases[entry.id] ?? []}
            onChange={(aliases) =>
              patch({
                extraAliases: {
                  ...commands.extraAliases,
                  [entry.id]: aliases,
                },
              })
            }
            addLabel={TEXT.COMMANDS_ALIASES_ADD}
            removeLabel={TEXT.COMMANDS_ALIASES_REMOVE}
          />
          {entry.toolName && (
            <div>
              <p className="mb-1 font-medium">{TEXT.COMMANDS_INSTANCES}</p>
              <p className="mb-1 opacity-70">{TEXT.COMMANDS_INSTANCES_HINT}</p>
              <div className="flex flex-col gap-1">
                {instances.map((instance) => (
                  <span key={instance.id} className="flex items-center gap-2 rounded-lg border border-[var(--as-border)] px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate">
                      {instance.name}
                      {instance.aliases.length > 0 && (
                        <span className="ml-1 opacity-60">
                          {instance.aliases.map((alias) => `/${alias}`).join(' ')}
                        </span>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={`${TEXT.DELETE_BUTTON} ${instance.name}`}
                      onClick={() => onDeleteInstance(instance.id)}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </Button>
                  </span>
                ))}
              </div>
              <Button variant="outline" size="sm" className="mt-1" onClick={onAddInstance}>
                <Plus className="mr-1 h-3 w-3" aria-hidden />
                {TEXT.COMMANDS_INSTANCES_ADD}
              </Button>
            </div>
          )}
          <Switch label={TEXT.COMMANDS_DETAIL_PIN} checked={commands.pins.includes(entry.id)} onCheckedChange={(pinned) => patch({ pins: pinned ? [...commands.pins, entry.id] : commands.pins.filter((id) => id !== entry.id) })} />
          <Switch
            label={TEXT.COMMANDS_DETAIL_HIDDEN}
            checked={commands.hidden.includes(entry.id)}
            onCheckedChange={(hidden) => patch({ hidden: hidden ? [...commands.hidden, entry.id] : commands.hidden.filter((id) => id !== entry.id) })}
          />
          <Switch
            label={TEXT.COMMANDS_DETAIL_AGENT}
            checked={agentOn}
            onCheckedChange={(agent) => patch({ agentCallable: { ...commands.agentCallable, [entry.id]: agent } })}
          />
          {agentCount > 25 && (
            <p role="status" className="opacity-70">
              {interpolate(TEXT.COMMANDS_AGENT_WARNING, { count: agentCount })}
            </p>
          )}
          {(entry.action === 'calc:evaluate' || entry.action === 'files:search') && (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void window.electronAPI.executeCommand(entry.id, [], 'palette').then((outcome) => {
                    setTestResult(outcome.status === 'done' ? outcome.text ?? '' : outcome.status === 'error' ? outcome.error : '');
                  });
                }}
              >
                {TEXT.COMMANDS_DETAIL_TEST}
              </Button>
              {testResult !== null && (
                <p role="status" className="mt-1 whitespace-pre-wrap opacity-80">
                  {interpolate(TEXT.COMMANDS_DETAIL_TEST_OK, { text: testResult })}
                </p>
              )}
            </div>
          )}
        </div>
      </ModalContent>
    </Modal>
  );
}
