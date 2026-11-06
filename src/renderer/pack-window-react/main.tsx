import React from 'react';
import { createRoot } from 'react-dom/client';
import '@neuronection/assistant-ui/styles.css';
import '@renderer/styles/motion.css';
import '@renderer/styles/pack-window.css';
import '@renderer/styles/theme.css';
import { PackWindowApp } from './PackWindowApp';
import { ErrorBoundary } from '@renderer/shared/ErrorBoundary';
import { installErrorReporting } from '@renderer/shared/installErrorReporting';
import { ThemeType } from '@shared/constants/themes';
import { AppConfig } from '@shared/config/AppConfig';
import { applyTheme } from '@renderer/settings-react/theme';

async function bootstrap(): Promise<void> {
  installErrorReporting();
  const container = document.getElementById('pack-window-root');
  if (!container) {
    console.error('Pack window root element not found!');
    return;
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

  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <PackWindowApp />
      </ErrorBoundary>
    </React.StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void bootstrap());
} else {
  void bootstrap();
}
