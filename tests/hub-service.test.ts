import { describe, it, expect, vi } from 'vitest';
import { HubService, type HubServiceDeps } from '@main/hub/HubService';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { SPEECH_INITIAL } from '@shared/speech';
import { LIVE_INITIAL } from '@shared/live';
import { TEXT } from '@shared/constants/text';

function deps(overrides: Partial<HubServiceDeps> = {}): HubServiceDeps {
  return {
    getConfig: () => DEFAULT_CONFIG,
    getSpeech: () => SPEECH_INITIAL,
    getLive: () => LIVE_INITIAL,
    readSelection: async () => ({ ok: true, text: 'Hello world' }),
    readClipboard: vi.fn(() => ''),
    speakClipboard: vi.fn(async () => 'started'),
    sendSelection: vi.fn(),
    translate: vi.fn(async () => ({ text: 'Hallo', engine: 'llm', target: 'de', source: 'en' })),
    speakSelection: async () => 'started',
    speechControl: vi.fn(),
    liveInterrupt: vi.fn(),
    liveEnd: vi.fn(),
    startLive: vi.fn(),
    endLive: vi.fn(),
    openAssistant: vi.fn(),
    hideHub: vi.fn(),
    openSettings: vi.fn(),
    startDictation: vi.fn(),
    sendResult: vi.fn(),
    openResult: vi.fn(),
    sendBusy: vi.fn(),
    ...overrides,
  };
}

describe('HubService (plan 65)', () => {
  it('lists configured actions in order and disables selection actions without text', async () => {
    const service = new HubService(deps({ readSelection: async () => ({ ok: false, reason: 'unsupported', error: TEXT.SELECTION_UNSUPPORTED }) }));
    const actions = await service.actions();
    expect(actions.map((a) => a.id)).toEqual([...DEFAULT_CONFIG.voice.hubQuickActions]);
    expect(actions.find((a) => a.id === 'translate-selection')).toMatchObject({
      enabled: false,
      reason: TEXT.HUB_SELECTION_REQUIRED,
    });
    expect(actions.find((a) => a.id === 'speak-selection')?.enabled).toBe(false);
    expect(actions.find((a) => a.id === 'dictate')?.enabled).toBe(true);
  });

  it('marks the live action active while a session runs', async () => {
    const service = new HubService(deps({ getLive: () => ({ ...LIVE_INITIAL, state: 'listening' }) }));
    const actions = await service.actions();
    expect(actions.find((a) => a.id === 'live-toggle')).toMatchObject({ enabled: true, active: true });
  });

  it('translates the selection and emits a result', async () => {
    const d = deps();
    const service = new HubService(d);
    const result = await service.run('translate-selection');
    expect(result.ok).toBe(true);
    expect(d.translate).toHaveBeenCalledWith('Hello world', 'en');
    expect(d.sendResult).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'translation', text: 'Hallo', retryable: true })
    );
  });

  it('falls back to clipboard text when the primary selection is empty', async () => {
    const d = deps({
      readSelection: async () => ({ ok: false }),
      readClipboard: () => 'Copied text',
    });
    const service = new HubService(d);
    expect((await service.actions()).find((a) => a.id === 'translate-selection')?.enabled).toBe(true);
    await service.run('translate-selection');
    expect(d.translate).toHaveBeenCalledWith('Copied text', 'en');
    await service.run('speak-selection');
    expect(d.speakClipboard).toHaveBeenCalledTimes(1);
  });

  it('broadcasts whether a text target exists', async () => {
    const sendSelection = vi.fn();
    const service = new HubService(deps({ sendSelection }));
    await service.checkSelection();
    expect(sendSelection).toHaveBeenCalledWith({ available: true });
    sendSelection.mockClear();
    const empty = new HubService(
      deps({ readSelection: async () => ({ ok: false }), readClipboard: () => '', sendSelection })
    );
    await empty.checkSelection();
    expect(sendSelection).toHaveBeenCalledWith({ available: false });
  });

  it('announces the translating state before and after the action', async () => {
    const calls: { id: string; active: boolean }[] = [];
    const d = deps({ sendBusy: (busy) => calls.push(busy) });
    await new HubService(d).run('translate-selection');
    expect(calls).toEqual([
      { id: 'translate-selection', active: true },
      { id: 'translate-selection', active: false },
    ]);
  });

  it('reports a missing selection instead of calling the translator', async () => {
    const d = deps({ readSelection: async () => ({ ok: false, error: TEXT.SELECTION_UNSUPPORTED }) });
    const service = new HubService(d);
    const result = await service.run('translate-selection');
    expect(result).toMatchObject({ ok: false, error: TEXT.HUB_SELECTION_REQUIRED });
    expect(d.translate).not.toHaveBeenCalled();
    expect(d.sendResult).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
  });

  it('emits an error result when translation fails, with retry', async () => {
    const d = deps({ translate: vi.fn(async () => { throw new Error('provider down'); }) });
    const service = new HubService(d);
    const result = await service.run('translate-selection');
    expect(result.ok).toBe(false);
    expect(d.sendResult).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', retryable: true, text: expect.stringContaining('provider down') })
    );
  });

  it('starts and ends live and routes app actions', async () => {
    const idle = deps();
    await new HubService(idle).run('live-toggle');
    expect(idle.startLive).toHaveBeenCalledTimes(1);

    const active = deps({ getLive: () => ({ ...LIVE_INITIAL, state: 'listening' }) });
    await new HubService(active).run('live-toggle');
    expect(active.endLive).toHaveBeenCalledTimes(1);

    const app = deps();
    const service = new HubService(app);
    await service.run('dictate');
    await service.run('open-assistant');
    await service.run('hide-hub');
    expect(app.startDictation).toHaveBeenCalledTimes(1);
    expect(app.openAssistant).toHaveBeenCalledTimes(1);
    expect(app.hideHub).toHaveBeenCalledTimes(1);
  });

  it('runs the fixed speech and live controls', async () => {
    const speech = deps({ getSpeech: () => ({ ...SPEECH_INITIAL, state: 'speaking' }) });
    const speechService = new HubService(speech);
    await speechService.run('speech-toggle');
    expect(speech.speechControl).toHaveBeenCalledWith('pause');
    await speechService.run('speech-stop');
    expect(speech.speechControl).toHaveBeenCalledWith('stop');

    const paused = deps({ getSpeech: () => ({ ...SPEECH_INITIAL, state: 'paused' }) });
    await new HubService(paused).run('speech-toggle');
    expect(paused.speechControl).toHaveBeenCalledWith('resume');

    const live = deps();
    const liveService = new HubService(live);
    await liveService.run('live-interrupt');
    await liveService.run('live-end');
    expect(live.liveInterrupt).toHaveBeenCalledTimes(1);
    expect(live.liveEnd).toHaveBeenCalledTimes(1);
  });

  it('opens the last result in the launcher', async () => {
    const d = deps();
    const service = new HubService(d);
    await service.run('translate-selection');
    service.activateResult();
    expect(d.openResult).toHaveBeenCalledWith('Hallo');
  });

  it('ignores activate before any result exists', () => {
    const d = deps();
    new HubService(d).activateResult();
    expect(d.openResult).not.toHaveBeenCalled();
  });

  it('rejects an unknown action', async () => {
    const service = new HubService(deps());
    expect(await service.run('rm -rf /')).toEqual({ ok: false, error: 'Unknown hub action: rm -rf /' });
  });
});
