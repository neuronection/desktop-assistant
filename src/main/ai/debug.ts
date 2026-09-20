import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

export function aiDebugEnabled(): boolean {
  return process.env.DA_AI_DEBUG === '1';
}

/**
 * Wire-level AI tracing, opt-in via `DA_AI_DEBUG=1`: logs every agent
 * model call — the bound tool names sent to the provider and whether the
 * response carried tool_calls — separating "the model never asked for
 * tools" from "tool calls were lost in the stack". Emits nothing when
 * the flag is off.
 */
export function aiDebugCallbacks(): BaseCallbackHandler[] {
  if (!aiDebugEnabled()) {
    return [];
  }
  class Handler extends BaseCallbackHandler {
    name = 'da_ai_debug';

    handleLLMStart(_llm: unknown, _prompts: unknown, _runId: string, _parentRunId?: unknown, extraParams?: Record<string, unknown>): void {
      const params = (extraParams?.invocation_params ?? {}) as Record<string, unknown>;
      const tools = params.tools as Array<Record<string, unknown>> | undefined;
      const names = Array.isArray(tools)
        ? tools
            .map((tool) => ((tool?.function as { name?: string } | undefined)?.name ?? (tool?.name as string | undefined)) ?? '')
            .filter(Boolean)
            .join(',')
        : 'NONE';
      console.log(`[ai-debug] llm start: model=${String(params.model ?? params.model_name ?? 'unknown')} tools=${names}`);
    }

    handleLLMEnd(output: unknown): void {
      const generation = (output as { generations?: Array<Array<{ message?: unknown }>> }).generations?.[0]?.[0];
      const message = (generation?.message ?? {}) as {
        content?: unknown;
        tool_calls?: Array<{ name?: string; function?: { name?: string } }>;
        additional_kwargs?: { tool_calls?: Array<{ name?: string; function?: { name?: string } }> };
      };
      const calls = message.tool_calls ?? message.additional_kwargs?.tool_calls ?? [];
      const names = Array.isArray(calls)
        ? calls.map((call) => call?.name ?? call?.function?.name).filter(Boolean).join(',')
        : '';
      const text = typeof message.content === 'string' ? message.content.slice(0, 120) : Array.isArray(message.content) ? '[multimodal]' : '';
      console.log(`[ai-debug] llm end: tool_calls=${names || 'none'} text="${text}"`);
    }
  }
  return [new Handler()];
}
