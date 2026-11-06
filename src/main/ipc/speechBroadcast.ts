import type { SpeechSnapshot } from '@shared/speech';
import { scopeFromUrl } from '@main/ipc/register';

export interface SpeechWindowLike {
  isDestroyed(): boolean;
  webContents: {
    send(channel: string, payload?: unknown): void;
    getURL(): string;
  };
}

/**
 * `speech:state` reaches EVERY window — including a hidden overlay (plan 58
 * §4.6 reachability): a hidden renderer still owns its audio element, so
 * visibility can never gate the broadcast.
 */
export function broadcastSpeechState(targets: readonly SpeechWindowLike[], snapshot: SpeechSnapshot): void {
  for (const target of targets) {
    if (!target.isDestroyed()) {
      target.webContents.send('speech:state', snapshot);
    }
  }
}

export function speechOverlays(
  targets: readonly SpeechWindowLike[],
  scopeOf: (url: string) => string = scopeFromUrl
): SpeechWindowLike[] {
  return targets.filter(
    (target) => !target.isDestroyed() && scopeOf(target.webContents.getURL()) === 'overlay'
  );
}

export function sendToSpeechOverlays(
  targets: readonly SpeechWindowLike[],
  channel: 'speech:play' | 'speech:stop',
  payload?: unknown,
  scopeOf: (url: string) => string = scopeFromUrl
): void {
  for (const target of speechOverlays(targets, scopeOf)) {
    target.webContents.send(channel, payload);
  }
}
