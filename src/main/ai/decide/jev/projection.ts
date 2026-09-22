import type {
  DecisionAnswer,
  DecisionOutcome,
  DecisionQuestion,
  DecisionToolSchema,
} from '@shared/ai/decisions';
import { sanitizeConfidence } from '@shared/ai/decisions';
import { isCatalogArgName } from '../tool-surface';
import type { TypeSafeQuestion, TypeSafeResult } from './client';

export const TOOL_CHOICE_ID = '__tool__';
export const NONE_OPTION = '__none__';

function propertiesOf(tool: DecisionToolSchema): Record<string, Record<string, unknown>> {
  const parameters = tool.parameters as { properties?: Record<string, Record<string, unknown>> } | undefined;
  return parameters?.properties ?? {};
}

/**
 * Tool dispatch as a TypeSafe question set (plan 24 D4 + S0 spike): a
 * `__tool__` Choice that always carries a `__none__` out, plus a question
 * per closed-set argument. Open arguments (free text / numbers / dates and
 * ungrounded catalogs) get no question — the pre-fill → LLM cascade owns
 * them (S4b).
 */
export function buildToolDispatchQuestions(
  tools: DecisionToolSchema[],
  catalogEntities?: ReadonlyMap<string, readonly string[]>
): Record<string, TypeSafeQuestion> {
  const questions: Record<string, TypeSafeQuestion> = {
    [TOOL_CHOICE_ID]: {
      type: 'choice',
      instructions: 'What is the user asking the assistant to do?',
      criteria: {
        [NONE_OPTION]: 'The user is chatting, or asking something that needs no tool.',
        ...Object.fromEntries(tools.map((tool) => [tool.name, tool.description || null])),
      },
    },
  };
  for (const tool of tools) {
    const entityIds = (tool as { appId?: string }).appId
      ? catalogEntities?.get((tool as { appId?: string }).appId as string)
      : undefined;
    for (const [arg, schema] of Object.entries(propertiesOf(tool))) {
      const id = `${tool.name}.${arg}`;
      const type = String(schema.type ?? '');
      const enumValues = Array.isArray(schema.enum) ? (schema.enum as unknown[]).map(String) : null;
      if (enumValues) {
        questions[id] = {
          type: 'choice',
          instructions: `Which ${arg} does the user want for ${tool.name}?`,
          criteria: Object.fromEntries(enumValues.map((value) => [value, null])),
        };
      } else if (type === 'boolean') {
        questions[id] = { type: 'noul', instructions: `Does the user want ${arg} for ${tool.name}?` };
      } else if (isCatalogArgName(arg) && entityIds && entityIds.length > 0) {
        // Grounded choice over the live catalog (plan 24 S4b): an unknown
        // name cannot be selected, so no guess reaches the tool.
        questions[id] = {
          type: 'choice',
          instructions: `Which known ${arg} is the user referring to for ${tool.name}?`,
          criteria: Object.fromEntries(entityIds.map((entityId) => [entityId, null])),
        };
      }
    }
  }
  return questions;
}

export function toolDispatchOutcome(result: TypeSafeResult, tools: DecisionToolSchema[]): DecisionOutcome {
  const toolAnswer = result.answers[TOOL_CHOICE_ID];
  if (!toolAnswer || toolAnswer.type !== 'choice' || toolAnswer.choice === NONE_OPTION) {
    return {
      engine: 'jev',
      calls: [],
      confidence: toolAnswer?.type === 'choice' ? sanitizeConfidence(toolAnswer.confidence) : 0,
    };
  }
  const tool = tools.find((candidate) => candidate.name === toolAnswer.choice);
  if (!tool) {
    return { engine: 'jev', calls: [], confidence: 0 };
  }
  const args: Record<string, unknown> = {};
  let confidence = toolAnswer.confidence;
  for (const [arg] of Object.entries(propertiesOf(tool))) {
    const answer = result.answers[`${tool.name}.${arg}`];
    if (!answer) {
      continue;
    }
    if (answer.type === 'choice') {
      args[arg] = answer.choice;
      confidence = Math.min(confidence, answer.confidence);
    } else if (answer.type === 'noul') {
      if (answer.noul >= 0.5) {
        args[arg] = true;
      }
      confidence = Math.min(confidence, Math.max(answer.noul, 1 - answer.noul));
    }
  }
  return {
    engine: 'jev',
    calls: [{ tool: tool.name, args }],
    confidence: sanitizeConfidence(confidence),
    ...(result.usage
      ? { usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } }
      : {}),
  };
}

export function buildQuestionSet(questions: DecisionQuestion[]): Record<string, TypeSafeQuestion> {
  const set: Record<string, TypeSafeQuestion> = {};
  for (const question of questions) {
    if (question.type === 'choice') {
      set[question.id] = { type: 'choice', instructions: question.instructions, criteria: question.options };
    } else if (question.type === 'score') {
      set[question.id] = { type: 'score', instructions: question.instructions, criteria: question.levels };
    } else {
      set[question.id] = {
        type: 'noul',
        instructions: question.instructions,
        ...(question.criteria ? { criteria: question.criteria } : {}),
      };
    }
  }
  return set;
}

export function questionOutcome(result: TypeSafeResult, questions: DecisionQuestion[]): DecisionOutcome {
  const answers: Record<string, DecisionAnswer> = {};
  const certainties: number[] = [];
  for (const question of questions) {
    const answer = result.answers[question.id];
    if (!answer) {
      continue;
    }
    if (answer.type === 'choice') {
      answers[question.id] = {
        type: 'choice',
        choice: answer.choice,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
      };
      certainties.push(answer.confidence);
    } else if (answer.type === 'score') {
      answers[question.id] = {
        type: 'score',
        score: answer.score,
        legend: answer.legend,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
      };
      certainties.push(answer.confidence);
    } else {
      answers[question.id] = { type: 'noul', noul: answer.noul };
      certainties.push(Math.max(answer.noul, 1 - answer.noul));
    }
  }
  return {
    engine: 'jev',
    calls: [],
    confidence: sanitizeConfidence(certainties.length ? Math.min(...certainties) : 0),
    answers,
    ...(result.usage
      ? { usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } }
      : {}),
  };
}
