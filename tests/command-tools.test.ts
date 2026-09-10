import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CommandEntry } from '@shared/commands';
import type { ToolRiskClass } from '@shared/turns';
import type { NativeToolDefinition } from '@main/ai/tools/types';
import { buildCommandTools, commandToolSlug, schemaFromArgs, argvForEntry } from '@main/ai/tools/command-tools';
import { ToolRegistry } from '@main/ai/tools/registry';
import { buildInterruptOn } from '@main/ai/graphs/assistant';
import { ToolPolicyEngine } from '@main/ai/tools/policy';

function toolDef(name: string, risk: ToolRiskClass): NativeToolDefinition {
  return {
    name,
    description: `${name} description`,
    schema: z.object({}) as z.ZodType<Record<string, unknown>>,
    risk,
    category: 'system',
    summarize: () => name,
    exec: async () => 'ok',
  };
}

function entry(overrides: Partial<CommandEntry> & { id: string }): CommandEntry {
  return {
    kind: 'app',
    title: overrides.id,
    category: 'apps',
    aliases: [],
    source: 'app',
    scopes: { palette: true, agent: true },
    args: [],
    ...overrides,
  };
}

describe('command tool bridge (plan 14 S7)', () => {
  it('synthesizes command_ slugs from entry ids', () => {
    expect(commandToolSlug('app:firefix')).toBe('command_app_firefix');
    expect(commandToolSlug('integration:acme:deploy')).toBe('command_integration_acme_deploy');
  });

  it('synthesizes typed zod schemas from argument specs', () => {
    const schema = schemaFromArgs([
      { name: 'target', required: true, type: 'string', description: 'deploy target' },
      { name: 'retries', required: false, type: 'number' },
      { name: 'dry', required: false, type: 'boolean' },
    ]);
    const parsed = schema.safeParse({ target: 'prod', retries: 2, dry: false });
    expect(parsed.success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ target: 'prod', retries: 'two' }).success).toBe(false);
  });

  it('maps named agent arguments onto positional argv', () => {
    const spec = entry({
      id: 'custom:x',
      args: [
        { name: 'a', required: true, type: 'string' },
        { name: 'b', required: false, type: 'string' },
      ],
    });
    expect(argvForEntry(spec, { a: 'one' })).toEqual(['one', '']);
    expect(argvForEntry(spec, { a: 'one', b: 2 })).toEqual(['one', '2']);
  });

  it('builds tools that execute through the source with agent attribution', async () => {
    const executed: Array<{ id: string; argv: string[] }> = [];
    const source = {
      getAgentEntries: () => [
        entry({
          id: 'app:firefix',
          title: 'Firefix',
          subtitle: 'Browse the web',
          args: [{ name: 'arg1', required: false, type: 'string' }],
        }),
      ],
      executeAgent: async (id: string, argv: string[]) => {
        executed.push({ id, argv });
        return { ok: true, text: 'Launched Firefix.' };
      },
    };
    const wrapped = buildCommandTools(source);
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]?.name).toBe('command_app_firefix');
    expect(wrapped[0]?.risk).toBe('state-changing');
    const result = await wrapped[0]?.tool.invoke({ arg1: 'x' });
    expect(result).toBe('Launched Firefix.');
    expect(executed).toEqual([{ id: 'app:firefix', argv: ['x'] }]);
  });

  it('surfaces execution failures as tool errors', async () => {
    const source = {
      getAgentEntries: () => [entry({ id: 'integration:acme:deploy', args: [] })],
      executeAgent: async () => ({ ok: false, text: 'HTTP 500: boom' }),
    };
    const wrapped = buildCommandTools(source);
    const result = await wrapped[0]?.tool.invoke({});
    expect(String(result)).toContain('command_integration_acme_deploy');
    expect(String(result)).toContain('HTTP 500');
  });
});

import { ToolRegistry } from '@main/ai/tools/registry';
import { buildInterruptOn } from '@main/ai/graphs/assistant';
import { ToolPolicyEngine } from '@main/ai/tools/policy';

describe('executeDirect image handling (plan 14 S8 fix)', () => {
  it('returns image data-URLs separately with clean text — never as [image] placeholders', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'screen_capture',
      description: 'capture',
      schema: z.object({}),
      risk: 'read-only',
      category: 'desktop',
      summarize: () => 'capture',
      exec: async () => [
        { type: 'text', text: 'Screenshot captured. The image is attached below.' },
        { type: 'image', url: 'data:image/jpeg;base64,QUJD' },
      ],
    });
    const outcome = await registry.executeDirect('screen_capture', {});
    expect(outcome.ok).toBe(true);
    expect(outcome.images).toEqual(['data:image/jpeg;base64,QUJD']);
    expect(outcome.text).toBe('Screenshot captured. The image is attached below.');
    expect(outcome.text).not.toContain('[image]');
  });
});

describe('policy seam for bridged commands', () => {
  const makePolicy = (disabled: string[]): ToolPolicyEngine =>
    new ToolPolicyEngine(() => ({
      toolGrants: {},
      disabledTools: disabled,
      grantedRoots: [],
    }));

  it('interrupts state-changing commands and lets read-only wrappers run', () => {
    const registry = new ToolRegistry();
    registry.register(toolDef('run_shell', 'state-changing'));
    const interruptOn = buildInterruptOn(registry, makePolicy([]), [
      { name: 'command_app_firefix', risk: 'state-changing' },
      { name: 'command_custom_grep', risk: 'read-only' },
    ]);
    expect(interruptOn['command_app_firefix']).toBeTruthy();
    expect(interruptOn['command_custom_grep']).toBeUndefined();
    expect(interruptOn['run_shell']).toBeTruthy();
  });

  it('never bridges disabled tools through the policy kill switch', () => {
    const registry = new ToolRegistry();
    registry.register(toolDef('run_shell', 'state-changing'));
    const interruptOn = buildInterruptOn(registry, makePolicy(['run_shell']), [
      { name: 'run_shell', risk: 'state-changing' },
    ]);
    expect(interruptOn['run_shell']).toBeUndefined();
  });
});
