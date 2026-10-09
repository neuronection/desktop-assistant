import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, readdirSync } from 'node:fs';import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateManifest } from '@shared/app-pack';
import { BUNDLED_CODE_PACKS, CALC_PACK, TRANSLATE_PACK } from '@packs'
import { MiniAppRegistry } from '@main/apps/registry';
import { DEFAULT_CONFIG, type AppConfig } from '@shared/config/AppConfig';
import { PackFs, validateRunRoot } from '@main/apps/capabilities/fs';
import { nodePackFsDeps } from '@main/apps/capabilities/node-fs';
import { QuarantineService, type QuarantineFsDeps, type QuarantineRecord, type QuarantineStore } from '@main/apps/quarantine';
import { ProposalService, type ProposalRow, type ProposalStore } from '@main/apps/run/proposals';
import { MiniAppRunService, type ServiceRunEvent } from '@main/apps/run/RunService';
import type { MiniAppRunItemRow, MiniAppRunRow, MiniAppRunStore } from '@main/apps/run/store';
import { runAssessment } from '@main/apps/runner/runner';

const REFERENCE_PACK: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'src/packs/file-deletion-review/pack.json'), 'utf8')
);

function createRegistry(initialPacks: AppConfig['miniApps']['packs'] = []) {
  let config: AppConfig = { ...structuredClone(DEFAULT_CONFIG), miniApps: { masterEnabled: true, packs: initialPacks } };
  const registry = new MiniAppRegistry({
    config: () => config,
    updateMiniApps: async (patch) => {
      config = { ...config, miniApps: { ...config.miniApps, ...patch } };
    },
    now: () => Date.now(),
    sha256: (input) => createHash('sha256').update(input).digest('hex'),
  });
  return { registry, read: () => config.miniApps };
}

