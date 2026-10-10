import { ipcMain } from 'electron';
import type { LiveNoticeCode, LiveSnapshot } from '@shared/live';
import type { LiveSessionService } from '@main/services/LiveSessionService';

/** Every `live:*` channel this module registers (the teardown list consumes the invoke channels). */
export const LIVE_IPC_CHANNELS: string[] = [
  'live:start', 'live:stop', 'live:get-state',
];

export interface LiveIpcDeps {
  session: LiveSessionService;
  setConversationId: (id: string | null) => void;
}

export function registerLiveIpc(deps: LiveIpcDeps): void {
  const { session, setConversationId } = deps;

  ipcMain.handle('live:start', async (_event, conversationId: string): Promise<LiveSnapshot> => {
    setConversationId(typeof conversationId === 'string' && conversationId ? conversationId : null);
    return session.start();
  });

  ipcMain.handle('live:stop', async (): Promise<LiveSnapshot> => {
    const snapshot = session.stop('user');
    setConversationId(null);
    return snapshot;
  });

  ipcMain.handle('live:get-state', async (): Promise<LiveSnapshot> => session.getSnapshot());

  ipcMain.on('live:mic-ready', () => session.micReady());
  ipcMain.on('live:phrase-committed', (_event, transcript: string) => {
    void session.phraseCommitted(transcript);
  });
  ipcMain.on('live:speech-detected', (_event, input: { transcript: string; currentSentence: string }) => {
    void session.speechDetected(input);
  });
  ipcMain.on('live:playback-started', () => session.playbackStarted());
  ipcMain.on('live:playback-ended', () => session.playbackEnded());
  ipcMain.on('live:interrupt', () => session.interrupt());
  ipcMain.on('live:fail', (_event, code: LiveNoticeCode) => session.fail(code));
  ipcMain.on('live:warning', (_event, code: LiveNoticeCode) => session.warn(code));
  ipcMain.on('live:downgrade', () => session.downgrade());
  ipcMain.on('live:set-duplex', (_event, fullDuplex: boolean) => session.setFullDuplex(fullDuplex === true));
}
