import { describe, expect, it, vi } from 'vitest';
import { HudDraftStore } from '@main/services/capture/HudDraftStore';
import { intentForCaptureStyle } from '@shared/capture';

const item = (label: string) => ({
  dataUrl: 'data:image/jpeg;base64,AAAA',
  meta: { kind: 'window' as const, label, width: 900, height: 600, displayId: 1 },
});

describe('HUD draft store', () => {
  it('holds exactly one capture and summarizes it for the badge', () => {
    const store = new HudDraftStore();
    expect(store.summary()).toEqual({ count: 0, hasImage: false, label: null });
    expect(store.set(item('Firefox — GitHub'))).toEqual({
      count: 1,
      hasImage: true,
      label: 'Firefox — GitHub',
    });
    expect(store.set(item('Code'))).toEqual({ count: 1, hasImage: true, label: 'Code' });
    expect(store.take()?.meta.label).toBe('Code');
    expect(store.peek()).toBeNull();
  });

  it('notifies subscribers on set and take', () => {
    const store = new HudDraftStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set(item('One'));
    store.take();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.set(item('Two'));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('capture style → intent', () => {
  it('maps the default style onto the pointer ladder', () => {
    expect(intentForCaptureStyle('window')).toBe('auto');
    expect(intentForCaptureStyle('region')).toBe('overlay');
    expect(intentForCaptureStyle('display')).toBe('display');
    expect(intentForCaptureStyle(undefined)).toBe('auto');
  });
});
