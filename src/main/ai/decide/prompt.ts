import type { DecisionScope, DecisionSettings } from '@shared/ai/decisions';
import { DECISION_PROMPT_MAX_CHARS } from '@shared/ai/decisions';

/**
 * The base engine steer (D11). Both engines receive the assembled
 * string through `DecisionRequest.systemPrompt` — the LLM engine makes
 * it the system message, needle passes it to `needle_init`.
 */
export const DECISION_PROMPT_DEFAULT = 'You are a tool-dispatch engine for a desktop assistant.';

export type DecisionPromptSettings = Pick<DecisionSettings, 'prompt' | 'routeTools' | 'scope'>;

/**
 * One-place prompt assembly (plan 20 S7 D11): default engine prompt +
 * user steer (`decision.prompt`) + per-route-tool few-shot lines from
 * `examples` + one scope line. Fail-soft: any assembly error falls back
 * to the default prompt — a broken steer must never break dispatch.
 */
export function assembleDecisionPrompt(settings: DecisionPromptSettings): string {
  try {
    const parts: string[] = [DECISION_PROMPT_DEFAULT];
    const user = (settings.prompt ?? '').trim().slice(0, DECISION_PROMPT_MAX_CHARS);
    if (user) {
      parts.push(user);
    }
    for (const route of settings.routeTools ?? []) {
      for (const example of route.examples ?? []) {
        parts.push(`Example — user says "${example}" → call ${route.name}.`);
      }
    }
    const scope = buildScopeLine(settings.scope ?? { apps: [], includeNatives: true });
    if (scope) {
      parts.push(scope);
    }
    return parts.join(' ');
  } catch {
    return DECISION_PROMPT_DEFAULT;
  }
}

function buildScopeLine(scope: DecisionScope): string | null {
  const parts: string[] = [];
  if (scope.apps.length > 0) {
    parts.push(`integration tools in scope: ${scope.apps.join(', ')}`);
  }
  if (!scope.includeNatives) {
    parts.push('built-in tools are out of scope');
  }
  if (parts.length === 0) {
    return null;
  }
  return `Decision scope — ${parts.join('; ')}.`;
}
