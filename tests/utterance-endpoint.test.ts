import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateUtterance, FAIL_VERDICT, parseUtteranceVerdict } from '@main/ai/utterance';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { LLMProviderType } from '@shared/types';

const gatewayChat = vi.fn();
const deps = {
  gateway: { chat: gatewayChat },
  resolveKey: vi.fn(async () => 'sk-key'),
};

const configWith = (voiceOverrides: Record<string, unknown> = {}, endpointModel?: string, providerOverrides: Record<string, unknown> = {}): AppConfig => ({
  ...DEFAULT_CONFIG,
  providers: [
    {
      ...DEFAULT_CONFIG.providers[0],
      ...(endpointModel
        ? { availableModels: [{ id: endpointModel, name: endpointModel, providerType: LLMProviderType.OPENAI, providerId: DEFAULT_CONFIG.providers[0].id }] }
        : {}),
      ...providerOverrides,
    },
  ],
  taskAssignments: {
    ...DEFAULT_CONFIG.taskAssignments,
    voiceEndpoint: endpointModel ?? null,
  },
  voice: { ...DEFAULT_CONFIG.voice, autoSend: true, ...voiceOverrides },
});

beforeEach(() => {
  gatewayChat.mockReset();
  deps.resolveKey.mockReset();
  deps.resolveKey.mockResolvedValue('sk-key');
});

describe('parseUtteranceVerdict', () => {
  it('accepts explicit JSON verdicts', () => {
    expect(parseUtteranceVerdict('{"complete": true}').complete).toBe(true);
    expect(parseUtteranceVerdict('{"complete": false}').complete).toBe(false);
  });

  it('extracts JSON embedded in prose', () => {
    expect(parseUtteranceVerdict('Sure! {"complete": true} hope that helps.').complete).toBe(true);
  });

  it('fails closed on junk, non-boolean, or missing verdicts', () => {
    expect(parseUtteranceVerdict('no json here')).toEqual(FAIL_VERDICT);
    expect(parseUtteranceVerdict('{"complete": "yes"}')).toEqual(FAIL_VERDICT);
    expect(parseUtteranceVerdict('{}')).toEqual(FAIL_VERDICT);
    expect(parseUtteranceVerdict('{"complete": {"nested": true}}')).toEqual(FAIL_VERDICT);
  });
});

describe('evaluateUtterance', () => {
  it('returns a positive verdict from the assigned voice-endpoint model', async () => {
    gatewayChat.mockResolvedValue('{"complete": true}');
    const verdict = await evaluateUtterance(configWith({}, 'mini-model'), deps, 'What is the weather in Berlin?');
    expect(verdict).toEqual({ complete: true });
    expect(gatewayChat).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'mini-model',
        task: 'voiceEndpoint',
        apiKey: 'sk-key',
      })
    );
  });

  it('fails closed when auto-send is off, unassigned, or text is empty', async () => {
    expect(await evaluateUtterance(configWith({ autoSend: false }, 'mini'), deps, 'hello')).toEqual(FAIL_VERDICT);
    expect(await evaluateUtterance(configWith({}, undefined), deps, 'hello')).toEqual(FAIL_VERDICT);
    expect(await evaluateUtterance(configWith({}, 'mini'), deps, '   ')).toEqual(FAIL_VERDICT);
    expect(gatewayChat).not.toHaveBeenCalled();
  });

  it('fails closed on gateway errors and malformed model output', async () => {
    gatewayChat.mockRejectedValue(new Error('provider down'));
    expect(await evaluateUtterance(configWith({}, 'mini'), deps, 'hello')).toEqual(FAIL_VERDICT);

    gatewayChat.mockResolvedValue('I cannot answer that.');
    expect(await evaluateUtterance(configWith({}, 'mini'), deps, 'hello')).toEqual(FAIL_VERDICT);
  });

  it('treats local-server providers as keyless', async () => {
    gatewayChat.mockResolvedValue('{"complete": false}');
    const verdict = await evaluateUtterance(
      configWith({ autoSend: true }, 'whisper-cpp', { type: LLMProviderType.OLLAMA }),
      {
        gateway: { chat: gatewayChat },
        resolveKey: vi.fn(async () => ''),
      },
      'hallo'
    );
    expect(verdict).toEqual(FAIL_VERDICT);
    expect(gatewayChat).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'local-server' }));
  });

  it('returns model-corrected text only when a fix feature is on', async () => {
    gatewayChat.mockResolvedValue('{"complete": true, "text": "What is the weather in Berlin?"}');
    const fixed = await evaluateUtterance(configWith({ autoFix: true }, 'mini'), deps, 'what is the weather in berlin');
    expect(fixed).toEqual({ complete: true, text: 'What is the weather in Berlin?' });

    gatewayChat.mockResolvedValue('{"complete": true, "text": "rewritten"}');
    const untouched = await evaluateUtterance(configWith({}, 'mini'), deps, 'raw text');
    expect(untouched).toEqual({ complete: true });
    expect(untouched.text).toBeUndefined();
  });

  it('evaluates for text-fixing even when auto-send is off', async () => {
    gatewayChat.mockResolvedValue('{"complete": false, "text": "Hello there."}');
    const verdict = await evaluateUtterance(configWith({ autoSend: false, autoFix: true }, 'mini'), deps, 'hello there');
    expect(verdict).toEqual({ complete: false, text: 'Hello there.' });
    expect(gatewayChat).toHaveBeenCalled();
  });

  it('builds the system prompt from the active features', async () => {
    gatewayChat.mockResolvedValue('{"complete": true}');
    await evaluateUtterance(configWith({ autoFix: true, formatting: true, customPrompt: 'Always write K8s.' }, 'mini'), deps, 'hello');
    const prompt = gatewayChat.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('corrected for punctuation');
    expect(prompt).toContain('paragraphs');
    expect(prompt).toContain('User instructions: Always write K8s.');
    expect(prompt).toContain('"wait", "wait a minute", "hold on"');
    expect(prompt).toContain('choose false');

    await evaluateUtterance(configWith({}, 'mini'), deps, 'hello');
    const barePrompt = gatewayChat.mock.calls[1][0].messages[0].content as string;
    expect(barePrompt).toContain('"text" must be an empty string.');
  });

  it('always fails closed when the evaluator is unsure', () => {
    expect(parseUtteranceVerdict('{"complete": null}').complete).toBe(false);
    expect(parseUtteranceVerdict('{"complete": 1}').complete).toBe(false);
  });

  it('attaches recent context only when the toggle and exchange are present', async () => {
    gatewayChat.mockResolvedValue('{"complete": true}');
    await evaluateUtterance(configWith({ attachContext: true }, 'mini'), deps, 'so about kubernetes', {
      recentExchange: 'User: how do I scale kubernetes?\nAssistant: Use kubectl scale.',
    });
    const userContent = gatewayChat.mock.calls[0][0].messages[1].content as string;
    expect(userContent).toContain('kubectl scale');
    expect(userContent).toContain('reference ONLY');

    await evaluateUtterance(configWith({ attachContext: true }, 'mini'), deps, 'so about kubernetes');
    const bareContent = gatewayChat.mock.calls[1][0].messages[1].content as string;
    expect(bareContent).not.toContain('Recent conversation exchange');

    await evaluateUtterance(configWith({}, 'mini'), deps, 'so about kubernetes', {
      recentExchange: 'User: how do I scale kubernetes?',
    });
    expect((gatewayChat.mock.calls[2][0].messages[1].content as string)).not.toContain('kubectl');
  });
});
