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
  return {
    ...(input !== undefined ? { inputTokens: input } : {}),
    ...(output !== undefined ? { outputTokens: output } : {}),
  };
}

/**
 * Combines stream usage. `sum` is right for delta chunks (Google, OpenAI final);
 * `max` is right for a provider that repeats a cumulative total and sends a
 * non-zero initial output count (Anthropic message_start + message_delta).
 */
export function mergeUsage(
  total: TokenUsage | null,
  part: TokenUsage | null,
  strategy: 'sum' | 'max' = 'sum'
): TokenUsage | null {
  if (!part) {
    return total;
  }
  const combine = (left: number | undefined, right: number | undefined): number | undefined => {
    if (left === undefined) {
      return right;
    }
    if (right === undefined) {
      return left;
    }
    return strategy === 'max' ? Math.max(left, right) : left + right;
  };
  const inputTokens = combine(total?.inputTokens, part.inputTokens);
  const outputTokens = combine(total?.outputTokens, part.outputTokens);
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
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
