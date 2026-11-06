import type { LiveNoticeCode, LiveSnapshot } from '@shared/live';
import type { LiveSessionService } from '@main/services/LiveSessionService';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every `live:*` channel this module registers (the teardown list consumes the invoke channels). */

export interface LiveIpcDeps {
  session: LiveSessionService;
  setConversationId: (id: string | null) => void;
}

export function registerLiveIpc(deps: LiveIpcDeps): void {
  const { session, setConversationId } = deps;

  register(IPC['live:start'], async (_event, conversationId: string): Promise<LiveSnapshot> => {
    setConversationId(conversationId || null);
    return session.start();
  });

  register(IPC['live:stop'], async (): Promise<LiveSnapshot> => {
    const snapshot = session.stop('user');
    setConversationId(null);
    return snapshot;
  });

  register(IPC['live:get-state'], async (): Promise<LiveSnapshot> => session.getSnapshot());

  register(IPC['live:mic-ready'], () => session.micReady());
  register(IPC['live:phrase-committed'], (_event, transcript: string) => {
    void session.phraseCommitted(transcript);
  });
  register(IPC['live:speech-detected'], (_event, input: { transcript: string; currentSentence: string }) => {
    void session.speechDetected(input);
  });
  register(IPC['live:playback-started'], () => session.playbackStarted());
  register(IPC['live:playback-ended'], () => session.playbackEnded());
  register(IPC['live:interrupt'], () => session.interrupt());
  register(IPC['live:fail'], (_event, code: LiveNoticeCode) => session.fail(code));
  register(IPC['live:warning'], (_event, code: LiveNoticeCode) => session.warn(code));
  register(IPC['live:downgrade'], () => session.downgrade());
  register(IPC['live:set-duplex'], (_event, fullDuplex: boolean) => session.setFullDuplex(fullDuplex === true));
}
