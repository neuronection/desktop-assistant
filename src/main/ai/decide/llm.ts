import { z } from 'zod';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LLMProvider } from '@shared/types';
import type { DecisionCall, DecisionOutcome, DecisionToolSchema } from '@shared/ai/decisions';
import { sanitizeConfidence } from '@shared/ai/decisions';
import type { StructuredModelFactory } from '../chat-models';
import { createStructuredChatModel } from '../chat-models';
import type { DecisionEngine, DecisionRequest } from './types';

const llmDecisionSchema = z.object({
  calls: z
    .array(
      z.object({
        tool: z.string().min(1),
        args: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .default([]),
  confidence: z.number().default(0),
  reasoning: z.string().optional(),
});

export type LlmDecisionOutput = z.infer<typeof llmDecisionSchema>;

export function renderToolCatalog(tools: DecisionToolSchema[]): string {
  return tools
    .map((tool) =>
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        ...(tool.parameters ? { parameters: tool.parameters } : {}),
      })
    )
    .join('\n');
}

export function buildDecisionMessages(request: DecisionRequest): (SystemMessage | HumanMessage)[] {
  const system = [
    request.systemPrompt ?? 'You are a tool-dispatch engine for a desktop assistant.',
    'Given the user input and the tool catalog, output the tool calls the input asks for, with fully specified arguments.',
    'Pick a tool only when the input clearly matches it; when nothing fits, return an empty calls list — never guess or invent tools, names, or argument values not grounded in the input.',
    'confidence is your calibrated probability (0-1) that the calls are exactly right.',
  ].join(' ');
  return [
    new SystemMessage(`${system}\n\nTool catalog:\n${renderToolCatalog(request.tools)}`),
    new HumanMessage(request.input),
  ];
}

export function toOutcome(parsed: LlmDecisionOutput): DecisionOutcome {
  const calls: DecisionCall[] = parsed.calls.map((call) => ({ tool: call.tool, args: call.args }));
  return {
    engine: 'llm',
    calls,
    confidence: sanitizeConfidence(parsed.confidence),
    ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
  };
}

export interface LlmDecisionEngineParams {
  provider: LLMProvider;
  modelId: string;
  apiKey: string;
  createModel?: StructuredModelFactory;
}

export class LlmDecisionEngine implements DecisionEngine {
  readonly kind = 'llm' as const;

  constructor(private readonly params: LlmDecisionEngineParams) {}

  async decide(request: DecisionRequest): Promise<DecisionOutcome> {
    const createModel = this.params.createModel ?? createStructuredChatModel;
    const model = createModel(this.params.provider, this.params.modelId, this.params.apiKey, llmDecisionSchema, {
      temperature: 0,
    });
    const raw = await model.invoke(buildDecisionMessages(request));
    return toOutcome(llmDecisionSchema.parse(raw));
  }
}
