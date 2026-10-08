import type { DecisionAnswer } from '@shared/ai/decisions';
import { globToRegex, matchesGlob } from '@main/ai/tools/native/file-search';
import type { PackClassifyStep, PackCondition, PackComposeStep, PackVerdict } from '@shared/app-pack';

export interface SignalMeta {
  path: string;
  name: string;
  ext: string;
  size: number;
  ageDays: number;
}

export interface SignalContext {
  meta: SignalMeta;
  config: Record<string, unknown>;
  matchedRules: Set<string>;
  answers: Record<string, DecisionAnswer>;
}

/**
 * Signal resolution; undefined means unresolved — every condition over an
 * unresolved signal evaluates FALSE (fail-closed: the default verdict is
 * always `ask`). `rule.<id>` resolves against rules matched so far (lists
 * evaluate in contract order, so forward references read as unmatched —
 * deterministic and cycle-safe).
 */
export function resolveSignal(signal: string, context: SignalContext): unknown {
  if (signal === 'meta.size') {
    return context.meta.size;
  }
  if (signal === 'meta.ageDays') {
    return context.meta.ageDays;
  }
  if (signal === 'meta.ext') {
    return context.meta.ext;
  }
  if (signal === 'meta.name') {
    return context.meta.name;
  }
  if (signal === 'meta.path') {
    return context.meta.path;
  }
  if (signal.startsWith('rule.')) {
    return context.matchedRules.has(signal.slice(5)) ? true : undefined;
  }
  if (signal.startsWith('config.')) {
    return context.config[signal.slice(7)];
  }
  if (signal.startsWith('answer.')) {
    const rest = signal.slice(7);
    const dot = rest.indexOf('.');
    if (dot <= 0) {
      return undefined;
    }
    const answer = context.answers[rest.slice(0, dot)];
    if (!answer) {
      return undefined;
    }
    const part = rest.slice(dot + 1);
    if (part === 'confidence') {
      return answer.type === 'noul' ? undefined : answer.confidence;
    }
    if (answer.type === 'choice') {
      return part === 'choice' ? answer.choice : undefined;
    }
    if (answer.type === 'noul') {
      return part === 'value' ? answer.noul : undefined;
    }
    if (answer.type === 'score') {
      return part === 'value' ? answer.score : undefined;
    }
    return undefined;
  }
  return undefined;
}

function toComparable(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function compare(order: 'lt' | 'lte' | 'gt' | 'gte', left: string | number, right: string | number): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    return order === 'lt' ? left < right : order === 'lte' ? left <= right : order === 'gt' ? left > right : left >= right;
  }
  const a = String(left);
  const b = String(right);
  return order === 'lt' ? a < b : order === 'lte' ? a <= b : order === 'gt' ? a > b : a >= b;
}

export function evaluateCondition(condition: PackCondition, context: SignalContext): boolean {
  if ('all' in condition) {
    return condition.all.every((entry) => evaluateCondition(entry, context));
  }
  if ('any' in condition) {
    return condition.any.some((entry) => evaluateCondition(entry, context));
  }
  if ('not' in condition) {
    return !evaluateCondition(condition.not, context);
  }
  const left = resolveSignal(condition.signal, context);
  if (left === undefined) {
    return false;
  }
  const { op } = condition;
  if (op === 'exists') {
    return true;
  }
  const right = 'value' in condition
    ? condition.value
    : condition.valueSignal !== undefined
      ? resolveSignal(condition.valueSignal, context)
      : undefined;
  if (right === undefined) {
    return false;
  }
  if (op === 'eq') {
    return left === right;
  }
  if (op === 'ne') {
    return left !== right;
  }
  if (op === 'lt' || op === 'lte' || op === 'gt' || op === 'gte') {
    const a = toComparable(left);
    const b = toComparable(right);
    return a !== undefined && b !== undefined ? compare(op, a, b) : false;
  }
  if (op === 'in') {
    return Array.isArray(right) && right.some((entry) => entry === left);
  }
  if (op === 'matches') {
    if (typeof left !== 'string' || typeof right !== 'string') {
      return false;
    }
    const regex = globToRegex(right);
    return matchesGlob(left, regex, right.includes('/'));
  }
  if (op === 'matches-any') {
    if (typeof left !== 'string') {
      return false;
    }
    const globs = Array.isArray(right) ? right.filter((entry): entry is string => typeof entry === 'string') : [];
    return globs.some((glob) => matchesGlob(left, globToRegex(glob), glob.includes('/')));
  }
  return false;
}

export type ClassifyOutcome =
  | { kind: 'final'; verdict: PackVerdict; rule: string; list: 'veto' | 'keep' | 'ask' }
  | { kind: 'residual'; candidateRule: string | null };

/**
 * Contract classify semantics (pinned at S3): lists evaluate in the order
 * veto → keep → ask → candidate; within a list the first matching rule is
 * the evidence rule. veto/keep/ask matches finalize without the model;
 * candidate matches and unmatched items form the residual.
 */
export function classifyItem(step: PackClassifyStep, context: SignalContext): ClassifyOutcome {
  const evaluateList = (list: 'veto' | 'keep' | 'ask' | 'candidate'): string | null => {
    for (const rule of step[list] ?? []) {
      if (evaluateCondition(rule.when, context)) {
        context.matchedRules.add(rule.id);
        return rule.id;
      }
    }
    return null;
  };
  const veto = evaluateList('veto');
  if (veto !== null) {
    return { kind: 'final', verdict: 'keep', rule: veto, list: 'veto' };
  }
  const keep = evaluateList('keep');
  if (keep !== null) {
    return { kind: 'final', verdict: 'keep', rule: keep, list: 'keep' };
  }
  const ask = evaluateList('ask');
  if (ask !== null) {
    return { kind: 'final', verdict: 'ask', rule: ask, list: 'ask' };
  }
  const candidate = evaluateList('candidate');
  return { kind: 'residual', candidateRule: candidate };
}

/** Contract compose semantics: keepWhen → candidateWhen → askWhen → default ask (fail-closed). */
export function composeVerdict(step: PackComposeStep, context: SignalContext): PackVerdict {
  if (step.keepWhen && evaluateCondition(step.keepWhen, context)) {
    return 'keep';
  }
  if (step.candidateWhen && evaluateCondition(step.candidateWhen, context)) {
    return 'candidate';
  }
  if (step.askWhen && evaluateCondition(step.askWhen, context)) {
    return 'ask';
  }
  return 'ask';
}
