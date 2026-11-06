import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '@shared/types';
import {
  digestEnabled,
  draftRulesFromIntent,
  inferRulePatterns,
  learnRulesFromOverrides,
  ruleDraftingEnabled,
  ruleLearningEnabled,
  summarizeRunDigest,
  type PackLlmGateway,
  type PackLlmModel,
} from '@main/apps/run/llm';

const MODEL: PackLlmModel = { provider: { id: 'p', name: 'P', type: 'openai', apiKey: '', apiBase: '', timeout: 1, temperature: 0, maxTokens: 10, systemPrompt: '', availableModels: [], customModels: [] } as LLMProvider, modelId: 'm', apiKey: 'k' };

function gatewayWith(response: string, calls: { messages: { role: string; content: string }[] }[] = []): PackLlmGateway {
  return {
    chat: async (request) => {
      calls.push({ messages: request.messages });
      return response;
    },
  };
}

const TOTALS = { scanned: 10, keep: 4, ask: 3, candidate: 3, ruleDecided: 6, modelDecided: 4, cacheHits: 1, pending: 0 };

describe('plan 51 S6 — LLM conveniences (untrusted output, fail soft)', () => {
  it('the digest prompt pins descriptive-only constraints and the schema fails soft', async () => {
    const calls: { messages: { role: string; content: string }[] }[] = [];
    const gateway = gatewayWith('{"summary": "Candidates cluster in src/generated; the 3 asks are small odd files."}', calls);
    const summary = await summarizeRunDigest(gateway, MODEL, { totals: TOTALS, samples: ['src/generated/a.ts', 'b.log'] });
    expect(summary).toContain('src/generated');
    const system = calls[0]?.messages.find((message) => message.role === 'system')?.content ?? '';
    expect(system).toContain('Never recommend deleting');
    expect(system.toLowerCase()).toContain('never address a specific file');
    const prose = await summarizeRunDigest(gatewayWith('I recommend you delete src/generated/a.ts immediately'), MODEL, { totals: TOTALS, samples: [] });
    expect(prose).toBeNull();
    const malformed = await summarizeRunDigest(gatewayWith('{"summary": 42}'), MODEL, { totals: TOTALS, samples: [] });
    expect(malformed).toBeNull();
  });

  it('drafting returns globs only, bounded, failing soft; the intent is capped', async () => {
    const calls: { messages: { role: string; content: string }[] }[] = [];
    const gateway = gatewayWith('{"globs": ["*.afdesign", "assets/**", ""]}', calls);
    const globs = await draftRulesFromIntent(gateway, MODEL, 'keep everything adobe designer exports');
    expect(globs).toEqual(['*.afdesign', 'assets/**']);
    const long = `${'x'.repeat(600)}keep logs`;
    await draftRulesFromIntent(gatewayWith('{"globs": ["*.log"]}'), MODEL, long);
    expect(calls[1]?.messages.find((message) => message.role === 'user')?.content.length ?? 0).toBeLessThanOrEqual(500);
    expect(await draftRulesFromIntent(gatewayWith('no json here'), MODEL, 'x')).toBeNull();
    expect(await draftRulesFromIntent(gatewayWith('{"globs": ' + JSON.stringify(Array.from({ length: 70 }, (_, i) => `g${i}`)) + '}'), MODEL, 'x')).toBeNull();
  });

  it('deterministic rule inference: suffix and directory majorities, ambiguity → null', () => {
    expect(
      inferRulePatterns([
        { relPath: 'design/a.afdesign', verdict: 'keep' },
        { relPath: 'design/b.afdesign', verdict: 'keep' },
        { relPath: 'c.afdesign', verdict: 'keep' },
        { relPath: 'other.txt', verdict: 'candidate' },
      ])
    ).toEqual(['*.afdesign']);
    expect(
      inferRulePatterns([
        { relPath: 'manuals/a.pdf', verdict: 'keep' },
        { relPath: 'manuals/b.pdf', verdict: 'keep' },
        { relPath: 'manuals/c.md', verdict: 'keep' },
        { relPath: 'unrelated/x.bin', verdict: 'keep' },
      ])
    ).toEqual(['manuals/**']);
    expect(
      inferRulePatterns([
        { relPath: 'a.txt', verdict: 'keep' },
        { relPath: 'b.log', verdict: 'keep' },
        { relPath: 'c.bin', verdict: 'keep' },
      ])
    ).toBeNull();
    expect(inferRulePatterns([{ relPath: 'a.txt', verdict: 'keep' }])).toBeNull();
    expect(
      inferRulePatterns([
        { relPath: 'a.txt', verdict: 'keep' },
        { relPath: 'b.txt', verdict: 'candidate' },
        { relPath: 'c.txt', verdict: 'candidate' },
      ])
    ).toBeNull();
  });

  it('learning goes deterministic first (zero calls), one model call only when ambiguous', async () => {
    const calls: { messages: { role: string; content: string }[] }[] = [];
    const pattern = await learnRulesFromOverrides(
      gatewayWith('{"globs": ["*.x"]}', calls),
      MODEL,
      [
        { relPath: 'a.afdesign', verdict: 'keep' },
        { relPath: 'b.afdesign', verdict: 'keep' },
        { relPath: 'c.afdesign', verdict: 'keep' },
      ]
    );
    expect(pattern).toEqual({ globs: ['*.afdesign'], source: 'pattern' });
    expect(calls).toHaveLength(0);

    const ambiguous = [
      { relPath: 'a.txt', verdict: 'keep' },
      { relPath: 'b.log', verdict: 'keep' },
      { relPath: 'c.bin', verdict: 'keep' },
      { relPath: 'd.iso', verdict: 'candidate' },
    ];
    const learned = await learnRulesFromOverrides(gatewayWith('{"globs": ["assets/**"]}', calls), MODEL, ambiguous);
    expect(learned).toEqual({ globs: ['assets/**'], source: 'model' });
    expect(calls).toHaveLength(1);

    expect(await learnRulesFromOverrides(gatewayWith('{"globs": ["assets/**"]}', calls), null, ambiguous)).toBeNull();
  });

  it('toggles: digest defaults on; drafting and learning default off', () => {
    expect(digestEnabled(undefined)).toBe(true);
    expect(digestEnabled({ runDigest: false })).toBe(false);
    expect(digestEnabled({ runDigest: true })).toBe(true);
    expect(ruleDraftingEnabled(undefined)).toBe(false);
    expect(ruleDraftingEnabled({ ruleDrafting: true })).toBe(true);
    expect(ruleLearningEnabled(undefined)).toBe(false);
    expect(ruleLearningEnabled({ learnRules: true })).toBe(true);
  });
});
