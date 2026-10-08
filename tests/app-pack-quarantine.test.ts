import { describe, expect, it } from 'vitest';
import { join } from 'path';
import { validateManifest, type ValidatedPack } from '@shared/app-pack';
import type { PackError } from '@shared/app-pack';
import { QuarantineService, type QuarantineFsDeps, type QuarantineRecord, type QuarantineStore } from '@main/apps/quarantine';
import { ProposalService, type ProposalRow, type ProposalStore } from '@main/apps/run/proposals';
import { runnerFingerprint } from '@main/apps/run/fingerprint';
import type { MiniAppRunItemRow, MiniAppRunRow, MiniAppRunStore } from '@main/apps/run/store';

class MemoryQuarantineStore implements QuarantineStore {
  records: QuarantineRecord[] = [];
  async create(record: QuarantineRecord): Promise<void> {
    this.records.push({ ...record });
  }
  async byProposal(proposalId: string): Promise<QuarantineRecord[]> {
    return this.records.filter((record) => record.proposalId === proposalId);
  }
  async byRun(runId: string): Promise<QuarantineRecord[]> {
    return this.records.filter((record) => record.runId === runId);
  }
  async byPack(packId: string): Promise<QuarantineRecord[]> {
    return this.records.filter((record) => record.packId === packId);
  }
  async olderThan(packId: string, cutoff: number): Promise<QuarantineRecord[]> {
    return this.records.filter((record) => record.packId === packId && record.movedAt < cutoff && record.restoredAt === null);
  }
  async markRestored(id: string, at: number): Promise<void> {
    const record = this.records.find((candidate) => candidate.id === id);
    if (record) {
      record.restoredAt = at;
    }
  }
  async delete(id: string): Promise<void> {
    this.records = this.records.filter((record) => record.id !== id);
  }
}

class FakeQuarantineFs implements QuarantineFsDeps {
  files = new Map<string, { content: string; dev: number }>();
  failOn?: string;
  private id = 0;

  constructor(root: string, files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
      this.files.set(join(root, path), { content, dev: 1 });
    }
  }

  async mkdir(): Promise<void> {}
  async stat(path: string) {
    const file = this.files.get(path);
    if (!file) {
      throw new Error(`ENOENT ${path}`);
    }
    return { isFile: true, isDirectory: false, size: file.content.length, dev: file.dev };
  }
  async rename(from: string, to: string): Promise<void> {
    if (this.failOn === from) {
      throw new Error('EIO disk full');
    }
    const file = this.files.get(from);
    if (!file) {
      throw new Error(`ENOENT ${from}`);
    }
    this.files.delete(from);
    this.files.set(to, file);
  }
  async copyAndDelete(from: string, to: string): Promise<void> {
    const file = this.files.get(from);
    if (!file) {
      throw new Error(`ENOENT ${from}`);
    }
    if (this.failOn === from) {
      throw new Error('ENOSPC');
    }
    this.files.set(to, { ...file });
    this.files.delete(from);
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, { content, dev: 1 });
  }
  async readFile(path: string): Promise<string> {
    return this.files.get(path)?.content ?? '';
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async unlink(path: string): Promise<void> {
    this.files.delete(path);
  }
  now(): number {
    return 86_400_000 * 100;
  }
  newId(): string {
    this.id += 1;
    return `q-${this.id}`;
  }
}

class MemoryProposalStore implements ProposalStore {
  rows = new Map<string, ProposalRow>();
  async create(row: ProposalRow): Promise<void> {
    this.rows.set(row.id, { ...row });
  }
  async get(id: string): Promise<ProposalRow | null> {
    return this.rows.get(id) ?? null;
  }
  async update(id: string, patch: Partial<ProposalRow>): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      Object.assign(row, patch);
    }
  }
  async pendingForRun(runId: string): Promise<ProposalRow | null> {
    for (const row of this.rows.values()) {
      if (row.runId === runId && row.status === 'pending') {
        return row;
      }
    }
    return null;
  }
}

const runStoreBase = {
  updated: [] as { runId: string; relPath: string; verdict: string; decidedBy: string }[],
  async updateItemVerdict(runId: string, relPath: string, verdict: string, decidedBy: string): Promise<boolean> {
    runStoreBase.updated.push({ runId, relPath, verdict, decidedBy });
    return true;
  },
};

