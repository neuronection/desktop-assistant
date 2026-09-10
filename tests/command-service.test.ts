import { describe, expect, it, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from 'generated/client';
import { z } from 'zod';
import type { CommandsSettings } from '@shared/config/AppConfig';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { resolveCommandAlias, type DiscoveredApp } from '@shared/commands';
import type { NativeToolDefinition } from '@main/ai/tools/types';
import { CommandService, type BuiltinActionHandlers, type CommandHistoryClient } from '@main/services/CommandService';

const clients: PrismaClient[] = [];
let dataDir: string;

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true });
  }
});

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS "CommandInvocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "commandId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "args" JSONB,
  "outcome" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "CommandInvocation_commandId_idx" ON "CommandInvocation"("commandId");
CREATE INDEX IF NOT EXISTS "CommandInvocation_createdAt_idx" ON "CommandInvocation"("createdAt");`;

async function makeDbClient(): Promise<PrismaClient> {
  if (!dataDir) {
    dataDir = await mkdtemp(join(tmpdir(), 'da-commands-'));
  }
  const client = new PrismaClient({ datasources: { db: { url: `file:${join(dataDir, `${Math.random().toString(36).slice(2)}.db`)}` } } });
  clients.push(client);
  await client.$connect();
  for (const statement of CREATE_TABLE.split(';').map((part) => part.trim()).filter(Boolean)) {
    await client.$executeRawUnsafe(statement);
  }
  return client;
}

function tool(name: string, risk: NativeToolDefinition['risk'], schema: z.ZodTypeAny = z.object({})): NativeToolDefinition {
  return {
    name,
    description: `${name} description`,
    schema: schema as z.ZodType<Record<string, unknown>>,
    risk,
    category: 'system',
    summarize: () => name,
    exec: async () => 'ok',
  };
}

function makeConfig(overrides?: Partial<CommandsSettings>): CommandsSettings {
  return { ...DEFAULT_CONFIG.commands, ...overrides };
}

function recordingActions(): BuiltinActionHandlers & { called: string[] } {
  const called: string[] = [];
  const track = (name: string) => () => {
    called.push(name);
  };
  return {
    called,
    newConversation: track('new-conversation'),
    toggleExpand: track('toggle-expand'),
    openDesktop: track('open-desktop'),
    openSettings: track('open-settings'),
    hideLauncher: track('hide'),
    quit: track('quit'),
  };
}

function makeService(options: {
  tools?: NativeToolDefinition[];
  config?: Partial<CommandsSettings>;
  client?: CommandHistoryClient | null;
  grantedRoots?: string[];
  isToolDisabled?: (name: string) => boolean;
  apps?: DiscoveredApp[];
  launchApp?: (id: string) => Promise<void>;
  executeDirectTool?: (name: string, args: unknown) => Promise<{ ok: boolean; text: string; durationMs: number }>;
  updateCommands?: (patch: Partial<CommandsSettings>) => Promise<void>;
  storeSecret?: (key: string, value: string) => Promise<void>;
  resolveSecret?: (key: string) => Promise<string | null>;
  deleteSecret?: (key: string) => Promise<void>;
  httpFetch?: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text: string }>;
}): { service: CommandService; actions: ReturnType<typeof recordingActions> } {
  const actions = recordingActions();
  const configState: CommandsSettings = makeConfig(options.config);
  const service = new CommandService({
    client: options.client ?? null,
    config: () => configState,
    updateCommands: options.updateCommands
      ? async (patch) => {
          Object.assign(configState, patch);
          await options.updateCommands?.(patch);
        }
      : undefined,
    toolCatalog: () => options.tools ?? [],
    isToolDisabled: options.isToolDisabled ?? (() => false),
    grantedRoots: () => options.grantedRoots ?? [],
    actions,
    ...(options.apps ? { apps: () => options.apps as DiscoveredApp[] } : {}),
    ...(options.launchApp ? { launchApp: options.launchApp } : {}),
    ...(options.executeDirectTool ? { executeDirectTool: options.executeDirectTool } : {}),
    ...(options.storeSecret ? { storeSecret: options.storeSecret } : {}),
    ...(options.resolveSecret ? { resolveSecret: options.resolveSecret } : {}),
    ...(options.deleteSecret ? { deleteSecret: options.deleteSecret } : {}),
    ...(options.httpFetch ? { httpFetch: options.httpFetch } : {}),
  });
  return { service, actions };
}

const APP_FIXTURE: DiscoveredApp = {
  id: 'firefix',
  title: 'Firefix',
  comment: 'Browse the web',
  categories: ['Network'],
  iconRef: 'firefix',
  launchSpec: { type: 'gtk-launch', id: 'firefix' },
};

describe('CommandService app entries (plan 14 S3)', () => {
  it('surfaces discovered apps with app-icon refs, comment keywords and title alias', () => {
    const { service } = makeService({ apps: [APP_FIXTURE] });
    const entry = service.list().find((candidate) => candidate.id === 'app:firefix');
    expect(entry).toMatchObject({
      kind: 'app',
      title: 'Firefix',
      category: 'apps',
      subtitle: 'Browse the web',
      icon: 'app-icon:firefix',
      source: 'app',
      scopes: { palette: true, agent: false },
    });
    expect(entry?.aliases).toContain('firefix');
    expect(entry?.keywords).toContain('Browse');
  });

  it('vanishes when launchEnabled or discovery is off and honors hiddenApps', () => {
    const off = makeService({ apps: [APP_FIXTURE], config: { apps: { discovery: true, launchEnabled: false, hiddenApps: [] } } });
    expect(off.service.list().some((entry) => entry.kind === 'app')).toBe(false);
    const noDiscovery = makeService({ apps: [APP_FIXTURE], config: { apps: { discovery: false, launchEnabled: true, hiddenApps: [] } } });
    expect(noDiscovery.service.list().some((entry) => entry.kind === 'app')).toBe(false);
    const hidden = makeService({
      apps: [APP_FIXTURE],
      config: { apps: { discovery: true, launchEnabled: true, hiddenApps: ['firefix'] } },
    });
    expect(hidden.service.list().some((entry) => entry.id === 'app:firefix')).toBe(false);
  });

  it('executes app commands through the launcher without recording argv', async () => {
    const client = fakeClient();
    const launched: string[] = [];
    const { service } = makeService({
      apps: [APP_FIXTURE],
      client,
      launchApp: async (id) => {
        launched.push(id);
      },
    });
    const outcome = await service.execute('app:firefix', [], 'palette');
    expect(outcome).toEqual({ status: 'done', text: 'Firefix' });
    expect(launched).toEqual(['firefix']);
    await service.flushHistory();
    expect(client.rows[0]).toMatchObject({ commandId: 'app:firefix', kind: 'app', source: 'palette', outcome: 'ok' });
    expect(client.rows[0].args).toBeUndefined();
  });

  it('honors the per-app agent scope from config', () => {
    const { service } = makeService({
      apps: [APP_FIXTURE],
      config: { agentCallable: { 'app:firefix': true } },
    });
    const entry = service.list().find((candidate) => candidate.id === 'app:firefix');
    expect(entry?.scopes.agent).toBe(true);
  });
});

describe('CommandService custom commands & integration packs (plan 14 S5)', () => {
  const tools = [tool('run_shell', 'state-changing', z.object({ command: z.string().min(1) }))];

  it('saves validated custom tool wrappers and rejects reserved aliases', async () => {
    let stored: CommandsSettings['custom'] = [];
    const client = fakeClient();
    const { service } = makeService({
      tools,
      client,
      updateCommands: async (patch) => {
        stored = patch.custom ?? stored;
      },
    });
    const good = await service.saveCustom({
      id: '',
      name: 'Git status',
      kind: 'tool',
      toolName: 'run_shell',
      argTemplate: { command: 'git status' },
      aliases: ['git'],
    });
    expect(good.ok).toBe(true);
    expect(stored[0]?.id).toMatch(/^custom-/);
    expect((await service.saveCustom({ id: '', name: 'X', kind: 'tool', toolName: 'run_shell', argTemplate: {}, aliases: [] })).ok).toBe(false);
    expect(
      (await service.saveCustom({ id: '', name: 'X', kind: 'tool', toolName: 'not_a_tool', argTemplate: { command: 'x' }, aliases: [] })).error
    ).toContain('unavailable');
    expect(
      (await service.saveCustom({ id: '', name: 'X', kind: 'tool', toolName: 'run_shell', argTemplate: { bogus: 'x' }, aliases: [] })).error
    ).toContain("no argument 'bogus'");
    expect(
      (await service.saveCustom({ id: '', name: 'X', kind: 'tool', toolName: 'run_shell', argTemplate: { command: '{{1}}' }, aliases: ['calc'] })).error
    ).toContain('reserved');
  });

  it('deletes custom commands', async () => {
    const one = { id: 'one', name: 'One', kind: 'prompt' as const, promptTemplate: 'hi', aliases: [] };
    let stored: CommandsSettings['custom'] = [one];
    const { service } = makeService({
      config: { custom: [one] },
      updateCommands: async (patch) => {
        stored = patch.custom ?? stored;
      },
    });
    expect(await service.deleteCustom('missing')).toBe(false);
    expect(await service.deleteCustom('one')).toBe(true);
    expect(stored).toEqual([]);
  });

  it('builds catalog entries with synthesized args and executes the wrapper through the turn path', async () => {
    let stored: CommandsSettings['custom'] = [
      {
        id: 'git-push',
        name: 'Git push',
        kind: 'tool',
        toolName: 'run_shell',
        argTemplate: { command: 'git push {{1}}' },
        aliases: ['push'],
      },
    ];
    const client = fakeClient();
    const { service } = makeService({
      tools,
      client,
      config: { custom: stored },
      updateCommands: async (patch) => {
        stored = patch.custom ?? stored;
      },
    });
    const entry = service.list().find((candidate) => candidate.id === 'custom:git-push');
    expect(entry?.args).toHaveLength(1);
    const outcome = await service.execute('custom:git-push', ['main'], 'palette');
    expect(outcome.status).toBe('turn');
    expect((outcome as { direct?: { name: string; args: unknown } }).direct).toEqual({
      name: 'run_shell',
      args: { command: 'git push main' },
    });
    await service.flushHistory();
    expect(client.rows).toEqual([]);
  });

  it('executes prompt commands as substituted turn prompts and records them', async () => {
    const client = fakeClient();
    const { service } = makeService({
      client,
      config: {
        custom: [{ id: 'standup', name: 'Standup', kind: 'prompt', promptTemplate: 'Summarize {{1}}', aliases: ['standup'] }],
      },
    });
    const outcome = await service.execute('custom:standup', ['today notes'], 'palette');
    expect(outcome).toEqual({ status: 'turn', prompt: 'Summarize today notes' });
    await service.flushHistory();
    expect(client.rows[0]).toMatchObject({ commandId: 'custom:standup', kind: 'custom', outcome: 'ok' });
    const missing = await service.execute('custom:standup', [], 'palette');
    expect(missing.status).toBe('error');
  });

  it('imports packs, stores secret refs (values never in config), and executes http commands', async () => {
    const storedSecrets: Record<string, string> = {};
    let storedPacks: CommandsSettings['integrations'] = [];
    const httpCalls: Array<{ url: string; init: { method: string; headers: Record<string, string> } }> = [];
    const { service } = makeService({
      client: fakeClient(),
      tools,
      updateCommands: async (patch) => {
        if (patch.integrations) {
          storedPacks = patch.integrations;
        }
      },
      storeSecret: async (key, value) => {
        storedSecrets[key] = value;
      },
      resolveSecret: async (key) => storedSecrets[key] ?? null,
      deleteSecret: async (key) => {
        delete storedSecrets[key];
      },
      httpFetch: async (url, init) => {
        httpCalls.push({ url, init });
        return { status: 200, text: 'deployed' };
      },
    });
    const manifest = JSON.stringify({
      manifestVersion: 1,
      id: 'acme',
      name: 'Acme',
      commands: [
        {
          kind: 'http',
          name: 'deploy',
          title: 'Deploy',
          aliases: ['deploy'],
          method: 'POST',
          urlTemplate: 'https://api.acme.example/{{1}}',
          headers: { Authorization: '${secret:deployKey}', Accept: 'application/json' },
          bodyTemplate: '{"ref":"{{1}}"}',
        },
        {
          kind: 'tool',
          name: 'open-docs',
          title: 'Docs',
          toolName: 'run_shell',
          argTemplate: { command: 'open docs' },
        },
      ],
    });
    const bad = await service.importPack(manifest, {});
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('deployKey');
    const good = await service.importPack(manifest, { deployKey: 'SUPER-SECRET' });
    expect(good.ok).toBe(true);
    expect(Object.values(storedSecrets)).toEqual(['SUPER-SECRET']);
    expect(JSON.stringify(storedPacks)).not.toContain('SUPER-SECRET');
    expect(JSON.stringify(storedPacks)).toContain('${secret:integration:acme:deploy:deployKey}');

    const outcome = await service.execute('integration:acme:deploy', ['main'], 'palette');
    expect(outcome).toEqual({ status: 'done', text: 'deployed' });
    expect(httpCalls[0]?.url).toBe('https://api.acme.example/main');
    expect(httpCalls[0]?.init.headers.Authorization).toBe('SUPER-SECRET');

    const docs = await service.execute('integration:acme:open-docs', [], 'palette');
    expect((docs as { direct?: { name: string } }).direct?.name).toBe('run_shell');
    expect(await service.removePack('acme')).toBe(true);
    expect(storedSecrets).toEqual({});
  });

  it('re-imports are rejected and disabled packs never execute', async () => {
    let storedPacks: CommandsSettings['integrations'] = [
      {
        id: 'acme',
        name: 'Acme',
        enabled: true,
        error: 'Bound tool is unavailable.',
        commands: [{ id: 'x', kind: 'tool', title: 'X', toolName: 'run_shell', argTemplate: { command: 'x' } }],
      },
    ];
    const { service } = makeService({
      tools,
      config: { integrations: storedPacks },
      updateCommands: async (patch) => {
        if (patch.integrations) {
          storedPacks = patch.integrations;
        }
      },
    });
    expect((await service.execute('integration:acme:x', [], 'palette')).status).toBe('error');
    const result = await service.importPack(
      JSON.stringify({
        manifestVersion: 1,
        id: 'acme',
        name: 'Acme',
        commands: [{ kind: 'tool', name: 'y', title: 'Y', toolName: 'run_shell', argTemplate: { command: 'y' } }],
      }),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('already installed');
  });

  it('boot validation self-disables packs whose bound tools vanished', async () => {
    let storedPacks: CommandsSettings['integrations'] = [
      {
        id: 'acme',
        name: 'Acme',
        enabled: true,
        commands: [
          { id: 'good', kind: 'prompt', title: 'Good', promptTemplate: 'hi', aliases: [] },
          { id: 'bad', kind: 'tool', title: 'Bad', toolName: 'gone_tool', argTemplate: { command: 'x' } },
        ],
      },
    ];
    const { service } = makeService({
      tools: [tool('run_shell', 'state-changing')],
      config: { integrations: storedPacks },
      updateCommands: async (patch) => {
        if (patch.integrations) {
          storedPacks = patch.integrations;
        }
      },
    });
    const invalid = await service.validateStoredIntegrations();
    expect(invalid).toEqual(['acme']);
    expect(storedPacks[0]?.enabled).toBe(false);
    expect(storedPacks[0]?.error).toContain('gone_tool');
    expect(service.list().some((entry) => entry.id.startsWith('integration:acme'))).toBe(false);
  });
});

describe('CommandService catalog', () => {
  it('assembles builtins plus tool entries with args from the zod schema', () => {
    const tools = [
      tool('screen_capture', 'read-only'),
      tool('run_shell', 'state-changing', z.object({ command: z.string().describe('The command') })),
    ];
    const { service } = makeService({ tools });
    const entries = service.list();
    const byId = new Map(entries.map((entry) => [entry.id, entry]));

    expect(byId.get('nav:new-conversation')?.kind).toBe('builtin');
    expect(byId.get('calc:evaluate')?.aliases).toContain('calc');
    expect(byId.get('files:search')?.args).toEqual([
      { name: 'pattern', required: true, type: 'string' },
    ]);
    expect(byId.get('tool:screen_capture')?.aliases).toEqual(['screenshot']);
    const shell = byId.get('tool:run_shell');
    expect(shell?.args).toEqual([
      { name: 'command', description: 'The command', required: true, type: 'string', defaultValue: undefined },
    ]);
    expect(shell?.risk).toBe('state-changing');
  });

  it('excludes destructive and disabled tools', () => {
    const tools = [
      tool('safe_tool', 'read-only'),
      tool('danger_tool', 'destructive'),
      tool('killed_tool', 'read-only'),
    ];
    const { service } = makeService({
      tools,
      isToolDisabled: (name) => name === 'killed_tool',
    });
    const ids = service.list().filter((entry) => entry.kind === 'tool').map((entry) => entry.id);
    expect(ids).toEqual(['tool:safe_tool']);
  });

  it('categorizes web tools under the web group', () => {
    const tools = [tool('web_search', 'read-only'), tool('run_shell', 'state-changing')];
    const { service } = makeService({ tools });
    const entries = service.list().filter((entry) => entry.kind === 'tool');
    expect(entries.find((entry) => entry.id === 'tool:web_search')?.category).toBe('web');
    expect(entries.find((entry) => entry.id === 'tool:run_shell')?.category).toBe('tools');
  });

  it('scopes alias-less tools out of the palette but keeps them listed for management', () => {
    const tools = [
      tool('run_shell', 'state-changing', z.object({ command: z.string() })),
      tool('web_fetch', 'read-only', z.object({ url: z.string() })),
    ];
    const { service } = makeService({ tools });
    const byId = new Map(service.list().map((entry) => [entry.id, entry]));
    expect(byId.get('tool:run_shell')?.scopes.palette).toBe(true);
    expect(byId.get('tool:web_fetch')?.scopes.palette).toBe(false);
    expect(byId.has('tool:web_fetch')).toBe(true);
  });

  it('restores palette scope when the user aliases an alias-less tool', () => {
    const tools = [tool('web_fetch', 'read-only', z.object({ url: z.string() }))];
    const { service } = makeService({
      tools,
      config: { extraAliases: { 'tool:web_fetch': ['neuronection'] } },
    });
    const entry = service.list().find((candidate) => candidate.id === 'tool:web_fetch');
    expect(entry?.aliases).toContain('neuronection');
    expect(entry?.scopes.palette).toBe(true);
    expect(resolveCommandAlias(service.list(), '/neuronection https://neuronection.com')?.entry.id).toBe('tool:web_fetch');
  });

  it('applies hidden ids and extra aliases from config', () => {
    const tools = [tool('run_shell', 'state-changing')];
    const { service } = makeService({
      tools,
      config: {
        hidden: ['tool:run_shell'],
        extraAliases: { 'nav:quit': ['bye'] },
      },
    });
    const entries = service.list();
    expect(entries.some((entry) => entry.id === 'tool:run_shell')).toBe(false);
    const quit = entries.find((entry) => entry.id === 'nav:quit');
    expect(quit?.aliases).toContain('bye');
  });

  it('returns an empty catalog when the feature is disabled', () => {
    const { service } = makeService({ config: { enabled: false }, tools: [tool('run_shell', 'state-changing')] });
    expect(service.list()).toEqual([]);
  });
});

describe('CommandService execute', () => {
  it('dispatches navigation builtins to the injected actions', async () => {
    const { service, actions } = makeService({});
    const outcome = await service.execute('nav:open-desktop', [], 'palette');
    expect(outcome).toEqual({ status: 'done' });
    expect(actions.called).toEqual(['open-desktop']);
  });

  it('evaluates calculator expressions and records args for read-only builtins', async () => {
    const client = fakeClient();
    const { service } = makeService({ client });
    const outcome = await service.execute('calc:evaluate', ['2', '+', '3', '*4'], 'palette');
    expect(outcome).toEqual({ status: 'done', text: '= 14' });
    await service.flushHistory();
    expect(client.rows).toHaveLength(1);
    expect(client.rows[0]).toMatchObject({ commandId: 'calc:evaluate', kind: 'builtin', source: 'palette', outcome: 'ok' });
    expect(JSON.parse(client.rows[0].args as string)).toEqual({ argv: ['2', '+', '3', '*4'] });
  });

  it('returns usage errors without crashing', async () => {
    const { service } = makeService({});
    const calc = await service.execute('calc:evaluate', [], 'palette');
    expect(calc.status).toBe('error');
    const files = await service.execute('files:search', [], 'palette');
    expect(files.status).toBe('error');
  });

  it('surfaces calculator failures as errors', async () => {
    const { service } = makeService({});
    const outcome = await service.execute('calc:evaluate', ['1', '/', '0'], 'palette');
    expect(outcome.status).toBe('error');
  });

  it('searches granted roots for files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'da-files-'));
    await writeFile(join(root, 'report.txt'), 'x');
    await writeFile(join(root, 'notes.md'), 'x');
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'nested', 'report.txt'), 'x');
    const { service } = makeService({ grantedRoots: [root] });
    const outcome = await service.execute('files:search', ['*.txt'], 'palette');
    expect(outcome.status).toBe('done');
    expect((outcome as { text: string }).text).toContain('2 match(es)');
    await rm(root, { recursive: true, force: true });
  });

  it('reports missing granted roots for file search', async () => {
    const { service } = makeService({ grantedRoots: [] });
    const outcome = await service.execute('files:search', ['*.txt'], 'palette');
    expect(outcome.status).toBe('error');
  });

  it('defers tool-backed commands to the turn path', async () => {
    const client = fakeClient();
    const { service } = makeService({ client, tools: [tool('run_shell', 'state-changing')] });
    const outcome = await service.execute('tool:run_shell', ['ls'], 'palette');
    expect(outcome).toEqual({ status: 'turn' });
  });

  it('rejects unknown ids and disabled feature', async () => {
    const { service } = makeService({});
    expect((await service.execute('nope', [], 'palette')).status).toBe('error');
    const disabled = makeService({ config: { enabled: false } }).service;
    expect((await disabled.execute('nav:quit', [], 'palette')).status).toBe('error');
  });
});

describe('CommandService history', () => {
  it('writes rows for turn-path records and reads recents deduped and capped', async () => {
    const db = await makeDbClient();
    const { service } = makeService({ client: db });
    service.record({ commandId: 'tool:run_shell', kind: 'tool', source: 'palette', ok: true });
    service.record({ commandId: 'calc:evaluate', kind: 'builtin', source: 'palette', ok: false });
    await service.flushHistory();
    await new Promise((resolve) => setTimeout(resolve, 5));
    service.record({ commandId: 'tool:run_shell', kind: 'tool', source: 'palette', ok: true });
    await service.flushHistory();
    expect(await service.recentIds(5)).toEqual(['tool:run_shell', 'calc:evaluate']);
  });

  it('dedupes recents regardless of same-millisecond write order', async () => {
    const db = await makeDbClient();
    const { service } = makeService({ client: db });
    service.record({ commandId: 'calc:evaluate', kind: 'builtin', source: 'palette', ok: true });
    service.record({ commandId: 'tool:web_search', kind: 'tool', source: 'palette', ok: true });
    await service.flushHistory();
    expect((await service.recentIds(5)).sort()).toEqual(['calc:evaluate', 'tool:web_search']);
  });

  it('honors history disabled and clears on demand', async () => {
    const db = await makeDbClient();
    const muted = makeService({ client: db, config: { history: { enabled: false, retentionDays: 90 } } }).service;
    muted.record({ commandId: 'nav:quit', kind: 'builtin', source: 'palette', ok: true });
    await muted.flushHistory();
    expect(await muted.recentIds()).toEqual([]);

    const { service } = makeService({ client: db });
    service.record({ commandId: 'nav:quit', kind: 'builtin', source: 'palette', ok: true });
    await service.flushHistory();
    await service.clearHistory();
    expect(await service.recentIds()).toEqual([]);
  });

  it('prunes invocations older than the retention window', async () => {
    const db = await makeDbClient();
    const oldDate = new Date(Date.now() - 120 * 86_400_000);
    await db.commandInvocation.create({
      data: { id: 'old', commandId: 'old:command', kind: 'builtin', source: 'palette', outcome: 'ok', createdAt: oldDate },
    });
    const { service } = makeService({ client: db });
    service.record({ commandId: 'nav:quit', kind: 'builtin', source: 'palette', ok: true });
    await service.flushHistory();
    const pruned = await service.pruneHistory();
    expect(pruned).toBe(1);
    expect(await service.recentIds()).toEqual(['nav:quit']);
  });

  it('works without any client (null history)', async () => {
    const { service } = makeService({ client: null });
    service.record({ commandId: 'nav:quit', kind: 'builtin', source: 'palette', ok: true });
    expect(await service.recentIds()).toEqual([]);
    await expect(service.clearHistory()).resolves.toBeUndefined();
    await expect(service.pruneHistory()).resolves.toBe(0);
  });
});

describe('CommandService agent bridge (plan 14 S7)', () => {
  it('bridges only agent-scoped, executable entries', () => {
    const apps = [APP_FIXTURE];
    const { service } = makeService({
      tools: [tool('run_shell', 'state-changing')],
      apps,
      config: {
        agentCallable: {
          'app:firefix': true,
          'custom:prompt': true,
          'custom:wrapper': true,
        },
        custom: [
          { id: 'wrapper', name: 'Wrapper', kind: 'tool', toolName: 'run_shell', argTemplate: { command: '{{1}}' }, aliases: [] },
          { id: 'prompt', name: 'Prompt', kind: 'prompt', promptTemplate: 'hi', aliases: [] },
        ],
      },
    });
    const bridged = service.agentBridgeEntries().map((entry) => entry.id);
    expect(bridged).toContain('app:firefix');
    expect(bridged).toContain('custom:wrapper');
    expect(bridged).not.toContain('custom:prompt');
    expect(bridged.every((id) => !id.startsWith('tool:'))).toBe(true);
  });

  it('drops app commands when the launch switch is off', () => {
    const { service } = makeService({
      apps: [APP_FIXTURE],
      config: { agentCallable: { 'app:firefix': true }, apps: { discovery: true, launchEnabled: false, hiddenApps: [] } },
    });
    expect(service.agentBridgeEntries()).toEqual([]);
  });

  it('builds wrapped tools whose risk inherits the bound tool', () => {
    const { service } = makeService({
      tools: [tool('find_files', 'read-only')],
      config: {
        agentCallable: { 'custom:grep': true },
        custom: [{ id: 'grep', name: 'Grep', kind: 'tool', toolName: 'find_files', argTemplate: { pattern: '{{1}}' }, aliases: [] }],
      },
    });
    const wrapped = service.buildAgentTools();
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]?.risk).toBe('read-only');
    expect(wrapped[0]?.name).toBe('command_custom_grep');
  });

  it('executes agent-invoked wrappers directly with agent-sourced history', async () => {
    const client = fakeClient();
    const executed: Array<{ name: string; args: unknown }> = [];
    const { service } = makeService({
      tools: [tool('run_shell', 'state-changing', z.object({ command: z.string().min(1) }))],
      client,
      config: {
        agentCallable: { 'custom:wrapper': true },
        custom: [{ id: 'wrapper', name: 'Wrapper', kind: 'tool', toolName: 'run_shell', argTemplate: { command: '{{1}}' }, aliases: [] }],
      },
      executeDirectTool: async (name, args) => {
        executed.push({ name, args });
        return { ok: true, text: 'done', durationMs: 5 };
      },
    });
    const outcome = await service.execute('custom:wrapper', ['ls'], 'agent');
    expect(outcome).toEqual({ status: 'done', text: 'done' });
    expect(executed).toEqual([{ name: 'run_shell', args: { command: 'ls' } }]);
    await service.flushHistory();
    expect(client.rows[0]).toMatchObject({ commandId: 'custom:wrapper', kind: 'custom', source: 'agent', outcome: 'ok' });
  });
});

function fakeClient(): CommandHistoryClient & {
  rows: { commandId: string; kind: string; source: string; args?: string; outcome: string }[];
} {
  const rows: { commandId: string; kind: string; source: string; args?: string; outcome: string }[] = [];
  return {
    rows,
    commandInvocation: {
      async create({ data }) {
        rows.push({ ...data });
        return data;
      },
      async findMany({ take }) {
        return [...rows].reverse().slice(0, take).map((row) => ({ commandId: row.commandId }));
      },
      async deleteMany() {
        const count = rows.length;
        rows.length = 0;
        return { count };
      },
    },
  };
}
