import { describe, expect, it } from 'vitest';
import { ImageViewerStore } from '@main/services/viewer/ImageViewerStore';

const png = (seed: string) => `data:image/png;base64,${Buffer.from(seed).toString('base64')}`;

describe('image viewer store', () => {
  it('parks a payload under a unique token and returns it once', () => {
    const store = new ImageViewerStore();
    const first = store.put({ dataUrl: png('a'), title: 'Draft capture' });
    const second = store.put({ dataUrl: png('b'), title: 'Second' });
    expect(first.token).not.toBe(second.token);
    expect(store.get(first.token)).toMatchObject({ title: 'Draft capture' });
    expect(store.get('nope')).toBeNull();
  });

  it('keeps the shelf bounded (oldest evicted)', () => {
    const store = new ImageViewerStore(2);
    const a = store.put({ dataUrl: png('a'), title: 'a' });
    const b = store.put({ dataUrl: png('b'), title: 'b' });
    store.put({ dataUrl: png('c'), title: 'c' });
    expect(store.size()).toBe(2);
    expect(store.get(a.token)).toBeNull();
    expect(store.get(b.token)).not.toBeNull();
    store.clear();
    expect(store.size()).toBe(0);
  });

  it('only accepts image data URLs', () => {
    expect(ImageViewerStore.isImageDataUrl(png('a'))).toBe(true);
    expect(ImageViewerStore.isImageDataUrl('data:application/pdf;base64,AAAA')).toBe(false);
    expect(ImageViewerStore.isImageDataUrl('https://example.com/a.png')).toBe(false);
  });
});
