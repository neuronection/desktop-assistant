import { z } from 'zod';
import type { DecisionCall, DecisionOutcome, DecisionToolSchema } from '@shared/ai/decisions';
import { sanitizeConfidence } from '@shared/ai/decisions';

const needleOutputSchema = z.object({
  function_calls: z
    .array(
      z.object({
        name: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .default([]),
  suppressed_calls: z
    .array(
      z.object({
        name: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .default([]),
  confidence: z.number().default(0),
  reasoning: z.string().optional(),
});

export function toolsToNeedleJson(tools: DecisionToolSchema[]): string {
  return JSON.stringify(
    tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      ...(tool.parameters ? { parameters: tool.parameters } : {}),
    }))
  );
}

/**
 * Parses raw needle JSON into a DecisionOutcome. Unknown tool names are
 * a hard error (D5: output is untrusted — a hallucinated name must not
 * silently drop or execute), everything else maps 1:1.
 */
export function parseNeedleOutput(raw: string, tools: DecisionToolSchema[]): DecisionOutcome {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('Needle returned non-JSON output');
  }
  const parsed = needleOutputSchema.parse(json);
  const known = new Set(tools.map((tool) => tool.name));
  const calls: DecisionCall[] = parsed.function_calls.map((call) => ({ tool: call.name, args: call.arguments }));
  for (const call of calls) {
    if (!known.has(call.tool)) {
      throw new Error(`Needle picked unknown tool ${call.tool}`);
    }
  }
  return {
    engine: 'needle',
    calls,
    confidence: sanitizeConfidence(parsed.confidence),
    ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
  };
}
