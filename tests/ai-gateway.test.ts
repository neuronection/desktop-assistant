import { describe, it, expect } from 'vitest';
import { AiGateway } from '@main/ai/gateway';
import { AiCallRecord } from '@main/ai/audit';
import { LLMProvider } from '@shared/types';

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

  it('chat joins multimodal content parts', async () => {
    const gateway = new AiGateway(
      () => ({ invoke: async () => ({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), stream: null as never }),
      async () => {}
    );
    expect(await gateway.chat(baseRequest)).toBe('ab');
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
});
