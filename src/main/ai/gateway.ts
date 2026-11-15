import { AIMessage as AppMessage, LLMProvider, LLMProviderType } from '@shared/types';
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage, type MessageContent } from '@langchain/core/messages';
import { ChatModelLike, ModelFactory, ModelOverrides, createChatModel } from './chat-models';
import { recordAiCall, AuditSink, AiCallRecord } from './audit';
import { embedTexts } from './embeddings';
import { extractUsage, mergeUsage } from './usage';

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
  /** Cancels the provider call (a vision/OCR read must not run forever). */
  signal?: AbortSignal;
}

export interface EmbedRequest {
  provider: LLMProvider;
  modelId: string;
  apiKey: string;
  texts: string[];
  /** Audit task label; defaults to the family `embed` task. */
  task?: string;
}

export class AiGateway {
  private readonly createModel: ModelFactory;
  private readonly audit: AuditSink;

  constructor(createModel: ModelFactory = createChatModel, audit: AuditSink = recordAiCall) {
    this.createModel = createModel;
    this.audit = audit;
  }

  async chat(request: ChatRequest): Promise<string> {
    const { provider, modelId, apiKey, messages, task, overrides, signal } = request;
    const startedAt = Date.now();
    try {
      const model: ChatModelLike = this.createModel(provider, modelId, apiKey, overrides);
      const response = await model.invoke(toLcMessages(messages), signal ? { signal } : undefined);
      const text = contentToString(response.content);
      await this.auditRecord({
        task,
        providerId: provider.id,
        model: modelId,
        durationMs: Date.now() - startedAt,
        outcome: 'ok',
        ...(extractUsage(response) ?? {}),
      });
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

  /**
   * Embedding call over the sanctioned AI-layer transport
   * (`embeddings.ts`, ADR-0018). Every call audits an `AiCall` row on the
   * `embed` task; a typed unsupported provider throws before any fetch.
   */
  async embed(request: EmbedRequest): Promise<number[][]> {
    const { provider, modelId, apiKey, texts, task = 'embed' } = request;
    const startedAt = Date.now();
    try {
      const vectors = await embedTexts({ ...provider, apiKey }, modelId, texts);
      await this.auditRecord({ task, providerId: provider.id, model: modelId, durationMs: Date.now() - startedAt, outcome: 'ok' });
      return vectors;
    } catch (error) {
      await this.auditRecord({
        task, providerId: provider.id, model: modelId,
        durationMs: Date.now() - startedAt, outcome: 'error',
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async *chatStream(request: ChatRequest): AsyncGenerator<string> {
    const { provider, modelId, apiKey, messages, task, overrides } = request;
    const startedAt = Date.now();
    let usage = null as Awaited<ReturnType<typeof extractUsage>>;
    let completed = false;
    let failure: Error | null = null;
    try {
      const model: ChatModelLike = this.createModel(provider, modelId, apiKey, overrides);
      // ChatOpenAI (current @langchain/openai) returns a Promise from
      // .stream(); older/other clients return the generator directly —
      // await tolerates both.
      const streamStrategy = provider.type === LLMProviderType.ANTHROPIC ? 'max' : 'sum';
      for await (const chunk of await model.stream(toLcMessages(messages))) {
        usage = mergeUsage(usage, extractUsage(chunk), streamStrategy);
        const token = contentToString(chunk.content);
        if (token) {
          yield token;
        }
      }
      completed = true;
    } catch (error) {
      failure = error as Error;
      throw new Error(`AI stream failed for model ${modelId}: ${failure.message}`);
    } finally {
      await this.auditRecord({
        task,
        providerId: provider.id,
        model: modelId,
        durationMs: Date.now() - startedAt,
        outcome: completed ? 'ok' : 'error',
        ...(completed ? {} : { error: failure?.message ?? 'cancelled' }),
        ...(usage ?? {}),
      });
    }
  }

  private auditRecord(record: AiCallRecord): Promise<void> {
    return this.audit(record);
  }
}

export const aiGateway = new AiGateway();
