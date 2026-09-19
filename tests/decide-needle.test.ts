import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import { setAuditSink, type AiCallRecord } from '@main/ai/audit';
import { parseNeedleOutput, toolsToNeedleJson } from '@main/ai/decide/needle/parse';
import { NeedleDecisionEngine } from '@main/ai/decide/needle/engine';
import { needleWeightsPath, verifyWeights, locateVerifiedWeights, downloadWeights } from '@main/ai/decide/needle/weights';
import { UtilityNeedleTransport } from '@main/ai/decide/needle/transport';
import { runDecision } from '@main/ai/decide';
import { NEEDLE_MODEL_ID } from '@main/ai/decide/needle/pins';

const spikeOutput = JSON.stringify({
  type: 'call',
  success: true,
  function_calls: [{ name: 'light_turn_on', arguments: { entity_id: 'living room', brightness_pct: 30 } }],
  suppressed_calls: [],
  reasoning: "'living room' -> entity_id",
  confidence: 0.8201,
});

const tools = [
  { name: 'light_turn_on', description: 'Turn on a light.', parameters: { type: 'object' } },
  { name: 'light_turn_off', description: 'Turn off a light.' },
];

describe('parseNeedleOutput', () => {
  it('maps the needle wire shape to a DecisionOutcome', () => {
    const outcome = parseNeedleOutput(spikeOutput, tools);
    expect(outcome).toMatchObject({
      engine: 'needle',
      confidence: 0.8201,
      reasoning: "'living room' -> entity_id",
    });
    expect(outcome.calls).toEqual([{ tool: 'light_turn_on', args: { entity_id: 'living room', brightness_pct: 30 } }]);
  });

  it('defaults empty calls and clamps confidence', () => {
    const outcome = parseNeedleOutput(JSON.stringify({ confidence: 1.4 }), tools);
    expect(outcome.calls).toEqual([]);
    expect(outcome.confidence).toBe(1);
  });

  it('throws on non-JSON and unknown tools (D5)', () => {
    expect(() => parseNeedleOutput('not json', tools)).toThrow('non-JSON');
    const hallucinated = JSON.stringify({ function_calls: [{ name: 'space_laser', arguments: {} }], confidence: 0.9 });
    expect(() => parseNeedleOutput(hallucinated, tools)).toThrow('unknown tool space_laser');
  });

  it('serializes the tool catalog for the engine', () => {
    const json = toolsToNeedleJson(tools);
    expect(JSON.parse(json)).toHaveLength(2);
    expect(JSON.parse(json)[0]).toMatchObject({ name: 'light_turn_on', description: 'Turn on a light.', parameters: { type: 'object' } });
    expect(JSON.parse(json)[1]).not.toHaveProperty('parameters');
  });
});

function fakeTransport() {
  const calls: string[] = [];
  const responses: Record<string, string> = { 'dim the living room': spikeOutput };
  const transport = {
    calls,
    load: async (weightsPath: string) => {
      calls.push(`load:${path.basename(weightsPath)}`);
    },
    init: async (systemPrompt: string, toolsJson: string) => {
      calls.push(`init:${systemPrompt}:${toolsJson}`);
    },
    complete: async (input: string, maxNewTokens?: number) => {
      calls.push(`complete:${input}:${maxNewTokens}`);
      return responses[input] ?? JSON.stringify({ function_calls: [], confidence: 0 });
    },
    reset: async () => {
      calls.push('reset');
    },
    dispose: () => {
      calls.push('dispose');
    },
  };
  return transport;
}

