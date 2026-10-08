import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LLMProviderType, type LLMProvider } from '@shared/types';
import { mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import { setAuditSink, type AiCallRecord } from '@main/ai/audit';
import type { StructuredModelFactory } from '@main/ai/chat-models';
import { validateManifest, type ValidatedPack } from '@shared/app-pack';
import { PackFs, validateRunRoot } from '@main/apps/capabilities/fs';
import { nodePackFsDeps } from '@main/apps/capabilities/node-fs';
import { PackDecideBridge } from '@main/apps/capabilities/decide';
import { PackRunBridge } from '@main/apps/capabilities/run';
import { DecisionLimiter } from '@main/ai/decide/limiter';
import { MiniAppRunService, type ServiceRunEvent } from '@main/apps/run/RunService';
import type { MiniAppRunItemRow, MiniAppRunRow, MiniAppRunStore } from '@main/apps/run/store';
import { evaluateCondition, classifyItem, composeVerdict, type SignalContext } from '@main/apps/runner/evaluate';

class MemoryStore implements MiniAppRunStore {
  readonly runs = new Map<string, MiniAppRunRow>();
  readonly items: MiniAppRunItemRow[] = [];

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
  async appendItem(row: MiniAppRunItemRow): Promise<void> {
    const index = this.items.findIndex((item) => item.runId === row.runId && item.fingerprint === row.fingerprint);
    if (index >= 0) {
      this.items[index] = row;
    } else {
      this.items.push(row);
    }
  }
  async itemsOfRun(runId: string): Promise<MiniAppRunItemRow[]> {
    return this.items.filter((item) => item.runId === runId);
  }
  async findCachedVerdict(key: Parameters<MiniAppRunStore['findCachedVerdict']>[0]): Promise<Omit<MiniAppRunItemRow, 'runId'> | null> {
    const matches = this.items.filter(
      (item) =>
        item.packId === key.packId &&
        item.packVersion === key.packVersion &&
        item.configHash === key.configHash &&
        item.engineId === key.engineId &&
        item.fingerprint === key.fingerprint
    );
    if (matches.length === 0) {
      return null;
    }
    const { runId: _runId, ...rest } = matches[matches.length - 1];
    return rest;
  }
}

const audit: AiCallRecord[] = [];

beforeEach(() => {
  audit.length = 0;
  setAuditSink(async (record) => {
    audit.push(record);
  });
});

let root = '';

beforeEach(() => {
  const base = join(process.cwd(), 'node_modules', '.tmp');
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, 'pack-runner-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function seedTree(): void {
  mkdirSync(join(root, 'node_modules', 'lib'), { recursive: true });
  const past = (days: number) => new Date(Date.now() - days * 86_400_000);
  const { utimesSync } = require('node:fs') as typeof import('node:fs');
  writeFileSync(join(root, 'important.key'), 'secret');
  writeFileSync(join(root, 'fresh-note.txt'), 'recent');
  writeFileSync(join(root, 'weird.bin'), 'x');
  writeFileSync(join(root, 'mystery.dat'), 'unknown');
  utimesSync(join(root, 'weird.bin'), past(400), past(400));
  utimesSync(join(root, 'mystery.dat'), past(400), past(400));
  writeFileSync(join(root, 'node_modules', 'lib', 'index.js'), 'module.exports = 1');
  utimesSync(join(root, 'node_modules', 'lib', 'index.js'), past(300), past(300));
}

function makePack(overrides: Record<string, unknown> = {}): ValidatedPack {
  const manifest = {
    apiVersion: 1,
    id: 'runner-test',
    version: '1.0.0',
    kind: 'assessment',
    capabilities: ['fs-read', 'decision', 'run', 'report'],
    privacy: { sendsContent: false, sensitiveGlobs: [] },
    run: {
      scan: {},
      classify: {
        veto: [{ id: 'exceptions', when: { signal: 'meta.path', op: 'matches-any', valueSignal: 'config.exceptions' } }],
        keep: [{ id: 'fresh', when: { signal: 'meta.ageDays', op: 'lt', valueSignal: 'config.freshDays' } }],
        ask: [{ id: 'weird', when: { signal: 'meta.ext', op: 'eq', value: 'bin' } }],
        candidate: [{ id: 'cache', when: { signal: 'meta.path', op: 'matches', value: 'node_modules/**' } }],
      },
      decide: { questions: [{ id: 'safe', type: 'noul', instructions: 'Safe to delete?' }] },
      compose: { candidateWhen: { all: [{ signal: 'rule.cache', op: 'eq', value: true }, { signal: 'answer.safe.confidence', op: 'gte', value: 0.8 }] } },
    },
    report: { nodes: [{ id: 'items', type: 'table', columns: ['path'] }, { id: 'ev', type: 'evidence' }] },
    configSchema: {
      type: 'object',
      properties: {
        freshDays: { type: 'number', default: 7, minimum: 0, maximum: 3650 },
        exceptions: { type: 'array', items: { type: 'string' }, default: [] },
      },
    },
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          title: 'Runner test',
          'rule.exceptions': 'Exception',
          'rule.fresh': 'Fresh',
          'rule.weird': 'Weird',
          'rule.cache': 'Cache',
          'rule.everything': 'Everything',
          'config.freshDays': 'Fresh days',
          'config.exceptions': 'Exceptions',
          'report.items': 'Items',
          'report.ev': 'Evidence',
        },
      },
    },
    ...overrides,
  };
  const result = validateManifest(manifest);
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
  }
  return result.pack;
}

