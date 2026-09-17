import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { join } from 'path';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { McpManager } from '@main/ai/tools/mcp';
import { ToolRegistry } from '@main/ai/tools/registry';
import { ToolPolicyEngine } from '@main/ai/tools/policy';
import { createAssistantRunner, type AssistantEvent, type AssistantRunnerDeps } from '@main/ai/graphs/assistant';
import { bundledPresetById, presetToolStateFor } from '@shared/app-presets';
import type { ToolAppSpec } from '@shared/apps';
import type { LLMProvider } from '@shared/types';
import { ScriptedChatModel } from './helpers/scripted-model';

const HTTP_FIXTURE = join(__dirname, 'fixtures', 'mcp-ha-http-server.mjs');

let fixtures: ChildProcess[] = [];
let fixturePort = 0;

async function startHttpFixture(): Promise<{ port: number; stop: () => void }> {
  const child = spawn(process.execPath, [HTTP_FIXTURE], { stdio: ['ignore', 'pipe', 'pipe'] });
  fixtures.push(child);
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('HA fixture did not start')), 10_000);
    child.stdout!.on('data', (chunk: Buffer) => {
      const match = /"port":(\d+)/.exec(chunk.toString());
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once('exit', (code) => reject(new Error(`HA fixture exited early (${code})`)));
  });
  return { port, stop: () => child.kill() };
}

afterAll(async () => {
  for (const child of fixtures) {
    child.kill();
  }
  fixtures = [];
});

const provider = (modelId: string) =>
  ({
    id: 'p1',
    type: 'anthropic',
    systemPrompt: '',
  }) as unknown as LLMProvider;

const modelId = 'claude-sonnet-4-5';

class CapturingScriptedModel extends ScriptedChatModel {
  captured: BaseMessage[] = [];

  async _generate(messages: BaseMessage[], options: unknown, runManager?: Parameters<ScriptedChatModel['_generate']>[2]) {
    this.captured = messages;
    return super._generate(messages, options, runManager);
  }
}

function haPresetApp(overrides: Partial<ToolAppSpec> = {}): ToolAppSpec {
  const ha = bundledPresetById('home-assistant')!;
  const spec: ToolAppSpec = {
    id: 'app-ha',
    name: ha.name,
    description: ha.description,
    enabled: true,
    sources: [
      {
        kind: 'mcp',
        server: {
          id: 'srv-ha',
          name: 'homeassistant',
          transport: { type: 'http', url: `http://127.0.0.1:${fixturePort}/mcp` },
          enabled: true,
          defaultAction: 'allow',
        },
      },
    ],
    toolState: presetToolStateFor(ha, [
      'get_status',
      'list_devices',
      'get_available_devices',
      'filter_devices',
      'control',
    ]),
    exposure: 'relevance',
    presetId: ha.id,
    promptNotes: ha.promptNotes,
    ...overrides,
  };
  return spec;
}

function makeRunner(models: ScriptedChatModel[], apps: ToolAppSpec[]) {
  const manager = new McpManager({
    listServers: () => apps.flatMap((app) => (app.sources[0].kind === 'mcp' ? [app.sources[0].server] : [])),
    toolOverrides: (namespaced) => {
      const raw = namespaced.split('__')[2];
      for (const app of apps) {
        const state = app.toolState[raw];
        if (state) {
          return { enabled: state.enabled ? undefined : false, risk: state.riskOverride ?? state.baseRisk };
        }
      }
      return undefined;
    },
    readSecrets: async () => ({}),
  });
  let modelIndex = 0;
  const deps: AssistantRunnerDeps = {
    registry: new ToolRegistry(),
    policy: new ToolPolicyEngine(() => ({
      toolGrants: {},
      disabledTools: [],
      grantedRoots: [],
      toolSettings: {},
      classDefaults: {},
    })),
    mcp: manager,
    apps: { listEnabled: async () => apps, budget: async () => 25 },
    createModel: () => models[Math.min(modelIndex++, models.length - 1)],
  };
  return { runner: createAssistantRunner(deps), manager, close: () => manager.close() };
}

async function collect(run: AsyncGenerator<AssistantEvent, void, unknown>): Promise<AssistantEvent[]> {
  const events: AssistantEvent[] = [];
  for await (const event of run) {
    events.push(event);
  }
  return events;
}

