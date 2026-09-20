import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import {
  GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS,
  findGeminiUnsupportedKeywords,
  reportGeminiUnsupportedSchemas,
} from '@main/ai/tool-schema-guard';
import { createAssistantRunner } from '@main/ai/graphs/assistant';
import { ToolRegistry } from '@main/ai/tools/registry';
import type { NativeToolDefinition } from '@main/ai/tools/types';
import type { LLMProvider } from '@shared/types';
import { ScriptedChatModel } from './helpers/scripted-model';

describe('findGeminiUnsupportedKeywords', () => {
  it('flags the zod .positive() → exclusiveMinimum shape (the kill_process regression)', () => {
    const schema = z.object({ pid: z.number().int().positive() });
    expect(findGeminiUnsupportedKeywords('kill_process', schema)).toEqual([
      { tool: 'kill_process', path: 'parameters.properties.pid.exclusiveMinimum', keyword: 'exclusiveMinimum' },
    ]);
  });

  it('flags nested keywords in plain JSON schemas (MCP tools)', () => {
    const schema = {
      type: 'object',
      properties: {
        rows: { type: 'array', items: { type: 'number', exclusiveMaximum: 100 } },
      },
    };
    expect(findGeminiUnsupportedKeywords('mcp__srv__query', schema)).toEqual([
      {
        tool: 'mcp__srv__query',
        path: 'parameters.properties.rows.items.exclusiveMaximum',
        keyword: 'exclusiveMaximum',
      },
    ]);
  });

  it('flags type-array unions the Gemini converter throws on (the datetime regression)', () => {
    const schema = z.object({
      date: z.union([z.string(), z.number()]).optional(),
      notes: z.string().optional(),
    });
    expect(findGeminiUnsupportedKeywords('datetime', schema)).toEqual([
      { tool: 'datetime', path: 'parameters.properties.date.type', keyword: 'type[string|number]' },
    ]);
  });

  it('does not flag nullable or single-member type arrays the converter rewrites', () => {
    const schema = {
      type: 'object',
      properties: {
        limit: { type: ['integer', 'null'] },
        label: { type: ['string'] },
      },
    };
    expect(findGeminiUnsupportedKeywords('mcp__srv__f', schema)).toEqual([]);
  });

  it('passes clean schemas', () => {
    const schema = z.object({ count: z.number().int().min(1).max(10), query: z.string() });
    expect(findGeminiUnsupportedKeywords('search', schema)).toEqual([]);
  });

  it('ignores keywords the LangChain converter strips before the request', () => {
    const schema = {
      type: 'object',
      $schema: 'http://json-schema.org/draft-07/schema#',
      additionalProperties: false,
      properties: { value: { type: 'string' } },
    };
    expect(findGeminiUnsupportedKeywords('tool', schema)).toEqual([]);
  });

  it('exposes exactly the unsupported keyword set', () => {
    expect(GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS).toEqual(['exclusiveMinimum', 'exclusiveMaximum']);
  });
});

describe('reportGeminiUnsupportedSchemas', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns once naming each offending tool and keyword path', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const findings = reportGeminiUnsupportedSchemas([
      { name: 'kill_process', schema: z.object({ pid: z.number().int().positive() }) },
      { name: 'safe', schema: z.object({ q: z.string() }) },
    ]);
    expect(findings).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('kill_process: parameters.properties.pid.exclusiveMinimum');
    expect(warn.mock.calls[0][0]).not.toContain('safe');
  });

  it('stays silent when every schema is Gemini-safe', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const findings = reportGeminiUnsupportedSchemas([{ name: 'safe', schema: z.object({ q: z.string() }) }]);
    expect(findings).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the whole native catalog Gemini-clean (no union/keyword offenders)', async () => {
    const { NATIVE_TOOL_CATALOG } = await import('@main/ai/tools/native');
    const findings = reportGeminiUnsupportedSchemas(
      NATIVE_TOOL_CATALOG.map((def) => ({ name: def.name, schema: def.schema }))
    );
    expect(findings).toEqual([]);
  });
});

describe('assistant runner schema guard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const badTool: NativeToolDefinition<{ pid: number }> = {
    name: 'kill_process',
    description: 'Kills a process.',
    schema: z.object({ pid: z.number().int().positive() }),
    risk: 'destructive',
    summarize: (args) => `Kill ${args.pid}`,
    exec: async (args) => `Killed ${args.pid}`,
  };

  const makeRunner = () => {
    const registry = new ToolRegistry();
    registry.register(badTool);
    return createAssistantRunner({ registry, createModel: () => new ScriptedChatModel([new AIMessage({ content: 'done' })]) });
  };

  const runTurn = (type: LLMProvider['type']) =>
    makeRunner().run({
      provider: { id: 'p1', type, systemPrompt: '' } as unknown as LLMProvider,
      modelId: 'test-model',
      apiKey: 'sk-test',
      history: [{ role: 'user', content: 'hi' }],
      threadId: 'guard-test',
    });

  it('warns when a google provider binds an offending tool schema', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for await (const _event of runTurn('google')) {
      void _event;
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('kill_process');
  });

  it('does not warn for other providers (schemas are tolerated there)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for await (const _event of runTurn('openai')) {
      void _event;
    }
    expect(warn).not.toHaveBeenCalled();
  });
});
