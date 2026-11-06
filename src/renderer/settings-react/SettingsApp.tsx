import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Minus, X } from 'lucide-react';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { SettingsShell, type SettingsNavItem } from '@neuronection/assistant-ui/settings-shell';
import { AppConfig, DEFAULT_CONFIG, mergeWithDefaults, validateConfig } from '@shared/config/AppConfig';
import { HotkeySettings } from '@shared/types';
import { ThemeType } from '@shared/constants/themes';
import type { SettingsOpenTarget } from '@shared/types';
import { TEXT, interpolate } from '@shared/constants/text';
import { NotificationService } from '@renderer/services/NotificationService';
import { GeneralTab } from './tabs/GeneralTab';
import { ApiTab, type ApiSection } from './tabs/ApiTab';
import { VoiceTab } from './tabs/VoiceTab';
import { HotkeysTab } from './tabs/HotkeysTab';
import { ToolsTab } from './tabs/ToolsTab';
import { AppsTab } from './tabs/AppsTab';
import type { SettingsDetailRoute } from './apps/route';
import { AutomationTab } from './tabs/AutomationTab';
import { CalendarTab } from './tabs/CalendarTab';
import { HubTab } from './tabs/HubTab';
import { NotificationsTab } from './tabs/NotificationsTab';
import { AboutTab } from './tabs/AboutTab';
import { UpdatesSection } from './UpdatesSection';

interface SettingsSnapshot {
  config: AppConfig;
  hotkeys: HotkeySettings;
}

const NAV: SettingsNavItem[] = [
  { id: 'general', label: TEXT.SETTINGS_NAV_GENERAL, description: TEXT.SETTINGS_NAV_GENERAL_DESCRIPTION },
  { id: 'api', label: TEXT.SETTINGS_NAV_API, description: TEXT.SETTINGS_NAV_API_DESCRIPTION },
  { id: 'voice', label: TEXT.SETTINGS_NAV_VOICE, description: TEXT.SETTINGS_NAV_VOICE_DESCRIPTION },
  { id: 'hub', label: TEXT.SETTINGS_NAV_HUB, description: TEXT.SETTINGS_NAV_HUB_DESCRIPTION },
  { id: 'tools', label: TEXT.SETTINGS_NAV_TOOLS, description: TEXT.SETTINGS_NAV_TOOLS_DESCRIPTION },
  { id: 'apps', label: TEXT.SETTINGS_NAV_APPS, description: TEXT.SETTINGS_NAV_APPS_DESCRIPTION },
  { id: 'notifications', label: TEXT.SETTINGS_NAV_NOTIFICATIONS, description: TEXT.SETTINGS_NAV_NOTIFICATIONS_DESCRIPTION },
  { id: 'calendar', label: TEXT.CALENDAR_NAV, description: TEXT.CALENDAR_NAV_DESCRIPTION },
  { id: 'automation', label: TEXT.AUTOMATION_NAV, description: TEXT.AUTOMATION_NAV_DESCRIPTION },
  { id: 'hotkeys', label: TEXT.SETTINGS_NAV_HOTKEYS, description: TEXT.SETTINGS_NAV_HOTKEYS_DESCRIPTION },
  { id: 'about', label: TEXT.SETTINGS_NAV_ABOUT, description: TEXT.SETTINGS_NAV_ABOUT_DESCRIPTION },
];

export interface SettingsAppProps {
  onThemeChange: (theme: ThemeType) => void;
}

