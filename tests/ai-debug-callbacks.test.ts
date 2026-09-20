import { describe, it, expect, afterEach, vi } from 'vitest';
import { aiDebugCallbacks, aiDebugEnabled } from '@main/ai/debug';

afterEach(() => {
  delete process.env.DA_AI_DEBUG;
  vi.restoreAllMocks();
});

describe('ai debug callbacks (DA_AI_DEBUG)', () => {
  it('emits nothing when the flag is off', () => {
    delete process.env.DA_AI_DEBUG;
    expect(aiDebugEnabled()).toBe(false);
    expect(aiDebugCallbacks()).toEqual([]);
  });

  it('logs bound tool names on llm start when enabled', () => {
    process.env.DA_AI_DEBUG = '1';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const [handler] = aiDebugCallbacks();
    expect(handler).toBeTruthy();
    handler!.handleLLMStart(null, [], 'run-1', undefined, {
      invocation_params: {
        model: 'gpt-5.6-luna',
        tools: [
          { type: 'function', function: { name: 'web_search' } },
          { type: 'function', function: { name: 'screen_capture' } },
        ],
      },
    } as unknown as Record<string, unknown>);
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0][0] as string;
    expect(line).toContain('[ai-debug] llm start');
    expect(line).toContain('gpt-5.6-luna');
    expect(line).toContain('web_search,screen_capture');
  });

  it('reports NONE when no tools are in the invocation params', () => {
    process.env.DA_AI_DEBUG = '1';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const [handler] = aiDebugCallbacks();
    handler!.handleLLMStart(null, [], 'run-1', undefined, { invocation_params: { model: 'm' } } as unknown as Record<string, unknown>);
    expect(log.mock.calls[0][0] as string).toContain('tools=NONE');
  });

  it('logs parsed tool_calls on llm end', () => {
    process.env.DA_AI_DEBUG = '1';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const [handler] = aiDebugCallbacks();
    handler!.handleLLMEnd({
      generations: [[{ message: { content: 'I will search.', tool_calls: [{ name: 'web_search', args: {}, id: 'c1', type: 'tool_call' }] } }]],
    } as unknown as Parameters<NonNullable<ReturnType<typeof aiDebugCallbacks>[0]>['handleLLMEnd']>[0]);
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0][0] as string;
    expect(line).toContain('tool_calls=web_search');
    expect(line).toContain('I will search.');
  });

  it('reports tool_calls=none for plain text replies', () => {
    process.env.DA_AI_DEBUG = '1';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const [handler] = aiDebugCallbacks();
    handler!.handleLLMEnd({
      generations: [[{ message: { content: 'plain answer' } }]],
    } as unknown as Parameters<NonNullable<ReturnType<typeof aiDebugCallbacks>[0]>['handleLLMEnd']>[0]);
    const line = log.mock.calls[0][0] as string;
    expect(line).toContain('tool_calls=none');
    expect(line).toContain('plain answer');
  });
});