function runRow(): MiniAppRunRow {
  return {
    id: 'run-1', packId: 'arm-test', packVersion: '1.0.0', rootPath: '/tree', configHash: 'c',
    engineId: 'llm', status: 'done', totals: null, estimateCalls: 0, actualCalls: 0,
    inputTokens: 0, outputTokens: 0, error: null, conversationId: null,
    startedAt: 1, updatedAt: 2, finishedAt: 3,
  };
}

function itemRow(relPath: string, verdict: string, confidence: number | null, fingerprint: string, evidence: Record<string, unknown> | null = null): MiniAppRunItemRow {
  return {
    runId: 'run-1', packId: 'arm-test', packVersion: '1.0.0', configHash: 'c', engineId: 'llm',
    fingerprint, relPath, verdict: verdict as MiniAppRunItemRow['verdict'], confidence, decidedBy: 'engine:llm', evidence, updatedAt: 1,
  };
}

function armedPack(): ValidatedPack {
  const result = validateManifest({
    apiVersion: 1,
    id: 'arm-test',
    version: '1.0.0',
    kind: 'assessment',
    capabilities: ['fs-read', 'fs-write-quarantine', 'decision', 'run', 'report', 'propose'],
    privacy: { sendsContent: false, sensitiveGlobs: ['*.key'] },
    run: {
      scan: {},
      classify: { candidate: [{ id: 'cache', when: { signal: 'meta.size', op: 'gte', value: 0 } }] },
      decide: { questions: [
        { id: 'safe', type: 'noul', instructions: 'Safe?' },
        { id: 'category', type: 'choice', instructions: 'Which category?', options: { logs: null, cache: null } },
      ] },
      compose: {},
      propose: { verb: 'quarantine', groupBy: 'answer.category.choice', gate: { minConfidence: 0.8 } },
    },
    report: { nodes: [{ id: 'items', type: 'table', columns: ['path'] }, { id: 'ev', type: 'evidence' }] },
    i18n: {
      defaultLocale: 'en',
      locales: { en: { title: 'Arm test', 'rule.cache': 'Cache', 'report.items': 'Items', 'report.ev': 'Evidence' } },
    },
  });
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
  }
  return result.pack;
}

function harness(treeFiles: Record<string, string>) {
  runStoreBase.updated = [];
  const fs = new FakeQuarantineFs('/tree', treeFiles);
  const quarantineStore = new MemoryQuarantineStore();
  const quarantine = new QuarantineService(fs, quarantineStore, async () => '/userdata');
  const proposals = new MemoryProposalStore();
  const runs = runStoreBase as unknown as MiniAppRunStore;
  const service = new ProposalService(proposals, quarantine, runs, { now: () => 1_000, newId: () => `p-${proposals.rows.size + 1}` });
  return { fs, quarantine, quarantineStore, proposals, service };
}

function statView(fs: FakeQuarantineFs, liveFiles: Record<string, { size: number; mtimeMs: number }>) {
  return {
    rootPath: '/tree',
    statItem: async (relative: string) => {
      const exists = await fs.exists(join('/tree', relative)).catch(() => false);
      if (!exists) {
        return { ok: false as const, error: { code: 'io', detail: { reason: 'gone' } } as PackError };
      }
      const live = liveFiles[relative];
      return { ok: true as const, size: live.size, mtimeMs: live.mtimeMs, isFile: true };
    },
  };
}

const FP = (rel: string, size = 9, mtimeMs = 1) => runnerFingerprint('/tree', rel, size, mtimeMs);

describe('ProposalService.arm — the fail-closed gate matrix', () => {
  it('admits only confident candidates off the sensitive list; groups by category', async () => {
    const h = harness({ 'a.log': 'x', 'secret.key': 'y', 'low.log': 'z', 'keep.txt': 'w' });
    const pack = armedPack();
    const items = [
      itemRow('a.log', 'candidate', 0.95, FP('a.log'), { answers: { category: { type: 'choice', choice: 'logs', probabilities: { logs: 1 }, confidence: 1 } } }),
      itemRow('secret.key', 'candidate', 0.95, FP('secret.key')),
      itemRow('low.log', 'candidate', 0.5, FP('low.log')),
      itemRow('keep.txt', 'keep', null, FP('keep.txt')),
    ];
    const armed = await h.service.arm(pack, runRow(), items, statView(h.fs, {
      'a.log': { size: 1, mtimeMs: 1 },
      'secret.key': { size: 1, mtimeMs: 1 },
      'low.log': { size: 1, mtimeMs: 1 },
      'keep.txt': { size: 1, mtimeMs: 1 },
    }));
    expect(armed.ok).toBe(true);
    if (!armed.ok) {
      return;
    }
    expect(armed.proposal.payload.items.map((item) => item.relPath)).toEqual(['a.log']);
    expect(armed.proposal.payload.items[0].category).toBe('logs');
    expect(armed.proposal.verb).toBe('quarantine');
  });

  it('refuses to arm an empty gate with a typed error, and one pending proposal per run', async () => {
    const h = harness({});
    const armed = await h.service.arm(armedPack(), runRow(), [itemRow('low.log', 'candidate', 0.1, FP('low.log'))], statView(h.fs, {}));
    expect(armed.ok).toBe(false);
    if (!armed.ok) {
      expect(armed.error.code).toBe('invalid');
    }
  });
});

