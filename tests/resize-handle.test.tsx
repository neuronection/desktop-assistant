// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ResizeHandle } from '@renderer/chat-react/ResizeHandle';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => true;
});

afterEach(cleanup);

function mockApi() {
  window.electronAPI = {
    resizeCornerStart: vi.fn(async () => {}),
    resizeCornerUpdate: vi.fn(async () => {}),
    resizeCornerEnd: vi.fn(async () => {}),
  } as unknown as typeof window.electronAPI;
  return window.electronAPI;
}

function renderHandle(corner: 'bottom-left' | 'bottom-right', onResizeStart?: () => void): HTMLElement {
  const { container } = render(<ResizeHandle corner={corner} onResizeStart={onResizeStart} />);
  return container.querySelector(`[data-testid="window-resize-handle-${corner}"]`) as HTMLElement;
}

describe('corner resize handles', () => {
  it('notifies the app and reports the corner when starting a resize session', async () => {
    const api = mockApi();
    const onResizeStart = vi.fn();
    const handle = renderHandle('bottom-right', onResizeStart);

    fireEvent.pointerDown(handle, { pointerId: 1, screenX: 100, screenY: 100 });
    expect(onResizeStart).toHaveBeenCalledTimes(1);
    expect(api.resizeCornerStart).toHaveBeenCalledWith('bottom-right');

    fireEvent.pointerMove(handle, { pointerId: 1, screenX: 130, screenY: 165 });
    await waitFor(() => expect(api.resizeCornerUpdate).toHaveBeenCalledWith(30, 65));

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(api.resizeCornerEnd).toHaveBeenCalledTimes(1);
  });

  it('works on the bottom-left corner too', async () => {
    const api = mockApi();
    const handle = renderHandle('bottom-left');

    fireEvent.pointerDown(handle, { pointerId: 1, screenX: 200, screenY: 200 });
    expect(api.resizeCornerStart).toHaveBeenCalledWith('bottom-left');

    fireEvent.pointerMove(handle, { pointerId: 1, screenX: 150, screenY: 240 });
    await waitFor(() => expect(api.resizeCornerUpdate).toHaveBeenCalledWith(-50, 40));

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(api.resizeCornerEnd).toHaveBeenCalledTimes(1);
  });

  it('ignores moves without an active drag and stops after pointerup', async () => {
    const api = mockApi();
    const handle = renderHandle('bottom-right');

    fireEvent.pointerMove(handle, { pointerId: 1, screenX: 200, screenY: 200 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(api.resizeCornerUpdate).not.toHaveBeenCalled();

    fireEvent.pointerDown(handle, { pointerId: 1, screenX: 10, screenY: 10 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1, screenX: 300, screenY: 300 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(api.resizeCornerUpdate).not.toHaveBeenCalled();
    expect(api.resizeCornerEnd).toHaveBeenCalledTimes(1);
  });
});
