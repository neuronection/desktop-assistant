import { describe, expect, it, vi, beforeEach } from 'vitest';

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>() }));

vi.mock('@main/ipc/register', () => ({
  register: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
    handlers.set(channel, handler);
  },
}));

import { registerConversationsIpc } from '@main/ipc/conversations';
import { IPC } from '@shared/ipc/registry';

const duplicateConversation = vi.fn(async (id: string, title?: string) => ({ id: 'copy-1', title: title ?? `Copy of ${id}` }));

beforeEach(() => {
  handlers.clear();
  duplicateConversation.mockClear();
  registerConversationsIpc({
    conversationService: { duplicateConversation } as never,
    messageService: {} as never,
  });
});

describe('conversation IPC — duplicate (plan 78 phase 2)', () => {
  it('copies a conversation through the service and returns the copy', async () => {
    const handler = handlers.get(IPC['db:conversations:duplicate']);
    expect(handler).toBeTruthy();
    const copy = await handler!({}, 'conv-1', 'My copy');
    expect(duplicateConversation).toHaveBeenCalledWith('conv-1', 'My copy');
    expect(copy).toEqual({ id: 'copy-1', title: 'My copy' });
  });
});
