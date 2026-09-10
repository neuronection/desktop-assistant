import { describe, expect, it } from 'vitest';
import { evaluateExpression, formatCalcResult } from '@shared/commands/calculator';

describe('evaluateExpression', () => {
  const value = (input: string): number => {
    const result = evaluateExpression(input);
    if (!result.ok) {
      throw new Error(`${input} unexpectedly failed: ${result.error}`);
    }
    return result.value;
  };

  it('evaluates the four basic operators', () => {
    expect(value('1 + 2')).toBe(3);
    expect(value('10 - 4')).toBe(6);
    expect(value('6 * 7')).toBe(42);
    expect(value('7 / 2')).toBe(3.5);
  });

  it('evaluates modulo and exponentiation', () => {
    expect(value('10 % 3')).toBe(1);
    expect(value('2 ^ 10')).toBe(1024);
  });

  it('respects operator precedence', () => {
    expect(value('2 + 3 * 4')).toBe(14);
    expect(value('(2 + 3) * 4')).toBe(20);
    expect(value('2 ^ 3 ^ 2')).toBe(512);
  });

  it('supports unary minus and plus', () => {
    expect(value('-5 + 3')).toBe(-2);
    expect(value('2 * -3')).toBe(-6);
    expect(value('-(2 + 3)')).toBe(-5);
    expect(value('+5')).toBe(5);
    expect(value('-2 ^ 2')).toBe(-4);
  });

  it('handles decimals and scientific notation', () => {
    expect(value('0.5 + .25')).toBeCloseTo(0.75);
    expect(value('1e2 + 1')).toBe(101);
  });

  it('rejects division and modulo by zero', () => {
    expect(evaluateExpression('1 / 0')).toEqual({ ok: false, error: 'division by zero' });
    expect(evaluateExpression('1 % 0')).toEqual({ ok: false, error: 'modulo by zero' });
  });

  it('rejects malformed input', () => {
    expect(evaluateExpression('').ok).toBe(false);
    expect(evaluateExpression('abc').ok).toBe(false);
    expect(evaluateExpression('2 +').ok).toBe(false);
    expect(evaluateExpression('(1 + 2').ok).toBe(false);
    expect(evaluateExpression('1 + 2)').ok).toBe(false);
    expect(evaluateExpression('sqrt(4)').ok).toBe(false);
  });

  it('caps runaway magnitudes', () => {
    expect(evaluateExpression('9 ^ 99999').ok).toBe(false);
    expect(evaluateExpression(`${'9+'.repeat(200)}1`).ok).toBe(false);
    expect(evaluateExpression(`${'x'.repeat(300)}`).ok).toBe(false);
  });

  it('never produces NaN or Infinity', () => {
    const result = evaluateExpression('1e308 * 1e308');
    expect(result.ok).toBe(false);
  });
});

describe('formatCalcResult', () => {
  it('prints integers plainly', () => {
    expect(formatCalcResult(42)).toBe('42');
    expect(formatCalcResult(-7)).toBe('-7');
  });

  it('trims float noise', () => {
    expect(formatCalcResult(0.1 + 0.2)).toBe('0.3');
    expect(formatCalcResult(1 / 3)).toBe('0.333333333333');
  });
});