describe('bundled packs (plan 26 S7)', () => {
  it('every manifest under src/packs/<id>/ passes the shared validator in bundled mode (CI gate)', () => {
    const manifests: unknown[] = [...BUNDLED_CODE_PACKS, REFERENCE_PACK];
    for (const pack of manifests) {
      const result = validateManifest(pack, { bundled: true });
      expect(result.ok, (pack as { id?: string }).id ?? 'pack').toBe(true);
    }
  });

  it('no pack directory is left unregistered — the manifest set on disk matches what CI validates', () => {
    const dirs = readdirSync(join(process.cwd(), 'src', 'packs'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const registered = [...BUNDLED_CODE_PACKS, REFERENCE_PACK as { id: string }].map((pack) => (pack as { id: string }).id).sort();
    expect(dirs).toEqual(registered);
  });

  it('the calc and translate surface packs validate (kind surface forbids the pipeline)', () => {
    for (const pack of BUNDLED_CODE_PACKS) {
      const result = validateManifest(pack, { bundled: true });
      expect(result.ok, (pack as { id: string }).id).toBe(true);
    }
    expect(CALC_PACK.kind).toBe('surface');
    expect(TRANSLATE_PACK.capabilities).toContain('llm');
  });

  it('ensureBundled installs absent packs once and never clobbers user imports', async () => {
    const { registry, read } = createRegistry();
    const first = await registry.ensureBundled(BUNDLED_CODE_PACKS);
    expect(first).toEqual(['mini-calc', 'mini-translate']);
    const again = await registry.ensureBundled(BUNDLED_CODE_PACKS);
    expect(again).toEqual([]);
    expect(read().packs.map((pack) => (pack.manifest as { id: string }).id).sort()).toEqual(['mini-calc', 'mini-translate']);
    expect(read().packs.every((pack) => pack.origin.kind === 'bundled')).toBe(true);
  });

  it('removing a bundled pack is sticky — ensureBundled never resurrects it, restore does', async () => {
    const { registry, read } = createRegistry();
    await registry.ensureBundled(BUNDLED_CODE_PACKS);
    expect(await registry.remove('mini-calc')).toBe(true);
    expect(read().packs.map((pack) => (pack.manifest as { id: string }).id)).toEqual(['mini-translate']);
    expect(read().removedBundled).toEqual(['mini-calc']);
    const reinstalled = await registry.ensureBundled(BUNDLED_CODE_PACKS);
    expect(reinstalled).toEqual([]);
    expect(read().packs.map((pack) => (pack.manifest as { id: string }).id)).toEqual(['mini-translate']);
    const restored = await registry.restoreBundled(BUNDLED_CODE_PACKS);
    expect(restored).toContain('mini-calc');
    expect(read().packs.map((pack) => (pack.manifest as { id: string }).id).sort()).toEqual(['mini-calc', 'mini-translate']);
    expect(read().removedBundled).toEqual([]);
  });

  it('a user import of the same id is still never clobbered by ensureBundled', async () => {
    const { registry, read } = createRegistry();
    const imported = { ...(REFERENCE_PACK as Record<string, unknown>), version: '2.0.0' };
    const result = await registry.importManifest(JSON.stringify(imported), { kind: 'imported', path: '/tmp/review.json' });
    expect(result.ok).toBe(true);
    const changed = await registry.ensureBundled([REFERENCE_PACK, ...BUNDLED_CODE_PACKS]);
    expect(changed).toEqual(['mini-calc', 'mini-translate']);
    const review = read().packs.find((pack) => (pack.manifest as { id: string }).id === 'file-deletion-review')!;
    expect(review.origin.kind).toBe('imported');
    expect((review.manifest as { version: string }).version).toBe('2.0.0');
  });

  it('a newer shipped bundled pack upgrades in place, preserving config and enabled state', async () => {
    const { registry, read } = createRegistry();
    await registry.ensureBundled(BUNDLED_CODE_PACKS);
    const installed = read().packs.find((pack) => (pack.manifest as { id: string }).id === 'mini-translate')!;
    installed.enabled = false;
    installed.config = { defaultTarget: 'el', padDebounceMs: 900 };
    const upgraded = { ...(TRANSLATE_PACK as Record<string, unknown>), version: '1.2.0' };
    const changed = await registry.ensureBundled([upgraded]);
    expect(changed).toEqual(['mini-translate']);
    const after = read().packs.find((pack) => (pack.manifest as { id: string }).id === 'mini-translate')!;
    expect((after.manifest as { version: string }).version).toBe('1.2.0');
    expect(after.enabled).toBe(false);
    expect(after.config).toMatchObject({ defaultTarget: 'el', padDebounceMs: 900 });
  });
});

class MemoryRunStore implements MiniAppRunStore {
  runs = new Map<string, MiniAppRunRow>();
  items: MiniAppRunItemRow[] = [];
  updated: { relPath: string; verdict: string; decidedBy: string }[] = [];
  feedbackRows: { packId: string; rootPath: string; relPath: string; verdict: 'keep' | 'ask' | 'candidate'; source: 'override' | 'exclude' }[] = [];
  async createRun(row: MiniAppRunRow): Promise<void> { this.runs.set(row.id, { ...row }); }
  async updateRun(id: string, patch: Partial<MiniAppRunRow>): Promise<void> {
    const run = this.runs.get(id);
    if (run) { Object.assign(run, patch); }
  }
  async getRun(id: string): Promise<MiniAppRunRow | null> { return this.runs.get(id) ?? null; }
  async runsByStatus(status: MiniAppRunRow['status']): Promise<MiniAppRunRow[]> {
    return [...this.runs.values()].filter((run) => run.status === status);
  }
  async recentRuns(packId?: string, limit = 20): Promise<MiniAppRunRow[]> {
    return [...this.runs.values()].filter((run) => packId === undefined || run.packId === packId).slice(0, limit);
  }
  async appendItem(row: MiniAppRunItemRow): Promise<void> {
    const index = this.items.findIndex((item) => item.runId === row.runId && item.fingerprint === row.fingerprint);
    if (index >= 0) { this.items[index] = row; } else { this.items.push(row); }
  }
  async itemsOfRun(runId: string): Promise<MiniAppRunItemRow[]> { return this.items.filter((item) => item.runId === runId); }
  async updateItemVerdict(runId: string, relPath: string, verdict: MiniAppRunItemRow['verdict'], decidedBy: string): Promise<boolean> {
    const index = this.items.findIndex((item) => item.runId === runId && item.relPath === relPath);
    this.updated.push({ relPath, verdict, decidedBy });
    if (index >= 0) { this.items[index] = { ...this.items[index], verdict, decidedBy }; return true; }
    return false;
  }
  async findCachedVerdict(key: Parameters<MiniAppRunStore['findCachedVerdict']>[0]): Promise<Omit<MiniAppRunItemRow, 'runId'> | null> {
    const matches = this.items.filter((item) =>
      item.packId === key.packId && item.packVersion === key.packVersion && item.configHash === key.configHash &&
      item.engineId === key.engineId && item.fingerprint === key.fingerprint);
    if (matches.length === 0) { return null; }
    const { runId: _runId, ...rest } = matches[matches.length - 1];
    return rest;
  }
  async upsertFeedback(row: Parameters<MiniAppRunStore['upsertFeedback']>[0]): Promise<void> {
    const index = this.feedbackRows.findIndex((entry) => entry.packId === row.packId && entry.rootPath === row.rootPath && entry.relPath === row.relPath);
    if (index >= 0) { this.feedbackRows[index] = row; } else { this.feedbackRows.push(row); }
  }
  async feedbackFor(packId: string, rootPath: string) {
    const map = new Map<string, { packId: string; rootPath: string; relPath: string; verdict: 'keep' | 'ask' | 'candidate'; source: 'override' | 'exclude' }>();
    for (const entry of this.feedbackRows) {
      if (entry.packId === packId && entry.rootPath === rootPath) { map.set(entry.relPath, entry); }
    }
    return map;
  }
}

class RealQuarantineFs implements QuarantineFsDeps {
  constructor(private readonly userData: string) {}
  async mkdir(path: string, recursive: true): Promise<void> { await mkdirSync(path, { recursive }); }
  async stat(path: string) {
    const stats = await import('node:fs').then((fs) => fs.statSync(path));
    return { isFile: stats.isFile(), isDirectory: stats.isDirectory(), size: stats.size, dev: stats.dev };
  }
  async rename(from: string, to: string): Promise<void> { await import('node:fs').then((fs) => fs.renameSync(from, to)); }
  async copyAndDelete(from: string, to: string): Promise<void> {
    const fs = await import('node:fs');
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
  }
  async writeFile(path: string, content: string): Promise<void> { writeFileSync(path, content); }
  async readFile(path: string): Promise<string> { return readFileSync(path, 'utf8'); }
  async exists(path: string): Promise<boolean> { return import('node:fs').then((fs) => fs.existsSync(path)); }
  async unlink(path: string): Promise<void> { await import('node:fs').then((fs) => fs.rmSync(path, { force: true })); }
  now(): number { return Date.now(); }
  newId(): string { return `q-${Math.random().toString(36).slice(2, 8)}`; }
}

class MemoryQuarantineStore implements QuarantineStore {
  records: QuarantineRecord[] = [];
  async create(record: QuarantineRecord): Promise<void> { this.records.push({ ...record }); }
  async byProposal(proposalId: string): Promise<QuarantineRecord[]> { return this.records.filter((record) => record.proposalId === proposalId); }
  async byRun(runId: string): Promise<QuarantineRecord[]> { return this.records.filter((record) => record.runId === runId); }
  async byPack(packId: string): Promise<QuarantineRecord[]> { return this.records.filter((record) => record.packId === packId); }
  async olderThan(packId: string, cutoff: number): Promise<QuarantineRecord[]> {
    return this.records.filter((record) => record.packId === packId && record.movedAt < cutoff && record.restoredAt === null);
  }
  async markRestored(id: string, at: number): Promise<void> {
    const record = this.records.find((candidate) => candidate.id === id);
    if (record) { record.restoredAt = at; }
  }
  async delete(id: string): Promise<void> { this.records = this.records.filter((record) => record.id !== id); }
}

class MemoryProposalStore implements ProposalStore {
  rows = new Map<string, ProposalRow>();
  async create(row: ProposalRow): Promise<void> { this.rows.set(row.id, { ...row }); }
  async get(id: string): Promise<ProposalRow | null> { return this.rows.get(id) ?? null; }
  async update(id: string, patch: Partial<ProposalRow>): Promise<void> {
    const row = this.rows.get(id);
    if (row) { Object.assign(row, patch); }
  }
  async pendingForRun(runId: string): Promise<ProposalRow | null> {
    for (const row of this.rows.values()) {
      if (row.runId === runId && row.status === 'pending') { return row; }
    }
    return null;
  }
}

let root = '';
let userData = '';

beforeEach(() => {
  const base = join(process.cwd(), 'node_modules', '.tmp');
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, 'deletion-review-'));
  userData = mkdtempSync(join(base, 'quarantine-userdata-'));
  const past = (days: number) => new Date(Date.now() - days * 86_400_000);
  mkdirSync(join(root, 'node_modules', 'lib'), { recursive: true });
  mkdirSync(join(root, 'project', 'dist'), { recursive: true });
  writeFileSync(join(root, 'notes.txt'), 'recent');
  writeFileSync(join(root, 'important.key'), 'secret');
  writeFileSync(join(root, 'keep-me.zip-local'), 'assets');
  writeFileSync(join(root, 'old-build.log'), '2023');
  utimesSync(join(root, 'old-build.log'), past(400), past(400));
  writeFileSync(join(root, 'node_modules', 'lib', 'index.js'), 'x');
  utimesSync(join(root, 'node_modules', 'lib', 'index.js'), past(300), past(300));
  writeFileSync(join(root, 'project', 'dist', 'bundle.js'), 'y');
  utimesSync(join(root, 'project', 'dist', 'bundle.js'), past(200), past(200));
  writeFileSync(join(root, 'mystery.dat'), '?');
  utimesSync(join(root, 'mystery.dat'), past(400), past(400));
});

