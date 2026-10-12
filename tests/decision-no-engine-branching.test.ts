import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const TURN_MANAGER = path.resolve(__dirname, '../src/main/turns/TurnManager.ts');
const DECIDE_INDEX = path.resolve(__dirname, '../src/main/ai/decide/index.ts');

describe('decision transport branching (plan 24 S2 → plan 26 S1)', () => {
  it('the turn layer never switches on engine kind or transport', () => {
    const source = readFileSync(TURN_MANAGER, 'utf8');
    expect(source).not.toMatch(/engine\s*===\s*'needle'/);
    expect(source).not.toMatch(/engine\s*===\s*'llm'/);
    expect(source).not.toMatch(/engine\s*===\s*'jev'/);
    expect(source).not.toMatch(/decisionTransport/);
    expect(source).not.toMatch(/DECISION_ENGINE_NAME_/);
  });

  it('needle and the llm engine are gone outright (plan 26 D7, no-legacy ruling)', () => {
    const funnel = readFileSync(DECIDE_INDEX, 'utf8');
    expect(funnel).not.toContain('needle');
    expect(funnel).not.toMatch(/'llm'/);
  });
});
