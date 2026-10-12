import { describe, expect, it, beforeEach } from 'vitest';
import { LLMProviderType, type LLMProvider } from '@shared/types';
import { mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import { setAuditSink, type AiCallRecord } from '@main/ai/audit';
import { decisionSlot, JEV_MODEL_ID } from '@shared/ai/decisions';
import { clearDecisionResolutionCache } from '@main/ai/decide';
import { PackDecideBridge } from '@main/apps/capabilities/decide';
import { capabilitiesFor, PackCapabilityError } from '@main/apps/capabilities';
import { PackRunBridge } from '@main/apps/capabilities/run';
import { validateManifest } from '@shared/app-pack';
import { validateRunRoot, type PackFsDeps } from '@main/apps/capabilities/fs';

const provider: LLMProvider = {
  id: 'provider-1',
  name: 'Test',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://api.example.com',
  timeout: 1000,
  temperature: 0.7,
  maxTokens: 1000,
  systemPrompt: '',
  availableModels: [
    { id: 'model-mini', name: 'Mini', caps: [] },
    { id: JEV_MODEL_ID, name: 'Jev (latest)', caps: ['decision'], decisionTransport: 'systemone' },
  ],
  customModels: [],
};

function configWith(assignments: Record<string, string | null> = {}): AppConfig {
  return mergeWithDefaults({
    providers: [provider],
    defaultProviderId: provider.id,
    defaultChatModelId: 'model-mini',
    taskAssignments: assignments as never,
  });
}

const audit: AiCallRecord[] = [];

beforeEach(() => {
  audit.length = 0;
  clearDecisionResolutionCache();
  setAuditSink(async (record) => {
    audit.push(record);
  });
});

const okFetch = (async () =>
  new Response(
    JSON.stringify({
      model: JEV_MODEL_ID,
      answers: { safe: { type: 'noul', noul: 0.9 } },
      usage: { input_tokens: 20, output_tokens: 2 },
    }),
    { status: 200 }
  )) as unknown as typeof fetch;

const QUESTIONS = [{ id: 'safe', type: 'noul' as const, instructions: 'Safe to delete?' }];

describe('PackDecideBridge — funnel reuse + typed error mapping', () => {
  it('asks through the decision funnel: answers + confidence + exactly ONE audit row per call', async () => {
    const bridge = new PackDecideBridge({
      config: () => configWith({ [decisionSlot('boolean-gate')]: JEV_MODEL_ID }),
      engineDeps: {
        getApiKey: async () => 'key',
        fetchImpl: okFetch,
      },
    });
    const result = await bridge.ask('file: build.log, 3 years old', QUESTIONS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.engine).toBe(JEV_MODEL_ID);
      expect(result.value.confidence).toBeGreaterThanOrEqual(0.9);
    }
    expect(audit.length).toBe(1);
    expect(audit[0]).toMatchObject({ task: 'intent', outcome: 'ok', providerId: 'provider-1', model: JEV_MODEL_ID });
  });

  it('maps an unassigned slot to not-ready without any audit row', async () => {
    const bridge = new PackDecideBridge({
      config: () => configWith(),
      engineDeps: { getApiKey: async () => 'key' },
    });
    const result = await bridge.ask('anything', QUESTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-ready');
    }
    expect(audit.length).toBe(0);
  });

  it('maps a keyless decision provider to needs-secret', async () => {
    const bridge = new PackDecideBridge({
      config: () => configWith({ [decisionSlot('boolean-gate')]: JEV_MODEL_ID }),
      engineDeps: { getApiKey: async () => null },
    });
    const result = await bridge.ask('anything', QUESTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('needs-secret');
    }
    expect(audit.length).toBe(0);
  });

  it('maps upstream failures to provider and rate limits to rate-limited (audited as errors)', async () => {
    const failing = new PackDecideBridge({
      config: () => configWith({ [decisionSlot('boolean-gate')]: JEV_MODEL_ID }),
      engineDeps: {
        getApiKey: async () => 'key',
        fetchImpl: (async () => new Response('boom 502', { status: 502 })) as unknown as typeof fetch,
      },
    });
    const providerResult = await failing.ask('x', QUESTIONS);
    expect(providerResult.ok).toBe(false);
    if (!providerResult.ok) {
      expect(providerResult.error.code).toBe('provider');
    }
    const limited = new PackDecideBridge({
      config: () => configWith({ [decisionSlot('boolean-gate')]: JEV_MODEL_ID }),
      engineDeps: {
        getApiKey: async () => 'key',
        fetchImpl: (async () => new Response('HTTP 429 rate limit exceeded', { status: 429 })) as unknown as typeof fetch,
      },
    });
    const rated = await limited.ask('x', QUESTIONS);
    expect(rated.ok).toBe(false);
    if (!rated.ok) {
      expect(rated.error.code).toBe('rate-limited');
    }
    expect(audit.length).toBe(2);
    expect(audit.every((row) => row.outcome === 'error')).toBe(true);
  });
});

