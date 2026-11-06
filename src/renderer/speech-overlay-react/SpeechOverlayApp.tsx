import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SPEECH_INITIAL, type SpeechSnapshot } from '@shared/speech';
import type { LiveSnapshot } from '@shared/live';
import {
  hudSizeTokens,
  type HudCustomSize,
  type HudSizeMode,
  type HudSizeTokens,
  type SpeechHudDock,
  type SpeechHudEdgeSide,
  type SpeechHudStyle,
} from '@shared/speechHud';
import { DEFAULT_HUB_DOT_ACTIONS, type HubActionId, type HubBusy, type HubResult } from '@shared/hub';
import { TEXT } from '@shared/constants/text';
import type { SpeechPlaybackController } from './playback';
import { SpeechHud } from './SpeechHud';
import { useHudDictation } from './useHudDictation';

/** Subscribes in the commit phase and pulls the snapshot once (latest event wins). */
export function useSpeechSnapshot(): SpeechSnapshot {
  const [snapshot, setSnapshot] = useState<SpeechSnapshot>(SPEECH_INITIAL);
  const received = useRef(false);

  useLayoutEffect(() => {
    const api = window.electronAPI;
    if (!api?.onSpeechState) {
      return undefined;
    }
    let mounted = true;
    const off = api.onSpeechState((next) => {
      received.current = true;
      setSnapshot(next);
    });
    void api
      .getSpeechSnapshot()
      .then((initial) => {
        if (mounted && !received.current) {
          setSnapshot(initial);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      off();
    };
  }, []);

  return snapshot;
}

/** Config-driven HUD style: pulled on mount, updated live by `config-updated`. */
export function useSpeechHudStyle(initial: SpeechHudStyle = 'card'): {
  style: SpeechHudStyle;
  edgeSide: SpeechHudEdgeSide;
  preset: 'pulse' | 'aurora' | 'minimal' | 'snake' | 'terminal';
  motion: boolean;
  textScale: number;
  size: HudSizeTokens;
  dock: SpeechHudDock;
  resultAutoHideMs: number;
  dotActions: HubActionId[];
  dotDirection: 'start' | 'end';
} {
  const [style, setStyle] = useState<SpeechHudStyle>(initial);
  const [edgeSide, setEdgeSide] = useState<SpeechHudEdgeSide>('right');
  const [preset, setPreset] = useState<'pulse' | 'aurora' | 'minimal' | 'snake' | 'terminal'>('pulse');
  const [motion, setMotion] = useState(true);
  const [dockText, setDockText] = useState<'off' | 'latest'>('latest');
  const [dotActions, setDotActions] = useState<HubActionId[]>([...DEFAULT_HUB_DOT_ACTIONS]);
  const [dotXRatio, setDotXRatio] = useState(1);
  const [sizeMode, setSizeMode] = useState<HudSizeMode>('comfort');
  const [customSize, setCustomSize] = useState<HudCustomSize | undefined>();
  const [resultAutoHideMs, setResultAutoHideMs] = useState(10_000);
  const configEpoch = useRef(0);

  useLayoutEffect(() => {
    const api = window.electronAPI;
    if (!api) {
      return undefined;
    }
    let mounted = true;
    const epoch = configEpoch.current;
    void api
      .loadConfig?.()
      .then((config) => {
        if (!mounted || configEpoch.current !== epoch) {
          return;
        }
        const next = config?.voice?.speechHudStyle;
        if (mounted && next) {
          setStyle(next);
        }
        const side = config?.voice?.speechHudEdgeSide;
        if (mounted && side) {
          setEdgeSide(side);
        }
        if (mounted && config?.voice?.hudPreset) {
          setPreset(config.voice.hudPreset);
        }
        if (mounted && typeof config?.voice?.hudMotion === 'boolean') {
          setMotion(config.voice.hudMotion);
        }
        if (mounted && config?.voice?.hudSizePreset) {
          setSizeMode(config.voice.hudSizePreset);
        }
        if (mounted && config?.voice?.hudCustomSize) {
          setCustomSize(config.voice.hudCustomSize);
        }
        if (mounted && config?.voice?.hubDockText) {
          setDockText(config.voice.hubDockText);
        }
        if (mounted && typeof config?.voice?.hubResultAutoHideMs === 'number') {
          setResultAutoHideMs(config.voice.hubResultAutoHideMs);
        }
        if (mounted && Array.isArray(config?.voice?.hubDotActions)) {
          setDotActions([...config.voice.hubDotActions]);
        }
        if (mounted && typeof config?.voice?.speechHudDotXRatio === 'number') {
          setDotXRatio(config.voice.speechHudDotXRatio);
        }
      })
      .catch(() => undefined);
    api.onConfigUpdate?.((update) => {
      configEpoch.current += 1;
      const next = update.voice?.speechHudStyle;
      if (next) {
        setStyle(next);
      }
      const side = update.voice?.speechHudEdgeSide;
      if (side) {
        setEdgeSide(side);
      }
      if (update.voice?.hudPreset) {
        setPreset(update.voice.hudPreset);
      }
      if (typeof update.voice?.hudMotion === 'boolean') {
        setMotion(update.voice.hudMotion);
      }
      if (update.voice?.hudSizePreset) {
        setSizeMode(update.voice.hudSizePreset);
      }
      if (update.voice?.hudCustomSize) {
        setCustomSize(update.voice.hudCustomSize);
      }
      if (update.voice?.hubDockText) {
        setDockText(update.voice.hubDockText);
      }
      if (typeof update.voice?.hubResultAutoHideMs === 'number') {
        setResultAutoHideMs(update.voice.hubResultAutoHideMs);
      }
      if (Array.isArray(update.voice?.hubDotActions)) {
        setDotActions([...update.voice.hubDotActions]);
      }
      if (typeof update.voice?.speechHudDotXRatio === 'number') {
        setDotXRatio(update.voice.speechHudDotXRatio);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const size = hudSizeTokens(sizeMode, customSize);
  const text = dockText === 'latest';
  return {
    style,
    edgeSide,
    preset,
    motion,
    textScale: size.textScale,
    size,
    dock: { text, width: text ? size.faceWidth : 30, size },
    resultAutoHideMs,
    dotActions,
    dotDirection: dotXRatio >= 0.5 ? ('end' as const) : ('start' as const),
  };
}

export interface LiveFeed {
  snapshot: LiveSnapshot | null;
  transcript: string | null;
  caption: string | null;
}

/**
 * Read-only live feed for the presence surface (plan 58 addendum + plan 63):
 * the overlay pulls the snapshot on mount, follows `live:event`, and keeps
 * the last user transcript plus the bounded reply caption. It never invokes
 * a live control and persists nothing.
 */
export function useLiveFeed(): LiveFeed {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const received = useRef(false);
  const sessionRef = useRef(0);

  useLayoutEffect(() => {
    const api = window.electronAPI;
    if (!api?.onLiveEvent) {
      return undefined;
    }
    let mounted = true;
    const off = api.onLiveEvent((event) => {
      if (event.type === 'state') {
        received.current = true;
        sessionRef.current = event.snapshot.session;
        setSnapshot(event.snapshot);
        if (event.snapshot.state === 'arming') {
          setCaption(null);
        }
        if (event.snapshot.state === 'idle') {
          setCaption(null);
          setTranscript(null);
        }
      } else if (event.type === 'transcript') {
        setTranscript(event.text);
      } else if (event.type === 'ended') {
        setCaption(null);
        setTranscript(null);
      }
    });
    const offCaption = api.onLiveCaption?.((payload) => {
      if (payload.session !== sessionRef.current) {
        return;
      }
      setCaption(payload.text ? payload.text : null);
    });
    void api
      .getLiveState?.()
      .then((initial) => {
        if (mounted && !received.current && initial) {
          sessionRef.current = initial.session;
          setSnapshot(initial);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      off();
      offCaption?.();
    };
  }, []);

  return { snapshot, transcript, caption };
}

export interface SpeechOverlayAppProps {
  controller: SpeechPlaybackController;
  initialStyle?: SpeechHudStyle;
}

export function SpeechOverlayApp({ controller, initialStyle = 'card' }: SpeechOverlayAppProps): React.ReactElement {
  const opaque = new URLSearchParams(window.location.search).get('opaque') === '1';
  const snapshot = useSpeechSnapshot();
  const liveFeed = useLiveFeed();
  const live = liveFeed.snapshot;
  const { style, edgeSide, preset, motion, textScale, size, dock, resultAutoHideMs, dotActions, dotDirection } =
    useSpeechHudStyle(initialStyle);
  const liveActive = live !== null && live.state !== 'idle';
  const dictation = useHudDictation({ enabled: !liveActive, resultAutoHideMs });
  const [hubResult, setHubResult] = useState<HubResult | null>(null);
  const [hubBusy, setHubBusy] = useState<HubBusy | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [selectionAvailable, setSelectionAvailable] = useState(false);
  const [previewSide, setPreviewSide] = useState<SpeechHudEdgeSide | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sawInstruction = useRef(false);
  const resynced = useRef(false);

  useLayoutEffect(() => {
    const api = window.electronAPI;
    if (!api?.onSpeechPlay) {
      return undefined;
    }
    const offPlay = api.onSpeechPlay((instruction) => {
      sawInstruction.current = true;
      controller.play(instruction);
    });
    const offStop = api.onSpeechStop(() => {
      sawInstruction.current = true;
      controller.stop();
    });
    return () => {
      offPlay();
      offStop();
    };
  }, [controller]);

  useEffect(() => {
    if (resynced.current) {
      return;
    }
    resynced.current = true;
    const api = window.electronAPI;
    if (!api?.getSpeechChunk) {
      return;
    }
    void (async () => {
      const current = await api.getSpeechSnapshot().catch(() => null);
      if (!current || current.state === 'idle' || sawInstruction.current) {
        return;
      }
      const chunk = await api.getSpeechChunk().catch(() => null);
      if (chunk && !sawInstruction.current) {
        controller.play(chunk);
      }
    })();
  }, [controller]);

  useEffect(() => {
    controller.setState(snapshot.state);
  }, [controller, snapshot.state]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onHudEdgePreview) {
      return undefined;
    }
    return api.onHudEdgePreview((state) => setPreviewSide(state.side));
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onStartHudDictation) {
      return undefined;
    }
    return api.onStartHudDictation(() => {
      void dictation.start();
    });
  }, [dictation.start]);

  useEffect(() => {
    if (liveActive) {
      dictation.cancel();
    }
  }, [liveActive, dictation.cancel]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onHubSelection) {
      return undefined;
    }
    return api.onHubSelection((state) => setSelectionAvailable(state.available === true));
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.checkHubSelection) {
      return undefined;
    }
    api.checkHubSelection();
    const check = (): void => {
      api.checkHubSelection?.();
    };
    document.addEventListener('pointerenter', check, true);
    return () => {
      document.removeEventListener('pointerenter', check, true);
    };
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onLiveMicLevel) {
      return undefined;
    }
    return api.onLiveMicLevel((level) => {
      setMicLevel(Math.max(0, Math.min(1, level)));
    });
  }, []);

  useEffect(() => {
    if (!live || live.state === 'idle' || live.state === 'error' || live.capture !== 'open') {
      setMicLevel(0);
    }
  }, [live?.state, live?.capture]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onHubBusy) {
      return undefined;
    }
    return api.onHubBusy((busy) => {
      setHubBusy(busy.active ? busy : null);
    });
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onHubResult) {
      return undefined;
    }
    return api.onHubResult((result) => {
      setHubResult(result);
      if (resultTimer.current) {
        clearTimeout(resultTimer.current);
      }
      resultTimer.current = setTimeout(() => {
        resultTimer.current = null;
        setHubResult(null);
      }, resultAutoHideMs);
    });
  }, [resultAutoHideMs]);

  useEffect(
    () => () => {
      if (resultTimer.current) {
        clearTimeout(resultTimer.current);
      }
    },
    []
  );

  const speechStateText =
    snapshot.state === 'synthesizing'
      ? TEXT.SPEECH_PREPARING
      : snapshot.state === 'paused'
        ? snapshot.chunkText || TEXT.SPEECH_PAUSED
        : snapshot.state === 'speaking'
          ? snapshot.chunkText || TEXT.SPEECH_SPEAKING
          : '';
  const liveStateLabel =
    live?.state === 'arming' || live?.state === 'listening'
      ? TEXT.LIVE_HUD_LISTENING
      : live?.state === 'transcribing'
        ? TEXT.VOICE_TRANSCRIBING
        : live?.state === 'thinking'
          ? TEXT.LIVE_HUD_THINKING
          : live?.state === 'preparing'
            ? TEXT.LIVE_STATE_PREPARING
            : live?.state === 'speaking'
              ? liveFeed.caption ?? TEXT.LIVE_STATE_SPEAKING
              : live?.state === 'paused'
                ? TEXT.LIVE_HUD_APPROVAL
                : live?.state === 'error'
                  ? TEXT.LIVE_HUD_ERROR
                  : TEXT.HUB_ACTION_LIVE;
  const liveStateText = liveActive
    ? live?.state === 'listening' || live?.state === 'arming'
      ? liveStateLabel
      : liveFeed.caption ?? liveFeed.transcript ?? liveStateLabel
    : '';
  const busyText = hubBusy
    ? hubBusy.id === 'translate-selection'
      ? TEXT.HUB_BUSY_TRANSLATING
      : hubBusy.id === 'speak-selection'
        ? TEXT.SPEECH_PREPARING
        : ''
    : '';
  const dictationText = liveActive ? '' : dictation.text;
  const bodyText = liveActive
    ? liveStateText
    : dictationText || hubResult?.text || speechStateText;
  const dockText = (dictationText || busyText || bodyText).replace(/\s+/g, ' ').trim();

  const togglePause = (): void => {
    void window.electronAPI?.controlSpeech?.(snapshot.state === 'paused' ? 'resume' : 'pause');
  };

  const stop = (): void => {
    void window.electronAPI?.controlSpeech?.('stop');
  };

  const interruptLive = (): void => {
    void window.electronAPI?.interruptLiveReply?.();
  };

  const endLive = (): void => {
    void window.electronAPI?.endLiveSession?.();
  };

  return (
    <SpeechHud
      snapshot={snapshot}
      live={live}
      liveTranscript={liveFeed.transcript}
      liveCaption={liveFeed.caption}
      style={style}
      edgeSide={previewSide ?? edgeSide}
      opaque={opaque}
      preset={preset}
      motion={motion}
      textScale={textScale}
      dock={dock}
      size={size}
      dockText={dockText}
      busy={hubBusy !== null}
      micLevel={dictation.active ? dictation.micLevel : micLevel}
      selection={selectionAvailable}
      dictating={dictation.active}
      working={dictation.state === 'thinking' || dictation.state === 'streaming'}
      dotActions={dotActions}
      dotDirection={dotDirection}
      onDictate={() => {
        void dictation.start();
      }}
      onSendDictation={() => {
        void dictation.send();
      }}
      onCancelDictation={dictation.cancel}
      onCancelTurn={() => {
        void window.electronAPI.cancelTurn();
      }}
      onActivateText={
        hubResult &&
        hubResult.kind !== 'error' &&
        !liveActive &&
        !dictation.active &&
        !hubBusy
          ? () => window.electronAPI.activateHubResult?.()
          : undefined
      }
      onTogglePause={togglePause}
      onStop={stop}
      onInterruptLive={interruptLive}
      onEndLive={endLive}
    />
  );
}
