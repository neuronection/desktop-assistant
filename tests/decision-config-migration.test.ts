import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, readFile, writeFile as write } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  migrateLegacyDecisionConfig,
  type LegacyDecisionMigrationDeps,
} from '@main/ai/decide/migrate-legacy-config';

const RETIRED_JEV_KEYRING_KEY = 'openrouter:key';
import { mergeWithDefaults } from '@shared/config/AppConfig';
import { LLMProviderType } from '@shared/types';

let dir: string;
const secretStore = new Map<string, string>();
const operations: string[] = [];

function deps(overrides: Partial<LegacyDecisionMigrationDeps> = {}): LegacyDecisionMigrationDeps {
  return {
    configPath: () => path.join(dir, 'config.json'),
    userDataDir: () => dir,
    getSecret: async (key) => secretStore.get(key) ?? null,
    setSecret: async (key, value) => {
      operations.push(`set:${key}`);
      secretStore.set(key, value);
    },
    deleteSecret: async (key) => {
      operations.push(`delete:${key}`);
      secretStore.delete(key);
    },
    keyHint: (value) => `••••${value.slice(-4)}`,
    ...overrides,
  };
}

async function writeConfig(raw: Record<string, unknown>): Promise<void> {
  await write(path.join(dir, 'config.json'), JSON.stringify(raw, null, 2));
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'decision-migrate-'));
  secretStore.clear();
  operations.length = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('legacy decision config migration (plan 26 S2)', () => {
  it('is a no-op on fresh configs: no backup, no writes, nothing dropped', async () => {
    const raw = { theme: 'classic', providers: [] };
    await writeConfig(raw);
    const result = await migrateLegacyDecisionConfig(raw, deps());
    expect(result.migrated).toBe(false);
    expect(result.config).toBe(raw);
    expect(existsSync(path.join(dir, 'config.json.pre-plan26'))).toBe(false);
  });

  it('migrates engine jev @ openrouter: provider row + model + decision:* assignments + secret copy-verify-delete', async () => {
    secretStore.set(RETIRED_JEV_KEYRING_KEY, 'sk-or-legacy');
    const raw = {
      theme: 'classic',
      providers: [],
      decision: { engine: 'jev', actThreshold: 0.9, confirmThreshold: 0.6, jev: { endpoint: 'openrouter', baseUrl: '' } },
      taskAssignments: { chat: null, intent: 'model-mini' },
    };
    await writeConfig(raw);
    const result = await migrateLegacyDecisionConfig(raw, deps());
    expect(result.migrated).toBe(true);
    expect(result.secretMigrated).toBe(true);

    const providers = result.config.providers as { id: string; type: string; apiBase: string; presetKey?: string; apiKeyHint?: string; availableModels: { id: string; caps: string[]; decisionTransport?: string }[] }[];
    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({ type: LLMProviderType.OPENAI, apiBase: 'https://openrouter.ai/api/v1', presetKey: 'openrouter', apiKeyHint: '••••gacy' });
    expect(providers[0].availableModels[0]).toMatchObject({ id: 'openrouter.jev-latest', caps: ['decision'], decisionTransport: 'systemone' });

    const assignments = result.config.taskAssignments as Record<string, string | null>;
    expect(assignments['decision:tool-dispatch']).toBe('openrouter.jev-latest');
    expect(assignments['decision:boolean-gate']).toBe('openrouter.jev-latest');
    expect(assignments['decision:choice']).toBe('openrouter.jev-latest');
    expect(assignments['decision:score']).toBe('openrouter.jev-latest');
    expect('intent' in assignments).toBe(false);

    expect(operations).toEqual([
      `set:provider:${providers[0].id}`,
      `delete:${RETIRED_JEV_KEYRING_KEY}`,
    ]);
    expect(secretStore.has(RETIRED_JEV_KEYRING_KEY)).toBe(false);
    expect(secretStore.get(`provider:${providers[0].id}`)).toBe('sk-or-legacy');

    const decision = result.config.decision as Record<string, unknown>;
    expect(decision.engine).toBeUndefined();
    expect(decision.jev).toBeUndefined();
    expect(decision.actThreshold).toBe(0.9);
    expect(decision.legacyEngineNotice).toBeUndefined();

    expect(existsSync(path.join(dir, 'config.json.pre-plan26'))).toBe(true);
    const backup = JSON.parse(await readFile(path.join(dir, 'config.json.pre-plan26'), 'utf8'));
    expect(backup.decision.engine).toBe('jev');
  });

  it('reuses an existing openrouter provider row instead of duplicating', async () => {
    secretStore.set(RETIRED_JEV_KEYRING_KEY, 'sk-or-legacy');
    const existingId = 'existing-or';
    const raw = {
      providers: [{ id: existingId, name: 'My OpenRouter', type: 'openai', apiKey: '', apiBase: 'https://openrouter.ai/api/v1', presetKey: 'openrouter', availableModels: [], customModels: [] }],
      decision: { engine: 'jev', jev: { endpoint: 'openrouter', baseUrl: '' } },
    };
    await writeConfig(raw);
    const result = await migrateLegacyDecisionConfig(raw, deps());
    const providers = result.config.providers as { id: string }[];
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe(existingId);
    expect(secretStore.has(`provider:${existingId}`)).toBe(true);
  });

  it('migrates engine jev @ typesafe onto a decision-type provider row', async () => {
    secretStore.set(RETIRED_JEV_KEYRING_KEY, 'ts-key');
    const raw = {
      providers: [],
      decision: { engine: 'jev', jev: { endpoint: 'typesafe', baseUrl: '' } },
    };
    await writeConfig(raw);
    const result = await migrateLegacyDecisionConfig(raw, deps());
    const providers = result.config.providers as { type: string; apiBase: string; presetKey?: string; availableModels: { id: string }[] }[];
    expect(providers[0]).toMatchObject({ type: LLMProviderType.DECISION, apiBase: 'https://api.typesafe.ai', presetKey: 'typesafe' });
    expect(providers[0].availableModels[0].id).toBe('jev-latest');
    expect((result.config.taskAssignments as Record<string, string>)['decision:choice']).toBe('jev-latest');
  });

  it('migrates a custom endpoint onto a manual decision-type row with the stored base', async () => {
    secretStore.set(RETIRED_JEV_KEYRING_KEY, 'k');
    const raw = {
      providers: [],
      decision: { engine: 'jev', jev: { endpoint: 'custom', baseUrl: 'http://localhost:8080/' } },
    };
    await writeConfig(raw);
    const result = await migrateLegacyDecisionConfig(raw, deps());
    const providers = result.config.providers as { type: string; apiBase: string; presetKey?: string }[];
    expect(providers[0]).toMatchObject({ type: LLMProviderType.DECISION, apiBase: 'http://localhost:8080' });
    expect(providers[0].presetKey).toBeUndefined();
  });

  it('keeps live decision-slot assignments (gap-fill only, never clobbers)', async () => {
    secretStore.set(RETIRED_JEV_KEYRING_KEY, 'k');
    const raw = {
      providers: [],
      decision: { engine: 'jev', jev: { endpoint: 'typesafe', baseUrl: '' } },
      taskAssignments: { 'decision:choice': 'my-pinned-jev' },
    };
    await writeConfig(raw);
    const result = await migrateLegacyDecisionConfig(raw, deps());
    const assignments = result.config.taskAssignments as Record<string, string>;
    expect(assignments['decision:choice']).toBe('my-pinned-jev');
    expect(assignments['decision:tool-dispatch']).toBe('jev-latest');
  });

  it('never deletes the legacy secret when the copy cannot be verified', async () => {
    secretStore.set(RETIRED_JEV_KEYRING_KEY, 'sk-or-legacy');
    const raw = {
      providers: [],
      decision: { engine: 'jev', jev: { endpoint: 'openrouter', baseUrl: '' } },
    };
    await writeConfig(raw);
    const result = await migrateLegacyDecisionConfig(
      raw,
      deps({
        getSecret: async (key) => (key === RETIRED_JEV_KEYRING_KEY ? secretStore.get(key) ?? null : 'MISMATCH'),
      })
    );
    expect(result.secretMigrated).toBe(false);
    expect(secretStore.has(RETIRED_JEV_KEYRING_KEY)).toBe(true);
    expect(operations).toEqual([`set:provider:${(result.config.providers as { id: string }[])[0].id}`]);
  });

  it('llm and needle configs become unassigned slots (byte-identical OFF) + one-time notice', async () => {
    for (const engine of ['llm', 'needle']) {
      const raw = {
        providers: [{ id: 'p1', name: 'T', type: 'openai', apiKey: '', apiBase: 'https://x', availableModels: [], customModels: [] }],
        decision: { engine, actThreshold: 0.85, confirmThreshold: 0.5 },
        taskAssignments: { intent: 'p1-model' },
      };
      await writeConfig(raw);
    const result = await migrateLegacyDecisionConfig(raw, deps());
      expect(result.migrated).toBe(true);
      expect(result.secretMigrated).toBe(false);
      const decision = result.config.decision as Record<string, unknown>;
      expect(decision.engine).toBeUndefined();
      expect(decision.legacyEngineNotice).toBe(true);
      expect('intent' in (result.config.taskAssignments as Record<string, unknown>)).toBe(false);
      const merged = mergeWithDefaults(result.config as never);
      expect(merged.taskAssignments['decision:tool-dispatch']).toBeUndefined();
    }
  });

  it('drops taskAssignments.intent even without decision fields', async () => {
    const raw = { providers: [], taskAssignments: { intent: 'x', chat: 'y' } };
    await writeConfig(raw);
    const result = await migrateLegacyDecisionConfig(raw, deps());
    expect(result.migrated).toBe(true);
    expect((result.config.taskAssignments as Record<string, unknown>).chat).toBe('y');
    expect('intent' in (result.config.taskAssignments as Record<string, unknown>)).toBe(false);
  });

  it('removes the retired needle weights cache from userData', async () => {
    await mkdir(path.join(dir, 'needle'), { recursive: true });
    await writeFile(path.join(dir, 'needle', 'needle3.cact'), 'weights');
    const result = await migrateLegacyDecisionConfig({ providers: [] }, deps());
    expect(result.needleCacheRemoved).toBe(true);
    expect(existsSync(path.join(dir, 'needle'))).toBe(false);
  });

  it('is idempotent: a second run over the migrated config is a no-op', async () => {
    secretStore.set(RETIRED_JEV_KEYRING_KEY, 'sk-or-legacy');
    const raw = {
      providers: [],
      decision: { engine: 'jev', jev: { endpoint: 'openrouter', baseUrl: '' } },
    };
    await writeConfig(raw);
    const first = await migrateLegacyDecisionConfig(raw, deps());
    const second = await migrateLegacyDecisionConfig(first.config, deps());
    expect(second.migrated).toBe(false);
    expect(second.config).toBe(first.config);
    const backup = JSON.parse(await readFile(path.join(dir, 'config.json.pre-plan26'), 'utf8'));
    expect(backup.decision.engine).toBe('jev');
  });
});

