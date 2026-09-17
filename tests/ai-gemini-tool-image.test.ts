import { describe, it, expect } from 'vitest';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { convertMessageContentToParts } from '../node_modules/@langchain/google-genai/dist/utils/common.js';

const imageContent = (data = 'QUJD') => [
  { type: 'text', text: 'Screenshot captured of the primary display.' },
  { type: 'image', source_type: 'base64', data, mime_type: 'image/jpeg' },
];

const toolCallsMessage = {
  _getType: () => 'ai',
  getType: () => 'ai',
  tool_calls: [{ id: 'call_1', name: 'recall_screenshot', args: { stepId: 's1' } }],
  content: '',
};

const toolMessage = (content: unknown, status?: 'error') =>
  new ToolMessage({
    content: content as never,
    tool_call_id: 'call_1',
    name: 'recall_screenshot',
    ...(status ? { status } : {}),
  });

describe('gemini tool-message image wire (patched converter)', () => {
  it('nests media as functionResponse.parts on gemini-3 models', () => {
    const parts = convertMessageContentToParts(toolMessage(imageContent()), true, [toolCallsMessage], 'gemini-3.8-flash');
    expect(parts).toHaveLength(1);
    const response = (parts[0] as { functionResponse: { response: { result: unknown } } }).functionResponse.response;
    expect(response.result).toBe('Screenshot captured of the primary display.');
    expect(JSON.stringify(response)).not.toContain('inlineData');
    const fr = (parts[0] as { functionResponse: { parts?: unknown[] } }).functionResponse;
    expect(fr.parts).toEqual([{ inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } }]);
  });

  it('emits media as sibling parts on pre-gemini-3 models', () => {
    const parts = convertMessageContentToParts(toolMessage(imageContent()), true, [toolCallsMessage], 'gemini-2.5-flash');
    expect(parts).toHaveLength(2);
    const fr = (parts[0] as { functionResponse: { response: { result: unknown }; parts?: unknown } }).functionResponse;
    expect(fr.response.result).toBe('Screenshot captured of the primary display.');
    expect(fr.parts).toBeUndefined();
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } });
  });

  it('keeps text-only tool results free of a parts key', () => {
    const parts = convertMessageContentToParts(
      toolMessage([{ type: 'text', text: 'done' }]),
      true,
      [toolCallsMessage],
      'gemini-3.8-flash'
    );
    expect(parts).toEqual([
      { functionResponse: { name: 'recall_screenshot', response: { result: 'done' } } },
    ]);
  });

  it('leaves plain-string tool results unchanged', () => {
    const parts = convertMessageContentToParts(toolMessage('done'), true, [toolCallsMessage], 'gemini-3.8-flash');
    expect(parts).toEqual([
      { functionResponse: { name: 'recall_screenshot', response: { result: 'done' } } },
    ]);
  });

  it('keeps error-status tool results wrapped in the error response', () => {
    const parts = convertMessageContentToParts(
      toolMessage([{ type: 'text', text: 'boom' }], 'error'),
      true,
      [toolCallsMessage],
      'gemini-3.8-flash'
    );
    expect(parts).toEqual([
      {
        functionResponse: {
          name: 'recall_screenshot',
          response: { error: { details: [{ text: 'boom' }] } },
        },
      },
    ]);
  });

  it('does not disturb the human-message vision path', () => {
    const human = new HumanMessage({
      content: [
        { type: 'text', text: 'what do you see?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
      ],
    });
    const parts = convertMessageContentToParts(human, true, [], 'gemini-3.8-flash');
    expect(parts).toEqual([
      { text: 'what do you see?' },
      { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } },
    ]);
  });
});
