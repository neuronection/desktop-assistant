import type { AppConfig } from '@shared/config/AppConfig';
import type { DecisionProvenance, DecisionToolSchema } from '@shared/ai/decisions';
import { DECISION_MAX_INPUT_CHARS } from '@shared/ai/decisions';
import type { DirectToolRequest } from '@shared/turns';
import type { DecisionPointDescriptor } from '@shared/ai/decision-points';
import { selectDecisionCandidates } from '../tool-surface';
import type { DecisionStatus } from '../index';

export interface ToolDispatchDecision {
  tools(): DecisionToolSchema[] | Promise<DecisionToolSchema[]>;
  run(input: string, tools: DecisionToolSchema[]): Promise<DecisionStatus>;
}

export interface ToolDispatchInput {
  config: AppConfig;
  decision: ToolDispatchDecision;
  content: string;
  hasAttachments: boolean;
  hasFlow: boolean;
}

export type ToolDispatchVerdict =
  | { type: 'direct'; request: DirectToolRequest; provenance: DecisionProvenance }
  | { type: 'route'; modelId: string; provenance: DecisionProvenance }
  | { type: 'fallThrough'; provenance: DecisionProvenance; reason: string; calls?: number };

export const TOOL_DISPATCH_POINT: DecisionPointDescriptor = {
  id: 'tool-dispatch',
  capability: 'tool-dispatch',
  phase: 'pre-model',
  mode: 'blocking',
  domains: ['dispatch', 'route'],
};

/**
 * The tool-dispatch decision point (plan 20 S3, extracted in plan 24 S3):
 * an eligible input may dispatch directly, hand off to a routed model, or
 * fall through to the standard turn. Returns `null` when the point is not
 * applicable (flow, attachments, length, empty candidate set, engine
 * error) — the caller then runs the normal turn.
 */
export async function runToolDispatchPoint(input: ToolDispatchInput): Promise<ToolDispatchVerdict | null> {
  const { config, decision } = input;
  if (input.hasFlow || input.hasAttachments) {
    return null;
  }
  const content = input.content.trim();
  if (content.length === 0 || content.length > DECISION_MAX_INPUT_CHARS) {
    return null;
  }
  const candidates = selectDecisionCandidates(await decision.tools(), content);
  if (candidates.length === 0) {
    console.log(`[decision] no candidates for "${content.slice(0, 60)}" — skipped`);
    return null;
  }
  let status: DecisionStatus;
  try {
    status = await decision.run(content, candidates);
  } catch (error) {
    console.log(`[decision] engine threw: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
    return null;
  }
  if (status.status !== 'decided') {
    if (status.status === 'off') {
      return null;
    }
    const engine = 'engine' in status ? status.engine : undefined;
    console.log(
      `[decision] fall-through (${status.status}${engine ? `, engine ${engine}` : ''}: ${status.reason.slice(0, 200)})`
    );
    return {
      type: 'fallThrough',
      provenance: { engine: engine ?? 'needle', confidence: 0, band: 'refuse' },
      reason: status.reason,
    };
  }
  if (status.band === 'refuse' || status.outcome.calls.length !== 1) {
    const reason =
      status.band === 'refuse'
        ? 'low confidence'
        : status.outcome.calls.length === 0
          ? 'no actionable call'
          : 'compound request';
    console.log(`[decision] fall-through (${reason}) — ${status.outcome.calls.length} call(s)`);
    return {
      type: 'fallThrough',
      provenance: {
        engine: status.outcome.engine,
        confidence: status.outcome.confidence,
        band: status.band,
        ...(status.outcome.reasoning ? { reasoning: status.outcome.reasoning } : {}),
      },
      reason,
      ...(status.outcome.calls.length > 1 ? { calls: status.outcome.calls.length } : {}),
    };
  }
  const call = status.outcome.calls[0];
  const provenance: DecisionProvenance = {
    engine: status.outcome.engine,
    confidence: status.outcome.confidence,
    band: status.band,
    ...(status.outcome.reasoning ? { reasoning: status.outcome.reasoning } : {}),
  };
  const routeTool = config.decision.routeTools.find((tool) => tool.name === call.tool);
  if (routeTool) {
    console.log(
      `[decision] routed to ${routeTool.modelId} (band ${status.band}, confidence ${status.outcome.confidence.toFixed(2)}, engine ${status.outcome.engine})`
    );
    return { type: 'route', modelId: routeTool.modelId, provenance };
  }
  console.log(
    `[decision] dispatched ${call.tool} (band ${status.band}, confidence ${status.outcome.confidence.toFixed(2)}, engine ${status.outcome.engine}; candidates: ${candidates.map((candidate) => candidate.name).join(', ')})`
  );
  return {
    type: 'direct',
    request: {
      name: call.tool,
      args: call.args,
      ...(status.band === 'confirm' ? { forceApproval: true } : {}),
    },
    provenance,
  };
}
