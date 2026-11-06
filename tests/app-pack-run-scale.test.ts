import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifest, type ValidatedPack } from '@shared/app-pack';
import { MiniAppRunService, type ServiceRunEvent } from '@main/apps/run/RunService';
import { PackFs, validateRunRoot } from '@main/apps/capabilities/fs';
import { nodePackFsDeps } from '@main/apps/capabilities/node-fs';
import { PackRunBridge } from '@main/apps/capabilities/run';
import type { MiniAppRunItemRow, MiniAppRunRow, MiniAppRunStore } from '@main/apps/run/store';

class MemoryStore implements MiniAppRunStore {
  readonly runs = new Map<string, MiniAppRunRow>();
  items: MiniAppRunItemRow[] = [];
  readonly feedback: MiniAppRunItemRow['fingerprint'][] = [];

  async createRun(row: MiniAppRunRow): Promise<void> {
    this.runs.set(row.id, { ...row });
  }
  async updateRun(id: string, patch: Partial<MiniAppRunRow>): Promise<void> {
    const run = this.runs.get(id);
    if (run) {
      Object.assign(run, patch);
    }
  }
  async getRun(id: string): Promise<MiniAppRunRow | null> {
    return this.runs.get(id) ?? null;
  }
  async runsByStatus(status: MiniAppRunRow['status']): Promise<MiniAppRunRow[]> {
    return [...this.runs.values()].filter((run) => run.status === status);
  }
  async recentRuns(packId?: string, limit = 20): Promise<MiniAppRunRow[]> {
    return [...this.runs.values()]
      .filter((run) => packId === undefined || run.packId === packId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }
  async allRuns(): Promise<MiniAppRunRow[]> {
    return [...this.runs.values()];
  }
  async appendItem(row: MiniAppRunItemRow): Promise<void> {
    this.items.push(row);
  }
  async itemsOfRun(runId: string): Promise<MiniAppRunItemRow[]> {
    return this.items.filter((item) => item.runId === runId);
  }
  async updateItemVerdict(runId: string, relPath: string, verdict: MiniAppRunItemRow['verdict'], decidedBy: string): Promise<boolean> {
    const index = this.items.findIndex((item) => item.runId === runId && item.relPath === relPath);
    if (index < 0) {
      return false;
    }
    this.items[index] = { ...this.items[index], verdict, decidedBy, evidence: { userOverride: true } };
    return true;
  }
  async findCachedVerdict(): Promise<null> {
    return null;
  }
  async upsertFeedback(): Promise<void> {}
  async feedbackFor(): Promise<Map<string, never>> {
    return new Map();
  }
  async feedbackList(): Promise<never[]> {
    return [];
  }
  async feedbackClear(): Promise<number> {
    return 0;
  }
  async pruneRuns(): Promise<number> {
    return 0;
  }
}

let root = '';

beforeEach(() => {
  const base = join(process.cwd(), 'node_modules', '.tmp');
  mkdirSync(base, { recursive: true });
  root = join(base, `pack-scale-${Math.random().toString(36).slice(2, 8)}`);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makePack(): ValidatedPack {
  const manifest = {
    apiVersion: 1,
    id: 'scale-test',
    version: '1.0.0',
    kind: 'assessment',
    capabilities: ['fs-read', 'run', 'report'],
    privacy: { sendsContent: false, sensitiveGlobs: [] },
    run: {
      scan: {},
      classify: {
        candidate: [{ id: 'everything', when: { signal: 'meta.size', op: 'gte', value: 0 } }],
      },
      compose: {},
    },
    report: { nodes: [{ id: 'items', type: 'table', columns: ['path'] }, { id: 'ev', type: 'evidence' }] },
    i18n: {
      defaultLocale: 'en',
      locales: { en: { title: 'Scale test', 'rule.everything': 'Everything', 'report.items': 'Items', 'report.ev': 'Evidence' } },
    },
  };
  const result = validateManifest(manifest);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
  }
  return result.pack;
}

async function seedTree(dirs: number, filesPerDir: number): Promise<void> {
  for (let dir = 0; dir < dirs; dir += 1) {
    const dirPath = join(root, `d${String(dir).padStart(3, '0')}`, 'sub');
    mkdirSync(dirPath, { recursive: true });
    for (let file = 0; file < filesPerDir; file += 1) {
      writeFileSync(join(dirPath, `f${file}.txt`), 'x');
    }
  }
}

function makeService(store: MemoryStore, pack: ValidatedPack): MiniAppRunService {
  return new MiniAppRunService({
    store,
    runBridge: new PackRunBridge({ newId: () => `run-${Math.random()}`, now: () => Date.now() }),
    getPack: (packId) => (packId === 'scale-test' ? { pack, config: {}, title: 'Scale test' } : null),
    openFs: async (_candidate, rootPath) => {
      const validated = await validateRunRoot(rootPath, { home: '/home/tester', userData: '/x', platform: 'linux' }, nodePackFsDeps);
      if (!validated.ok) {
        return validated;
      }
      return { ok: true, value: new PackFs(validated.value.root, validated.value.dev, nodePackFsDeps) };
    },
    decideFor: () => null,
    resolveEngineId: async () => ({ ok: true as const, engineId: 'none' }),
    broadcast: (_event: ServiceRunEvent) => undefined,
    createConversation: async (title) => ({ id: `conv-${title}` }),
    createRunMessage: async () => ({ id: 'msg' }),
    updateRunMessage: async () => undefined,
    notify: () => undefined,
    packTitle: () => 'Scale test',
    now: () => Date.now(),
    newId: () => 'run-1',
  });
}

async function settle(store: MemoryStore, runId: string): Promise<MiniAppRunRow> {
  for (let spin = 0; spin < 2000; spin += 1) {
    const run = await store.getRun(runId);
    if (run && ['done', 'paused', 'failed', 'canceled'].includes(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('run did not settle');
}

describe('plan 51 S3.9 — scale robustness', () => {
  it('a 6000-file run completes; tree totals match run totals exactly; paging and prefix overrides stay honest', async () => {
    seedTree(400, 15);
    const store = new MemoryStore();
    const service = makeService(store, makePack());
    const started = await service.start('scale-test', root, {});
    expect(started.ok).toBe(true);
    const run = await settle(store, started.ok ? started.runId : '');
    expect(run.status).toBe('done');
    expect(run.totals?.scanned).toBe(6000);

    const tree = await service.treeFor(run.id);
    expect(tree).toBeTruthy();
    const rootDir = tree?.directories.find((dir) => dir.path === '');
    expect(rootDir?.totalCounts.candidate).toBe(6000);
    expect(rootDir?.directCounts.candidate).toBe(0);
    expect(tree?.directories.length).toBe(801);
    const sizesHonest = rootDir?.totalSizeByVerdict.candidate;
    expect(sizesHonest).toBe(6000 * 1);

    const items = store.items.filter((item) => item.runId === run.id);
    expect(items).toHaveLength(6000);
    const deep = tree?.directories.find((dir) => dir.path === 'd000/sub');
    expect(deep?.directCounts.candidate).toBe(15);

    const seen = new Set<string>();
    const rootPages = Math.ceil(6000 / 200);
    for (let page = 1; page <= rootPages; page += 1) {
      const listing = await service.directoryItems(run.id, '', page);
      expect(listing?.totalMatching).toBe(6000);
      for (const item of listing?.items ?? []) {
        seen.add(item.relPath);
      }
    }
    expect(seen.size).toBe(6000);

    const d000 = await service.directoryItems(run.id, 'd000', 1);
    expect(d000?.totalMatching).toBe(15);
    const d000Filtered = await service.directoryItems(run.id, 'd000', 1, 'candidate');
    expect(d000Filtered?.totalMatching).toBe(15);

    const first = await service.applyPrefixOverride(run.id, 'd000', 'keep', 'override', 2000);
    expect(first?.applied).toBe(15);
    expect(first?.remaining).toBe(0);
    const overriddenSub = store.items.filter((item) => item.runId === run.id && item.relPath.startsWith('d000/') && item.decidedBy === 'override:user');
    expect(overriddenSub).toHaveLength(15);

    const continued = await service.applyPrefixOverride(run.id, '', 'keep', 'override', 2000);
    expect(continued?.applied).toBe(2000);
    expect(continued?.remaining).toBe(3985);
    const continued2 = await service.applyPrefixOverride(run.id, '', 'keep', 'override', 2000);
    expect(continued2?.applied).toBe(2000);
    expect(continued2?.remaining).toBe(1985);

    const cachedTree = await service.treeFor(run.id);
    const cachedRoot = cachedTree?.directories.find((dir) => dir.path === '');
    expect(cachedRoot?.totalCounts.keep).toBe(4015);
    expect(cachedRoot?.totalCounts.candidate).toBe(6000 - 4015);
    const cachedSub = cachedTree?.directories.find((dir) => dir.path === 'd000/sub');
    expect(cachedSub?.directCounts.keep).toBe(15);
    expect(cachedSub?.directCounts.candidate).toBe(0);
  }, 120_000);
});
