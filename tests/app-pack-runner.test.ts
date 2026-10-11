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
import { MiniAppRunService, EventCoalescer, type ServiceRunEvent } from '@main/apps/run/RunService';
import type { MiniAppRunItemRow, MiniAppRunRow, MiniAppRunStore } from '@main/apps/run/store';
import { evaluateCondition, classifyItem, composeVerdict, type SignalContext } from '@main/apps/runner/evaluate';

class MemoryStore implements MiniAppRunStore {
  readonly runs = new Map<string, MiniAppRunRow>();
  readonly items: MiniAppRunItemRow[] = [];
  readonly feedback: { packId: string; rootPath: string; relPath: string; verdict: 'keep' | 'ask' | 'candidate'; source: 'override' | 'exclude' }[] = [];

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
  async appendItem(row: MiniAppRunItemRow): Promise<void> {
    const index = this.items.findIndex((item) => item.runId === row.runId && item.fingerprint === row.fingerprint);
    if (index >= 0) {
      this.items[index] = row;
    } else {
      this.items.push(row);
    }
  }
  async updateItemVerdict(runId: string, relPath: string, verdict: MiniAppRunItemRow['verdict'], decidedBy: string): Promise<boolean> {
    const index = this.items.findIndex((item) => item.runId === runId && item.relPath === relPath);
    if (index < 0) {
      return false;
    }
    this.items[index] = { ...this.items[index], verdict, decidedBy, evidence: { userOverride: true } };
    return true;
  }
  async upsertFeedback(row: { packId: string; rootPath: string; relPath: string; verdict: 'keep' | 'ask' | 'candidate'; source: 'override' | 'exclude' }): Promise<void> {
    const index = this.feedback.findIndex(
      (entry) => entry.packId === row.packId && entry.rootPath === row.rootPath && entry.relPath === row.relPath
    );
    if (index >= 0) {
      this.feedback[index] = row;
    } else {
      this.feedback.push(row);
    }
  }
  async feedbackList(packId: string) {
    return this.feedback.filter((entry) => entry.packId === packId).map((entry) => ({ ...entry }));
  }
  async feedbackClear(packId: string, relPath?: string): Promise<number> {
    const before = this.feedback.length;
    this.feedback = this.feedback.filter((entry) => !(entry.packId === packId && (relPath === undefined || entry.relPath === relPath)));
    return before - this.feedback.length;
  }
  async pruneRuns(keepPerPack: number): Promise<number> {
    const sorted = [...this.runs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    const perPack = new Map<string, number>();
    const doomed: string[] = [];
    for (const run of sorted) {
      if (['paused', 'interrupted', 'running', 'queued'].includes(run.status)) {
        continue;
      }
      const seen = (perPack.get(run.packId) ?? 0) + 1;
      perPack.set(run.packId, seen);
      if (seen > keepPerPack) {
        doomed.push(run.id);
      }
    }
    for (const id of doomed) {
      this.runs.delete(id);
      this.items = this.items.filter((item) => item.runId !== id);
    }
    return doomed.length;
  }
  async feedbackFor(packId: string, rootPath: string): Promise<Map<string, { packId: string; rootPath: string; relPath: string; verdict: 'keep' | 'ask' | 'candidate'; source: 'override' | 'exclude' }>> {
    const map = new Map<string, { packId: string; rootPath: string; relPath: string; verdict: 'keep' | 'ask' | 'candidate'; source: 'override' | 'exclude' }>();
    for (const entry of this.feedback) {
      if (entry.packId === packId && entry.rootPath === rootPath) {
        map.set(entry.relPath, entry);
      }
    }
    return map;
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
  return { store, service: makeService(store, events, asks, pack, config, ask, options), events, asks };
}

function makeService(
  store: MemoryStore,
  events: ServiceRunEvent[],
  asks: { input: string }[],
  pack: ValidatedPack,
  config: Record<string, unknown>,
  ask: StubAsk | null,
  options: {
    maxModelCalls?: number;
    notify?: (title: string, body: string) => void;
    decide?: { ask: PackDecideBridge['ask'] } | null;
    newId?: () => string;
  }
): MiniAppRunService {
  const runBridge = new PackRunBridge({ newId: () => `run-${Math.random()}`, now: () => Date.now() });
  const decide =
    options.decide !== undefined
      ? options.decide
      : ask
        ? {
            ask: (async (input: string, questions: never) => {
              asks.push({ input });
              return ask(input, questions);
            }) as unknown as { ask: PackDecideBridge['ask'] },
          }
        : null;
  return new MiniAppRunService({
    store,
    runBridge,
    getPack: (packId) => (packId === 'runner-test' ? { pack, config, title: 'Runner test' } : null),
    openFs: async (_candidate, rootPath) => {
      const validated = await validateRunRoot(rootPath, { home: '/home/tester', userData: '/x', platform: 'linux' }, nodePackFsDeps);
      if (!validated.ok) {
        return validated;
      }
      return { ok: true, value: new PackFs(validated.value.root, validated.value.dev, nodePackFsDeps) };
    },
    decideFor: () => decide,
    resolveEngineId: async () => ({ ok: true as const, engineId: 'llm' }),
    broadcast: (event) => events.push(event),
    createConversation: async (title) => ({ id: `conv-${title}` }),
    createRunMessage: async (_conversationId, _content, _metadata) => ({ id: `msg-${Math.random()}` }),
    updateRunMessage: async () => undefined,
    notify: options.notify ?? (() => undefined),
    packTitle: () => 'Runner test',
    now: () => Date.now(),
    newId: options.newId ?? (() => `run-${Math.random().toString(36).slice(2, 8)}`),
    defaultMaxModelCalls: options.maxModelCalls,
  });
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
    expect(byPath.get('important.key')).toMatchObject({ verdict: 'keep', decidedBy: 'rule:host-sensitive' });
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
    const service = makeService(store, events, [], pack, { freshDays: 7, exceptions: [] }, null, {
      decide: { ask: (input, questions) => bridge.ask(input, questions) },
    });
    const started = await service.start('runner-test', root, { maxModelCalls: 2 });
    expect(started.ok).toBe(true);
    let run = await settle(store, started.ok ? started.runId : '');
    expect(run.status).toBe('paused');
    expect(run.totals?.pending).toBe(2);
    expect(run.totals).toMatchObject({ keep: 1, ruleDecided: 1 });
    expect(run.estimateCalls).toBe(4);
    expect(audit.length).toBe(2);

    const resumed = await service.resume(run.id);
    expect(resumed.ok).toBe(true);
    run = await settle(store, run.id);
    expect(run.status).toBe('done');
    expect(run.actualCalls).toBe(4);
    expect(run.totals).toMatchObject({ pending: 0, cacheHits: 2, modelDecided: 4 });
    expect(audit.length).toBe(4);
  });

