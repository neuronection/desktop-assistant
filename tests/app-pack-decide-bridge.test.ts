import { describe, expect, it, beforeEach } from 'vitest';
import { LLMProviderType, type LLMProvider } from '@shared/types';
import { mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import { setAuditSink, type AiCallRecord } from '@main/ai/audit';
import type { StructuredModelFactory } from '@main/ai/chat-models';
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
  apiBase: 'https://api.example.com/v1',
  timeout: 1000,
  temperature: 0.7,
  maxTokens: 1000,
  systemPrompt: '',
  availableModels: [{ id: 'model-mini', name: 'Mini', caps: [] }],
  customModels: [],
};

function configWith(decision: Partial<AppConfig['decision']>): AppConfig {
  return mergeWithDefaults({
    providers: [provider],
    defaultProviderId: provider.id,
    defaultChatModelId: 'model-mini',
    decision: { engine: 'llm', actThreshold: 0.85, confirmThreshold: 0.5, ...decision },
  } as Partial<AppConfig>);
}

const audit: AiCallRecord[] = [];

beforeEach(() => {
  audit.length = 0;
  setAuditSink(async (record) => {
    audit.push(record);
  });
});

function scriptedModel(invoke: () => unknown): StructuredModelFactory {
  return () => ({ invoke: async () => invoke() });
}

const QUESTIONS = [{ id: 'safe', type: 'noul' as const, instructions: 'Safe to delete?' }];

describe('PackDecideBridge — funnel reuse + typed error mapping', () => {
  it('asks through the decision funnel: answers + confidence + exactly ONE audit row per call', async () => {
    const bridge = new PackDecideBridge({
      config: () => configWith({ engine: 'llm' }),
      engineDeps: {
        getApiKey: async () => 'key',
        createStructuredModel: scriptedModel(() => ({
          calls: [],
          confidence: 0.9,
          reasoning: 'clearly disposable',
        })),
      },
    });
    const result = await bridge.ask('file: build.log, 3 years old', QUESTIONS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.engine).toBe('llm');
      expect(result.value.confidence).toBe(0.9);
    }
    expect(audit.length).toBe(1);
    expect(audit[0]).toMatchObject({ task: 'intent', outcome: 'ok', providerId: 'provider-1', model: 'model-mini' });
  });

  it('maps engine-off to not-ready without any audit row', async () => {
    const bridge = new PackDecideBridge({
      config: () => configWith({ engine: 'off' }),
      engineDeps: { getApiKey: async () => 'key' },
    });
    const result = await bridge.ask('anything', QUESTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-ready');
    }
    expect(audit.length).toBe(0);
  });

  it('maps a keyless cloud engine to needs-secret', async () => {
    const bridge = new PackDecideBridge({
      config: () => configWith({ engine: 'jev' }),
      engineDeps: { getApiKey: async () => 'key', getJevKey: async () => null },
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
      config: () => configWith({ engine: 'llm' }),
      engineDeps: { getApiKey: async () => 'key', createStructuredModel: scriptedModel(() => {
        throw new Error('boom 502');
      }) },
    });
    const provider = await failing.ask('x', QUESTIONS);
    expect(provider.ok).toBe(false);
    if (!provider.ok) {
      expect(provider.error.code).toBe('provider');
    }
    const limited = new PackDecideBridge({
      config: () => configWith({ engine: 'llm' }),
      engineDeps: { getApiKey: async () => 'key', createStructuredModel: scriptedModel(() => {
        throw new Error('HTTP 429 rate limit exceeded');
      }) },
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
      decideDeps: { config: () => configWith({ engine: 'off' }), engineDeps: { getApiKey: async () => null } },
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
