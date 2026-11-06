import { describe, expect, it } from 'vitest';
import { MessageRole } from '@shared/database-types';
import type { Message } from '@shared/database-types';
import { branchThreadKey, checkpointThreadOwner, regenerateThreadKey } from '@main/turns/branchThreads';

function message(
  id: string,
  parentId: string | null,
  role: MessageRole,
  createdAt: number
): Message {
  return {
    id,
    parentId,
    activeChildId: null,
    role,
    content: id,
    conversationId: 'conv',
    createdAt: new Date(createdAt),
  };
}

describe('per-branch LangGraph thread keys (health H2 ruling)', () => {
  it('keeps the bare conversation id on the original spine', () => {
    const u1 = message('u1', null, MessageRole.USER, 1);
    const a1 = message('a1', 'u1', MessageRole.ASSISTANT, 2);
    const u2 = message('u2', 'a1', MessageRole.USER, 3);
    expect(branchThreadKey('conv', [u1, a1, u2], u2)).toBe('conv');
  });

  it('keys an edited user branch on the deepest edited sibling', () => {
    const u1 = message('u1', null, MessageRole.USER, 1);
    const a1 = message('a1', 'u1', MessageRole.ASSISTANT, 2);
    const edited = message('edited', null, MessageRole.USER, 3);
    expect(branchThreadKey('conv', [u1, a1, edited], edited)).toBe('conv:edited');
    const editedReply = message('edited-reply', 'edited', MessageRole.ASSISTANT, 4);
    expect(branchThreadKey('conv', [u1, a1, edited, editedReply], editedReply)).toBe('conv:edited');
  });

  it('keys a regenerate reply on the target user, but keeps a first reply on the spine', () => {
    const u1 = message('u1', null, MessageRole.USER, 1);
    const a1 = message('a1', 'u1', MessageRole.ASSISTANT, 2);
    const a2 = message('a2', 'u1', MessageRole.ASSISTANT, 3);
    expect(branchThreadKey('conv', [u1, a1, a2], a2)).toBe('conv:u1');
    expect(regenerateThreadKey('conv', [u1, a1], u1)).toBe('conv:u1');
    const childless = message('u2', 'a1', MessageRole.USER, 4);
    expect(regenerateThreadKey('conv', [u1, a1, childless], childless)).toBe('conv');
  });

  it('derives ownership for both thread forms', () => {
    expect(checkpointThreadOwner('conv')).toBe('conv');
    expect(checkpointThreadOwner('conv:branch-tip')).toBe('conv');
    expect(checkpointThreadOwner('conv:branch:deeper')).toBe('conv');
  });
});