describe('ProposalService.resolve + execute — idempotency and revalidate-and-move', () => {
  async function armedProposal(h: ReturnType<typeof harness>, files: Record<string, { size: number; mtimeMs: number }>, items: MiniAppRunItemRow[]) {
    const armed = await h.service.arm(armedPack(), runRow(), items, statView(h.fs, files));
    expect(armed.ok).toBe(true);
    return (armed as { ok: true; proposal: ProposalRow }).proposal;
  }

  it('moves gated items, writes the manifest, and the second responder is a no-op', async () => {
    const h = harness({ 'a.log': 'content-a', 'b.log': 'content-b' });
    const proposal = await armedProposal(h, { 'a.log': { size: 9, mtimeMs: 1 }, 'b.log': { size: 9, mtimeMs: 1 } }, [
      itemRow('a.log', 'candidate', 0.9, FP('a.log')),
      itemRow('b.log', 'candidate', 0.9, FP('b.log')),
    ]);
    const first = await h.service.resolve(proposal.id, true);
    expect(first).toMatchObject({ ok: true, executed: true });
    const outcome = await h.service.execute(proposal.id, statView(h.fs, { 'a.log': { size: 9, mtimeMs: 1 }, 'b.log': { size: 9, mtimeMs: 1 } }), (rel, size, mtimeMs) => FP(rel, size, mtimeMs));
    expect(outcome).toEqual([
      { relPath: 'a.log', outcome: 'moved' },
      { relPath: 'b.log', outcome: 'moved' },
    ]);
    expect(h.fs.files.has(join('/tree', 'a.log'))).toBe(false);
    expect(h.fs.files.has(join('/userdata/mini-apps/arm-test/quarantine/run-1', 'a.log'))).toBe(true);
    expect(h.fs.files.has(join('/userdata/mini-apps/arm-test/quarantine/run-1', 'manifest.json'))).toBe(true);
    const second = await h.service.resolve(proposal.id, true);
    expect(second).toMatchObject({ ok: true, executed: false });
  });

  it('a changed fingerprint drops the item to ask — never moved (change-after-assessment)', async () => {
    const h = harness({ 'a.log': 'changed-content' });
    const proposal = await armedProposal(h, { 'a.log': { size: 9, mtimeMs: 1 } }, [itemRow('a.log', 'candidate', 0.9, FP('a.log'))]);
    await h.service.resolve(proposal.id, true);
    const outcome = await h.service.execute(proposal.id, statView(h.fs, { 'a.log': { size: 16, mtimeMs: 9 } }), (rel, size, mtimeMs) => FP(rel, size, mtimeMs));
    expect(outcome).toEqual([{ relPath: 'a.log', outcome: 'changed', detail: 'changed after assessment — back to ask' }]);
    expect(h.fs.files.has(join('/tree', 'a.log'))).toBe(true);
    expect(runStoreBase.updated.at(-1)).toMatchObject({ relPath: 'a.log', verdict: 'ask', decidedBy: 'arm:changed' });
  });

  it('execution fails soft: an io failure stops the batch, earlier moves stay restorable, the rest skip', async () => {
    const h = harness({ 'a.log': 'a', 'b.log': 'b', 'c.log': 'c' });
    h.fs.failOn = join('/tree', 'b.log');
    const proposal = await armedProposal(h, { 'a.log': { size: 9, mtimeMs: 1 }, 'b.log': { size: 9, mtimeMs: 1 }, 'c.log': { size: 9, mtimeMs: 1 } }, [
      itemRow('a.log', 'candidate', 0.9, FP('a.log')),
      itemRow('b.log', 'candidate', 0.9, FP('b.log')),
      itemRow('c.log', 'candidate', 0.9, FP('c.log')),
    ]);
    await h.service.resolve(proposal.id, true);
    const outcome = await h.service.execute(proposal.id, statView(h.fs, { 'a.log': { size: 9, mtimeMs: 1 }, 'b.log': { size: 9, mtimeMs: 1 }, 'c.log': { size: 9, mtimeMs: 1 } }), (rel, size, mtimeMs) => FP(rel, size, mtimeMs));
    expect(outcome.map((entry) => entry.outcome)).toEqual(['moved', 'failed', 'skipped']);
    expect((await h.proposals.get(proposal.id))?.status).toBe('failed');
    expect(h.fs.files.has(join('/tree', 'a.log'))).toBe(false);
    expect(h.fs.files.has(join('/tree', 'c.log'))).toBe(true);
  });

  it('abort returns not-yet-moved items to ask', async () => {
    const h = harness({ 'a.log': 'a', 'b.log': 'b' });
    const proposal = await armedProposal(h, { 'a.log': { size: 9, mtimeMs: 1 }, 'b.log': { size: 9, mtimeMs: 1 } }, [
      itemRow('a.log', 'candidate', 0.9, FP('a.log')),
      itemRow('b.log', 'candidate', 0.9, FP('b.log')),
    ]);
    await h.service.resolve(proposal.id, true);
    h.service.abort(proposal.id);
    const outcome = await h.service.execute(proposal.id, statView(h.fs, { 'a.log': { size: 9, mtimeMs: 1 }, 'b.log': { size: 9, mtimeMs: 1 } }), (rel, size, mtimeMs) => FP(rel, size, mtimeMs));
    expect(outcome.map((entry) => entry.outcome)).toEqual(['skipped', 'skipped']);
    expect((await h.proposals.get(proposal.id))?.status).toBe('aborted');
    expect(h.fs.files.has(join('/tree', 'a.log'))).toBe(true);
    expect(runStoreBase.updated.filter((entry) => entry.decidedBy === 'arm:skipped')).toHaveLength(2);
  });
});