afterEachCleanup();

function afterEachCleanup(): void {
  process.on('exit', () => {
    rmSync(root, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  });
}

describe('file-deletion-review — end to end on the real pack (S7)', () => {
  it('runs the real pack over a real mixed tree, arms, quarantines and restores', async () => {
    const validated = validateManifest(REFERENCE_PACK, { bundled: true });
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    const effectiveConfig = {
      freshDays: 14,
      exceptions: [] as string[],
      excludedExtensions: ['zip-local'],
      readContext: false,
      guidelines: '',
    };
    const validatedRoot = await validateRunRoot(root, { home: '/home/tester', userData: '/x', platform: 'linux' }, nodePackFsDeps);
    expect(validatedRoot.ok).toBe(true);
    if (!validatedRoot.ok) {
      return;
    }
    const fs = new PackFs(validatedRoot.value.root, validatedRoot.value.dev, nodePackFsDeps);
    const store = new MemoryRunStore();
    const decidedRelPaths: string[] = [];
    const outcome = await runAssessment(validated.pack, effectiveConfig, {
      runId: 'e2e-1',
      fs,
      decide: {
        ask: async (input) => ({
          ok: true as const,
          value: {
            engine: 'stub',
            confidence: 0.92,
            answers: {
              safe: { type: 'choice' as const, choice: 'yes', probabilities: { yes: 0.92 }, confidence: 0.92 },
              recoverability: { type: 'score' as const, score: 0, legend: {}, probabilities: {}, confidence: 0.95 },
              category: { type: 'choice' as const, choice: 'logs', probabilities: { logs: 0.9 }, confidence: 0.9 },
            },
          },
        }),
      },
      items: {
        appendItem: (row) => store.appendItem(row),
        findCachedVerdict: (key) => store.findCachedVerdict(key),
      },
      key: { packId: 'file-deletion-review', packVersion: '1.0.0', configHash: 'e2e', engineId: 'llm' },
      rootPath: validatedRoot.value.root,
      emit: (event) => {
        if (event.type === 'item') {
          decidedRelPaths.push(event.relPath);
        }
      },
      signal: new AbortController().signal,
      maxModelCalls: 100,
      now: () => Date.now(),
    });
    expect(outcome.status).toBe('done');
    const byPath = new Map(store.items.map((item) => [item.relPath, item]));
    expect(byPath.get('important.key')).toMatchObject({ verdict: 'keep', decidedBy: 'rule:sensitive' });
    expect(byPath.get('keep-me.zip-local')).toMatchObject({ verdict: 'keep', decidedBy: 'rule:excluded-ext' });
    expect(byPath.get('notes.txt')).toMatchObject({ verdict: 'keep', decidedBy: 'rule:fresh' });
    expect(byPath.get('node_modules/lib/index.js')).toMatchObject({ verdict: 'candidate' });
    expect(byPath.get('project/dist/bundle.js')).toMatchObject({ verdict: 'candidate' });
    expect(byPath.get('old-build.log')).toMatchObject({ verdict: 'candidate' });
    expect(byPath.get('mystery.dat')).toMatchObject({ verdict: 'candidate' });
    expect(byPath.get('mystery.dat')?.evidence).toMatchObject({ answers: { category: { type: 'choice', choice: 'logs' } } });

    const run: MiniAppRunRow = {
      id: 'e2e-1', packId: 'file-deletion-review', packVersion: '1.0.0', rootPath: validatedRoot.value.root,
      configHash: 'e2e', engineId: 'llm', status: 'done', totals: outcome.totals, estimateCalls: outcome.estimateCalls,
      actualCalls: outcome.actualCalls, inputTokens: 0, outputTokens: 0, error: null, conversationId: null,
      startedAt: Date.now(), updatedAt: Date.now(), finishedAt: Date.now(),
    };
    const quarantine = new QuarantineService(new RealQuarantineFs(userData), new MemoryQuarantineStore(), async () => userData);
    const proposals = new ProposalService(new MemoryProposalStore(), quarantine, store, { now: () => Date.now(), newId: () => 'prop-1' });
    const armed = await proposals.arm(validated.pack, run, store.items, {
      rootPath: validatedRoot.value.root,
      statItem: async (relative) => {
        const stats = await fs.statItem(relative);
        return stats.ok ? { ok: true as const, size: stats.value.size, mtimeMs: stats.value.mtimeMs, isFile: stats.value.isFile } : { ok: false as const, error: stats.error };
      },
    });
    expect(armed.ok).toBe(true);
    if (!armed.ok) {
      return;
    }
    expect(armed.proposal.payload.items.every((item) => item.confidence !== null && item.confidence >= 0.8)).toBe(true);
    expect(armed.proposal.payload.items.some((item) => item.relPath === 'important.key')).toBe(false);

    const resolved = await proposals.resolve(armed.proposal.id, true);
    expect(resolved).toMatchObject({ ok: true, executed: true });
    const { runnerFingerprint } = await import('@main/apps/run/fingerprint');
    const execution = await proposals.execute(armed.proposal.id, {
      rootPath: validatedRoot.value.root,
      statItem: async (relative) => {
        const stats = await fs.statItem(relative);
        return stats.ok ? { ok: true as const, size: stats.value.size, mtimeMs: stats.value.mtimeMs, isFile: stats.value.isFile } : { ok: false as const, error: stats.error };
      },
    }, (relative, size, mtimeMs) => runnerFingerprint(validatedRoot.value.root, relative, size, mtimeMs));
    const moved = execution.filter((entry) => entry.outcome === 'moved');
    expect(moved.length).toBe(4);
    expect(await import('node:fs').then((nodeFs) => nodeFs.existsSync(join(root, 'old-build.log')))).toBe(false);
    expect(await import('node:fs').then((nodeFs) => nodeFs.existsSync(join(root, 'notes.txt')))).toBe(true);

    const restored = await quarantine.restoreItem('e2e-1', 'old-build.log');
    expect(restored.ok).toBe(true);
    expect(await import('node:fs').then((nodeFs) => nodeFs.existsSync(join(root, 'old-build.log')))).toBe(true);

    const second = await proposals.resolve(armed.proposal.id, true);
    expect(second).toMatchObject({ ok: true, executed: false });
  }, 30_000);
});

describe('MiniAppRunService drives the real pack (integration smoke)', () => {
  it('starts, runs to done and exposes the run through recentRuns', async () => {
    const validated = validateManifest(REFERENCE_PACK, { bundled: true });
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    const store = new MemoryRunStore();
    const events: ServiceRunEvent[] = [];
    const service = new MiniAppRunService({
      store,
      runBridge: new (await import('@main/apps/capabilities/run')).PackRunBridge({ newId: () => 'r', now: () => Date.now() }),
      getPack: (packId) =>
        packId === 'file-deletion-review'
          ? { pack: validated.pack, config: { freshDays: 14, exceptions: [], excludedExtensions: [], readContext: false, guidelines: '' }, title: 'Deletion review' }
          : null,
      openFs: async (_pack, rootPath) => {
        const result = await validateRunRoot(rootPath, { home: '/home/tester', userData: '/x', platform: 'linux' }, nodePackFsDeps);
        return result.ok ? { ok: true, value: new PackFs(result.value.root, result.value.dev, nodePackFsDeps) } : result;
      },
      decideFor: () => ({
        ask: async () => ({
          ok: true as const,
          value: { engine: 'stub', confidence: 0.9, answers: { safe: { type: 'choice' as const, choice: 'yes', probabilities: {}, confidence: 0.9 } } },
        }),
      }),
      resolveEngineId: async () => ({ ok: true as const, engineId: 'llm' }),
      broadcast: (event) => events.push(event),
      createConversation: async (title) => ({ id: `conv-${title}` }),
      createRunMessage: async () => ({ id: 'msg-1' }),
      updateRunMessage: async () => undefined,
      notify: () => undefined,
      packTitle: () => 'Deletion review',
      now: () => Date.now(),
      newId: () => `run-${Math.random().toString(36).slice(2, 8)}`,
    });
    const started = await service.start('file-deletion-review', root, {});
    expect(started.ok).toBe(true);
    let settled: MiniAppRunRow | null = null;
    for (let spin = 0; spin < 600; spin += 1) {
      settled = started.ok ? await store.getRun(started.runId) : null;
      if (settled && ['done', 'paused', 'failed', 'canceled'].includes(settled.status)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(settled?.status).toBe('done');
    expect(settled?.totals?.scanned).toBe(7);
    expect(settled?.conversationId).toBeTruthy();
    expect(events.some((event) => event.type === 'run:finished')).toBe(true);
  }, 30_000);
});

describe('launcher surface state (miniApps.tsx) — uninstall is real', () => {
  it('a successful registry read with no surface packs disables the modes; the pre-fetch default restores nothing', async () => {
    const { miniAppForId, miniAppForEntry } = await import('@renderer/chat-react/miniApps');
    const { setSurfacePackViews } = await import('@renderer/chat-react/surfacePackState');
    setSurfacePackViews(
      [{ id: 'mini-calc', version: '1', kind: 'surface', title: 'Calculator', capabilities: [], enabled: true, originKind: 'bundled', configFields: [], configValues: {} }],
      true
    );
    expect(miniAppForId('calc:evaluate')).toBeTruthy();
    setSurfacePackViews([], true);
    expect(miniAppForId('calc:evaluate')).toBeNull();
    expect(
      miniAppForEntry({ id: 'tool:translate', kind: 'tool', title: 't', aliases: [], category: 'tools', source: 'system', scopes: { palette: true, agent: false }, args: [], toolName: 'translate' })
    ).toBeNull();
  });
});
