import { describe, expect, it } from 'vitest';
import { connectionErrorText } from '@main/ai/tools/mcp';

describe('connectionErrorText (fetch cause chain)', () => {
  it('flattens the undici cause chain into the message', () => {
    const error = new TypeError('fetch failed');
    (error as { cause?: unknown }).cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
      code: 'ECONNREFUSED',
    });
    const text = connectionErrorText(error);
    expect(text).toContain('fetch failed');
    expect(text).toContain('ECONNREFUSED');
  });

  it('includes certificate errors from nested causes', () => {
    const error = new TypeError('fetch failed');
    (error as { cause?: unknown }).cause = Object.assign(new Error('unable to verify the first certificate'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    });
    const text = connectionErrorText(error);
    expect(text).toContain('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
  });

  it('caps length and tolerates missing causes', () => {
    expect(connectionErrorText(new TypeError('fetch failed'))).toBe('fetch failed');
    expect(connectionErrorText(new Error('x'.repeat(1000)))).toContain('truncated 700 chars');
  });
});