describe('QuarantineService — restore + retention', () => {
  it('restores the round-trip, never overwrites, and recreates missing parents', async () => {
    const h = harness({ 'sub/a.log': 'data' });
    const moved = await h.quarantine.moveOne({
      proposalId: 'p1', packId: 'arm-test', runId: 'run-1',
      originPath: join('/tree', 'sub/a.log'), relPath: 'sub/a.log',
      expectedFingerprintAtArm: FP('x'), currentFingerprint: FP('x'), currentIsFile: true,
    });
    expect(moved.ok).toBe(true);
    h.fs.files.set(join('/tree', 'sub/a.log'), { content: 'new-occupant', dev: 1 });
    const restored = await h.quarantine.restoreItem('run-1', 'sub/a.log');
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.restoredPath).toBe(join('/tree', 'sub/a.log.restore-1'));
      expect(h.fs.files.get(join('/tree', 'sub/a.log.restore-1'))?.content).toBe('data');
    }
  });

  it('retention prunes only stale unrestored records; empty() is the user-armed purge', async () => {
    const h = harness({ 'old.log': 'o', 'new.log': 'n' });
    await h.quarantine.moveOne({ proposalId: 'p1', packId: 'arm-test', runId: 'run-1', originPath: join('/tree', 'old.log'), relPath: 'old.log', expectedFingerprintAtArm: FP('o'), currentFingerprint: FP('o'), currentIsFile: true });
    const newRecord = await h.quarantine.moveOne({ proposalId: 'p2', packId: 'arm-test', runId: 'run-2', originPath: join('/tree', 'new.log'), relPath: 'new.log', expectedFingerprintAtArm: FP('n'), currentFingerprint: FP('n'), currentIsFile: true });
    h.quarantineStore.records.find((record) => record.relPath === 'old.log')!.movedAt = 1;
    const pruned = await h.quarantine.pruneRetention('arm-test', 30);
    expect(pruned).toBe(1);
    expect(h.fs.files.has(join('/userdata/mini-apps/arm-test/quarantine/run-1', 'old.log'))).toBe(false);
    expect(newRecord.ok).toBe(true);
    const emptied = await h.quarantine.empty('arm-test');
    expect(emptied).toBe(1);
  });
});
