import { describe, it, expect } from 'vitest';
import { AiGateway } from '@main/ai/gateway';
import { AiCallRecord } from '@main/ai/audit';
import { LLMProvider, LLMProviderType } from '@shared/types';

const provider: LLMProvider = {
  id: 'p1', name: 'Test', type: 0, apiKey: '', apiBase: 'http://localhost:11434/v1',
  timeout: 30, temperature: 0.7, maxTokens: 128, systemPrompt: '',
} as unknown as LLMProvider;

const baseRequest = {
  provider,
  modelId: 'test-model',
  apiKey: 'sk-test',
  messages: [{ role: 'user' as const, content: 'hello' }],
  task: 'chat',
};

describe('AiGateway embed', () => {
  it('returns vectors and audits an ok embed row over the sanctioned transport', async () => {
    const rows: AiCallRecord[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2] }] }), { status: 200 })) as typeof fetch;
    try {
      const gateway = new AiGateway(() => ({ invoke: null as never, stream: null as never }), async (r) => { rows.push(r); });
      const vectors = await gateway.embed({ provider: { ...provider, type: LLMProviderType.OPENAI }, modelId: 'embed-model', apiKey: 'sk-test', texts: ['hello'] });
      expect(vectors).toEqual([[0.1, 0.2]]);
      expect(rows[0]).toMatchObject({ task: 'embed', model: 'embed-model', outcome: 'ok' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('audits a typed-unsupported provider as an embed error', async () => {
    const rows: AiCallRecord[] = [];
    const gateway = new AiGateway(() => ({ invoke: null as never, stream: null as never }), async (r) => { rows.push(r); });
    await expect(
      gateway.embed({ provider: { ...provider, type: 99 as never }, modelId: 'x', apiKey: 'k', texts: ['hello'] })
    ).rejects.toThrow(/does not serve embeddings/);
    expect(rows[0]).toMatchObject({ task: 'embed', outcome: 'error' });
  });
});

describe('AiGateway', () => {
  it('chat returns text and records an ok audit row', async () => {
    const rows: AiCallRecord[] = [];
    const gateway = new AiGateway(
      () => ({ invoke: async () => ({ content: ' model says hi' }), stream: null as never })
    , async (r) => { rows.push(r); });

    const text = await gateway.chat(baseRequest);
    expect(text).toBe(' model says hi');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ task: 'chat', model: 'test-model', outcome: 'ok' });
    expect(rows[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('chat records provider token usage when the response carries it', async () => {
    const rows: AiCallRecord[] = [];
    const gateway = new AiGateway(
      () => ({
        invoke: async () => ({ content: 'ok', usage_metadata: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } }),
        stream: null as never,
      }),
      async (r) => { rows.push(r); }
    );
    await gateway.chat(baseRequest);
    expect(rows[0]).toMatchObject({ inputTokens: 120, outputTokens: 30 });
  });

  it('chat joins multimodal content parts', async () => {
    const gateway = new AiGateway(
      () => ({ invoke: async () => ({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), stream: null as never }),
      async () => {}
    );
    expect(await gateway.chat(baseRequest)).toBe('ab');
  });

  it('accumulates split provider stream usage across chunks', async () => {
    const rows: AiCallRecord[] = [];
    const gateway = new AiGateway(
      () => ({
        invoke: null as never,
        stream: async function* () {
          yield { content: 'a', usage_metadata: { input_tokens: 100, output_tokens: 0 } };
          yield { content: 'b', usage_metadata: { input_tokens: 0, output_tokens: 50 } };
        },
      }),
      async (r) => { rows.push(r); }
    );
    let text = '';
    for await (const token of gateway.chatStream(baseRequest)) {
      text += token;
    }
    expect(text).toBe('ab');
    expect(rows[0]).toMatchObject({ inputTokens: 100, outputTokens: 50, outcome: 'ok' });
  });

  it('uses cumulative max for an Anthropic-shaped stream', async () => {
    const rows: AiCallRecord[] = [];
    const gateway = new AiGateway(
      () => ({
        invoke: null as never,
        stream: async function* () {
          yield { content: '', usage_metadata: { input_tokens: 100, output_tokens: 1 } };
          yield { content: 'a', usage_metadata: { input_tokens: 0, output_tokens: 50 } };
        },
      }),
      async (r) => { rows.push(r); }
    );
    const request = { ...baseRequest, provider: { ...provider, type: LLMProviderType.ANTHROPIC } };
    for await (const _token of gateway.chatStream(request)) {
      continue;
    }
    expect(rows[0]).toMatchObject({ inputTokens: 100, outputTokens: 50, outcome: 'ok' });
  });

  it('records a cancelled stream with the partial usage', async () => {
    const rows: AiCallRecord[] = [];
    const gateway = new AiGateway(
      () => ({
        invoke: null as never,
        stream: async function* () {
          yield { content: 'first', usage_metadata: { input_tokens: 10, output_tokens: 2 } };
          yield { content: 'second' };
        },
      }),
      async (r) => { rows.push(r); }
    );
    for await (const token of gateway.chatStream(baseRequest)) {
      expect(token).toBe('first');
      break;
    }
    expect(rows[0]).toMatchObject({ outcome: 'error', error: 'cancelled', inputTokens: 10, outputTokens: 2 });
  });

  it('chat failure records an error audit row and rethrows', async () => {
    const rows: AiCallRecord[] = [];
    const gateway = new AiGateway(
      () => ({ invoke: async () => { throw new Error('boom'); }, stream: null as never }),
      async (r) => { rows.push(r); }
    );
    await expect(gateway.chat(baseRequest)).rejects.toThrow(/AI request failed for model test-model: boom/);
    expect(rows[0]).toMatchObject({ outcome: 'error', error: 'boom' });
  });

  it('chatStream yields non-empty tokens and audits once at the end', async () => {
    const rows: AiCallRecord[] = [];
    const gateway = new AiGateway(
      () => ({
        invoke: null as never,
        stream: async function* () {
          yield { content: 'He' };
          yield { content: '' };
          yield { content: [{ type: 'text', text: 'llo' }] };
        },
      }),
      async (r) => { rows.push(r); }
    );

    const tokens: string[] = [];
    for await (const token of gateway.chatStream(baseRequest)) {
      tokens.push(token);
    }
    expect(tokens).toEqual(['He', 'llo']);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('ok');
  });

  it('chatStream failure mid-stream audits error and rethrows', async () => {
    const rows: AiCallRecord[] = [];
    const gateway = new AiGateway(
      () => ({
        invoke: null as never,
        stream: async function* () {
          yield { content: 'partial' };
          throw new Error('connection dropped');
        },
      }),
      async (r) => { rows.push(r); }
    );

    const tokens: string[] = [];
    await expect(async () => {
      for await (const token of gateway.chatStream(baseRequest)) {
        tokens.push(token);
      }
    }).rejects.toThrow(/AI stream failed/);
    expect(tokens).toEqual(['partial']);
    expect(rows[0]).toMatchObject({ outcome: 'error', error: 'connection dropped' });
  });

  it('chatStream awaits Promise-returning .stream (current ChatOpenAI shape)', async () => {
    const rows: AiCallRecord[] = [];
    const gateway = new AiGateway(
      () => ({
        invoke: null as never,
        stream: async () =>
          (async function* () {
            yield { content: 'He' };
            yield { content: 'y' };
          })(),
      }),
      async (r) => { rows.push(r); }
    );

    const tokens: string[] = [];
    for await (const token of gateway.chatStream(baseRequest)) {
      tokens.push(token);
    }
    expect(tokens).toEqual(['He', 'y']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'ok' });
  });

  it('chatStream audits Promise-returning .stream failures too', async () => {
    const rows: AiCallRecord[] = [];
    const gateway = new AiGateway(
      () => ({
        invoke: null as never,
        stream: async () =>
          (async function* () {
            yield { content: 'partial' };
            throw new Error('connection dropped');
          })(),
      }),
      async (r) => { rows.push(r); }
    );

    const tokens: string[] = [];
    await expect(async () => {
      for await (const token of gateway.chatStream(baseRequest)) {
        tokens.push(token);
      }
    }).rejects.toThrow(/AI stream failed/);
    expect(tokens).toEqual(['partial']);
    expect(rows[0]).toMatchObject({ outcome: 'error', error: 'connection dropped' });
  });
});
