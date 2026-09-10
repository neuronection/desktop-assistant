import { describe, it, expect } from 'vitest';
import { ToolResultStore, extractStoredResult } from '@main/turns/tool-results';

describe('extractStoredResult', () => {
  it('passes plain string content through as text', () => {
    expect(extractStoredResult('Echoed hi')).toEqual({ text: 'Echoed hi', images: [] });
  });

  it('splits wire blocks into text and base64 data-URL images', () => {
    const extracted = extractStoredResult([
      { type: 'text', text: 'Screenshot captured.' },
      { type: 'image', source_type: 'base64', data: 'QUJD', mime_type: 'image/jpeg' },
    ]);
    expect(extracted.text).toBe('Screenshot captured.');
    expect(extracted.images).toEqual(['data:image/jpeg;base64,QUJD']);
  });

  it('keeps legacy data-URL image blocks and drops remote URLs', () => {
    const extracted = extractStoredResult([
      { type: 'text', text: 'a' },
      { type: 'image', url: 'data:image/png;base64,WFla' },
      { type: 'image', url: 'https://example.com/pic.png' },
    ]);
    expect(extracted.images).toEqual(['data:image/png;base64,WFla']);
  });

  it('returns empty text for non-array non-string content', () => {
    expect(extractStoredResult({ odd: true })).toEqual({ text: '', images: [] });
  });
});

describe('ToolResultStore', () => {
  it('roundtrips a stored result with its callId', () => {
    const store = new ToolResultStore();
    store.put('tool_call_1', { tool: 'screen_capture', status: 'ok', text: 'shot', images: ['data:image/jpeg;base64,QUJD'] });
    expect(store.get('tool_call_1')).toEqual({
      callId: 'tool_call_1',
      tool: 'screen_capture',
      status: 'ok',
      text: 'shot',
      images: ['data:image/jpeg;base64,QUJD'],
    });
  });

  it('returns null for unknown ids', () => {
    expect(new ToolResultStore().get('nope')).toBeNull();
  });

  it('evicts the oldest entry beyond the cap', () => {
    const store = new ToolResultStore();
    for (let index = 0; index < 64; index += 1) {
      store.put(`call_${index}`, { tool: 't', status: 'ok', text: '', images: [] });
    }
    expect(store.has('call_0')).toBe(true);
    store.put('call_64', { tool: 't', status: 'ok', text: '', images: [] });
    expect(store.has('call_0')).toBe(false);
    expect(store.has('call_64')).toBe(true);
  });

  it('refreshes recency on get so hot results survive', () => {
    const store = new ToolResultStore();
    for (let index = 0; index < 64; index += 1) {
      store.put(`call_${index}`, { tool: 't', status: 'ok', text: '', images: [] });
    }
    store.get('call_0');
    store.put('call_64', { tool: 't', status: 'ok', text: '', images: [] });
    expect(store.has('call_0')).toBe(true);
    expect(store.has('call_1')).toBe(false);
  });
});