const provider: LLMProvider = {
  id: 'provider-1',
  name: 'Test',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://api.example.com/v1',
  timeout: 1000,
  temperature: 0.7,
  maxTokens: 1000,
  systemPrompt: '',
  availableModels: [{ id: 'model-mini', name: 'Mini', caps: [] }],
  customModels: [],
};

function llmConfig(): AppConfig {
  return mergeWithDefaults({
    providers: [provider],
    defaultProviderId: provider.id,
    defaultChatModelId: 'model-mini',
    decision: { engine: 'llm', actThreshold: 0.85, confirmThreshold: 0.5 },
  } as Partial<AppConfig>);
}

type StubAsk = (input: string, questions: never) => Promise<Parameters<PackDecideBridge['ask']>[1] extends never ? never : Awaited<ReturnType<PackDecideBridge['ask']>>>;

interface Harness {
  store: MemoryStore;
  service: MiniAppRunService;
  events: ServiceRunEvent[];
  asks: { input: string }[];
}

async function harness(
  pack: ValidatedPack,
  config: Record<string, unknown>,
  ask: StubAsk | null,
  options: { maxModelCalls?: number } = {}
): Promise<Harness> {
  const store = new MemoryStore();
  const events: ServiceRunEvent[] = [];
  const asks: { input: string }[] = [];
  const runBridge = new PackRunBridge({ newId: () => `run-${Math.random()}`, now: () => Date.now() });
  const decide = ask
    ? {
        ask: (async (input: string, questions: never) => {
          asks.push({ input });
          return ask(input, questions);
        }) as unknown as { ask: PackDecideBridge['ask'] },
      }
    : null;
  const service = new MiniAppRunService({
    store,
    runBridge,
    getPack: (packId) => (packId === 'runner-test' ? { pack, config } : null),
    openFs: async (candidate, rootPath) => {
      const validated = await validateRunRoot(rootPath, { home: '/home/tester', userData: '/x', platform: 'linux' }, nodePackFsDeps);
      if (!validated.ok) {
        return validated;
      }
      return { ok: true, value: new PackFs(validated.value.root, validated.value.dev, nodePackFsDeps) };
    },
    decideFor: () => decide,
    resolveEngineId: async () => ({ ok: true as const, engineId: 'llm' }),
    broadcast: (event) => events.push(event),
    now: () => Date.now(),
    newId: () => `run-${Math.random().toString(36).slice(2, 8)}`,
    defaultMaxModelCalls: options.maxModelCalls,
  });
  return { store, service, events, asks };
}