export function SettingsApp({ onThemeChange }: SettingsAppProps): JSX.Element {
  const [activeTab, setActiveTab] = useState('general');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [hotkeys, setHotkeys] = useState<HotkeySettings | null>(null);
  const [original, setOriginal] = useState<SettingsSnapshot | null>(null);
  const [appVersion, setAppVersion] = useState('…');
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [focusCommandId, setFocusCommandId] = useState<string | null>(null);
  const [apiSection, setApiSection] = useState<ApiSection>('providers');
  const [miniAppRunFocus, setMiniAppRunFocus] = useState<{ packId: string; runId: string; at: number } | null>(null);
  const [detailRoute, setDetailRoute] = useState<SettingsDetailRoute | null>(null);

  useEffect(() => {
    const applyTarget = (target: SettingsOpenTarget | null | undefined): void => {
      if (target?.tab) {
        setActiveTab(target.tab === 'commands' ? 'apps' : target.tab);
      }
      if (target?.tab === 'api' && target.section && ['providers', 'models', 'tasks'].includes(target.section)) {
        setApiSection(target.section as ApiSection);
      }
      setFocusCommandId(target?.commandId ?? null);
      if (target?.miniAppsConfigurePackId) {
        setDetailRoute({ kind: 'pack-config', packId: target.miniAppsConfigurePackId });
      }
      if (target?.miniAppsReportPackId) {
        if (target.miniAppsReportRunId) {
          setMiniAppRunFocus({ packId: target.miniAppsReportPackId, runId: target.miniAppsReportRunId, at: Date.now() });
        } else {
          setMiniAppRunFocus(null);
        }
        setDetailRoute({ kind: 'pack-runs', packId: target.miniAppsReportPackId });
      }
    };
    const unsubscribe = window.electronAPI.onSettingsNavigate?.(applyTarget);
    void window.electronAPI
      .takePendingSettingsNav?.()
      .then((target) => {
        if (target) {
          applyTarget(target);
        }
      })
      .catch(() => undefined);
    return () => unsubscribe?.();
  }, []);

  const dirty = useMemo(() => {
    if (!config || !hotkeys || !original) {
      return false;
    }
    return JSON.stringify({ config, hotkeys }) !== JSON.stringify(original);
  }, [config, hotkeys, original]);

  useEffect(() => {
    (async () => {
      try {
        if (window.electronAPI?.getAppVersion) {
          setAppVersion((await window.electronAPI.getAppVersion()) || TEXT.SETTINGS_VERSION_UNAVAILABLE);
        }
        const loaded = await window.electronAPI.loadConfig();
        const hotkeySettings = await window.electronAPI.getHotkeySettings();
        const effective = loaded ? mergeWithDefaults(loaded) : { ...DEFAULT_CONFIG };
        setConfig(effective);
        setHotkeys(hotkeySettings);
        setOriginal({ config: JSON.parse(JSON.stringify(effective)), hotkeys: JSON.parse(JSON.stringify(hotkeySettings)) });
      } catch (error) {
        NotificationService.showError(interpolate(TEXT.SETTINGS_LOAD_FAILED, { error: error instanceof Error ? error.message : String(error) }));
        setConfig({ ...DEFAULT_CONFIG });
        setHotkeys({} as HotkeySettings);
        setOriginal({ config: { ...DEFAULT_CONFIG }, hotkeys: {} as HotkeySettings });
      }
    })();
  }, []);

  const updateConfig = useCallback((updates: Partial<AppConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void window.electronAPI.getUpdateStatus
      ?.()
      .then((state) => {
        if (alive) setUpdateAvailable(Boolean(state.release));
      })
      .catch(() => undefined);
    const unsubscribe = window.electronAPI.onUpdateState?.((state) => {
      setUpdateAvailable(Boolean(state.release));
    });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  const nav: SettingsNavItem[] = NAV.map((item) =>
    item.id === 'about' && updateAvailable
      ? {
          ...item,
          trailing: (
            <span
              aria-hidden
              className="inline-block size-1.5 rounded-full bg-primary-600"
            />
          ),
        }
      : item,
  );

  const adoptMainConfig = useCallback(async () => {
    try {
      const loaded = await window.electronAPI.loadConfig();
      if (loaded) {
        const effective = mergeWithDefaults(loaded);
        setConfig(effective);
        setOriginal((prev) => (prev ? { ...prev, config: JSON.parse(JSON.stringify(effective)) } : prev));
      }
    } catch (error) {
      console.error('Failed to adopt main config after setup:', error);
    }
  }, []);

  const saveConfiguration = useCallback(async () => {
    if (!config || !hotkeys || !dirty) {
      return;
    }
    setSaving(true);
    try {
      const hotkeysChanged = JSON.stringify(hotkeys) !== JSON.stringify(original?.hotkeys);
      if (hotkeysChanged) {
        await window.electronAPI.saveHotkeySettings(hotkeys);
      }
      const channelChanged = original?.config.updates.channel !== config.updates.channel;
      await window.electronAPI.saveConfig(config);
      setOriginal({ config: JSON.parse(JSON.stringify(config)), hotkeys: JSON.parse(JSON.stringify(hotkeys)) });
      if (channelChanged) {
        await window.electronAPI.checkForUpdates().catch(() => undefined);
      }
      NotificationService.showSuccess(TEXT.SETTINGS_SAVED_OK);
    } catch (error) {
      NotificationService.showError(interpolate(TEXT.SETTINGS_SAVE_FAILED, { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving(false);
    }
  }, [config, hotkeys, dirty, original]);

  const resetToDefaults = useCallback(async () => {
    try {
      await window.electronAPI.resetConfig();
      const loaded = await window.electronAPI.loadConfig();
      const hotkeySettings = await window.electronAPI.getHotkeySettings();
      const effective = loaded ? mergeWithDefaults(loaded) : { ...DEFAULT_CONFIG };
      setConfig(effective);
      setHotkeys(hotkeySettings);
      setOriginal({ config: JSON.parse(JSON.stringify(effective)), hotkeys: JSON.parse(JSON.stringify(hotkeySettings)) });
      NotificationService.showSuccess(TEXT.SETTINGS_RESET_OK);
    } catch (error) {
      NotificationService.showError(interpolate(TEXT.SETTINGS_RESET_FAILED, { error: error instanceof Error ? error.message : String(error) }));
    }
  }, []);

  const exportConfiguration = useCallback(async () => {
    if (!config) {
      return;
    }
    try {
      const filePath = await window.electronAPI.saveFile({
        title: TEXT.SETTINGS_EXPORT_DIALOG_TITLE,
        defaultPath: `desktop-assistant-settings-${new Date().toISOString().split('T')[0]}.json`,
        content: JSON.stringify(config, null, 2),
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      });
      if (filePath) {
        NotificationService.showSuccess(interpolate(TEXT.SETTINGS_EXPORT_OK, { path: filePath }));
      }
    } catch (error) {
      NotificationService.showError(interpolate(TEXT.SETTINGS_EXPORT_FAILED, { error: error instanceof Error ? error.message : String(error) }));
    }
  }, [config]);

  const importConfiguration = useCallback(async () => {
    try {
      const result = await window.electronAPI.openFile({});
      if (!result?.content) {
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.content);
      } catch {
        NotificationService.showError(TEXT.SETTINGS_IMPORT_INVALID_JSON);
        return;
      }
      if (!validateConfig(parsed as Partial<AppConfig>)) {
        NotificationService.showError(TEXT.SETTINGS_IMPORT_INCOMPATIBLE);
        return;
      }
      setConfirmImport(parsed as AppConfig);
    } catch (error) {
      NotificationService.showError(interpolate(TEXT.SETTINGS_IMPORT_FAILED, { error: error instanceof Error ? error.message : String(error) }));
    }
  }, []);

  const [confirmImport, setConfirmImport] = useState<AppConfig | null>(null);
  const applyImport = useCallback(async (imported: AppConfig) => {
    setConfirmImport(null);
    setSaving(true);
    try {
      const effective = mergeWithDefaults(imported);
      await window.electronAPI.saveConfig(effective);
      const hotkeySettings = await window.electronAPI.getHotkeySettings();
      setConfig(effective);
      setHotkeys(hotkeySettings);
      setOriginal({ config: JSON.parse(JSON.stringify(effective)), hotkeys: JSON.parse(JSON.stringify(hotkeySettings)) });
      NotificationService.showSuccess(TEXT.SETTINGS_IMPORT_OK);
    } catch (error) {
      NotificationService.showError(interpolate(TEXT.SETTINGS_IMPORT_FAILED, { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving(false);
    }
  }, []);

  if (!config || !hotkeys) {
    return <div className="p-6 text-sm opacity-60">{TEXT.SETTINGS_WINDOW_LOADING}</div>;
  }

  return (
    <div role="main" aria-label={TEXT.SETTINGS_WINDOW_TITLE} className="flex h-screen flex-col">
      <div className="settings-drag flex select-none items-center justify-between px-6 pt-4 pb-2">
        <h2 className="text-lg font-semibold">{TEXT.SETTINGS_WINDOW_TITLE}</h2>
        <div className="flex items-center gap-1">
          <span className="settings-drag text-xs opacity-60">v{appVersion}</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title={TEXT.DESKTOP_MINIMIZE}
            aria-label={TEXT.DESKTOP_MINIMIZE}
            onClick={() => void window.electronAPI.minimizeWindow()}
          >
            <Minus className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title={TEXT.CLOSE_BUTTON}
            aria-label={TEXT.CLOSE_BUTTON}
            onClick={() => window.close()}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
        <SettingsShell nav={nav} active={activeTab} onNavigate={setActiveTab}>
          {activeTab === 'general' && (
            <GeneralTab config={config} onChange={updateConfig} onThemeChange={onThemeChange} />
          )}
          {activeTab === 'api' && (
            <ApiTab
              config={config}
              onChange={updateConfig}
              section={apiSection}
              onSectionChange={setApiSection}
              onSetupComplete={() => void adoptMainConfig()}
            />
          )}
          {activeTab === 'voice' && config && (
            <VoiceTab
              config={config}
              onChange={updateConfig}
              onOpenTasks={() => {
                setApiSection('tasks');
                setActiveTab('api');
              }}
              onOpenDecision={() => {
                setApiSection('tasks');
                setActiveTab('api');
              }}
              onOpenHub={() => setActiveTab('hub')}
            />
          )}
          {activeTab === 'hub' && config && <HubTab config={config} onChange={updateConfig} />}
          {activeTab === 'tools' && <ToolsTab />}
          {activeTab === 'apps' && config && (
            <AppsTab
              miniAppRunFocus={miniAppRunFocus}
              config={config}
              updateConfig={updateConfig}
              focusCommandId={focusCommandId}
              detailRoute={detailRoute}
              onDetailRouteChange={setDetailRoute}
            />
          )}
          {activeTab === 'notifications' && <NotificationsTab />}
          {activeTab === 'calendar' && <CalendarTab />}
          {activeTab === 'automation' && <AutomationTab />}
          {activeTab === 'hotkeys' && (
            <HotkeysTab
              hotkeys={hotkeys}
              onHotkeysChange={setHotkeys}
              commandOptions={
                config.commands.enabled
                  ? config.commands.custom.map((def) => ({ id: `custom:${def.id}`, title: def.name }))
                  : []
              }
              commandBindings={config.commands.commandHotkeys}
              onCommandBindingChange={(commandId, accelerator) => {
                if (!config) {
                  return;
                }
                const next = { ...config.commands.commandHotkeys };
                if (accelerator) {
                  next[commandId] = { ...(next[commandId] ?? { accelerator }), accelerator };
                } else {
                  delete next[commandId];
                }
                updateConfig({ commands: { ...config.commands, commandHotkeys: next } });
              }}
            />
          )}
          {activeTab === 'about' && (
            <>
              <AboutTab version={appVersion} />
              <UpdatesSection config={config} onChange={updateConfig} />
            </>
          )}
        </SettingsShell>
      </div>
      <div className="flex items-center justify-between border-t border-[var(--as-border)] px-6 py-3">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}>{TEXT.SETTINGS_RESET_DEFAULTS}</Button>
          <Button variant="outline" size="sm" onClick={() => void exportConfiguration()}>{TEXT.SETTINGS_EXPORT_CONFIG}</Button>
          <Button variant="outline" size="sm" onClick={() => void importConfiguration()}>{TEXT.SETTINGS_IMPORT_CONFIG}</Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.close()}>{TEXT.CLOSE_BUTTON}</Button>
          <Button size="sm" disabled={!dirty || saving} loading={saving} onClick={() => void saveConfiguration()}>
            {dirty ? TEXT.SETTINGS_SAVE_CHANGES : TEXT.SETTINGS_SAVED}
          </Button>
        </div>
      </div>
      <ConfirmationModal
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={TEXT.SETTINGS_RESET_TITLE}
        description={TEXT.SETTINGS_RESET_DESCRIPTION}
        confirmLabel={TEXT.SETTINGS_RESET_CONFIRM}
        destructive
        onConfirm={() => void resetToDefaults()}
      />
      <ConfirmationModal
        open={confirmImport !== null}
        onOpenChange={(open) => { if (!open) { setConfirmImport(null); } }}
        title={TEXT.SETTINGS_IMPORT_TITLE}
        description={TEXT.SETTINGS_IMPORT_DESCRIPTION}
        confirmLabel={TEXT.SETTINGS_IMPORT_CONFIRM}
        onConfirm={() => { if (confirmImport) { void applyImport(confirmImport); } }}
      />
      <div id="notification-container" className="notification-container" />
    </div>
  );
}