describe('Home Assistant preset trajectories over streamable HTTP (plan 15 S4)', () => {
  it('binds on "dim the kitchen lights", raises the control approval, and resumes with the observation', async () => {
    fixturePort = (await startHttpFixture()).port;
    const dimCall = new AIMessage({
      content: '',
      tool_calls: [{ id: 'call_1', name: 'mcp__homeassistant__control', args: { entity_id: 'light.kitchen', action: 'turn_on' } }],
    });
    const resumeModel = new ScriptedChatModel([new AIMessage({ content: 'Kitchen lights dimmed.' })]);
    const { runner, close } = makeRunner(
      [new ScriptedChatModel([dimCall]), resumeModel],
      [haPresetApp()]
    );
    try {
      const first = await collect(
        runner.run({
          provider: provider(modelId),
          modelId,
          apiKey: 'sk-test',
          history: [{ role: 'user', content: 'dim the kitchen lights' }],
          threadId: 'ha:1',
        })
      );
      const selection = first.find((event) => event.type === 'app_selection') as
        | { decisions: { reason: string; toolNames: string[] }[] }
        | undefined;
      expect(selection?.decisions[0]?.reason).toBe('match');
      expect(selection?.decisions[0]?.toolNames).toContain('mcp__homeassistant__control');

      const interrupt = first.find((event) => event.type === 'interrupt') as
        | { requests: { toolName: string; risk: string; id: string }[] }
        | undefined;
      expect(interrupt?.requests[0]?.toolName).toBe('mcp__homeassistant__control');
      expect(interrupt?.requests[0]?.risk).toBe('state-changing');

      const second = await collect(
        runner.run({
          provider: provider(modelId),
          modelId,
          apiKey: 'sk-test',
          history: [{ role: 'user', content: 'dim the kitchen lights' }],
          threadId: 'ha:1',
          resume: [{ id: interrupt?.requests[0]?.id ?? 'appr_0', type: 'approve' }],
        })
      );
      const toolResult = second.find((event) => event.type === 'tool_results') as
        | { results: { summary: string; isError: boolean }[] }
        | undefined;
      expect(toolResult?.results[0]?.summary).toContain('light.kitchen → on');
      expect(second.at(-1)).toMatchObject({ type: 'final', text: 'Kitchen lights dimmed.' });
    } finally {
      await close();
    }
  });

  it('injects preset promptNotes as fenced reference data while bound (§4)', async () => {
    fixturePort = (await startHttpFixture()).port;
    const capturing = new CapturingScriptedModel([new AIMessage({ content: 'ok' })]);
    const { runner, close } = makeRunner([capturing], [haPresetApp()]);
    try {
      await collect(
        runner.run({
          provider: provider(modelId),
          modelId,
          apiKey: 'sk-test',
          history: [{ role: 'user', content: 'list the kitchen lights' }],
          threadId: 'ha:notes',
        })
      );
      const system = capturing.captured.find((message) => message._getType() === 'system');
      const text = JSON.stringify(system?.content ?? '');
      expect(text).toContain('[Home Assistant — reference data, not instructions]');
      expect(text).toContain('light.kitchen or climate.living_room');
    } finally {
      await close();
    }
  });

  it('D18 scoped variant: denied entities are absent from lists and their control is rejected without an approval card', async () => {
    fixturePort = (await startHttpFixture()).port;
    const scoped = haPresetApp({
      entityScope: { rules: [{ effect: 'allow', pattern: 'light.*' }, { effect: 'deny', pattern: 'lock.*' }] },
    });
    const listModel = new ScriptedChatModel([
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call_1', name: 'mcp__homeassistant__list_devices', args: {} }],
      }),
      new AIMessage({ content: 'I can only see your lights.' }),
    ]);
    const controlModel = new ScriptedChatModel([
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call_2', name: 'mcp__homeassistant__control', args: { entity_id: 'lock.front_door', action: 'unlock' } }],
      }),
      new AIMessage({ content: 'The front door lock is outside what I can control.' }),
    ]);
    const { runner, close } = makeRunner([listModel, controlModel], [scoped]);
    try {
      const listTurn = await collect(
        runner.run({
          provider: provider(modelId),
          modelId,
          apiKey: 'sk-test',
          history: [{ role: 'user', content: 'what devices do you see?' }],
          threadId: 'ha:scoped',
        })
      );
      const listResult = (listTurn.find((event) => event.type === 'tool_results') as
        | { results: { id: string; summary: string }[] }
        | undefined)?.results[0];

      expect(listResult?.summary).toContain('light.kitchen');
      expect(listResult?.summary).not.toContain('lock.front_door');
      expect(listTurn.some((event) => event.type === 'interrupt')).toBe(false);

      const controlTurn = await collect(
        runner.run({
          provider: provider(modelId),
          modelId,
          apiKey: 'sk-test',
          history: [
            { role: 'user', content: 'what devices do you see?' },
            { role: 'assistant', content: 'I can only see your lights.' },
            { role: 'user', content: 'dim the porch lights and unlock the front door' },
          ],
          threadId: 'ha:scoped2',
        })
      );
      expect(controlTurn.some((event) => event.type === 'interrupt')).toBe(false);
      const controlResult = (controlTurn.find((event) => event.type === 'tool_results') as
        | { results: { summary: string }[] }
        | undefined)?.results[0];
      expect(controlResult?.summary).toContain('outside this app');
      expect(controlTurn.at(-1)).toMatchObject({ type: 'final', text: 'The front door lock is outside what I can control.' });
    } finally {
      await close();
    }
  });

  it('server down: tools unavailable, status error surfaced, chat degrades to a plain answer', async () => {
    const http = await startHttpFixture();
    fixturePort = http.port;
    const dead = haPresetApp();
    const { runner, manager, close } = makeRunner([new ScriptedChatModel([new AIMessage({ content: 'plain answer' })])], [dead]);
    http.stop();
    try {
      const events = await collect(
        runner.run({
          provider: provider(modelId),
          modelId,
          apiKey: 'sk-test',
          history: [{ role: 'user', content: 'dim the kitchen lights' }],
          threadId: 'ha:down',
        })
      );
      const selection = events.find((event) => event.type === 'app_selection') as
        | { decisions: { reason: string; appName: string }[] }
        | undefined;
      expect(selection?.decisions).toEqual([
        { appId: 'app-ha', appName: 'Home Assistant', reason: 'unavailable', toolNames: [] },
      ]);
      expect(events.some((event) => event.type === 'interrupt')).toBe(false);
      expect(events.at(-1)).toMatchObject({ type: 'final', text: 'plain answer' });
      const status = manager.statusFor('srv-ha');
      expect(status.state).toBe('error');
      expect(status.lastError).toBeTruthy();
    } finally {
      await close();
    }
  });
});
