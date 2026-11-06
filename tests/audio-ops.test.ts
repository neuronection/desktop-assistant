import { describe, it, expect } from 'vitest';
import { beginAudioOp, cancelAudioOp, endAudioOp, isAbortError } from '@main/ai/audioOps';

describe('audioOps cancel seam', () => {
  it('aborts a live op and reports it', () => {
    const signal = beginAudioOp('req-1');
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    expect(cancelAudioOp('req-1')).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(cancelAudioOp('req-1')).toBe(false);
  });

  it('a cancelled id can be re-registered fresh (next speak)', () => {
    const first = beginAudioOp('req-2');
    cancelAudioOp('req-2');
    const second = beginAudioOp('req-2');
    expect(second?.aborted).toBe(false);
    expect(first?.aborted).toBe(true);
  });

  it('ends cleanly: cancel after end reports nothing live', () => {
    beginAudioOp('req-3');
    endAudioOp('req-3');
    expect(cancelAudioOp('req-3')).toBe(false);
  });

  it('undefined ids are pass-through (no signal, nothing cancellable)', () => {
    expect(beginAudioOp(undefined)).toBeUndefined();
    endAudioOp(undefined);
    expect(cancelAudioOp('never-registered')).toBe(false);
  });

  it('recognizes cancellation rejections across SDK flavors', () => {
    expect(isAbortError(Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' }))).toBe(true);
    expect(isAbortError(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))).toBe(true);
    expect(isAbortError(new Error('endpoint down'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
