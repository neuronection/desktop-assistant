import { evaluateExpression, formatCalcResult } from './evaluate';
import { convertUnits } from './units';

export type CalculatorResult =
  | { ok: true; value: number; display: string }
  | { ok: false; error: string };

export function evaluateCalculator(input: string): CalculatorResult {
  const conversion = convertUnits(input);
  if (conversion.kind === 'error') {
    return { ok: false, error: conversion.error };
  }
  if (conversion.kind === 'converted') {
    return {
      ok: true,
      value: conversion.value,
      display: `${formatCalcResult(conversion.value)} ${conversion.symbol}`,
    };
  }
  const arithmetic = evaluateExpression(input);
  if (!arithmetic.ok) {
    return { ok: false, error: arithmetic.error };
  }
  return {
    ok: true,
    value: arithmetic.value,
    display: formatCalcResult(arithmetic.value),
  };
}
