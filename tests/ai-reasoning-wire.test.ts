// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAgentModel } from '@main/ai/chat-models';
import { LLMProvider, LLMProviderType } from '@shared/types';

const provider = {
  id: 'p1',
  name: 'Gateway',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://gateway.local/v1',
  temperature: 0.5,
  maxTokens: 1000,
} as unknown as LLMProvider;

const completionResponse = () =>
  new Response(
    JSON.stringify({
      id: 'cmpl-1',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-5.6-luna',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reasoning_effort on the wire', () => {
  it('sends reasoning_effort none alongside bound tools for gpt-5 style models', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return completionResponse();
      })
    );

    const model = createAgentModel(provider, 'gpt-5.6-luna', 'sk-test', { reasoningEffort: 'none', maxTokens: 1000 });
    const toolModel = model.bindTools?.([
      {
        type: 'function',
        function: {
          name: 'screen_capture',
          description: 'Capture the screen',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ]) ?? model;

    await toolModel.invoke([{ role: 'user', content: 'hi' }]);

    const body = bodies[0] as { reasoning_effort?: string; tools?: unknown[] };
    expect(body.tools).toBeTruthy();
    expect(body.reasoning_effort).toBe('none');
  });

  it('keeps explicit reasoning effort for reasoning-capable models', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return completionResponse();
      })
    );

    const model = createAgentModel(provider, 'gpt-5.6-luna', 'sk-test', { reasoningEffort: 'low' });
    await model.invoke([{ role: 'user', content: 'hi' }]);
    expect((bodies[0] as { reasoning_effort?: string }).reasoning_effort).toBe('low');
  });
});
