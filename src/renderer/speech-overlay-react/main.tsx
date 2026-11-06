import React from 'react';
import { createRoot } from 'react-dom/client';
import '@neuronection/assistant-ui/styles.css';
import '@renderer/styles/motion.css';
import '@renderer/styles/speech-hud.css';
import '@renderer/styles/theme.css';
import { SpeechOverlayApp } from './SpeechOverlayApp';
import { parseHudCapture, SpeechHudCapture } from './hudCapture';
import { createSpeechPlaybackController } from './playback';
import { ErrorBoundary } from '@renderer/shared/ErrorBoundary';
import { installErrorReporting } from '@renderer/shared/installErrorReporting';
import { ThemeType } from '@shared/constants/themes';
import { AppConfig } from '@shared/config/AppConfig';
import { applyTheme } from '@renderer/settings-react/theme';
import type { SpeechHudStyle } from '@shared/speechHud';

function themeFromParam(value: string | null): ThemeType | null {
  if (!value) {
    return null;
  }
  return (
    Object.values(ThemeType).find((theme) => theme.toLowerCase() === value.toLowerCase()) ?? null
  );
}

async function bootstrap(): Promise<void> {
  installErrorReporting();
  const container = document.getElementById('speech-root');
  if (!container) {
    console.error('Speech overlay root element not found!');
    return;
  }

  const capture = window.electronAPI ? null : parseHudCapture(window.location.search);
  if (capture) {
    applyTheme(themeFromParam(new URLSearchParams(window.location.search).get('capTheme')) ?? ThemeType.DARK);
    createRoot(container).render(
      <React.StrictMode>
        <SpeechHudCapture capture={capture} />
      </React.StrictMode>
    );
    return;
  }

  let initialTheme: ThemeType = ThemeType.CLASSIC;
  let initialStyle: SpeechHudStyle = 'card';
  try {
    if (window.electronAPI) {
      const config: Partial<AppConfig> | undefined = await window.electronAPI.loadConfig();
      if (config?.theme) {
        initialTheme = config.theme;
      }
      if (config?.voice?.speechHudStyle) {
        initialStyle = config.voice.speechHudStyle;
      }
    }
  } catch (error) {
    console.warn('Failed to load theme preference, using default:', error);
  }
  applyTheme(initialTheme);

  const controller = createSpeechPlaybackController({
    createAudio: (src) => new Audio(src),
    report: (fact) => {
      window.electronAPI?.reportSpeechFact?.(fact);
    },
  });

  createRoot(container).render(
    <React.StrictMode>
      <ErrorBoundary>
        <SpeechOverlayApp controller={controller} initialStyle={initialStyle} />
      </ErrorBoundary>
    </React.StrictMode>
  );
}

void bootstrap();
