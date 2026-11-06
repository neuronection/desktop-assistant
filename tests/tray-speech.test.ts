import { describe, expect, it, vi } from 'vitest';
import { SPEECH_INITIAL, type SpeechSnapshot } from '@shared/speech';
import { LIVE_INITIAL } from '@shared/live';

const buildFromTemplate = vi.fn((template: { label?: string; enabled?: boolean; click?: () => void }[]) => ({
  template,
}));

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  safeStorage: { isEncryptionAvailable: () => false },
  Tray: class {},
  Menu: { buildFromTemplate: (template: unknown) => buildFromTemplate(template as []) },
  nativeImage: { createFromPath: vi.fn(() => ({ resize: () => ({}) })) },
}));

const { TrayManager } = await import('@main/tray');
const { TEXT } = await import('@shared/constants/text');

function speaking(patch: Partial<SpeechSnapshot> = {}): SpeechSnapshot {
  return { ...SPEECH_INITIAL, state: 'speaking', source: 'selection', chunkIndex: 2, chunkCount: 12, ...patch };
}

function managerWithTray(): { manager: InstanceType<typeof TrayManager>; tray: Record<string, ReturnType<typeof vi.fn>> } {
  const manager = new TrayManager();
  const tray = { setToolTip: vi.fn(), setTitle: vi.fn(), setContextMenu: vi.fn(), destroy: vi.fn() };
  (manager as unknown as { tray: unknown }).tray = tray;
  return { manager, tray };
}

function labels(): (string | undefined)[] {
  const template = buildFromTemplate.mock.calls.at(-1)?.[0] ?? [];
  return (template as { label?: string }[]).map((item) => item.label);
}