describe('capabilitiesFor — capability-gated registration', () => {
  const sample = {
    apiVersion: 1,
    id: 'gate-test',
    version: '1.0.0',
    kind: 'assessment',
    capabilities: ['fs-read', 'run'],
    privacy: { sendsContent: false, sensitiveGlobs: [] },
    run: {
      scan: {},
      classify: { keep: [{ id: 'k', when: { signal: 'meta.ext', op: 'eq', value: 'tmp' } }] },
      compose: {},
    },
    i18n: { defaultLocale: 'en', locales: { en: { title: 'Gate test', 'rule.k': 'K' } } },
  };

  const stubFs: PackFsDeps = {
    realpath: async (path) => path,
    stat: async () => ({ isFile: true, isDirectory: false, isSymbolicLink: false, dev: 1, size: 0, mtimeMs: 0 }),
    readdir: async () => [],
    readFileHead: async () => ({ buffer: Buffer.alloc(0), truncated: false }),
  };

  function deps() {
    return {
      ...stubFs,
      fsEnv: { home: '/home/tester', userData: '/home/tester/.config/da', platform: 'linux' as const },
      decideDeps: { config: () => configWith(), engineDeps: { getApiKey: async () => null } },
      run: new PackRunBridge({ newId: () => 'run-1', now: () => 0 }),
    };
  }

  it('hands out declared bridges and throws for undeclared ones AT REGISTRATION', () => {
    const validated = validateManifest(structuredClone(sample));
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    const capabilities = capabilitiesFor(validated.pack, deps());
    expect(typeof capabilities.fs).toBe('function');
    expect(capabilities.run).toBeInstanceOf(PackRunBridge);
    expect(() => capabilities.decide).toThrow(PackCapabilityError);
    try {
      void capabilities.decide;
    } catch (error) {
      const typed = error as PackCapabilityError;
      expect(typed.error.code).toBe('invalid');
      expect(String(typed.error.detail?.reason)).toContain('decision');
    }
  });

  it('there is no net surface at any tier: the fs bridge only opens validated roots', async () => {
    const validated = validateManifest(structuredClone(sample));
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    const capabilities = capabilitiesFor(validated.pack, deps());
    const refused = await capabilities.fs('/home/tester');
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe('path-denied');
    }
    const root = await validateRunRoot('/home/tester/projects', { home: '/home/tester', userData: '/x', platform: 'linux' }, {
      ...stubFs,
      realpath: async () => '/home/tester/projects',
      stat: async () => ({ isFile: false, isDirectory: true, isSymbolicLink: false, dev: 1, size: 0, mtimeMs: 0 }),
    });
    expect(root.ok).toBe(true);
    expect(Object.keys(capabilities)).toEqual(['fs', 'decide', 'run']);
  });
});