describe('NeedleDecisionEngine', () => {
  it('boots once (load), then reset → init → complete per decide', async () => {
    const transport = fakeTransport();
    const engine = new NeedleDecisionEngine({
      weightsPath: '/data/needle/needle3.cact',
      resourceDir: '/resources/needle',
      createTransport: () => transport,
      maxNewTokens: 256,
    });
    const first = await engine.decide({ input: 'dim the living room', tools });
    expect(first.engine).toBe('needle');
    expect(first.confidence).toBeCloseTo(0.8201, 4);
    const second = await engine.decide({ input: 'nothing to do', tools });
    expect(second.calls).toEqual([]);
    expect(transport.calls).toEqual([
      'load:needle3.cact',
      'reset',
      `init:You are a local tool-dispatch engine for a desktop assistant.:${toolsToNeedleJson(tools)}`,
      'complete:dim the living room:256',
      'reset',
      `init:You are a local tool-dispatch engine for a desktop assistant.:${toolsToNeedleJson(tools)}`,
      'complete:nothing to do:256',
    ]);
    engine.dispose();
    await new Promise((resolve) => setImmediate(resolve));
    expect(transport.calls.at(-1)).toBe('dispose');
  });

  it('propagates transport failures (fail-open contract)', async () => {
    const transport = fakeTransport();
    transport.complete = async () => {
      throw new Error('needle_complete failed (-1)');
    };
    const engine = new NeedleDecisionEngine({ weightsPath: '/w', resourceDir: '/r', createTransport: () => transport });
    await expect(engine.decide({ input: 'dim the living room', tools })).rejects.toThrow('needle_complete failed');
  });
});

