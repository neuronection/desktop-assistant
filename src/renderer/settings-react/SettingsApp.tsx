import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { SettingsShell, type SettingsNavItem } from '@neuronection/assistant-ui/settings-shell';
import { AppConfig, DEFAULT_CONFIG, mergeWithDefaults, validateConfig } from '@shared/config/AppConfig';
import { HotkeySettings } from '@shared/types';
import { ThemeType } from '@shared/constants/themes';
import { TEXT, interpolate } from '@shared/constants/text';
import { NotificationService } from '@renderer/services/NotificationService';
import { GeneralTab } from './tabs/GeneralTab';
import { ApiTab } from './tabs/ApiTab';
import { HotkeysTab } from './tabs/HotkeysTab';
import { ToolsTab } from './tabs/ToolsTab';
import { CommandsTab } from './tabs/CommandsTab';

interface SettingsSnapshot {
  config: AppConfig;
  hotkeys: HotkeySettings;
}

const NAV: SettingsNavItem[] = [
  { id: 'general', label: TEXT.SETTINGS_NAV_GENERAL, description: TEXT.SETTINGS_NAV_GENERAL_DESCRIPTION },
  { id: 'api', label: TEXT.SETTINGS_NAV_API, description: TEXT.SETTINGS_NAV_API_DESCRIPTION },
  { id: 'tools', label: TEXT.SETTINGS_NAV_TOOLS, description: TEXT.SETTINGS_NAV_TOOLS_DESCRIPTION },
  { id: 'commands', label: TEXT.SETTINGS_NAV_COMMANDS, description: TEXT.SETTINGS_NAV_COMMANDS_DESCRIPTION },
  { id: 'hotkeys', label: TEXT.SETTINGS_NAV_HOTKEYS, description: TEXT.SETTINGS_NAV_HOTKEYS_DESCRIPTION },
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

  useEffect(() => {
    const unsubscribe = window.electronAPI.onSettingsNavigate?.((target) => {
      if (target?.tab) {
        setActiveTab(target.tab);
      }
      setFocusCommandId(target?.commandId ?? null);
    });
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
      await window.electronAPI.saveConfig(config);
      setOriginal({ config: JSON.parse(JSON.stringify(config)), hotkeys: JSON.parse(JSON.stringify(hotkeys)) });
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
      <div className="settings-drag flex select-none items-baseline justify-between px-6 pt-5 pb-2">
        <h2 className="text-lg font-semibold">{TEXT.SETTINGS_WINDOW_TITLE}</h2>
        <span className="settings-drag text-xs opacity-60">v{appVersion}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
        <SettingsShell nav={NAV} active={activeTab} onNavigate={setActiveTab}>
          {activeTab === 'general' && (
            <GeneralTab config={config} onChange={updateConfig} onThemeChange={onThemeChange} />
          )}
          {activeTab === 'api' && (
            <ApiTab config={config} onChange={updateConfig} />
          )}
          {activeTab === 'tools' && <ToolsTab />}
          {activeTab === 'commands' && (
            <CommandsTab config={config} updateConfig={updateConfig} focusCommandId={focusCommandId} />
          )}
          {activeTab === 'hotkeys' && (
            <HotkeysTab hotkeys={hotkeys} onHotkeysChange={setHotkeys} />
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
