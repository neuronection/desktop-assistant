import type { Message } from '@shared/types';

function activeIds(messages: Message[], activeRootId: string | null): Set<string> {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const ids = new Set<string>();
  let current = activeRootId;
  while (current && byId.has(current) && !ids.has(current)) {
    ids.add(current);
    current = byId.get(current)?.activeChildId ?? null;
  }
  return ids;
}

function depthOf(message: Message, byId: Map<string, Message>): number {
  let depth = 0;
  let parent = message.parentId ? byId.get(message.parentId) : undefined;
  const seen = new Set<string>();
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    depth += 1;
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return depth;
}

function body(message: Message, indent: string): string {
  return message.content
    .split('\n')
    .map((line) => `${indent}> ${line}`)
    .join('\n');
}

/**
 * Full-tree Markdown (not just the active path): every sibling branch is
 * exported so an edit/regenerate is recoverable from the file.
 */
export function buildBranchMarkdown(title: string, messages: Message[], activeRootId: string | null): string {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const active = activeIds(messages, activeRootId);
  const lines = [`# ${title}`, '', '## Full conversation tree', ''];
  for (const message of messages) {
    const indent = '  '.repeat(depthOf(message, byId));
    const role = message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'System';
    lines.push(`${indent}- **${role}**${active.has(message.id) ? ' _(active path)_' : ''}`);
    lines.push(body(message, `${indent}  `));
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

export function buildBranchJson(
  title: string,
  messages: Message[],
  activeRootId: string | null
): string {
  return JSON.stringify(
    {
      title,
      activeRootId,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        parentId: message.parentId ?? null,
        activeChildId: message.activeChildId ?? null,
        variantIndex: message.variantIndex ?? 0,
        variantCount: message.variantCount ?? 1,
        siblingIds: message.siblingIds ?? [message.id],
        createdAt: message.createdAt,
      })),
    },
    null,
    2
  );
}
