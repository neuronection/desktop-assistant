import type { DecisionRuleFire } from '@shared/ai/decisions';
import { decisionRuleText } from '@shared/ai/decisions';
import { TEXT } from '@shared/constants/text';
import type { TurnManagerDeps } from './TurnManager';

export function notifyTurn(deps: Pick<TurnManagerDeps, 'notify'>, title: string, body: string): void {
  try {
    if (deps.notify) {
      deps.notify(title, body);
    }
  } catch (error) {
    console.error('Turn notification failed:', error);
  }
}

export function applyDecisionRule(
  deps: Pick<TurnManagerDeps, 'notify' | 'conversations'>,
  fire: DecisionRuleFire | undefined,
  conversationId: string
): void {
  if (!fire) {
    return;
  }
  const { rule } = fire;
  if (rule.action === 'notify') {
    notifyTurn(deps, TEXT.DECISION_RULE_NOTIFY_TITLE, decisionRuleText(rule));
  } else if (rule.action === 'tag') {
    const setMetadata = deps.conversations.setConversationMetadata;
    if (setMetadata) {
      void deps.conversations
        .getConversationById?.(conversationId)
        .then((conversation) =>
          setMetadata(conversationId, {
            ...conversation?.metadata,
            decisionTag: decisionRuleText(rule),
          })
        )
        .catch(() => undefined);
    }
  }
  console.log(`[decision] rule ${rule.id} fired (${rule.action}) on ${rule.matchTool}`);
}
