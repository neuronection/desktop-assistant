import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { ChatResult } from '@langchain/core/outputs';

export class ScriptedChatModel extends BaseChatModel {
  lc_serializable = false;

  private step = 0;

  constructor(private readonly script: AIMessage[]) {
    super({});
  }

  _modelType(): string {
    return 'scripted_chat_model';
  }

  _llmType(): string {
    return 'scripted_chat_model';
  }

  _identifyingParams(): Record<string, unknown> {
    return {};
  }

  bindTools(): this {
    return this;
  }

  private nextMessage(): AIMessage {
    const message = this.script[Math.min(this.step, this.script.length - 1)];
    this.step += 1;
    return message;
  }

  async _generate(
    _messages: BaseMessage[],
    _options: unknown,
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const message = this.nextMessage();
    const text = typeof message.content === 'string' ? message.content : '';
    if (text) {
      await runManager?.handleLLMNewToken(text);
    }
    return { generations: [{ text, message }] };
  }
}
