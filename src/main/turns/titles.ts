import { AiTask, LLMProviderType } from '@shared/types';
import { modelTuning, resolveTaskModel } from '@shared/ai/tasks';
import type { TurnContext, TurnManagerDeps } from './TurnManager';

export async function generateTitleIfNeeded(
  deps: TurnManagerDeps,
  ctx: TurnContext,
  assistantContent: string
): Promise<void> {
  try {
    const config = deps.getConfig();
    const resolution = resolveTaskModel(config, AiTask.TITLES, null) ?? resolveTaskModel(config, AiTask.PLUMBING, null);
    if (!resolution) {
      return;
    }
    const conversation = (await deps.conversations.getConversationById?.(ctx.conversationId)) ?? null;
    if (!conversation) {
      return;
    }
    const autoTitle = ctx.request.content.substring(0, 40) + (ctx.request.content.length > 40 ? '...' : '');
    if (conversation.title !== autoTitle) {
      return;
    }
    const apiKey = await deps.resolveKey(resolution.provider);
    if (!apiKey && resolution.provider.type !== LLMProviderType.OLLAMA) {
      return;
    }
    const raw = await deps.gateway.chat({
      provider: resolution.provider,
      modelId: resolution.modelId,
      apiKey,
      task: resolution.task,
      overrides: modelTuning(resolution.provider, resolution.model),
      messages: [
        {
          role: 'system',
          content: 'Generate a concise conversation title (3-6 words) for the exchange. Reply with the title only, no quotes, no punctuation at the end.',
        },
        {
          role: 'user',
          content: `User: ${ctx.request.content.slice(0, 500)}\n\nAssistant: ${assistantContent.slice(0, 500)}`,
        },
      ],
    });
    const clean = raw
      .split('\n')[0]
      .replace(/^["'\s]+/, '')
      .replace(/["'\s.]+$/, '')
      .slice(0, 80)
      .trim();
    if (clean) {
      await deps.conversations.updateConversation(ctx.conversationId, { title: clean });
    }
  } catch (error) {
    console.error('Title generation failed:', error);
  }
}
