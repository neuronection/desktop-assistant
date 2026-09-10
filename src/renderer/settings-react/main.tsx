import React from 'react';
import { createRoot } from 'react-dom/client';
import '@neuronection/assistant-ui/styles.css';
import '@renderer/styles/motion.css';
import '@renderer/styles/settings.css';
import '@renderer/styles/theme.css';
import '@renderer/styles/notifications.css';
import { SettingsApp } from './SettingsApp';
import { ThemeManager } from '@renderer/managers/ThemeManager';
import { ThemeType } from '@shared/constants/themes';
import { AppConfig } from '@shared/config/AppConfig';
import { applyTheme } from './theme';
import { NotificationService } from '@renderer/services/NotificationService';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('settings-root');
  if (!container) {
    console.error('Settings root element not found!');
    return;
  }

  const notificationContainer = document.getElementById('notification-container');
  if (notificationContainer) {
    NotificationService.init(notificationContainer);
  }

  let initialTheme: ThemeType = ThemeType.CLASSIC;
  try {
    if (window.electronAPI) {
      const config: Partial<AppConfig> | undefined = await window.electronAPI.loadConfig();
      if (config?.theme) {
        initialTheme = config.theme;
      }
    }
  } catch (error) {
    console.warn('Failed to load theme preference, using default:', error);
  }
  applyTheme(initialTheme);

  if (window.electronAPI?.onConfigUpdate) {
    window.electronAPI.onConfigUpdate((newConfig: Partial<AppConfig>) => {
      if (newConfig.theme && newConfig.theme !== ThemeManager.getInstance().getCurrentThemeType()) {
        applyTheme(newConfig.theme);
      }
    });
  }

  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <SettingsApp onThemeChange={applyTheme} />
    </React.StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void bootstrap());
} else {
  void bootstrap();
}
