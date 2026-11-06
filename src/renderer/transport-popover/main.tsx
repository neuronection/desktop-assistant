import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OctagonX, Pause, Play, Square } from 'lucide-react';
import '@renderer/styles/theme.css';
import { applyTheme } from '@renderer/settings-react/theme';
import { ThemeType } from '@shared/constants/themes';
import { TEXT } from '@shared/constants/text';
import { SPEECH_INITIAL, type SpeechSnapshot } from '@shared/speech';
import { LIVE_INITIAL, type LiveSnapshot } from '@shared/live';
import './transport-popover.css';

function TransportPopover(): React.ReactElement {
  const [speech, setSpeech] = useState<SpeechSnapshot>(SPEECH_INITIAL);
  const [live, setLive] = useState<LiveSnapshot>(LIVE_INITIAL);

  useEffect(() => {
    const api = window.electronAPI;
    void api?.getSpeechSnapshot?.().then(setSpeech).catch(() => undefined);
    void api?.getLiveState?.().then(setLive).catch(() => undefined);
    const offSpeech = api?.onSpeechState?.((next) => setSpeech(next));
    const offLive = api?.onLiveEvent?.((event) => {
      if (event.type === 'state') {
        setLive(event.snapshot);
      }
    });
    return () => {
      offSpeech?.();
      offLive?.();
    };
  }, []);

  const liveActive = live.state !== 'idle';
  const paused = speech.state === 'paused';

  if (liveActive) {
    return (
      <div className="transport-panel" role="group" aria-label={TEXT.SPEECH_HUD_ARIA}>
        <button
          type="button"
          className="transport-button"
          aria-label={TEXT.SPEECH_LIVE_INTERRUPT}
          title={TEXT.SPEECH_LIVE_INTERRUPT}
          onClick={() => void window.electronAPI.interruptLiveReply?.()}
        >
          <OctagonX size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="transport-button transport-button--stop"
          aria-label={TEXT.SPEECH_LIVE_END}
          title={TEXT.SPEECH_LIVE_END}
          onClick={() => void window.electronAPI.endLiveSession?.()}
        >
          <Square size={13} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="transport-panel" role="group" aria-label={TEXT.SPEECH_HUD_ARIA}>
      <button
        type="button"
        className="transport-button"
        aria-label={paused ? TEXT.SPEECH_RESUME : TEXT.SPEECH_PAUSE}
        title={paused ? TEXT.SPEECH_RESUME : TEXT.SPEECH_PAUSE}
        onClick={() => void window.electronAPI.controlSpeech?.(paused ? 'resume' : 'pause')}
      >
        {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="transport-button transport-button--stop"
        aria-label={TEXT.SPEECH_STOP}
        title={TEXT.SPEECH_STOP}
        onClick={() => void window.electronAPI.controlSpeech?.('stop')}
      >
        <Square size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById('transport-root');
  if (!container) {
    return;
  }
  let theme: ThemeType = ThemeType.CLASSIC;
  try {
    const config = await window.electronAPI?.loadConfig?.();
    if (config?.theme) {
      theme = config.theme;
    }
  } catch {
    // keep the default theme
  }
  applyTheme(theme);
  createRoot(container).render(
    <React.StrictMode>
      <TransportPopover />
    </React.StrictMode>
  );
}

void bootstrap();