describe('tray speech items (plan 58 S3b)', () => {
  it('offers Speak clipboard always, pause/stop only while the bus is active', () => {
    const { manager } = managerWithTray();
    manager.setSpeechState(SPEECH_INITIAL);
    expect(labels()).toContain(TEXT.TRAY_SPEAK_CLIPBOARD);
    const idlePause = (buildFromTemplate.mock.calls.at(-1)?.[0] as { label?: string; enabled?: boolean }[]).find(
      (item) => item.label === TEXT.TRAY_PAUSE_SPEAKING
    );
    const idleStop = (buildFromTemplate.mock.calls.at(-1)?.[0] as { label?: string; enabled?: boolean }[]).find(
      (item) => item.label === TEXT.TRAY_STOP_SPEAKING
    );
    expect(idlePause?.enabled).toBe(false);
    expect(idleStop?.enabled).toBe(false);

    manager.setSpeechState(speaking());
    const activePause = (buildFromTemplate.mock.calls.at(-1)?.[0] as { label?: string; enabled?: boolean }[]).find(
      (item) => item.label === TEXT.TRAY_PAUSE_SPEAKING
    );
    const activeStop = (buildFromTemplate.mock.calls.at(-1)?.[0] as { label?: string; enabled?: boolean }[]).find(
      (item) => item.label === TEXT.TRAY_STOP_SPEAKING
    );
    expect(activePause?.enabled).toBe(true);
    expect(activeStop?.enabled).toBe(true);
  });

  it('flips the pause item to resume while paused', () => {
    const { manager } = managerWithTray();
    manager.setSpeechState(speaking({ state: 'paused' }));
    expect(labels()).toContain(TEXT.TRAY_RESUME_SPEAKING);
    expect(labels()).not.toContain(TEXT.TRAY_PAUSE_SPEAKING);
  });

  it('offers the three HUD styles as a radio submenu', () => {
    const { manager } = managerWithTray();
    manager.setSpeechState(SPEECH_INITIAL);
    type Entry = { label?: string; type?: string; checked?: boolean; click?: () => void; submenu?: Entry[] };
    const styleItem = (buildFromTemplate.mock.calls.at(-1)?.[0] as Entry[]).find(
      (item) => item.label === TEXT.VOICE_SPEECH_HUD_STYLE
    );
    expect(styleItem?.submenu?.map((item) => item.label)).toEqual([
      TEXT.VOICE_SPEECH_HUD_STYLE_CARD,
      TEXT.VOICE_SPEECH_HUD_STYLE_EDGE,
      TEXT.VOICE_SPEECH_HUD_STYLE_DOT,
    ]);
    expect(styleItem?.submenu?.every((item) => item.type === 'radio')).toBe(true);
    expect(styleItem?.submenu?.find((item) => item.checked)?.label).toBe(TEXT.VOICE_SPEECH_HUD_STYLE_CARD);

    const handler = vi.fn();
    manager.on('set-hud-style', handler);
    styleItem?.submenu?.find((item) => item.label === TEXT.VOICE_SPEECH_HUD_STYLE_DOT)?.click?.();
    expect(handler).toHaveBeenCalledWith('dot');
  });

  it('starts and ends live from the tray, disabling the impossible action', () => {
    const { manager } = managerWithTray();
    type Entry = { label?: string; enabled?: boolean; click?: () => void };
    const item = (label: string): Entry | undefined =>
      (buildFromTemplate.mock.calls.at(-1)?.[0] as Entry[]).find((candidate) => candidate.label === label);

    manager.setSpeechState(SPEECH_INITIAL);
    expect(item(TEXT.TRAY_START_LIVE)?.enabled).toBe(true);
    expect(item(TEXT.TRAY_END_LIVE)?.enabled).toBe(false);

    const start = vi.fn();
    const end = vi.fn();
    manager.on('start-live', start);
    manager.on('end-live', end);
    item(TEXT.TRAY_START_LIVE)?.click?.();
    expect(start).toHaveBeenCalledTimes(1);

    manager.setLiveState({ ...LIVE_INITIAL, state: 'listening', capture: 'open' });
    expect(item(TEXT.TRAY_START_LIVE)?.enabled).toBe(false);
    expect(item(TEXT.TRAY_END_LIVE)?.enabled).toBe(true);
    item(TEXT.TRAY_END_LIVE)?.click?.();
    expect(end).toHaveBeenCalledTimes(1);

    manager.setLiveState({ ...LIVE_INITIAL, state: 'error', reason: 'mic_denied' });
    expect(item(TEXT.TRAY_START_LIVE)?.enabled).toBe(true);
    expect(item(TEXT.TRAY_END_LIVE)?.enabled).toBe(true);

    manager.setLiveState({ ...LIVE_INITIAL, state: 'idle' });
    expect(item(TEXT.TRAY_START_LIVE)?.enabled).toBe(true);
    expect(item(TEXT.TRAY_END_LIVE)?.enabled).toBe(false);
  });

  it('enables Replay last only after something was spoken', () => {
    const { manager } = managerWithTray();
    const replayItem = () =>
      (buildFromTemplate.mock.calls.at(-1)?.[0] as { label?: string; enabled?: boolean }[]).find(
        (item) => item.label === TEXT.TRAY_REPLAY_LAST
      );
    manager.setSpeechState(SPEECH_INITIAL);
    expect(replayItem()?.enabled).toBe(false);
    manager.setSpeechReplayAvailable(true);
    expect(replayItem()?.enabled).toBe(true);
  });

  it('emits replay-speaking from the tray item', () => {
    const { manager } = managerWithTray();
    manager.setSpeechReplayAvailable(true);
    const handler = vi.fn();
    manager.on('replay-speaking', handler);
    const item = (buildFromTemplate.mock.calls.at(-1)?.[0] as { label?: string; click?: () => void }[]).find(
      (candidate) => candidate.label === TEXT.TRAY_REPLAY_LAST
    );
    item?.click?.();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rides the progress in the tooltip and resets it when idle', () => {
    const { manager, tray } = managerWithTray();
    manager.setSpeechState(speaking());
    expect(tray.setToolTip).toHaveBeenLastCalledWith('Speaking 3 of 12');
    manager.setSpeechState(speaking({ state: 'paused' }));
    expect(tray.setToolTip).toHaveBeenLastCalledWith('Paused at 3 of 12');
    manager.setSpeechState(SPEECH_INITIAL);
    expect(tray.setToolTip).toHaveBeenLastCalledWith(TEXT.TRAY_TOOLTIP);
  });
});
