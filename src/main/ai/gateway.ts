import { AIMessage as AppMessage, LLMProvider } from '@shared/types';
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage, type MessageContent } from '@langchain/core/messages';
import { ChatModelLike, ModelFactory, ModelOverrides, createChatModel } from './chat-models';
import { recordAiCall, AuditSink, AiCallRecord } from './audit';

export function toLcMessages(messages: AppMessage[]): BaseMessage[] {
  return messages.map((m) => {
    const content = m.content as MessageContent;
    switch (m.role) {
      case 'system':
        return new SystemMessage({ content });
      case 'assistant':
        return new AIMessage({ content });
      default:
        return new HumanMessage({ content });
    }
  });
}

export function contentToString(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
      .join('');
  }
  return '';
}

export interface ChatRequest {
  provider: LLMProvider;
  modelId: string;
  apiKey: string;
  messages: AppMessage[];
  task: string;
  overrides?: ModelOverrides;
}

export class AiGateway {
  private readonly createModel: ModelFactory;
  private readonly audit: AuditSink;

  constructor(createModel: ModelFactory = createChatModel, audit: AuditSink = recordAiCall) {
    this.createModel = createModel;
    this.audit = audit;
  }

  async chat(request: ChatRequest): Promise<string> {
    const { provider, modelId, apiKey, messages, task, overrides } = request;
    const startedAt = Date.now();
    try {
      const model: ChatModelLike = this.createModel(provider, modelId, apiKey, overrides);
      const response = await model.invoke(toLcMessages(messages));
      const text = contentToString(response.content);
      await this.auditRecord({ task, providerId: provider.id, model: modelId, durationMs: Date.now() - startedAt, outcome: 'ok' });
      return text;
    } catch (error) {
      await this.auditRecord({
        task, providerId: provider.id, model: modelId,
        durationMs: Date.now() - startedAt, outcome: 'error',
        error: (error as Error).message,
      });
      throw new Error(`AI request failed for model ${modelId}: ${(error as Error).message}`);
    }
  }

  async *chatStream(request: ChatRequest): AsyncGenerator<string> {
    const { provider, modelId, apiKey, messages, task, overrides } = request;
    const startedAt = Date.now();
    try {
      const model: ChatModelLike = this.createModel(provider, modelId, apiKey, overrides);
      for await (const chunk of model.stream(toLcMessages(messages))) {
        const token = contentToString(chunk.content);
        if (token) {
          yield token;
        }
      }
      await this.auditRecord({ task, providerId: provider.id, model: modelId, durationMs: Date.now() - startedAt, outcome: 'ok' });
    } catch (error) {
      await this.auditRecord({
        task, providerId: provider.id, model: modelId,
        durationMs: Date.now() - startedAt, outcome: 'error',
        error: (error as Error).message,
      });
      throw new Error(`AI stream failed for model ${modelId}: ${(error as Error).message}`);
    }
  }

  private auditRecord(record: AiCallRecord): Promise<void> {
    return this.audit(record);
  }
}

export const aiGateway = new AiGateway();
