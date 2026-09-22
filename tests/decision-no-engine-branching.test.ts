import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const TURN_MANAGER = path.resolve(__dirname, '../src/main/turns/TurnManager.ts');

describe('decision engine branching (plan 24 S2)', () => {
  it('the turn layer never switches on engine kind', () => {
    const source = readFileSync(TURN_MANAGER, 'utf8');
    expect(source).not.toMatch(/engine\s*===\s*'needle'/);
    expect(source).not.toMatch(/engine\s*===\s*'llm'/);
    expect(source).not.toMatch(/DECISION_ENGINE_NAME_/);
  });
});
