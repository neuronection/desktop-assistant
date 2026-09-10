import React from 'react';
import { createRoot } from 'react-dom/client';
import '@neuronection/assistant-ui/styles.css';
import '@renderer/styles/motion.css';
import '@renderer/styles/chat-app.css';
import '@renderer/styles/theme.css';
import '@renderer/styles/notifications.css';
import { ChatApp } from './ChatApp';
import { DesktopApp } from './DesktopApp';
import { ThemeManager } from '@renderer/managers/ThemeManager';
import { ThemeType } from '@shared/constants/themes';
import { AppConfig } from '@shared/config/AppConfig';
import { applyTheme } from '@renderer/settings-react/theme';
import { NotificationService } from '@renderer/services/NotificationService';

const isDesktopMode = new URLSearchParams(window.location.search).get('mode') === 'desktop';

function applyOverlayTheme(themeType: ThemeType): void {
  applyTheme(themeType);
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) {
    console.error('Fatal: #app container not found!');
    return;
  }

  const notificationContainer = document.getElementById('notification-container');
  if (notificationContainer) {
    NotificationService.init(notificationContainer);
  }
  if (!isDesktopMode) {
    // The compact launcher renders notices in-flow (the window grows);
    // desktop mode keeps the DOM toasts — it has the room for them.
    NotificationService.setHandler((message, type) => {
      window.dispatchEvent(new CustomEvent('da-notice', { detail: { type, message } }));
    });
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
  applyOverlayTheme(initialTheme);

  if (window.electronAPI?.onConfigUpdate) {
    window.electronAPI.onConfigUpdate((newConfig: Partial<AppConfig>) => {
      if (newConfig.theme && newConfig.theme !== ThemeManager.getInstance().getCurrentThemeType()) {
        applyOverlayTheme(newConfig.theme);
      }
    });
  }

  if (!isDesktopMode) {
    if (window.electronAPI?.onFocusInput) {
      window.electronAPI.onFocusInput(() => {
        const textarea = container.querySelector('textarea');
        textarea?.focus();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.electronAPI.hideWindow();
      }
    });
  }

  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      {isDesktopMode ? <DesktopApp /> : <ChatApp onThemeChange={applyOverlayTheme} />}
    </React.StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void bootstrap());
} else {
  void bootstrap();
}
