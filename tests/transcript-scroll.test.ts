// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { scrollTranscriptToResponseStart } from '@renderer/chat-react/transcriptScroll';

function transcript(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <div role="log">
      <div data-message-id="u1">user</div>
      <div data-message-id="a1">first answer</div>
      <div data-message-id="a2">last answer</div>
      <div data-as="chat-transcript-live">live answer</div>
    </div>
  `;
  return root;
}

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  vi.restoreAllMocks();
});

describe('scrollTranscriptToResponseStart', () => {
  it('puts the latest assistant row at the top of the transcript', () => {
    const root = transcript();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    expect(scrollTranscriptToResponseStart(root, { live: false, messageId: 'a2' })).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(root.querySelector('[data-message-id="a2"]'));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
  });

  it('prefers the streaming live row while a reply is in flight', () => {
    const root = transcript();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    expect(scrollTranscriptToResponseStart(root, { live: true, messageId: null })).toBe(true);
    expect(scrollIntoView.mock.instances[0]).toBe(root.querySelector('[data-as="chat-transcript-live"]'));
  });

  it('is a no-op when the target is not rendered', () => {
    const root = transcript();
    Element.prototype.scrollIntoView = vi.fn();

    expect(scrollTranscriptToResponseStart(root, { live: false, messageId: 'missing' })).toBe(false);
    expect(scrollTranscriptToResponseStart(null, { live: false, messageId: 'a2' })).toBe(false);
  });
});
