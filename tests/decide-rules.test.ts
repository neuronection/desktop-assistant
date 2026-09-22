import { describe, it, expect } from 'vitest';
import {
  DECISION_RULES_MAX,
  mergeDecisionSettings,
  sanitizeDecisionRules,
  type DecisionRule,
} from '@shared/ai/decisions';
import { ruleForCall, ruleFireFor } from '@main/ai/decide/points/tool-dispatch';

describe('sanitizeDecisionRules (plan 24 S7)', () => {
  it('keeps valid rules and drops unsafe/incomplete ones', () => {
    const rules = sanitizeDecisionRules([
      { id: 'a', matchTool: 'HassTurnOff', action: 'notify', text: 'Lights out' },
      { id: 'b', matchTool: 'ask_gemini', action: 'route', modelId: 'gemini-pro' },
      { id: 'c', matchTool: 'ask_gemini', action: 'route' },
      { id: 'd', matchTool: 'x', action: 'shell' },
      { id: 'e', matchTool: '', action: 'notify', text: 'hi' },
      { id: 'f', matchTool: 'x', action: 'notify' },
      { id: 'g', matchTool: 'x', action: 'dispatch' },
    ]);
    expect(rules.map((rule) => rule.id)).toEqual(['a', 'b', 'g']);
    expect(rules[0]).toMatchObject({ id: 'a', enabled: true, action: 'notify', text: 'Lights out' });
    expect(rules[1]).toMatchObject({ action: 'route', modelId: 'gemini-pro' });
  });

  it('caps the rule list and dedupes ids', () => {
    const many = Array.from({ length: DECISION_RULES_MAX + 5 }, (_, i) => ({
      id: i === 0 ? 'x' : `r${i}`,
      matchTool: 'tool',
      action: 'dispatch',
    }));
    many.push({ id: 'x', matchTool: 'tool', action: 'dispatch' });
    expect(sanitizeDecisionRules(many)).toHaveLength(DECISION_RULES_MAX);
  });

  it('defaults enabled to true unless explicitly false', () => {
    const rules = sanitizeDecisionRules([{ id: 'a', matchTool: 't', action: 'dispatch', enabled: false }]);
    expect(rules[0]?.enabled).toBe(false);
  });

  it('round-trips through mergeDecisionSettings', () => {
    const settings = mergeDecisionSettings({
      rules: [{ id: 'a', matchTool: 'HassTurnOff', action: 'notify', text: 'Lights out' }],
    });
    expect(settings.rules).toEqual([
      { id: 'a', enabled: true, matchTool: 'HassTurnOff', action: 'notify', text: 'Lights out' },
    ]);
    expect(mergeDecisionSettings(undefined).rules).toEqual([]);
  });
});

describe('ruleForCall / ruleFireFor (plan 24 S7)', () => {
  const rules: DecisionRule[] = [
    { id: 'off', enabled: false, matchTool: 'HassTurnOff', action: 'notify', text: 'no' },
    { id: 'on', enabled: true, matchTool: 'HassTurnOff', action: 'notify', text: 'yes' },
  ];

  it('matches the first enabled rule for the picked tool', () => {
    expect(ruleForCall(rules, 'HassTurnOff')?.id).toBe('on');
    expect(ruleForCall(rules, 'HassTurnOn')).toBeUndefined();
    expect(ruleForCall(undefined, 'x')).toBeUndefined();
  });

  it('builds a fire with the picked provenance', () => {
    const provenance = { engine: 'jev' as const, confidence: 0.9, band: 'act' as const };
    expect(ruleFireFor(rules, 'HassTurnOff', provenance)).toMatchObject({
      rule: { id: 'on' },
      call: { tool: 'HassTurnOff' },
      provenance,
    });
    expect(ruleFireFor(rules, 'other', provenance)).toBeUndefined();
  });
});