async function startAndWait(harness_: Harness, maxModelCalls?: number): Promise<MiniAppRunRow> {
  const started = await harness_.service.start('runner-test', root, maxModelCalls !== undefined ? { maxModelCalls } : {});
  expect(started.ok).toBe(true);
  if (!started.ok) {
    throw new Error('start failed');
  }
  for (let spin = 0; spin < 500; spin += 1) {
    const run = await harness_.store.getRun(started.runId);
    if (run && ['done', 'paused', 'failed', 'canceled'].includes(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('run did not settle');
}

function okAsk(confidence: number) {
  return async () => ({
    ok: true as const,
    value: {
      engine: 'stub',
      confidence,
      answers: { safe: { type: 'choice' as const, choice: 'yes', probabilities: { yes: confidence }, confidence } },
    },
  });
}

describe('assessment runner — classify/compose semantics (stub decide)', () => {
  it('rules finalize the majority; the model sees only the residual; evidence lands per verdict', async () => {
    seedTree();
    const pack = makePack();
    const h = await harness(pack, { freshDays: 7, exceptions: ['*.key'] }, okAsk(0.9));
    const run = await startAndWait(h);
    expect(run.status).toBe('done');
    const items = await h.store.itemsOfRun(run.id);
    const byPath = new Map(items.map((item) => [item.relPath, item]));
    expect(byPath.get('important.key')).toMatchObject({ verdict: 'keep', decidedBy: 'rule:exceptions' });
    expect(byPath.get('fresh-note.txt')).toMatchObject({ verdict: 'keep', decidedBy: 'rule:fresh' });
    expect(byPath.get('weird.bin')).toMatchObject({ verdict: 'ask', decidedBy: 'rule:weird' });
    expect(byPath.get('node_modules/lib/index.js')).toMatchObject({ verdict: 'candidate', decidedBy: 'engine:stub' });
    expect(byPath.get('node_modules/lib/index.js')?.evidence).toMatchObject({ rule: 'cache', list: 'candidate' });
    expect(byPath.get('mystery.dat')).toMatchObject({ verdict: 'ask', decidedBy: 'engine:stub' });
    expect(h.asks.length).toBe(2);
    expect(run.totals).toMatchObject({ scanned: 5, keep: 2, ask: 2, candidate: 1, ruleDecided: 3, modelDecided: 2 });
  });

  it('compose is fail-closed: low confidence demotes a candidate rule hit to ask', async () => {
    seedTree();
    const pack = makePack();
    const h = await harness(pack, { freshDays: 7, exceptions: [] }, okAsk(0.3));
    const run = await startAndWait(h);
    const items = await h.store.itemsOfRun(run.id);
    expect(items.find((item) => item.relPath === 'node_modules/lib/index.js')).toMatchObject({ verdict: 'ask' });
    expect(run.totals).toMatchObject({ candidate: 0 });
  });

  it('readContext sends a capped excerpt and the excerpt rides the fingerprint', async () => {
    seedTree();
    const pack = makePack({
      privacy: { sendsContent: true, sensitiveGlobs: [], contentCapBytes: 16 },
      run: {
        scan: {},
        classify: { candidate: [{ id: 'cache', when: { signal: 'meta.path', op: 'matches', value: 'node_modules/**' } }] },
        decide: { questions: [{ id: 'safe', type: 'noul', instructions: 'Safe?' }], readContext: true },
        compose: {},
      },
    });
    const h = await harness(pack, { freshDays: 7, exceptions: [] }, okAsk(0.9));
    await startAndWait(h);
    expect(h.asks.length).toBeGreaterThan(0);
    expect(h.asks[0].input).toContain('content (capped excerpt)');
  });
});

describe('assessment runner — budget, resume and cache proven by audit rows (full stack)', () => {
  function scriptedLlmBridge(): PackDecideBridge {
    const createModel: StructuredModelFactory = () => ({
      invoke: async () => ({ calls: [], confidence: 0.5, reasoning: 'stub' }),
    });
    return new PackDecideBridge({
      config: () => llmConfig(),
      engineDeps: { getApiKey: async () => 'key', createStructuredModel: createModel },
    });
  }

  function allResidualPack(): ValidatedPack {
    return makePack({
      run: {
        scan: {},
        classify: { candidate: [{ id: 'everything', when: { signal: 'meta.size', op: 'gte', value: 0 } }] },
        decide: { questions: [{ id: 'safe', type: 'noul', instructions: 'Safe?' }] },
        compose: {},
      },
    });
  }

  it('budget exhaustion pauses resumably; resume decides ONLY the pending items', async () => {
    seedTree();
    const pack = allResidualPack();
    const bridge = scriptedLlmBridge();
    const store = new MemoryStore();
    const events: ServiceRunEvent[] = [];
    const service = new MiniAppRunService({
      store,
      runBridge: new PackRunBridge({ newId: () => 'r', now: () => Date.now() }),
      getPack: () => ({ pack, config: { freshDays: 7, exceptions: [] } }),
      openFs: async (_candidate, rootPath) => {
        const validated = await validateRunRoot(rootPath, { home: '/home/tester', userData: '/x', platform: 'linux' }, nodePackFsDeps);
        return validated.ok ? { ok: true, value: new PackFs(validated.value.root, validated.value.dev, nodePackFsDeps) } : validated;
      },
      decideFor: () => ({ ask: (input, questions) => bridge.ask(input, questions) }),
      resolveEngineId: async () => ({ ok: true as const, engineId: 'llm' }),
      broadcast: (event) => events.push(event),
      now: () => Date.now(),
      newId: () => `run-${Math.random().toString(36).slice(2, 8)}`,
    });
    const started = await service.start('runner-test', root, { maxModelCalls: 2 });
    expect(started.ok).toBe(true);
    let run = await settle(store, started.ok ? started.runId : '');
    expect(run.status).toBe('paused');
    expect(run.totals?.pending).toBe(3);
    expect(run.estimateCalls).toBe(5);
    expect(audit.length).toBe(2);

    const resumed = await service.resume(run.id);
    expect(resumed.ok).toBe(true);
    run = await settle(store, run.id);
    expect(run.status).toBe('done');
    expect(run.actualCalls).toBe(5);
    expect(run.totals).toMatchObject({ pending: 0, cacheHits: 2, modelDecided: 5 });
    expect(audit.length).toBe(5);
  });

  it('a fresh run over an unchanged tree is fully cache-served (zero new audit rows)', async () => {
    seedTree();
    const pack = allResidualPack();
    const bridge = scriptedLlmBridge();
    const store = new MemoryStore();
    const service = new MiniAppRunService({
      store,
      runBridge: new PackRunBridge({ newId: () => 'r', now: () => Date.now() }),
      getPack: () => ({ pack, config: { freshDays: 7, exceptions: [] } }),
      openFs: async (_candidate, rootPath) => {
        const validated = await validateRunRoot(rootPath, { home: '/home/tester', userData: '/x', platform: 'linux' }, nodePackFsDeps);
        return validated.ok ? { ok: true, value: new PackFs(validated.value.root, validated.value.dev, nodePackFsDeps) } : validated;
      },
      decideFor: () => ({ ask: (input, questions) => bridge.ask(input, questions) }),
      resolveEngineId: async () => ({ ok: true as const, engineId: 'llm' }),
      broadcast: () => undefined,
      now: () => Date.now(),
      newId: () => `run-${Math.random().toString(36).slice(2, 8)}`,
    });
    const first = await service.start('runner-test', root, {});
    expect(first.ok).toBe(true);
    const firstRun = await settle(store, first.ok ? first.runId : '');
    expect(firstRun.status).toBe('done');
    const auditAfterFirst = audit.length;
    expect(auditAfterFirst).toBe(5);

    const second = await service.start('runner-test', root, {});
    expect(second.ok).toBe(true);
    const secondRun = await settle(store, second.ok ? second.runId : '');
    expect(secondRun.status).toBe('done');
    expect(secondRun.totals).toMatchObject({ cacheHits: 5, modelDecided: 0 });
    expect(audit.length).toBe(auditAfterFirst);
  });
});

async function settle(store: MemoryStore, runId: string): Promise<MiniAppRunRow> {
  for (let spin = 0; spin < 500; spin += 1) {
    const run = await store.getRun(runId);
    if (run && ['done', 'paused', 'failed', 'canceled'].includes(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('run did not settle');
}

describe('RunService — lifecycle rules', () => {
  it('boot reconciliation marks orphaned running rows interrupted', async () => {
    seedTree();
    const pack = makePack();
    const h = await harness(pack, { freshDays: 7, exceptions: [] }, null);
    await h.store.createRun({
      id: 'orphan', packId: 'runner-test', packVersion: pack.manifest.version, rootPath: root,
      configHash: 'x', engineId: 'llm', status: 'running', totals: null, estimateCalls: 0, actualCalls: 1,
      error: null, startedAt: 1, updatedAt: 1, finishedAt: null,
    });
    const count = await h.service.reconcileBoot();
    expect(count).toBe(1);
    expect((await h.store.getRun('orphan'))?.status).toBe('interrupted');
  });

  it('refuses a second concurrent run for the same pack and unknown packs', async () => {
    seedTree();
    const pack = makePack();
    const hang = new Promise<never>(() => undefined);
    const ask = async () => hang;
    const h = await harness(pack, { freshDays: 7, exceptions: [] }, ask as unknown as StubAsk);
    const started = await h.service.start('runner-test', root, {});
    expect(started.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const runRow = started.ok ? await h.store.getRun(started.runId) : null;
    expect(runRow?.status).toBe('running');
    const dup = await h.service.start('runner-test', root, {});
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.error.code).toBe('invalid');
    }
    const missing = await h.service.start('ghost', root, {});
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe('not-found');
    }
    if (started.ok) {
      await h.service.cancel(started.runId);
    }
  });

  it('cancel settles the run and keeps already-decided items', async () => {
    seedTree();
    const pack = makePack();
    let calls = 0;
    const h = await harness(pack, { freshDays: 7, exceptions: [] }, (async () => {
      calls += 1;
      const run = [...h.store.runs.values()].find((candidate) => candidate.status === 'running');
      if (run && calls >= 1) {
        await h.service.cancel(run.id);
      }
      return okAsk(0.9)();
    }) as unknown as StubAsk);
    const run = await startAndWait(h);
    expect(['canceled', 'done']).toContain(run.status);
    const items = await h.store.itemsOfRun(run.id);
    expect(items.length).toBeGreaterThan(0);
  });
});

describe('evaluate — condition semantics', () => {
  const context = (overrides: Partial<SignalContext> = {}): SignalContext => ({
    meta: { path: 'node_modules/lib/index.js', name: 'index.js', ext: 'js', size: 100, ageDays: 30 },
    config: { exceptions: ['*.key', 'keep/**'], freshDays: 7 },
    matchedRules: new Set(['cache']),
    answers: { safe: { type: 'choice', choice: 'yes', probabilities: { yes: 0.9 }, confidence: 0.9 } },
    ...overrides,
  });

  it('composites, comparisons, membership and globs evaluate', () => {
    expect(evaluateCondition({ all: [{ signal: 'meta.size', op: 'gt', value: 10 }, { signal: 'meta.ext', op: 'eq', value: 'js' }] }, context())).toBe(true);
    expect(evaluateCondition({ any: [{ signal: 'meta.ext', op: 'eq', value: 'png' }, { not: { signal: 'rule.cache', op: 'eq', value: true } }] }, context())).toBe(false);
    expect(evaluateCondition({ signal: 'meta.ageDays', op: 'lt', valueSignal: 'config.freshDays' }, context())).toBe(false);
    expect(evaluateCondition({ signal: 'config.freshDays', op: 'lt', value: 10 }, context())).toBe(true);
    expect(evaluateCondition({ signal: 'meta.path', op: 'matches-any', valueSignal: 'config.exceptions' }, { ...context(), meta: { ...context().meta, path: 'keep/me.txt' } })).toBe(true);
    expect(evaluateCondition({ signal: 'answer.safe.confidence', op: 'gte', value: 0.8 }, context())).toBe(true);
    expect(evaluateCondition({ signal: 'answer.safe.choice', op: 'eq', value: 'yes' }, context())).toBe(true);
  });

  it('unresolved signals fail closed', () => {
    expect(evaluateCondition({ signal: 'answer.ghost.confidence', op: 'gte', value: 0 }, context())).toBe(false);
    expect(evaluateCondition({ signal: 'rule.nope', op: 'eq', value: true }, context())).toBe(false);
  });

  it('classify order is veto → keep → ask → candidate with first-match evidence', () => {
    const step = {
      veto: [{ id: 'v', when: { signal: 'meta.ext', op: 'eq', value: 'js' } }],
      keep: [{ id: 'k1', when: { signal: 'meta.ext', op: 'eq', value: 'js' } }],
      ask: [],
      candidate: [],
    };
    expect(classifyItem(step, context())).toMatchObject({ kind: 'final', verdict: 'keep', rule: 'v', list: 'veto' });
    const residual = classifyItem({ veto: [], keep: [], ask: [], candidate: [{ id: 'c', when: { signal: 'meta.size', op: 'gte', value: 0 } }] }, context());
    expect(residual).toMatchObject({ kind: 'residual', candidateRule: 'c' });
  });

  it('compose defaults to ask', () => {
    expect(composeVerdict({}, context())).toBe('ask');
    expect(composeVerdict({ keepWhen: { signal: 'rule.cache', op: 'eq', value: true } }, context())).toBe('keep');
  });
});

describe('DecisionLimiter — interactive priority', () => {
  it('interactive requests overtake queued background work when a slot frees', async () => {
    const limiter = new DecisionLimiter(1);
    const order: string[] = [];
    const releaseBackground = await limiter.acquire('background');
    const backgroundPromise = (async () => {
      const release = await limiter.acquire('background');
      order.push('background-2');
      release();
    })();
    const interactivePromise = (async () => {
      const release = await limiter.acquire('interactive');
      order.push('interactive');
      release();
    })();
    await new Promise((resolve) => setTimeout(resolve, 5));
    releaseBackground();
    await Promise.all([backgroundPromise, interactivePromise]);
    expect(order).toEqual(['interactive', 'background-2']);
  });
});
