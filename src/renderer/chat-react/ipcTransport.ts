import type { ChatStreamEvent } from '@neuronection/assistant-ui/chat-core';
import type { TurnEvent, TurnOutcome, TurnStartRequest } from '@shared/turns';
import { turnEventToChatStreamEvents } from './turnEventsMap';

export interface ChatIpcTransportHooks {
  onStartTurn: (text: string) => TurnStartRequest | null;
  onFinishTurn: (outcome: TurnOutcome) => Promise<void>;
  onTurnRejected?: () => void;
  onTurnEvent?: (event: TurnEvent) => void;
}

/**
 * Maps the main-process turn stream (ai:turn-start + broadcast ai:turn-event)
 * onto the family ChatStreamEvent vocabulary consumed by useChatStream.
 */
export function createIpcTransport(hooks: ChatIpcTransportHooks) {
  let onEvent: ((event: ChatStreamEvent) => void) | null = null;
  let unsubscribeEvents: (() => void) | null = null;

  return {
    async send({ text }: { text: string }): Promise<void> {
      const request = hooks.onStartTurn(text);
      if (!request) {
        throw new Error('Turn could not be started: no model configured or no active conversation.');
      }
      try {
        await window.electronAPI.startTurn(request);
      } catch (error) {
        hooks.onTurnRejected?.();
        throw error;
      }
    },
    async stop(): Promise<void> {
      await window.electronAPI.cancelTurn();
    },
    subscribe({ onEvent: handler }: { onEvent: (event: ChatStreamEvent) => void }): () => void {
      onEvent = handler;
      unsubscribeEvents?.();
      unsubscribeEvents = window.electronAPI.onTurnEvent((turnEvent: TurnEvent) => {
        hooks.onTurnEvent?.(turnEvent);
        turnEventToChatStreamEvents(turnEvent).forEach((streamEvent) => {
          onEvent?.(streamEvent);
        });
        if (turnEvent.phase === 'finished') {
          void hooks.onFinishTurn({ phase: 'finished', conversationId: turnEvent.conversationId });
        } else if (turnEvent.phase === 'failed') {
          void hooks.onFinishTurn({
            phase: 'failed',
            conversationId: turnEvent.conversationId,
            error: turnEvent.error ?? 'Unknown error',
          });
        } else if (turnEvent.phase === 'cancelled') {
          void hooks.onFinishTurn({ phase: 'cancelled', conversationId: turnEvent.conversationId });
        }
      });
      return () => {
        onEvent = null;
        unsubscribeEvents?.();
        unsubscribeEvents = null;
      };
    },
  };
}
