const MAX_INPUT_LENGTH = 200;
const MAX_TOKENS = 120;
const MAX_EXPONENT_ABS = 1000;

export type CalcResult = { ok: true; value: number } | { ok: false; error: string };
type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; error: string };
type RpnResult = { ok: true; rpn: Token[] } | { ok: false; error: string };

type Token = { type: 'number'; value: number } | { type: 'op'; value: string };

interface OpSpec {
  precedence: number;
  rightAssociative: boolean;
  unary: boolean;
}

const OPS: Record<string, OpSpec> = {
  '+': { precedence: 1, rightAssociative: false, unary: false },
  '-': { precedence: 1, rightAssociative: false, unary: false },
  '*': { precedence: 2, rightAssociative: false, unary: false },
  '/': { precedence: 2, rightAssociative: false, unary: false },
  '%': { precedence: 2, rightAssociative: false, unary: false },
  'u-': { precedence: 3, rightAssociative: true, unary: true },
  'u+': { precedence: 3, rightAssociative: true, unary: true },
  '^': { precedence: 4, rightAssociative: true, unary: false },
};

function tokenize(input: string): TokenizeResult {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = /^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\.?/.exec(input.slice(i));
      if (!match) {
        return { ok: false, error: `unexpected character '${char}'` };
      }
      const value = Number(match[0]);
      if (!Number.isFinite(value)) {
        return { ok: false, error: `invalid number '${match[0]}'` };
      }
      tokens.push({ type: 'number', value });
      i += match[0].length;
      continue;
    }
    if ('+-*/%^()'.includes(char)) {
      const previous = tokens[tokens.length - 1];
      const unaryPosition =
        char === '-' || char === '+' ? !previous || (previous.type === 'op' && previous.value !== ')') : false;
      tokens.push({ type: 'op', value: unaryPosition ? `u${char}` : char });
      i += 1;
      continue;
    }
    return { ok: false, error: `unexpected character '${char}'` };
  }
  if (tokens.length === 0) {
    return { ok: false, error: 'empty expression' };
  }
  if (tokens.length > MAX_TOKENS) {
    return { ok: false, error: 'expression too long' };
  }
  return { ok: true, tokens };
}

function toRpn(tokens: Token[]): RpnResult {
  const output: Token[] = [];
  const stack: string[] = [];
  for (const token of tokens) {
    if (token.type === 'number') {
      output.push(token);
      continue;
    }
    const value = token.value;
    if (value === '(') {
      stack.push(value);
      continue;
    }
    if (value === ')') {
      let found = false;
      while (stack.length > 0) {
        const top = stack.pop() as string;
        if (top === '(') {
          found = true;
          break;
        }
        output.push({ type: 'op', value: top });
      }
      if (!found) {
        return { ok: false, error: 'unbalanced parentheses' };
      }
      continue;
    }
    const spec = OPS[value];
    if (!spec) {
      return { ok: false, error: `unknown operator '${value}'` };
    }
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top === '(') {
        break;
      }
      const topSpec = OPS[top];
      if (
        topSpec &&
        (topSpec.precedence > spec.precedence ||
          (topSpec.precedence === spec.precedence && !spec.rightAssociative))
      ) {
        output.push({ type: 'op', value: stack.pop() as string });
        continue;
      }
      break;
    }
    stack.push(value);
  }
  while (stack.length > 0) {
    const top = stack.pop() as string;
    if (top === '(') {
      return { ok: false, error: 'unbalanced parentheses' };
    }
    output.push({ type: 'op', value: top });
  }
  return { ok: true, rpn: output };
}

function apply(op: string, stack: number[]): CalcResult {
  if (op === 'u-' || op === 'u+') {
    const operand = stack.pop();
    if (operand === undefined) {
      return { ok: false, error: 'missing operand' };
    }
    stack.push(op === 'u-' ? -operand : operand);
    return { ok: true, value: stack[stack.length - 1] as number };
  }
  const b = stack.pop();
  const a = stack.pop();
  if (b === undefined || a === undefined) {
    return { ok: false, error: 'missing operand' };
  }
  let value: number;
  switch (op) {
    case '+':
      value = a + b;
      break;
    case '-':
      value = a - b;
      break;
    case '*':
      value = a * b;
      break;
    case '/':
      if (b === 0) {
        return { ok: false, error: 'division by zero' };
      }
      value = a / b;
      break;
    case '%':
      if (b === 0) {
        return { ok: false, error: 'modulo by zero' };
      }
      value = a % b;
      break;
    case '^':
      if (Math.abs(b) > MAX_EXPONENT_ABS) {
        return { ok: false, error: 'exponent too large' };
      }
      value = Math.pow(a, b);
      break;
    default:
      return { ok: false, error: `unknown operator '${op}'` };
  }
  if (!Number.isFinite(value)) {
    return { ok: false, error: 'number out of range' };
  }
  stack.push(value);
  return { ok: true, value };
}

export function evaluateExpression(input: string): CalcResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'empty expression' };
  }
  if (trimmed.length > MAX_INPUT_LENGTH) {
    return { ok: false, error: 'expression too long' };
  }
  const tokenized = tokenize(trimmed);
  if (!tokenized.ok) {
    return { ok: false, error: tokenized.error };
  }
  const converted = toRpn(tokenized.tokens);
  if (!converted.ok) {
    return { ok: false, error: converted.error };
  }
  const stack: number[] = [];
  for (const token of converted.rpn) {
    if (token.type === 'number') {
      stack.push(token.value);
      continue;
    }
    const applied = apply(token.value, stack);
    if (!applied.ok) {
      return { ok: false, error: applied.error };
    }
  }
  if (stack.length !== 1) {
    return { ok: false, error: 'incomplete expression' };
  }
  const value = stack[0] as number;
  if (!Number.isFinite(value)) {
    return { ok: false, error: 'number out of range' };
  }
  return { ok: true, value };
}

export function formatCalcResult(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) {
    return String(value);
  }
  return parseFloat(value.toPrecision(12)).toString();
}
