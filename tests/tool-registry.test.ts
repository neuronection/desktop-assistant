import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolMessage } from '@langchain/core/messages';
import { convertMessagesToCompletionsMessageParams } from '@langchain/openai';
import {
  ToolRegistry,
  buildLangChainTool,
  capToolResult,
  mergeTools,
  namespaceMcpTool,
  truncateText,
  withToolTimeout,
  DEFAULT_RESULT_CHAR_CAP,
} from '@main/ai/tools/registry';
import { buildDefaultToolRegistry } from '@main/ai/tools/native';
import type { NativeToolDefinition } from '@main/ai/tools/types';

const echoDef: NativeToolDefinition<{ text: string }> = {
  name: 'echo',
  description: 'Echoes text back.',
  schema: z.object({ text: z.string() }),
  risk: 'read-only',
  summarize: (args) => `Echo: ${args.text}`,
  exec: async (args) => `Echoed ${args.text}`,
};

const failingDef: NativeToolDefinition = {
  name: 'always_fails',
  description: 'Always throws.',
  schema: z.object({}),
  risk: 'read-only',
  summarize: () => 'Fails',
  exec: async () => {
    throw new Error('kaboom');
  },
};

const slowDef: NativeToolDefinition = {
  name: 'slow',
  description: 'Slow tool.',
  schema: z.object({}),
  risk: 'read-only',
  timeoutMs: 20,
  summarize: () => 'Slow',
  exec: async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return 'finally';
  },
};

describe('truncateText / capToolResult', () => {
  it('keeps short text intact and truncates with a counted suffix', () => {
    expect(truncateText('short', 10)).toBe('short');
    const truncated = truncateText('x'.repeat(30), 10);
    expect(truncated).toContain('…[truncated 20 chars]');
  });

  it('caps string results and text blocks but leaves image blocks alone', () => {
    expect(truncateText('y'.repeat(25), 10)).toContain('truncated 15 chars');
    const capped = capToolResult(
      [
        { type: 'text', text: 'z'.repeat(25) },
        { type: 'image', url: 'data:image/png;base64,AAAA' },
      ],
      10
    );
    expect((capped[0] as { text: string }).text).toContain('truncated 15 chars');
    expect(capped[1]).toMatchObject({ type: 'image' });
  });
});

describe('withToolTimeout', () => {
  it('rejects with a tool-name error when the deadline passes', async () => {
    await expect(withToolTimeout(new Promise(() => undefined), 10, 'slow_tool')).rejects.toThrow(/slow_tool timed out/);
  });
});

describe('buildLangChainTool', () => {
  it('validates args with the zod schema', async () => {
    const built = buildLangChainTool(echoDef);
    await expect(built.invoke({ text: 'hi' })).resolves.toBe('Echoed hi');
    await expect(built.invoke({ wrong: 1 } as never)).rejects.toThrow();
  });

  it('returns an agent-visible error string when the tool throws', async () => {
    const built = buildLangChainTool(failingDef);
    await expect(built.invoke({})).resolves.toBe('Error (always_fails): kaboom');
  });

  it('enforces the per-tool timeout', async () => {
    const built = buildLangChainTool(slowDef);
    await expect(built.invoke({})).resolves.toMatch(/timed out after 0s/);
  });

  it('truncates oversized results', async () => {
    const big: NativeToolDefinition = {
      ...echoDef,
      name: 'big',
      exec: async () => 'a'.repeat(50),
      resultCharCap: 10,
    };
    const built = buildLangChainTool(big);
    await expect(built.invoke({ text: 'x' })).resolves.toContain('truncated 40 chars');
  });

  it('emits image results as base64 data blocks providers convert in tool messages', async () => {
    const imager: NativeToolDefinition = {
      ...echoDef,
      name: 'imager',
      exec: async () => [
        { type: 'text', text: 'captured' },
        { type: 'image', url: 'data:image/jpeg;base64,QUJD', mimeType: 'image/jpeg' },
      ],
    };
    const built = buildLangChainTool(imager);
    await expect(built.invoke({ text: 'x' })).resolves.toEqual([
      { type: 'text', text: 'captured' },
      { type: 'image', source_type: 'base64', data: 'QUJD', mime_type: 'image/jpeg' },
    ]);
  });

  it('degrades non-data-URL image results to an omission note', async () => {
    const imager: NativeToolDefinition = {
      ...echoDef,
      name: 'imager_http',
      exec: async () => [{ type: 'image', url: 'https://example.com/pic.png' }],
    };
    const built = buildLangChainTool(imager);
    await expect(built.invoke({ text: 'x' })).resolves.toEqual([
      { type: 'text', text: 'Image result omitted (unsupported encoding).' },
    ]);
  });

  it('wire blocks serialize to provider-legal content parts in a tool message', async () => {
    const built = buildLangChainTool({
      ...echoDef,
      name: 'imager_wire',
      exec: async () => [
        { type: 'text', text: 'captured' },
        { type: 'image', url: 'data:image/jpeg;base64,QUJD', mimeType: 'image/jpeg' },
      ],
    });
    const content = (await built.invoke({ text: 'x' })) as unknown[];
    const toolMessage = new ToolMessage({ content, tool_call_id: 'call_1' });
    expect(convertMessagesToCompletionsMessageParams({ messages: [toolMessage], model: 'gpt-4o' })).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: [
          { type: 'text', text: 'captured' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
        ],
      },
    ]);
  });
});

describe('namespaceMcpTool', () => {
  it('namespaces short names without changes', () => {
    expect(namespaceMcpTool('math', 'add')).toBe('mcp__math__add');
  });

  it('keeps names within 64 chars and distinct for long inputs', () => {
    const a = namespaceMcpTool('a'.repeat(60), 'b'.repeat(60));
    const b = namespaceMcpTool('a'.repeat(60), 'c'.repeat(60));
    expect(a.length).toBeLessThanOrEqual(64);
    expect(b.length).toBeLessThanOrEqual(64);
    expect(a).toMatch(/^mcp__/);
    expect(a).not.toBe(b);
  });

  it('keeps the catalog default registry complete', () => {
    const registry = buildDefaultToolRegistry();
    const names = registry.list().map((def) => def.name);
    expect(names).toEqual(
      expect.arrayContaining(['screen_capture', 'system_info', 'clipboard_read', 'list_apps', 'web_fetch'])
    );
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('ToolRegistry', () => {
  it('rejects duplicate names and summarizes known tools', () => {
    const registry = new ToolRegistry();
    registry.register(echoDef);
    expect(() => registry.register(echoDef)).toThrow(/already registered/);
    expect(registry.summarizeFor('echo', { text: 'hi' })).toBe('Echo: hi');
  });

  it('falls back to a bounded JSON summary for unknown tools', () => {
    const registry = new ToolRegistry();
    const summary = registry.summarizeFor('mystery', { q: 'x'.repeat(300) });
    expect(summary.length).toBeLessThanOrEqual(160);
    expect(summary).toContain('q');
  });
});

describe('mergeTools', () => {
  it('preserves native names and namespaces mcp tools collision-proof', () => {
    const native = [buildLangChainTool(echoDef)];
    const mcp = [buildLangChainTool(echoDef), buildLangChainTool(failingDef)];
    const merged = mergeTools(native, mcp);
    expect(merged).toHaveLength(3);
    expect(merged[0].name).toBe('echo');
    expect(merged[1].name).not.toBe('echo');
    expect(merged[1].name).toMatch(/^mcp__/);
    expect(merged[2].name).not.toBe(merged[1].name);
  });
});
