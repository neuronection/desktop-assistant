import type { SpeechCacheService } from '@main/services/SpeechCacheService';
import type { SpeechService } from '@main/services/SpeechService';
import type { SpeechControl, SpeechPlaybackFact, SpeechPreviewRequest, SpeechRequest } from '@shared/speech';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

export interface SpeechIpcDeps {
  cache: SpeechCacheService;
  speech: SpeechService;
  hudDrag?: {
    begin(x: number, y: number): void;
    move(x: number, y: number): void;
    end(): void;
    cancel(): void;
  };
  /** The live loop's interrupt/end seams, shared with the tray (plan 58 addendum). */
  live?: {
    interruptReply(): void;
    end(): void;
  };
  /** HUD navigation: the native right-click menu and the card's open button. */
  hud?: {
    menu(): void;
    openAssistant(): void;
    busy?(active: boolean): void;
  };
}

export function registerSpeechIpc(deps: SpeechIpcDeps): void {
  register(IPC['speech:cache-stats'], async () => deps.cache.stats());
  register(IPC['speech:cache-clear'], async () => {
    await deps.cache.clear();
    return true;
  });
  register(IPC['speech:speak'], async (_event, request: SpeechRequest) => deps.speech.speak(request));
  register(IPC['speech:preview'], async (_event, request: SpeechPreviewRequest) => deps.speech.preview(request));
  register(IPC['speech:control'], async (_event, action: SpeechControl) => deps.speech.control(action));
  register(IPC['speech:snapshot'], async () => deps.speech.getSnapshot());
  register(IPC['speech:history'], async () => deps.speech.getHistory());
  register(IPC['speech:replay'], async (_event, utteranceId: number) => deps.speech.replay(utteranceId));
  register(IPC['speech:current-chunk'], async () => deps.speech.currentInstruction());
  register(IPC['speech:hud-drag-start'], (_event, x: number, y: number) => deps.hudDrag?.begin(x, y));
  register(IPC['speech:hud-drag-move'], (_event, x: number, y: number) => deps.hudDrag?.move(x, y));
  register(IPC['speech:hud-drag-end'], () => deps.hudDrag?.end());
  register(IPC['speech:hud-drag-cancel'], () => deps.hudDrag?.cancel());
  register(IPC['speech:live-interrupt'], async () => deps.live?.interruptReply());
  register(IPC['speech:live-end'], async () => deps.live?.end());
  register(IPC['speech:hud-busy'], (_event, active: boolean) => deps.hud?.busy?.(active));
  register(IPC['speech:hud-menu'], async () => deps.hud?.menu());
  register(IPC['speech:hud-open'], async () => deps.hud?.openAssistant());
  register(IPC['speech:playback-fact'], (_event, fact: SpeechPlaybackFact) => {
    deps.speech.handleFact(fact);
  });
}
