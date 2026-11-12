import { describe, expect, it } from 'vitest';
import { CaptureFrameStore } from '@main/services/capture/frames';
import type { NativeImageLike } from '@main/services/capture/sources';

function image(size = 100): NativeImageLike {
  return {
    getSize: () => ({ width: size, height: size }),
    toJPEG: () => Buffer.alloc(1),
    crop: () => image(size),
    resize: () => image(size),
  };
}

const display = (id: number) => ({
  id,
  bounds: { x: 0, y: 0, width: 1000, height: 800 },
  scaleFactor: 2,
});

function frame(id: number, takenAt: number) {
  return { display: display(id), image: image(), preview: `data:image/jpeg;base64,${id}`, takenAt };
}

describe('capture frame store', () => {
  it('keeps a warm frame per display and refreshes its LRU position', () => {
    const store = new CaptureFrameStore({ now: () => 1_000 });
    store.put(frame(1, 1_000));
    store.put(frame(2, 1_000));
    expect(store.get(1)?.display.id).toBe(1);
    store.put(frame(3, 1_000));
    expect(store.size()).toBe(2);
    expect(store.get(1)?.display.id).toBe(1);
    expect(store.get(2)).toBeNull();
  });

  it('drops a frame older than the TTL and clears on request', () => {
    let now = 1_000;
    const store = new CaptureFrameStore({ now: () => now, ttlMs: 5_000 });
    store.put(frame(1, now));
    now = 6_500;
    expect(store.get(1)).toBeNull();
    store.put(frame(2, now));
    store.clear();
    expect(store.size()).toBe(0);
  });

  it('replaces the frame for the same display instead of growing', () => {
    const store = new CaptureFrameStore({ now: () => 1_000 });
    store.put(frame(1, 1_000));
    store.put({ ...frame(1, 1_000), preview: 'data:image/jpeg;base64,new' });
    expect(store.size()).toBe(1);
    expect(store.get(1)?.preview).toBe('data:image/jpeg;base64,new');
  });
});
