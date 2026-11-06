import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpeechCacheStats, SpeechSnapshot } from '@shared/speech';
import { SPEECH_INITIAL } from '@shared/speech';
import { LIVE_INITIAL } from '@shared/live';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    },
    on: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    },
    removeHandler: (channel: string) => handlers.delete(channel),
    removeAllListeners: (channel: string) => handlers.delete(channel),
  },
}));

import { registerSpeechIpc } from '@main/ipc/speech';
import { registerLiveIpc } from '@main/ipc/live';
import { broadcastSpeechState, sendToSpeechOverlays, type SpeechWindowLike } from '@main/ipc/speechBroadcast';

const eventFrom = (url: string) => ({ sender: { getURL: () => url } });
const settingsEvent = eventFrom('http://localhost:3300/settings.html');
const launcherEvent = eventFrom('http://localhost:3300/');
const overlayEvent = eventFrom('http://localhost:3300/speech-overlay.html');
const liveHostEvent = eventFrom('http://localhost:3300/live-host.html');
const packEvent = eventFrom('http://localhost:3300/pack-window.html');
const resultEvent = eventFrom('http://localhost:3300/result-viewer.html?call=x');

const stats: SpeechCacheStats = { enabled: true, available: false, utterances: 3, bytes: 512 };

function setup(): {
  stats: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
  preview: ReturnType<typeof vi.fn>;
  handleFact: ReturnType<typeof vi.fn>;
  interruptReply: ReturnType<typeof vi.fn>;
  endLive: ReturnType<typeof vi.fn>;
  beginDrag: ReturnType<typeof vi.fn>;
  moveDrag: ReturnType<typeof vi.fn>;
  endDrag: ReturnType<typeof vi.fn>;
  cancelDrag: ReturnType<typeof vi.fn>;
  openHudMenu: ReturnType<typeof vi.fn>;
  openHudAssistant: ReturnType<typeof vi.fn>;
} {
  const cache = {
    stats: vi.fn(async () => stats),
    clear: vi.fn(async () => undefined),
  };
  const speech = {
    speak: vi.fn(async () => 'started'),
    preview: vi.fn(async () => 'started'),
    control: vi.fn(() => SPEECH_INITIAL),
    getSnapshot: vi.fn(() => SPEECH_INITIAL),
    getHistory: vi.fn(() => []),
    currentInstruction: vi.fn(() => null),
    handleFact: vi.fn(),
  };
  const live = { interruptReply: vi.fn(), end: vi.fn() };
  const hudDrag = { begin: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
  const hud = { menu: vi.fn(), openAssistant: vi.fn() };
  registerSpeechIpc({ cache: cache as never, speech: speech as never, live, hudDrag, hud });
  return {
    ...cache,
    speak: speech.speak,
    preview: speech.preview,
    handleFact: speech.handleFact,
    interruptReply: live.interruptReply,
    endLive: live.end,
    beginDrag: hudDrag.begin,
    moveDrag: hudDrag.move,
    endDrag: hudDrag.end,
    cancelDrag: hudDrag.cancel,
    openHudMenu: hud.menu,
    openHudAssistant: hud.openAssistant,
  };
}

beforeEach(() => {
  handlers.clear();
});

describe('speech IPC (plan 58 §4.6)', () => {
  it('serves stats to Settings, including the unavailable session state', async () => {
    setup();
    await expect(handlers.get('speech:cache-stats')!(settingsEvent)).resolves.toEqual(stats);
  });

  it('clears the cache and reports success', async () => {
    const cache = setup();
    await expect(handlers.get('speech:cache-clear')!(settingsEvent)).resolves.toBe(true);
    expect(cache.clear).toHaveBeenCalledTimes(1);
  });

  it('denies the cache controls to the launcher window (least privilege)', async () => {
    setup();
    for (const channel of ['speech:cache-stats', 'speech:cache-clear']) {
      await expect(handlers.get(channel)!(launcherEvent), channel).rejects.toThrow(/not available to the launcher/);
    }
  });

  it('lets overlay, launcher, desktop and settings speak — never pack/result windows', async () => {
    const { speak } = setup();
    for (const event of [launcherEvent, overlayEvent, settingsEvent, eventFrom('http://localhost:3300/?mode=desktop')]) {
      await expect(handlers.get('speech:speak')!(event, { text: 'hi', source: 'reply' })).resolves.toBe('started');
    }
    expect(speak).toHaveBeenCalledTimes(4);
    for (const event of [packEvent, resultEvent]) {
      await expect(handlers.get('speech:speak')!(event, { text: 'hi', source: 'reply' })).rejects.toThrow(
        /not available to the (pack|result) window/
      );
    }
    expect(speak).toHaveBeenCalledTimes(4);
  });

  it('lets only Settings audition a voice, and never accepts preview through speech:speak', async () => {
    const { preview } = setup();
    await expect(handlers.get('speech:preview')!(settingsEvent, { voice: 'nova', speed: 1.2 })).resolves.toBe('started');
    expect(preview).toHaveBeenCalledWith({ voice: 'nova', speed: 1.2 });
    for (const event of [launcherEvent, overlayEvent, eventFrom('http://localhost:3300/?mode=desktop')]) {
      await expect(handlers.get('speech:preview')!(event, { voice: 'nova' })).rejects.toThrow(
        /not available to the (launcher|overlay|desktop) window/
      );
    }
    await expect(
      handlers.get('speech:speak')!(settingsEvent, { text: 'hi', source: 'preview' })
    ).rejects.toThrow(/invalid_args/i);
  });

  it('restricts playback facts to the overlay', () => {
    const speech = setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fact = { utteranceId: 1, chunkIndex: 0, fact: 'ended' };
    handlers.get('speech:playback-fact')!(launcherEvent, fact);
    expect(errors).toHaveBeenCalledWith('[ipc] speech:playback-fact:', expect.objectContaining({ code: 'scope_denied' }));
    expect(speech.handleFact).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('proves overlay cannot invoke live:*', async () => {
    setup();
    registerLiveIpc({ session: {} as never, setConversationId: vi.fn() });
    await expect(handlers.get('live:start')!(overlayEvent, 'conv-1')).rejects.toThrow(/not available to the overlay/);
  });

  it('lets only the overlay open the HUD menu and hand control to the launcher', async () => {
    const hud = setup();
    for (const channel of ['speech:hud-menu', 'speech:hud-open']) {
      await expect(handlers.get(channel)!(launcherEvent), channel).rejects.toThrow(/not available to the launcher/);
      await expect(handlers.get(channel)!(settingsEvent), channel).rejects.toThrow(/not available to the settings/);
    }
    await handlers.get('speech:hud-menu')!(overlayEvent);
    await handlers.get('speech:hud-open')!(overlayEvent);
    expect(hud.openHudMenu).toHaveBeenCalledTimes(1);
    expect(hud.openHudAssistant).toHaveBeenCalledTimes(1);
  });

  it('takes absolute drag points from the overlay only and denies the launcher', async () => {
    const handle = setup();
    handlers.get('speech:hud-drag-start')!(overlayEvent, 100, 200);
    handlers.get('speech:hud-drag-move')!(overlayEvent, 112, 196);
    handlers.get('speech:hud-drag-end')!(overlayEvent);
    handlers.get('speech:hud-drag-cancel')!(overlayEvent);
    expect(handle.beginDrag).toHaveBeenCalledWith(100, 200);
    expect(handle.moveDrag).toHaveBeenCalledWith(112, 196);
    expect(handle.endDrag).toHaveBeenCalledTimes(1);
    expect(handle.cancelDrag).toHaveBeenCalledTimes(1);

    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handlers.get('speech:hud-drag-start')!(launcherEvent);
    expect(errors).toHaveBeenCalledWith('[ipc] speech:hud-drag-start:', expect.objectContaining({ code: 'scope_denied' }));
    errors.mockRestore();
  });

  it('lets the overlay interrupt or end a live session, and denies the launcher', async () => {
    const handle = setup();
    await expect(handlers.get('speech:live-interrupt')!(overlayEvent)).resolves.toBeUndefined();
    await expect(handlers.get('speech:live-end')!(overlayEvent)).resolves.toBeUndefined();
    expect(handle.interruptReply).toHaveBeenCalledTimes(1);
    expect(handle.endLive).toHaveBeenCalledTimes(1);

    for (const channel of ['speech:live-interrupt', 'speech:live-end']) {
      await expect(handlers.get(channel)!(launcherEvent), channel).rejects.toThrow(/not available to the launcher/);
    }
  });

  it('lets the overlay read the live snapshot but never start or control a session', async () => {
    setup();
    const getSnapshot = vi.fn(() => ({ ...SPEECH_INITIAL, state: 'idle' }));
    registerLiveIpc({
      session: { getSnapshot, start: vi.fn(), micReady: vi.fn() } as never,
      setConversationId: vi.fn(),
    });
    await expect(handlers.get('live:get-state')!(overlayEvent)).resolves.toMatchObject({ state: 'idle' });
    expect(getSnapshot).toHaveBeenCalled();

    for (const channel of ['live:start', 'live:stop']) {
      await expect(handlers.get(channel)!(overlayEvent, 'conv-1'), channel).rejects.toThrow(/not available to the overlay/);
    }
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handlers.get('live:mic-ready')!(overlayEvent);
    expect(errors).toHaveBeenCalledWith('[ipc] live:mic-ready:', expect.objectContaining({ code: 'scope_denied' }));
    errors.mockRestore();
  });

  it('takes live audio facts from the hidden host only', async () => {
    const micReady = vi.fn();
    registerLiveIpc({ session: { getSnapshot: vi.fn(() => LIVE_INITIAL), micReady } as never, setConversationId: vi.fn() });
    handlers.get('live:mic-ready')!(liveHostEvent);
    expect(micReady).toHaveBeenCalledTimes(1);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handlers.get('live:mic-ready')!(launcherEvent);
    expect(errors).toHaveBeenCalledWith('[ipc] live:mic-ready:', expect.objectContaining({ code: 'scope_denied' }));
    errors.mockRestore();
  });

  it('starts/stops the hidden host with the session and honours host readiness', async () => {
    const host = { start: vi.fn(), stop: vi.fn(), ready: vi.fn() };
    const start = vi.fn(() => ({ ...LIVE_INITIAL, state: 'arming' }));
    const stop = vi.fn(() => LIVE_INITIAL);
    registerLiveIpc({
      session: { start, stop, getSnapshot: vi.fn(() => LIVE_INITIAL) } as never,
      setConversationId: vi.fn(),
      host,
    });
    await handlers.get('live:start')!(launcherEvent, 'conv-1');
    expect(host.start).toHaveBeenCalledTimes(1);
    await handlers.get('live:stop')!(launcherEvent);
    expect(host.stop).toHaveBeenCalledTimes(1);
    handlers.get('live-host:ready')!(liveHostEvent);
    expect(host.ready).toHaveBeenCalledTimes(1);
  });

  it('stops the speech bus before a live session starts (reverse arbitration)', async () => {
    setup();
    const onStart = vi.fn();
    const start = vi.fn(() => ({ ...SPEECH_INITIAL, state: 'arming' }));
    registerLiveIpc({ session: { start } as never, setConversationId: vi.fn(), onStart });
    await handlers.get('live:start')!(launcherEvent, 'conv-1');
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0]);
  });
});

describe('speech broadcast reachability (plan 58 §4.6)', () => {
  function windowAt(url: string, options: { destroyed?: boolean } = {}) {
    const send = vi.fn();
    const target: SpeechWindowLike = {
      isDestroyed: () => options.destroyed === true,
      webContents: { send, getURL: () => url },
    };
    return { target, send };
  }

  it('reaches a hidden overlay — visibility never gates the broadcast', () => {
    const hiddenOverlay = windowAt('http://localhost:3300/speech-overlay.html');
    const launcher = windowAt('http://localhost:3300/');
    const destroyed = windowAt('http://localhost:3300/settings.html', { destroyed: true });
    const snapshot: SpeechSnapshot = { ...SPEECH_INITIAL, state: 'speaking' };
    broadcastSpeechState([hiddenOverlay.target, launcher.target, destroyed.target], snapshot);
    expect(hiddenOverlay.send).toHaveBeenCalledWith('speech:state', snapshot);
    expect(launcher.send).toHaveBeenCalledWith('speech:state', snapshot);
    expect(destroyed.send).not.toHaveBeenCalled();
  });

  it('targets playback instructions at the overlay only', () => {
    const overlay = windowAt('http://localhost:3300/speech-overlay.html');
    const launcher = windowAt('http://localhost:3300/');
    const play = { utteranceId: 1, chunkIndex: 0, url: 'data:audio/wav;base64,AAAA' };
    sendToSpeechOverlays([overlay.target, launcher.target], 'speech:play', play);
    sendToSpeechOverlays([overlay.target, launcher.target], 'speech:stop');
    expect(overlay.send).toHaveBeenNthCalledWith(1, 'speech:play', play);
    expect(overlay.send).toHaveBeenNthCalledWith(2, 'speech:stop', undefined);
    expect(launcher.send).not.toHaveBeenCalled();
  });
});
