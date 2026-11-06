import { describe, expect, it } from 'vitest';
import type { MiniAppRunItemRow } from '@main/apps/run/store';
import { replayRuleImpact } from '@main/apps/run/impact';

function item(overrides: Partial<MiniAppRunItemRow> = {}): MiniAppRunItemRow {
  return {
    runId: 'run-1',
    packId: 'pack',
    packVersion: '1.0.0',
    configHash: 'hash',
    engineId: 'llm',
    fingerprint: 'fp',
    relPath: 'a.txt',
    verdict: 'ask',
    confidence: null,
    decidedBy: 'engine:stub',
    evidence: { meta: { size: 10, ageDays: 400, ext: 'txt' } },
    updatedAt: 1,
    ...overrides,
  };
}

const EMPTY = { keep: [], review: [], junk: [] };

describe('plan 51 S2.6 — rule-impact replay', () => {
  it('counts verdict flips per list with samples in draft order', () => {
    const items = [
      item({ relPath: 'logs/a.log', verdict: 'ask' }),
      item({ relPath: 'logs/b.log', verdict: 'candidate' }),
      item({ relPath: 'src/keep-me.txt', verdict: 'candidate' }),
      item({ relPath: 'src/ask-me.txt', verdict: 'keep' }),
    ];
    const result = replayRuleImpact('run-1', items, {
      keep: ['src/keep-me.txt', 'logs/c.log'],
      review: ['logs/*.log'],
      junk: ['src/ask-me.txt'],
    });
    expect(result.runId).toBe('run-1');
    expect(result.totalItems).toBe(4);
    expect(result.lists).toEqual([
      { configKey: 'keepRules', ruleId: 'user-keep', direction: 'to-keep', count: 1, samples: ['src/keep-me.txt'] },
      { configKey: 'reviewRules', ruleId: 'user-review', direction: 'to-ask', count: 1, samples: ['logs/b.log'] },
      { configKey: 'junkRules', ruleId: 'user-junk', direction: 'to-candidate-queue', count: 1, samples: ['src/ask-me.txt'] },
    ]);
    expect(result.unverifiable).toBe(0);
  });

  it(':days entries replay with stored ages and count meta-less matches as unverifiable', () => {
    const items = [
      item({ relPath: 'old.log', verdict: 'keep', evidence: { meta: { size: 1, ageDays: 400, ext: 'log' } } }),
      item({ relPath: 'young.log', verdict: 'keep', evidence: { meta: { size: 1, ageDays: 2, ext: 'log' } } }),
      item({ relPath: 'ancient.log', verdict: 'keep', evidence: { rule: 'cache' } }),
      item({ relPath: 'other.txt', verdict: 'keep', evidence: null }),
    ];
    const result = replayRuleImpact('run-1', items, { ...EMPTY, junk: ['*.log:30'] });
    const junk = result.lists[2];
    expect(junk.count).toBe(1);
    expect(junk.samples).toEqual(['old.log']);
    expect(result.unverifiable).toBe(1);
  });

  it('caps samples at 10 while counting every flip', () => {
    const items = Array.from({ length: 14 }, (_, index) => item({ relPath: `f/${index}.txt`, verdict: 'candidate' }));
    const result = replayRuleImpact('run-1', items, { ...EMPTY, keep: ['f/*.txt'] });
    expect(result.lists[0].count).toBe(14);
    expect(result.lists[0].samples).toHaveLength(10);
  });

  it('overridden and host-sensitive items never flip', () => {
    const items = [
      item({ relPath: 'user.txt', verdict: 'ask', decidedBy: 'override:override' }),
      item({ relPath: 'secret.key', verdict: 'keep', decidedBy: 'rule:host-sensitive' }),
    ];
    const result = replayRuleImpact('run-1', items, { keep: ['user.txt', 'secret.key'], review: ['user.txt'], junk: [] });
    expect(result.lists.map((list) => list.count)).toEqual([0, 0, 0]);
  });

  it('returns a null runId result for an empty item set', () => {
    const result = replayRuleImpact(null, [], { ...EMPTY, keep: ['*.txt'] });
    expect(result).toEqual({
      runId: null,
      totalItems: 0,
      lists: [
        { configKey: 'keepRules', ruleId: 'user-keep', direction: 'to-keep', count: 0, samples: [] },
        { configKey: 'reviewRules', ruleId: 'user-review', direction: 'to-ask', count: 0, samples: [] },
        { configKey: 'junkRules', ruleId: 'user-junk', direction: 'to-candidate-queue', count: 0, samples: [] },
      ],
      unverifiable: 0,
    });
  });
});
