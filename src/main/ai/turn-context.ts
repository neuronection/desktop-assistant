import { AsyncLocalStorage } from 'node:async_hooks';

export interface TurnContextRef {
  conversationId: string;
  messageId: string;
}

const storage = new AsyncLocalStorage<TurnContextRef>();

export function runWithTurnContext<T>(context: TurnContextRef, run: () => T): T {
  return storage.run(context, run);
}

export function currentTurnContext(): TurnContextRef | undefined {
  return storage.getStore();
}
