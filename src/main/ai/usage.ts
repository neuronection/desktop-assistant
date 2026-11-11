import type { TokenUsage } from '@shared/usage';

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

interface UsageCarrier {
  usage_metadata?: Record<string, unknown>;
  response_metadata?: { tokenUsage?: Record<string, unknown>; usage?: Record<string, unknown> };
  llmOutput?: { tokenUsage?: Record<string, unknown>; usage?: Record<string, unknown> };
  generations?: Array<Array<{ message?: unknown }>>;
}

function fromRecord(usage: Record<string, unknown> | undefined): TokenUsage | null {
  if (!usage) {
    return null;
  }
  const input = count(usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens ?? usage.inputTokens);
  const output = count(usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens ?? usage.outputTokens);
  if (input === undefined && output === undefined) {
    return null;
  }
  return { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

/** Provider usage from a chat response, a stream chunk, or a LangChain callback output. */
export function extractUsage(value: unknown): TokenUsage | null {
  const carrier = value as UsageCarrier | null;
  if (!carrier || typeof carrier !== 'object') {
    return null;
  }
  const direct = fromRecord(carrier.usage_metadata) ?? fromRecord(carrier.response_metadata?.tokenUsage) ?? fromRecord(carrier.response_metadata?.usage);
  if (direct) {
    return direct;
  }
  const generation = carrier.generations?.[0]?.[0]?.message;
  if (generation && generation !== value) {
    const nested = extractUsage(generation);
    if (nested) {
      return nested;
    }
  }
  return fromRecord(carrier.llmOutput?.tokenUsage) ?? fromRecord(carrier.llmOutput?.usage);
}
