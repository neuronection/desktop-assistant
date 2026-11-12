// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToolResultViewerApp } from '@renderer/result-viewer-react/ToolResultViewerApp';
import { TEXT } from '@shared/constants/text';

const getViewerImage = vi.fn();
const getToolResult = vi.fn();
const applyViewerEdit = vi.fn(async () => true);

beforeEach(() => {
  window.electronAPI = {
    getViewerImage,
    getToolResult,
    applyViewerEdit,
    minimizeWindow: vi.fn(),
    closeWindow: vi.fn(),
  } as unknown as typeof window.electronAPI;
  window.history.pushState({}, '', '/?image=token-1');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('image viewer window', () => {
  it('renders a parked capture full-size with zoom controls', async () => {
    getViewerImage.mockResolvedValue({
      token: 'token-1',
      title: 'Firefox — GitHub',
      dataUrl: 'data:image/jpeg;base64,AAAA',
    });

    render(<ToolResultViewerApp />);

    expect(await screen.findByText(TEXT.VIEWER_IMAGE_TITLE)).toBeTruthy();
    const image = (await screen.findByRole('img')) as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('data:image/jpeg;base64,AAAA');
    expect(screen.getByText('Firefox — GitHub')).toBeTruthy();
    expect(screen.getByTitle(TEXT.TOOL_RESULT_ZOOM_IN)).toBeTruthy();
    expect(getViewerImage).toHaveBeenCalledWith('token-1');
    expect(getToolResult).not.toHaveBeenCalled();
  });

  it('says so when the payload was evicted', async () => {
    getViewerImage.mockResolvedValue(null);

    render(<ToolResultViewerApp />);

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(TEXT.TOOL_RESULT_MISSING));
  });

  it('still loads a stored tool result when no image token is present', async () => {
    window.history.pushState({}, '', '/?call=tool_1');
    getToolResult.mockResolvedValue({
      callId: 'tool_1',
      tool: 'screen_capture',
      status: 'ok',
      text: 'captured',
      images: ['data:image/jpeg;base64,BBBB'],
    });

    render(<ToolResultViewerApp />);

    expect(await screen.findByText('screen_capture')).toBeTruthy();
    expect(getToolResult).toHaveBeenCalledWith('tool_1');
    expect(getViewerImage).not.toHaveBeenCalled();
  });
});

describe('image viewer editing (plan 81)', () => {
  const rect = { left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0 };

  beforeEach(() => {
    window.history.pushState({}, '', '/?image=token-1');
    getViewerImage.mockResolvedValue({
      token: 'token-1',
      title: 'Firefox — GitHub',
      dataUrl: 'data:image/jpeg;base64,AAAA',
      editable: true,
    });
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
      configurable: true,
      value: () => 'data:image/jpeg;base64,EDITED',
    });
  });

  it('crops, applies, and sends the composited image back to main', async () => {
    render(<ToolResultViewerApp />);
    await screen.findByRole('img');

    fireEvent.click(screen.getByTitle(TEXT.VIEWER_EDIT));
    const stage = screen.getByTestId('viewer-stage');
    fireEvent.pointerDown(stage, { clientX: 100, clientY: 50, button: 0, pointerId: 1 });
    fireEvent.pointerMove(stage, { clientX: 300, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(stage, { clientX: 300, clientY: 150, button: 0, pointerId: 1 });
    fireEvent.click(screen.getByTitle(TEXT.VIEWER_APPLY));

    await waitFor(() => expect(applyViewerEdit).toHaveBeenCalledTimes(1));
    expect(applyViewerEdit).toHaveBeenCalledWith('token-1', {
      dataUrl: 'data:image/jpeg;base64,EDITED',
      width: 640,
      height: 400,
    });
  });

  it('keeps a read-only tool result out of the editor', async () => {
    window.history.pushState({}, '', '/?call=tool_1');
    getToolResult.mockResolvedValue({
      callId: 'tool_1',
      tool: 'screen_capture',
      status: 'ok',
      text: '',
      images: ['data:image/jpeg;base64,BBBB'],
    });
    render(<ToolResultViewerApp />);
    await screen.findByRole('img');
    expect(screen.queryByTitle(TEXT.VIEWER_EDIT)).toBeNull();
    expect(applyViewerEdit).not.toHaveBeenCalled();
  });
});
