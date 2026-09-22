import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import { LLMProviderType, type LLMProvider } from '@shared/types';
import { setAuditSink } from '@main/ai/audit';
import { DecisionSettingsController, type DecisionSettingsDeps } from '@main/ai/decide/settings-controller';
import { needleWeightsPath } from '@main/ai/decide/needle/weights';
import { NEEDLE_WEIGHTS_URL } from '@main/ai/decide/needle/pins';
import type { StructuredModelFactory } from '@main/ai/chat-models';

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
  availableModels: [{ id: 'model-mini', name: 'Model Mini', providerType: LLMProviderType.OPENAI, providerId: 'provider-1' }],
  customModels: [],
};

const config = (decision?: AppConfig['decision']): AppConfig =>
  mergeWithDefaults({
    providers: [provider],
    defaultProviderId: provider.id,
    defaultChatModelId: 'model-mini',
    ...(decision ? { decision } : {}),
  });

describe('DecisionSettingsController', () => {
  let userData: string;
  let emptyResourceDir: string;
  let resourceDir: string;

  beforeEach(async () => {
    setAuditSink(async () => undefined);
    userData = await mkdtemp(path.join(tmpdir(), 'decision-settings-'));
    emptyResourceDir = await mkdtemp(path.join(tmpdir(), 'decision-res-'));
    resourceDir = await mkdtemp(path.join(tmpdir(), 'decision-res-'));
    for (const file of ['host.cjs', 'needle.js', 'needle.wasm']) {
      await writeFile(path.join(resourceDir, file), 'x');
    }
  });

  afterEach(async () => {
    await Promise.all([
      rm(userData, { recursive: true, force: true }),
      rm(emptyResourceDir, { recursive: true, force: true }),
      rm(resourceDir, { recursive: true, force: true }),
    ]);
  });

  const deps = (overrides: Partial<DecisionSettingsDeps> = {}): DecisionSettingsDeps => ({
    config: () => config({ engine: 'needle', actThreshold: 0.85, confirmThreshold: 0.5 }),
    userDataDir: () => userData,
    resourceDir: () => resourceDir,
    getApiKey: async () => 'key',
    ...overrides,
  });

  it('reports runtime + weights presence', async () => {
    const controller = new DecisionSettingsController(deps());
    const state = await controller.getState();
    expect(state.needle.runtimePresent).toBe(true);
    expect(state.needle.weightsPresent).toBe(false);
    expect(state.needle.downloading).toBe(false);

    const missing = new DecisionSettingsController(deps({ resourceDir: () => emptyResourceDir }));
    expect((await missing.getState()).needle.runtimePresent).toBe(false);
  });

  it('single-flights the download, reports progress, and cancels', async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new Uint8Array([1, 2, 3]));
              init?.signal?.addEventListener('abort', () => {
                stream.error(new Error('The operation was aborted.'));
              });
            },
          }),
          { status: 200 }
        )
    );
    const controller = new DecisionSettingsController(deps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    const first = controller.downloadWeights();
    await vi.waitFor(async () => {
      const state = await controller.getState();
      expect(state.needle.downloading).toBe(true);
      expect(state.needle.receivedBytes).toBe(3);
    });
    const second = await controller.downloadWeights();
    expect(second).toMatchObject({ ok: false });
    expect(fetchImpl).toHaveBeenCalledWith(NEEDLE_WEIGHTS_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(controller.cancelDownload()).toBe(true);
    const cancelled = await first;
    expect(cancelled.ok).toBe(false);
    expect((await controller.getState()).needle.downloading).toBe(false);
  });

  it('reports generic per-engine readiness (plan 24 S2)', async () => {
    const controller = new DecisionSettingsController(deps());
    const state = await controller.getState();
    const byKind = Object.fromEntries(state.engines.map((engine) => [engine.kind, engine]));
    expect(byKind.llm).toMatchObject({ name: 'Chat model', readiness: { state: 'ready' } });
    expect(byKind.needle?.name).toBe('Needle');
    expect(byKind.needle?.capabilities).toContain('tool-dispatch');
    expect(byKind.needle?.readiness.state).toBe('unavailable');
    expect(byKind.jev?.readiness).toMatchObject({ state: 'needs-key' });
  });

  it('marks jev ready once an OpenRouter key is present (plan 24 S4)', async () => {
    const controller = new DecisionSettingsController(deps({ getJevKey: async () => 'sk-or-test' }));
    const state = await controller.getState();
    const jev = state.engines.find((engine) => engine.kind === 'jev');
    expect(jev?.readiness).toEqual({ state: 'ready' });
    expect(jev?.capabilities).toContain('boolean-gate');
  });

  it('runs the engine test through the funnel with the injected model', async () => {
    const createModel: StructuredModelFactory = () => ({
      invoke: async () => ({
        calls: [{ tool: 'light_turn_on', args: { entity_id: 'light.living_room', brightness_pct: 30 } }],
        confidence: 0.95,
      }),
    });
    const controller = new DecisionSettingsController(
      deps({ config: () => config({ engine: 'llm', actThreshold: 0.85, confirmThreshold: 0.5 }), createStructuredModel: createModel })
    );
    const test = await controller.test('dim the living room');
    expect(test.result).toMatchObject({
      status: 'decided',
      engine: 'llm',
      confidence: 0.95,
      band: 'act',
      calls: [{ tool: 'light_turn_on' }],
    });
    expect(test.durationMs).toBeGreaterThanOrEqual(0);
    expect(await controller.test('x')).toMatchObject({ result: { status: 'decided' } });
  });

  it('reports off when the engine is off', async () => {
    const controller = new DecisionSettingsController(deps({ config: () => config() }));
    const test = await controller.test('dim the living room');
    expect(test.result).toEqual({ status: 'off' });
    void needleWeightsPath;
  });
});
