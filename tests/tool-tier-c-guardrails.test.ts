import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';

let trashCalls: string[] = [];

vi.mock('electron', () => ({
  shell: {
    trashItem: vi.fn(async (path: string) => {
      trashCalls.push(path);
      return true;
    }),
  },
}));

import { fileDeleteTool } from '@main/ai/tools/native/file-delete';
import { killProcessTool } from '@main/ai/tools/native/kill-process';
import { buildLangChainTool, ToolRegistry } from '@main/ai/tools/registry';
import { ToolPolicyEngine } from '@main/ai/tools/policy';
import type { NativeToolDefinition } from '@main/ai/tools/types';
import { z } from 'zod';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'da-tierc-'));
  await mkdir(join(root, 'sub'), { recursive: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const ctx = (grantedRoots: string[]) => ({ grantedRoots });

describe('file_delete', () => {
  it('moves files inside granted roots to the trash', async () => {
    const target = join(root, 'gone.txt');
    await writeFile(target, 'bye', 'utf-8');
    const result = await fileDeleteTool.exec({ path: target }, ctx([root]));
    expect(result).toContain('trash');
    expect(trashCalls).toContain(target);
  });

  it('refuses paths outside granted roots', async () => {
    const result = await fileDeleteTool.exec({ path: '/etc/passwd' }, ctx([root]));
    expect(result).toContain('Error:');
    expect(result).toContain('was not granted');
    expect(trashCalls).not.toContain('/etc/passwd');
  });

  it('reports missing targets', async () => {
    expect(await fileDeleteTool.exec({ path: join(root, 'nope.txt') }, ctx([root]))).toContain('does not exist');
  });
});

describe('kill_process', () => {
  it('refuses PID 1 and the assistant process itself', async () => {
    expect(await killProcessTool.exec({ pid: 1 }, ctx([]))).toContain('refusing');
    expect(await killProcessTool.exec({ pid: process.pid }, ctx([]))).toContain('refusing');
  });

  it('terminates a live child process', async () => {
    const child = spawn('sleep', ['60'], { stdio: 'ignore', detached: false });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pid = child.pid!;
    const result = await killProcessTool.exec({ pid }, ctx([]));
    expect(result).toContain(`Process ${pid}`);
    await vi.waitFor(() => {
      expect(() => process.kill(pid, 0)).toThrow();
    });
  });

  it('reports unknown PIDs without killing anything', async () => {
    const result = await killProcessTool.exec({ pid: 999_999_999 }, ctx([]));
    expect(result).toContain('No process');
  });
});

describe('destructive serialization + policy', () => {
  const slowDestructive = (name: string, ms: number, log: string[]): NativeToolDefinition<Record<string, never>> => ({
    name,
    description: name,
    schema: z.object({}),
    risk: 'destructive',
    summarize: () => name,
    async exec() {
      log.push(`start:${name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`end:${name}`);
      return name;
    },
  });

  it('serializes destructive tools even when the model batches them', async () => {
    const registry = new ToolRegistry();
    const log: string[] = [];
    registry.register(slowDestructive('destroy_a', 40, log));
    registry.register(slowDestructive('destroy_b', 10, log));
    const [a, b] = registry.buildTools();

    await Promise.all([a.invoke({}), b.invoke({})]);
    expect(log.indexOf('start:destroy_b')).toBeGreaterThan(log.indexOf('start:destroy_a'));
    expect(log).toEqual(['start:destroy_a', 'end:destroy_a', 'start:destroy_b', 'end:destroy_b']);
  });

  it('runs read-only tools in parallel (unaffected)', async () => {
    const registry = new ToolRegistry();
    const log: string[] = [];
    registry.register({
      name: 'quick_read',
      description: 'x',
      schema: z.object({}),
      risk: 'read-only',
      summarize: () => 'x',
      async exec() {
        log.push('start');
        await new Promise((resolve) => setTimeout(resolve, 30));
        log.push('end');
        return 'ok';
      },
    });
    const tool = registry.buildTools()[0];
    await Promise.all([tool.invoke({}), tool.invoke({})]);
    expect(log).toEqual(['start', 'start', 'end', 'end']);
  });

  it('policy always requires approval for destructive tools, grants never bypass', () => {
    const engine = new ToolPolicyEngine(
      () => ({ toolGrants: { run_shell: 'always' }, disabledTools: [], grantedRoots: [] })
    );
    engine.grantSession('run_shell');
    expect(engine.decision('run_shell', 'destructive')).toBe('approve');
    expect(engine.needsApproval('run_shell', 'destructive')).toBe(true);
    expect(engine.grantSource('run_shell', 'destructive')).toBe('once');
  });

  it('disabled destructive tools stay denied', () => {
    const engine = new ToolPolicyEngine(
      () => ({ toolGrants: {}, disabledTools: ['kill_process'], grantedRoots: [] })
    );
    expect(engine.decision('kill_process', 'destructive')).toBe('deny');
  });

  it('buildLangChainTool passes the destructive gate through to the wrapper', async () => {
    const order: string[] = [];
    const def = slowDestructive('gated', 5, order);
    const gate = async <A>(_args: A, run: (args: A) => Promise<unknown>) => {
      order.push('gate:before');
      const result = await run(_args);
      order.push('gate:after');
      return result;
    };
    const tool = buildLangChainTool(def, {}, gate);
    await tool.invoke({});
    expect(order).toEqual(['gate:before', 'start:gated', 'end:gated', 'gate:after']);
  });
});