describe('weights manager', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'needle-weights-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('verifies size + sha256, rejects mismatches and missing files', async () => {
    const target = needleWeightsPath(dir);
    await mkdir(path.dirname(target), { recursive: true });
    const payload = Buffer.from('needle-test-weights');
    const sha = createHash('sha256').update(payload).digest('hex');
    await writeFile(target, payload);
    expect(await verifyWeights(target, payload.length, sha)).toBe(true);
    expect(await verifyWeights(target, payload.length + 1, sha)).toBe(false);
    expect(await verifyWeights(target, payload.length, 'deadbeef')).toBe(false);
    expect(await verifyWeights(target + '.missing', payload.length, sha)).toBe(false);
    expect(await locateVerifiedWeights(dir, payload.length, sha)).toBe(target);
  });

  it('downloads atomically: tmp → verify → rename, with progress', async () => {
    const target = needleWeightsPath(dir);
    const payload = Buffer.from('downloaded-weights-payload');
    const sha = createHash('sha256').update(payload).digest('hex');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(payload.subarray(0, 10));
        controller.enqueue(payload.subarray(10));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    const progress: number[] = [];
    await downloadWeights(
      { fetchImpl },
      {
        targetPath: target,
        url: 'https://example.test/needle3.cact',
        expectedBytes: payload.length,
        expectedSha256: sha,
        onProgress: (p) => progress.push(p.receivedBytes),
      }
    );
    expect(fetchImpl).toHaveBeenCalledWith('https://example.test/needle3.cact', { signal: undefined });
    expect(await readFile(target)).toEqual(payload);
    expect(progress).toEqual([10, payload.length]);
  });

  it('never leaves a partial file on checksum mismatch', async () => {
    const target = needleWeightsPath(dir);
    const payload = Buffer.from('corrupted');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    await expect(
      downloadWeights(
        { fetchImpl },
        { targetPath: target, url: 'https://example.test/x', expectedBytes: payload.length, expectedSha256: 'wrong' }
      )
    ).rejects.toThrow('checksum mismatch');
    expect(await verifyWeights(target, payload.length, 'wrong')).toBe(false);
    const { stat } = await import('node:fs/promises');
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(`${target}.download`)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('UtilityNeedleTransport', () => {
  it('matches requests to responses and serializes ops', async () => {
    const delivered: unknown[] = [];
    let responder: ((message: { id: number; ok: true; result: unknown }) => void) | null = null;
    const fork = vi.fn(
      () =>
        ({
          on: (event: string, listener: (arg: unknown) => void) => {
            if (event === 'message') {
              responder = listener as typeof responder;
            }
          },
          postMessage: (message: unknown) => {
            delivered.push(message);
            const { id } = message as { id: number };
            queueMicrotask(() => responder?.({ id, ok: true, result: 'ok' }));
          },
          kill: vi.fn(),
        }) as never
    );
    const transport = new UtilityNeedleTransport('/resources/needle', fork as never);
    expect(fork).toHaveBeenCalledWith('/resources/needle/host.cjs');
    const [a, b] = await Promise.all([transport.reset(), transport.init('sys', '[]')]);
    void a;
    void b;
    expect(delivered).toHaveLength(2);
    expect((delivered[0] as { op: string }).op).toBe('reset');
    transport.dispose();
  });

  it('times out a silent host and rejects pending on exit', async () => {
    vi.useFakeTimers();
    let onExit: (() => void) | null = null;
    const fork = vi.fn(
      () =>
        ({
          on: (event: string, listener: (arg: unknown) => void) => {
            if (event === 'exit') {
              onExit = listener as unknown as typeof onExit;
            }
          },
          postMessage: () => undefined,
          kill: vi.fn(),
        }) as never
    );
    const transport = new UtilityNeedleTransport('/r', fork as never);
    const pending = expect(transport.reset()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(31_000);
    await pending;
    const pendingExit = expect(transport.init('s', '[]')).rejects.toThrow('exited');
    vi.useRealTimers();
    onExit?.(1);
    await pendingExit;
  });
});

describe('needle path through the funnel', () => {
  const audit: AiCallRecord[] = [];
  let dir: string;

  beforeEach(async () => {
    setAuditSink(async (record) => {
      audit.push(record);
    });
    dir = await mkdtemp(path.join(tmpdir(), 'needle-funnel-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('decides through the needle engine and audits model needle3 (no providerId)', async () => {
    const transport = fakeTransport();
    const config: AppConfig = mergeWithDefaults({
      decision: { engine: 'needle', actThreshold: 0.85, confirmThreshold: 0.5 },
    });
    const result = await runDecision(
      {
        getApiKey: async () => null,
        needle: {
          userDataDir: async () => dir,
          resourceDir: async () => '/resources/needle',
          createTransport: () => transport,
          locateWeights: async () => needleWeightsPath(dir),
        },
      },
      { config, input: 'dim the living room', tools }
    );
    expect(result).toMatchObject({
      status: 'decided',
      band: 'confirm',
      outcome: { engine: 'needle', confidence: 0.8201 },
    });
    expect(audit.at(-1)).toMatchObject({ task: 'intent', model: NEEDLE_MODEL_ID, outcome: 'ok' });
    expect(audit.at(-1)?.providerId).toBeUndefined();
  });

  it('engine failure audits an error row and fails open', async () => {
    const transport = fakeTransport();
    transport.complete = async () => {
      throw new Error('needle_complete failed (-1)');
    };
    const config: AppConfig = mergeWithDefaults({
      decision: { engine: 'needle', actThreshold: 0.85, confirmThreshold: 0.5 },
    });
    const result = await runDecision(
      {
        getApiKey: async () => null,
        needle: {
          userDataDir: async () => dir,
          resourceDir: async () => '/resources/needle',
          createTransport: () => transport,
          locateWeights: async () => needleWeightsPath(dir),
        },
      },
      { config, input: 'dim the living room', tools }
    );
    expect(result).toMatchObject({ status: 'error' });
    expect(audit.at(-1)).toMatchObject({ task: 'intent', model: NEEDLE_MODEL_ID, outcome: 'error' });
  });
});

describe('vendored runtime (no-network smoke)', () => {
  it('runs the real wasm and rejects garbage weights with negative rc', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('network is forbidden in the needle runtime tests');
    });
    const resourceDir = path.resolve(__dirname, '../src/main/resources/needle');
    const { createRuntime } = (await import(path.join(resourceDir, 'host-core.cjs'))) as {
      createRuntime: (dir: string) => {
        init(): Promise<void>;
        loadWeights(weightsPath: string): number;
        callInit(systemPrompt: string, toolsJson: string): number;
        callComplete(input: string, maxNewTokens: number): string;
      };
    };
    const runtime = createRuntime(resourceDir);
    await runtime.init();
    const bad = path.join(await mkdtemp(path.join(tmpdir(), 'needle-rt-')), 'bad.cact');
    await writeFile(bad, 'garbage-not-cact');
    expect(runtime.loadWeights(bad)).toBeLessThan(0);
    expect(runtime.callInit('sys', '[]')).toBeLessThan(0);
    expect(() => runtime.callComplete('hello', 16)).toThrow('needle_complete failed');
    await rm(path.dirname(bad), { recursive: true, force: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
