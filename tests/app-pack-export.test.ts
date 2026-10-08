import { describe, expect, it } from 'vitest';
import { diffRuns, exportRunCsv, exportRunJson, exportRunMarkdown } from '@main/apps/run/export';
import type { MiniAppRunReportView } from '@shared/app-pack';

const report: MiniAppRunReportView = {
  packTitle: 'Deletion review',
  run: {
    id: 'run-1',
    packId: 'file-deletion-review',
    packVersion: '1.0.0',
    rootPath: '/home/tester/projects/demo',
    status: 'done',
    totals: {
      scanned: 3, keep: 1, ask: 1, candidate: 1, ruleDecided: 1, modelDecided: 2, cacheHits: 1, pending: 0,
    },
    estimateCalls: 2,
    actualCalls: 2,
    inputTokens: 120,
    outputTokens: 60,
    error: null,
    conversationId: 'conv-1',
    startedAt: Date.UTC(2026, 9, 8, 10, 0, 0),
    updatedAt: Date.UTC(2026, 9, 8, 10, 1, 0),
    finishedAt: Date.UTC(2026, 9, 8, 10, 1, 0),
  },
  items: [
    { relPath: 'a,b.log', verdict: 'candidate', confidence: 0.9, decidedBy: 'engine:llm', evidence: { rule: 'cache', list: 'candidate' } },
    { relPath: 'keep "quoted".txt', verdict: 'keep', confidence: null, decidedBy: 'rule:fresh', evidence: { rule: 'fresh', list: 'keep' } },
    { relPath: 'mystery.dat', verdict: 'ask', confidence: null, decidedBy: 'cache', evidence: null },
  ],
};

describe('run exports (plan 26 S4)', () => {
  it('markdown carries header, cost, totals, items and evidence', () => {
    const md = exportRunMarkdown(report);
    expect(md).toContain('# Deletion review — run report');
    expect(md).toContain('`/home/tester/projects/demo`');
    expect(md).toContain('Model calls: 2 (estimate 2)');
    expect(md).toContain('120 in / 60 out');
    expect(md).toContain('| Scanned | 3 |');
    expect(md).toContain('a,b.log');
    expect(md).toContain('keep "quoted".txt');
    expect(md).toContain('"rule": "cache"');
  });

  it('json round-trips the report', () => {
    const parsed = JSON.parse(exportRunJson(report));
    expect(parsed.run.id).toBe('run-1');
    expect(parsed.items).toHaveLength(3);
  });

  it('csv escapes commas and quotes', () => {
    const csv = exportRunCsv(report);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('path,verdict,confidence,decidedBy');
    expect(lines[1]).toBe('"a,b.log",candidate,0.900,engine:llm');
    expect(lines[2]).toBe('"keep ""quoted"".txt",keep,,rule:fresh');
  });
});

describe('diffRuns — changed since last run', () => {
  const baseline = {
    runId: 'run-old',
    finishedAt: 1,
    updatedAt: 1,
    items: [
      { relPath: 'same.txt', fingerprint: 'f1', verdict: 'keep' },
      { relPath: 'gone.txt', fingerprint: 'f2', verdict: 'candidate' },
      { relPath: 'flip.txt', fingerprint: 'f3', verdict: 'ask' },
      { relPath: 'content.txt', fingerprint: 'f4', verdict: 'ask' },
    ],
  };

  it('reports new, removed, changed and verdict flips', () => {
    const latest = {
      runId: 'run-new',
      finishedAt: 2,
      updatedAt: 2,
      items: [
        { relPath: 'same.txt', fingerprint: 'f1', verdict: 'keep' },
        { relPath: 'flip.txt', fingerprint: 'f3', verdict: 'candidate' },
        { relPath: 'content.txt', fingerprint: 'f4-changed', verdict: 'ask' },
        { relPath: 'brand-new.txt', fingerprint: 'f9', verdict: 'ask' },
      ],
    };
    const diff = diffRuns(latest, baseline);
    expect(diff.baselineRunId).toBe('run-old');
    const kinds = new Map(diff.entries.map((entry) => [entry.relPath, entry.kind]));
    expect(kinds.get('brand-new.txt')).toBe('new');
    expect(kinds.get('gone.txt')).toBe('removed');
    expect(kinds.get('flip.txt')).toBe('verdict-change');
    expect(kinds.get('content.txt')).toBe('changed');
    expect(kinds.has('same.txt')).toBe(false);
  });

  it('no baseline means no entries', () => {
    const diff = diffRuns({ runId: 'x', finishedAt: null, updatedAt: 0, items: [] }, null);
    expect(diff.baselineRunId).toBeNull();
    expect(diff.entries).toEqual([]);
  });
});
