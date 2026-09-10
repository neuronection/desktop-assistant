// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import axe from 'axe-core';
import type { ToolResultView } from '@shared/turns';

beforeAll(() => {
  if (!('ResizeObserver' in window)) {
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

afterEach(cleanup);

const RESULT: ToolResultView = {
  callId: 'tool_call_1',
  tool: 'screen_capture',
  status: 'ok',
  text: 'Screenshot captured of the primary display.',
  images: [
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ],
};

async function scanViewer(result: ToolResultView | null): Promise<Element> {
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({})),
    minimizeWindow: vi.fn(),
    closeWindow: vi.fn(),
    getToolResult: vi.fn(async () => result),
  } as unknown as typeof window.electronAPI;

  const { ToolResultViewerApp } = await import('@renderer/result-viewer-react/ToolResultViewerApp');
  const { container } = render(<ToolResultViewerApp />);
  await vi.waitFor(() => {
    expect(document.body.textContent).not.toBe('');
  });
  return container;
}

describe('a11y result viewer', () => {
  it('has no axe violations with a screenshot result', async () => {
    const container = await scanViewer(RESULT);
    const results = await axe.run(container, { resultTypes: ['violations'] });
    expect(results.violations).toEqual([]);
  });

  it('has no axe violations when the result has expired', async () => {
    const container = await scanViewer(null);
    const results = await axe.run(container, { resultTypes: ['violations'] });
    expect(results.violations).toEqual([]);
  });
});
