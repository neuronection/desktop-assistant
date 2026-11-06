import type { DecisionAnswer } from '@shared/ai/decisions';
import type { PackClassifyStep, PackCondition, PackComposeStep, PackRuleListId, PackVerdict } from './types';

/**
 * The ONE decision policy core (plan 51 S2.1): glob matching and the
 * classify/compose semantics the runner executes — pure functions, no
 * Electron, no Node APIs. Main's runner and the renderer's rules editor
 * (simulator, impact preview, drawer trace) import the same evaluator,
 * so the code that decides and the UI that explains can never drift.
 */

/** Translates a glob (`*`, `**`, `?`) into a case-insensitive full-match regex. */
export function globToRegex(glob: string): RegExp {
  let pattern = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          pattern += '(?:.*/)?';
          i += 2;
        } else {
          pattern += '.*';
          i += 1;
        }
      } else {
        pattern += '[^/]*';
      }
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${pattern}$`, 'i');
}

export function matchesGlob(relativePath: string, regex: RegExp, globHasSlash: boolean): boolean {
  if (regex.test(relativePath)) {
    return true;
  }
  return !globHasSlash && regex.test(basenameOf(relativePath));
}

function basenameOf(relativePath: string): string {
  const index = relativePath.lastIndexOf('/');
  return index >= 0 ? relativePath.slice(index + 1) : relativePath;
}

export interface ParsedRuleEntry {
  glob: string;
  minAgeDays: number | null;
}

/**
 * Rule-list entry grammar: `glob` or `glob:days` — the `:days` suffix
 * qualifies a rule with a minimum age (`*.log:30` fires only when the
 * item is at least 30 days old). Plain globs parse unchanged.
 */
export function parseRuleEntry(entry: string): ParsedRuleEntry {
  const match = /^(.+):(\d{1,5})$/.exec(entry);
  if (!match) {
    return { glob: entry, minAgeDays: null };
  }
  return { glob: match[1], minAgeDays: Number(match[2]) };
}

export function matchesRuleEntry(relativePath: string, entry: string, ageDays: number): boolean {
  const parsed = parseRuleEntry(entry);
  if (parsed.minAgeDays !== null && ageDays < parsed.minAgeDays) {
    return false;
  }
  return matchesGlob(relativePath, globToRegex(parsed.glob), parsed.glob.includes('/'));
}

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
    return globs.some((glob) => matchesRuleEntry(left, glob, context.meta.ageDays));
  }
  return false;
}

export type ClassifyOutcome =
  | { kind: 'final'; verdict: PackVerdict; rule: string; list: 'veto' | 'keep' | 'ask' }
  | { kind: 'residual'; candidateRule: string | null };

/** Why one classify rule did or did not fire (the editor's trace rendering). */
export interface PolicyTraceStep {
  ruleId: string;
  list: PackRuleListId;
  matched: boolean;
  /** `match` | `no-match` | `age-gate` — `age-gate` = the glob matched but the `:days` minimum age did not. */
  reason: 'match' | 'no-match' | 'age-gate';
}

export interface PolicyTrace {
  outcome: ClassifyOutcome;
  steps: PolicyTraceStep[];
}

/**
 * Contract classify semantics (pinned at S3): lists evaluate in the order
 * veto → keep → ask → candidate; within a list the first matching rule is
 * the evidence rule. veto/keep/ask matches finalize without the model;
 * candidate matches and unmatched items form the residual. The trace
 * variant records every rule's outcome in evaluation order.
 */
function evaluateClassify(step: PackClassifyStep, context: SignalContext, steps: PolicyTraceStep[] | null): ClassifyOutcome {
  const evaluateList = (list: 'veto' | 'keep' | 'ask' | 'candidate'): string | null => {
    for (const rule of step[list] ?? []) {
      const matched = evaluateCondition(rule.when, context);
      if (steps) {
        steps.push({ ruleId: rule.id, list, matched, reason: matched ? 'match' : traceReason(rule.when, context) });
      }
      if (matched) {
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

export function classifyItem(step: PackClassifyStep, context: SignalContext): ClassifyOutcome {
  return evaluateClassify(step, context, null);
}

export function classifyItemWithTrace(step: PackClassifyStep, context: SignalContext): PolicyTrace {
  const steps: PolicyTraceStep[] = [];
  return { outcome: evaluateClassify(step, context, steps), steps };
}

function traceReason(condition: PackCondition, context: SignalContext): PolicyTraceStep['reason'] {
  if ('all' in condition || 'any' in condition || 'not' in condition) {
    return 'no-match';
  }
  if (condition.op !== 'matches-any') {
    return 'no-match';
  }
  const left = resolveSignal(condition.signal, context);
  if (typeof left !== 'string') {
    return 'no-match';
  }
  const right = condition.valueSignal !== undefined ? resolveSignal(condition.valueSignal, context) : condition.value;
  const globs = Array.isArray(right) ? right.filter((entry): entry is string => typeof entry === 'string') : [];
  let globMatched = false;
  let ageBlocked = false;
  for (const glob of globs) {
    const parsed = parseRuleEntry(glob);
    if (matchesGlob(left, globToRegex(parsed.glob), parsed.glob.includes('/'))) {
      globMatched = true;
      if (parsed.minAgeDays !== null && context.meta.ageDays < parsed.minAgeDays) {
        ageBlocked = true;
      }
    }
  }
  return globMatched && ageBlocked ? 'age-gate' : 'no-match';
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
