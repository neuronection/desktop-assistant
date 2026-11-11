import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<'update'>();

/** Marks the single permitted public purpose: version metadata and release assets. */
export function withEgressPurpose<T>(purpose: 'update', run: () => T): T {
  return storage.run(purpose, run);
}

export function currentEgressPurpose(): 'update' | undefined {
  return storage.getStore();
}