  it('a fresh run over an unchanged tree is fully cache-served (zero new audit rows)', async () => {
    seedTree();
    const pack = allResidualPack();
    const bridge = scriptedLlmBridge();
    const store = new MemoryStore();
    const service = makeService(store, [], [], pack, { freshDays: 7, exceptions: [] }, null, {
      decide: { ask: (input, questions) => bridge.ask(input, questions) },
    });
    const first = await service.start('runner-test', root, {});
    expect(first.ok).toBe(true);
    const firstRun = await settle(store, first.ok ? first.runId : '');
    expect(firstRun.status).toBe('done');
    const auditAfterFirst = audit.length;
    expect(auditAfterFirst).toBe(4);

    const second = await service.start('runner-test', root, {});
    expect(second.ok).toBe(true);
    const secondRun = await settle(store, second.ok ? second.runId : '');
    expect(secondRun.status).toBe('done');
    expect(secondRun.totals).toMatchObject({ cacheHits: 4, modelDecided: 0 });
    expect(audit.length).toBe(auditAfterFirst);
  });
});

describe('assessment runner — parallel decision window (plan 28)', () => {
  it('scheduled runs persist disallowArm; manual starts do not (plan 33 D1)', async () => {
    seedTree();
    const pack = makePack();
    const scheduled = await harness(pack, { freshDays: 7, exceptions: [] }, okAsk(0.9));
    const started = await scheduled.service.start('runner-test', root, { disallowArm: true });
    expect(started.ok).toBe(true);
    await settle(scheduled.store, started.ok ? started.runId : '');
    expect((await scheduled.store.getRun(started.ok ? started.runId : ''))?.disallowArm).toBe(true);

    const manual = await harness(pack, { freshDays: 7, exceptions: [] }, okAsk(0.9));
    const manualStarted = await manual.service.start('runner-test', root, {});
    expect(manualStarted.ok).toBe(true);
    await settle(manual.store, manualStarted.ok ? manualStarted.runId : '');
    expect((await manual.store.getRun(manualStarted.ok ? manualStarted.runId : ''))?.disallowArm).toBe(false);
  });

  function seedResidualTree(count: number): void {
    for (let index = 0; index < count; index += 1) {
      writeFileSync(join(root, `residual-${String(index).padStart(2, '0')}.dat`), 'x');
    }
  }

  function allResidual(): ValidatedPack {
    return makePack({
      run: {
        scan: {},
        classify: { candidate: [{ id: 'everything', when: { signal: 'meta.size', op: 'gte', value: 0 } }] },
        decide: { questions: [{ id: 'safe', type: 'noul', instructions: 'Safe?' }] },
        compose: {},
      },
    });
  }

  it('out-of-order ask settlement still persists in scan order with identical counts', async () => {
    seedTree();
    const pack = allResidual();
    const callOrder: string[] = [];
    const settleOrder: string[] = [];
    const store = new MemoryStore();
    const events: ServiceRunEvent[] = [];
    const service = makeService(store, events, [], pack, { freshDays: 7, exceptions: [] }, null, {
      decide: {
        ask: (async (input: string) => {
          callOrder.push(input);
          const position = callOrder.length - 1;
          await new Promise((resolve) => setTimeout(resolve, (4 - position) * 8));
          settleOrder.push(input);
          return {
            ok: true as const,
            value: { engine: 'stub', confidence: 0.9, answers: { safe: { type: 'choice' as const, choice: 'yes', probabilities: { yes: 0.9 }, confidence: 0.9 } } },
          };
        }) as unknown as PackDecideBridge['ask'],
      },
    });
    const started = await service.start('runner-test', root, {});
    expect(started.ok).toBe(true);
    const run = await settle(store, started.ok ? started.runId : '');
    expect(run.status).toBe('done');
    expect(settleOrder[0]).not.toBe(callOrder[0]);

    const rows = store.items.filter((item) => item.runId === run.id);
    expect(rows.map((row) => row.relPath)).toHaveLength(5);
    expect(run.totals).toMatchObject({ modelDecided: 4, ruleDecided: 1, pending: 0 });
    expect(run.actualCalls).toBe(4);

    const other = new MemoryStore();
    const otherService = makeService(other, [], [], pack, { freshDays: 7, exceptions: [] }, null, {
      decide: {
        ask: (async () => ({
          ok: true as const,
          value: { engine: 'stub', confidence: 0.9, answers: { safe: { type: 'choice' as const, choice: 'yes', probabilities: { yes: 0.9 }, confidence: 0.9 } } },
        })) as unknown as PackDecideBridge['ask'],
      },
    });
    const otherStarted = await otherService.start('runner-test', root, {});
    expect(otherStarted.ok).toBe(true);
    const second = await settle(other, otherStarted.ok ? otherStarted.runId : '');
    expect(second.status).toBe('done');
    expect(store.items.filter((item) => item.runId === run.id).map((item) => item.relPath)).toEqual(
      other.items.filter((item) => item.runId === second.id).map((item) => item.relPath)
    );
  });

  it('the window is bounded by 4 and actually overlaps asks', async () => {
    seedResidualTree(12);
    const pack = allResidual();
    const hooks = { started: 0, settled: 0, maxInFlight: 0, inFlight: 0 };
    const store = new MemoryStore();
    const service = makeService(store, [], [], pack, { freshDays: 7, exceptions: [] }, null, {
      decide: {
        ask: (async () => {
          hooks.started += 1;
          hooks.inFlight += 1;
          hooks.maxInFlight = Math.max(hooks.maxInFlight, hooks.inFlight);
          await new Promise((resolve) => setTimeout(resolve, 6));
          hooks.inFlight -= 1;
          hooks.settled += 1;
          return {
            ok: true as const,
            value: { engine: 'stub', confidence: 0.9, answers: { safe: { type: 'choice' as const, choice: 'yes', probabilities: { yes: 0.9 }, confidence: 0.9 } } },
          };
        }) as unknown as PackDecideBridge['ask'],
      },
    });
    const started = await service.start('runner-test', root, {});
    expect(started.ok).toBe(true);
    const run = await settle(store, started.ok ? started.runId : '');
    expect(run.status).toBe('done');
    expect(hooks.maxInFlight).toBeGreaterThan(1);
    expect(hooks.maxInFlight).toBeLessThanOrEqual(4);
    expect(hooks.started).toBe(12);
    expect(store.items.filter((item) => item.runId === run.id)).toHaveLength(12);
  });

  it('cancel mid-window: no new launches, in-flight persists, the rest stays pending', async () => {
    seedResidualTree(12);
    const pack = allResidual();
    const hooks = { started: 0, settled: 0, maxInFlight: 0, inFlight: 0 };
    const pending: Array<() => void> = [];
    const releaseAll = (): void => {
      for (const resolve of pending.splice(0)) {
        resolve();
      }
    };
    const store = new MemoryStore();
    const events: ServiceRunEvent[] = [];
    const service = makeService(store, events, [], pack, { freshDays: 7, exceptions: [] }, null, {
      decide: {
        ask: (async () => {
          hooks.started += 1;
          hooks.inFlight += 1;
          hooks.maxInFlight = Math.max(hooks.maxInFlight, hooks.inFlight);
          await new Promise<void>((resolve) => pending.push(resolve));
          hooks.inFlight -= 1;
          hooks.settled += 1;
          return {
            ok: true as const,
            value: { engine: 'stub', confidence: 0.9, answers: { safe: { type: 'choice' as const, choice: 'yes', probabilities: { yes: 0.9 }, confidence: 0.9 } } },
          };
        }) as unknown as PackDecideBridge['ask'],
      },
    });
    const started = await service.start('runner-test', root, {});
    expect(started.ok).toBe(true);

    await waitFor(() => hooks.started >= 4);
    await service.cancel(started.ok ? started.runId : '');
    releaseAll();
    const run = await settle(store, started.ok ? started.runId : '');

    expect(run.status).toBe('canceled');
    expect(hooks.started).toBe(4);
    expect(store.items.filter((item) => item.runId === run.id)).toHaveLength(4);
    expect(run.totals?.pending).toBe(8);
  });

  function waitFor(predicate: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      let spins = 0;
      const tick = (): void => {
        spins += 1;
        if (predicate()) {
          resolve();
          return;
        }
        if (spins > 2000) {
          reject(new Error('waitFor: condition never held'));
          return;
        }
        setTimeout(tick, 5);
      };
      tick();
    });
  }
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
  it('user overrides win over rules and the model, persist, and are applied by later runs', async () => {
    seedTree();
    const pack = makePack();
    const h = await harness(pack, { freshDays: 7, exceptions: [] }, okAsk(0.9));
    const first = await startAndWait(h);
    expect(first.status).toBe('done');
    expect(h.asks.length).toBe(2);

    await h.store.upsertFeedback({ packId: 'runner-test', rootPath: first.rootPath, relPath: 'mystery.dat', verdict: 'candidate', source: 'override' });
    await h.store.upsertFeedback({ packId: 'runner-test', rootPath: first.rootPath, relPath: 'weird.bin', verdict: 'keep', source: 'exclude' });

    const second = await h.service.start('runner-test', root, {});
    expect(second.ok).toBe(true);
    const secondRun = await settle(h.store, second.ok ? second.runId : '');
    expect(secondRun.status).toBe('done');
    const items = await h.store.itemsOfRun(secondRun.id);
    expect(items.find((item) => item.relPath === 'mystery.dat')).toMatchObject({ verdict: 'candidate', decidedBy: 'override:override' });
    expect(items.find((item) => item.relPath === 'weird.bin')).toMatchObject({ verdict: 'keep', decidedBy: 'override:exclude' });
    expect(secondRun.totals).toMatchObject({ ruleDecided: 4 });
  });

  it('boot reconciliation marks orphaned running rows interrupted', async () => {
    seedTree();
    const pack = makePack();
    const h = await harness(pack, { freshDays: 7, exceptions: [] }, null);
    await h.store.createRun({
      id: 'orphan', packId: 'runner-test', packVersion: pack.manifest.version, rootPath: root,
      configHash: 'x', engineId: 'llm', status: 'running', totals: null, estimateCalls: 0, actualCalls: 1,
      inputTokens: 0, outputTokens: 0, error: null, conversationId: null, startedAt: 1, updatedAt: 1, finishedAt: null,
    });
    const count = await h.service.reconcileBoot();
    expect(count).toBe(1);
    expect((await h.store.getRun('orphan'))?.status).toBe('interrupted');
  });

  it('a completed run survives a restart: a fresh service reads the same store', async () => {
    seedTree();
    const pack = makePack();
    const events: ServiceRunEvent[] = [];
    const h = await harness(pack, { freshDays: 7, exceptions: [] }, okAsk(0.9));
    const run = await startAndWait(h);
    expect(run.status).toBe('done');
    const restarted = makeService(h.store, events, [], pack, { freshDays: 7, exceptions: [] }, null, {});
    const rows = await restarted.recentRuns('runner-test', 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'done', actualCalls: 2 });
    const items = await restarted.itemsOfRun(run.id);
    expect(items).toHaveLength(5);
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

describe('audit round 1 — host baseline, truncation, prune, coalescer', () => {
  it('host-sensitive files finalize as keep regardless of pack rules and never reach the model', async () => {
    seedTree();
    const pack = makePack();
    const h = await harness(pack, { freshDays: 7, exceptions: [] }, okAsk(0.9));
    const run = await startAndWait(h);
    const items = await h.store.itemsOfRun(run.id);
    const sensitive = items.find((item) => item.relPath === 'important.key');
    expect(sensitive).toMatchObject({ verdict: 'keep', decidedBy: 'rule:host-sensitive' });
    expect(h.asks.length).toBe(2);
  });

  it('a truncated scan is surfaced honestly in totals', async () => {
    seedTree();
    const pack = makePack({
      capabilities: ['fs-read', 'run'],
      run: { scan: { fileCap: 2 }, classify: { keep: [{ id: 'everything', when: { signal: 'meta.size', op: 'gte', value: 0 } }] }, compose: {} },
      report: undefined,
    });
    const h = await harness(pack, { freshDays: 7, exceptions: [] }, null);
    const run = await startAndWait(h);
    expect(run.totals?.scanTruncated).toBe(true);
    expect(run.status).toBe('done');
  });

  it('run retention prunes finished runs past the cap, keeping paused ones', async () => {
    seedTree();
    const pack = makePack();
    const h = await harness(pack, { freshDays: 7, exceptions: [] }, null);
    for (let index = 0; index < 3; index += 1) {
      await h.store.createRun({
        id: `old-${index}`, packId: 'runner-test', packVersion: pack.manifest.version, rootPath: root,
        configHash: 'x', engineId: 'none', status: 'done', totals: null, estimateCalls: 0, actualCalls: 0,
        inputTokens: 0, outputTokens: 0, error: null, conversationId: null,
        startedAt: index, updatedAt: index, finishedAt: index,
      });
    }
    await h.store.createRun({
      id: 'paused-keep', packId: 'runner-test', packVersion: pack.manifest.version, rootPath: root,
      configHash: 'x', engineId: 'none', status: 'paused', totals: null, estimateCalls: 0, actualCalls: 0,
      inputTokens: 0, outputTokens: 0, error: null, conversationId: null,
      startedAt: 1, updatedAt: 1, finishedAt: null,
    });
    const pruned = await h.store.pruneRuns(2);
    expect(pruned).toBe(1);
    expect(await h.store.getRun('old-0')).toBeNull();
    expect(await h.store.getRun('paused-keep')).not.toBeNull();
  });
});

describe('EventCoalescer — run:item broadcast storms are batched', () => {
  it('buffers item events into batched run:items counts and flushes on interval or demand', () => {
    let clock = 1_000;
    const emitted: Record<string, unknown>[] = [];
    const coalescer = new EventCoalescer(() => clock, 250);
    for (let index = 0; index < 500; index += 1) {
      coalescer.push({ type: 'item', relPath: `f${index}`, verdict: 'candidate', decidedBy: 'engine:stub' }, (payload) => emitted.push(payload));
      clock += 1;
    }
    coalescer.push({ type: 'progress', phase: 'decide', done: 500, total: 500 }, (payload) => emitted.push(payload));
    const forwarded = emitted.filter((event) => event.type === 'run:items');
    expect(forwarded.length).toBeLessThan(10);
    expect(forwarded.reduce((sum, event) => sum + Number(event.count), 0)).toBe(500);
    coalescer.flush((payload) => emitted.push(payload));
    const total = emitted.reduce((sum, event) => (event.type === 'run:items' ? sum + Number(event.count) : sum), 0);
    expect(total).toBe(500);
    expect(emitted.filter((event) => event.type === 'run:progress').length).toBeLessThanOrEqual(3);
  });
});
