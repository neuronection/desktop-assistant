import type { Message } from '@shared/database-types';
import { MessageRole } from '@shared/database-types';
import { ancestorChain, childrenByParent } from '@main/services/messageTree';

/**
 * Health H2 ruling (ai-features §8): a turn's checkpoint thread is the
 * branch key of its anchor. The original spine keeps the bare conversation
 * id so pre-branching pauses stay resumable; a diverged branch keys
 * `{conversationId}:{branchTipId}`.
 *
 * Role-aware anchor rule:
 * - deepest non-first-born USER variant on the chain = an edited branch;
 * - otherwise root-most non-first-born ASSISTANT variant = a re-roll lineage,
 *   keyed on the variant's parent (determinable before the new sibling exists);
 * - otherwise the anchor is on the original spine.
 */
export function branchThreadKey(conversationId: string, messages: Message[], anchor: Message): string {
  const children = childrenByParent(messages);
  const chain = ancestorChain(messages, anchor.id);
  const firstBorn = (message: Message): boolean => {
    const siblings = children.get(message.parentId ?? '') ?? [];
    return siblings.length === 0 || siblings[0].id === message.id;
  };
  const userMarkers = chain.filter(
    (message) => message.role === MessageRole.USER && !firstBorn(message)
  );
  if (userMarkers.length > 0) {
    return `${conversationId}:${userMarkers[userMarkers.length - 1].id}`;
  }
  for (const message of chain) {
    if (message.role === MessageRole.ASSISTANT && !firstBorn(message)) {
      return `${conversationId}:${message.parentId}`;
    }
  }
  return conversationId;
}

/**
 * Regenerate runs under the target USER message: when the target already has
 * a reply, the re-roll is a fresh assistant variant keyed on the target; a
 * first reply under a childless target is just a send and keeps the chain key.
 */
export function regenerateThreadKey(conversationId: string, messages: Message[], target: Message): string {
  const key = branchThreadKey(conversationId, messages, target);
  if (key !== conversationId) {
    return key;
  }
  const hasReply = messages.some((message) => message.parentId === target.id);
  return hasReply ? `${conversationId}:${target.id}` : conversationId;
}

/** Both thread forms are owned by the conversation before the first colon. */
export function checkpointThreadOwner(threadId: string): string {
  const separator = threadId.indexOf(':');
  return separator === -1 ? threadId : threadId.slice(0, separator);
}
