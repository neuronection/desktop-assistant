import { describe, it, expect } from 'vitest';
import { HumanMessage, ToolMessage, AIMessage } from '@langchain/core/messages';
import { convertMessagesToGeminiContents } from '../node_modules/@langchain/google/dist/converters/messages.js';

const imageContent = (data = 'QUJD') => [
  { type: 'text', text: 'Screenshot captured of the primary display.' },
  { type: 'image', source_type: 'base64', data, mime_type: 'image/jpeg' },
];

const toolCallsMessage = () =>
  new AIMessage({
    content: 'Checking the capture…',
    tool_calls: [{ id: 'call_1', name: 'recall_screenshot', args: { stepId: 's1' } }],
  });

const toolMessage = (content: unknown, status?: 'error') =>
  new ToolMessage({
    content: content as never,
    tool_call_id: 'call_1',
    name: 'recall_screenshot',
    ...(status ? { status } : {}),
  });

describe('gemini tool-message image wire (@langchain/google converter)', () => {
  it('emits media as a sibling inlineData part beside the functionResponse', () => {
    const contents = convertMessagesToGeminiContents([toolCallsMessage(), toolMessage(imageContent())]);
    expect(contents).toHaveLength(2);
    const parts = contents[1].parts;
    expect(parts).toHaveLength(2);
    expect(parts?.[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } });
    const fr = parts?.[1] as { functionResponse: { name: string; response: { result: unknown } } };
    expect(fr.functionResponse.name).toBe('recall_screenshot');
    expect(JSON.stringify(fr.functionResponse.response)).toContain('Screenshot captured');
    expect(JSON.stringify(fr)).not.toContain('"inlineData"');
  });

  it('keeps text-only tool results in the functionResponse with no media part', () => {
    const contents = convertMessagesToGeminiContents([toolCallsMessage(), toolMessage([{ type: 'text', text: 'done' }])]);
    const parts = contents[1].parts;
    expect(parts).toHaveLength(1);
    expect(JSON.stringify(parts?.[0])).toContain('done');
    expect(JSON.stringify(parts)).not.toContain('inlineData');
  });

  it('leaves plain-string tool results unchanged', () => {
    const contents = convertMessagesToGeminiContents([toolCallsMessage(), toolMessage('done')]);
    const parts = contents[1].parts;
    expect(parts).toEqual([
      { functionResponse: { id: 'call_1', name: 'recall_screenshot', response: { result: 'done' } } },
    ]);
  });

  it('keeps error-status tool results as text the model can read', () => {
    const contents = convertMessagesToGeminiContents([
      toolCallsMessage(),
      toolMessage([{ type: 'text', text: 'boom' }], 'error'),
    ]);
    const parts = contents[1].parts;
    expect(parts).toHaveLength(1);
    expect(JSON.stringify(parts?.[0])).toContain('boom');
  });

  it('does not disturb the human-message vision path', () => {
    const human = new HumanMessage({
      content: [
        { type: 'text', text: 'what do you see?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
      ],
    });
    const contents = convertMessagesToGeminiContents([human]);
    expect(contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'what do you see?' }, { inlineData: { data: 'QUJD', mimeType: 'image/jpeg' } }],
      },
    ]);
  });
});
