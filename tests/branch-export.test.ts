import { describe, expect, it } from 'vitest';
import { MessageRole } from '@shared/database-types';
import type { Message } from '@shared/types';
import { buildBranchJson, buildBranchMarkdown } from '@renderer/chat-react/branchExport';

const node = (
  id: string,
  parentId: string | null,
  role: MessageRole,
  content: string,
  activeChildId: string | null,
  createdAt: number
): Message => ({
  id,
  parentId,
  activeChildId,
  role,
  content,
  conversationId: 'conv',
  createdAt: new Date(createdAt),
});

describe('tree-aware export (plan 40 S4)', () => {
  it('exports every branch in Markdown and marks the active path', () => {
    const messages = [
      node('u1', null, MessageRole.USER, 'original question', 'a1', 1),
      node('a1', 'u1', MessageRole.ASSISTANT, 'original answer', null, 2),
      node('u2', null, MessageRole.USER, 'edited question', 'a2', 3),
      node('a2', 'u2', MessageRole.ASSISTANT, 'edited answer', null, 4),
    ];
    const markdown = buildBranchMarkdown('Branches', messages, 'u2');
    expect(markdown).toContain('original question');
    expect(markdown).toContain('original answer');
    expect(markdown).toContain('edited question');
    expect(markdown).toContain('edited answer');
    expect(markdown).toContain('_(active path)_');
  });

  it('exports the full tree structure in JSON', () => {
    const messages = [
      node('u1', null, MessageRole.USER, 'q', 'a1', 1),
      node('a1', 'u1', MessageRole.ASSISTANT, 'a', null, 2),
    ];
    const parsed = JSON.parse(buildBranchJson('Branches', messages, 'u1')) as {
      activeRootId: string;
      messages: Array<{ id: string; parentId: string | null; activeChildId: string | null }>;
    };
    expect(parsed.activeRootId).toBe('u1');
    expect(parsed.messages).toEqual([
      expect.objectContaining({ id: 'u1', parentId: null, activeChildId: 'a1' }),
      expect.objectContaining({ id: 'a1', parentId: 'u1', activeChildId: null }),
    ]);
  });
});
