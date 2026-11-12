// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ToolResultViewerApp } from '@renderer/result-viewer-react/ToolResultViewerApp';
import { TEXT } from '@shared/constants/text';

const getViewerImage = vi.fn();
const getToolResult = vi.fn();

beforeEach(() => {
  window.electronAPI = {
    getViewerImage,
    getToolResult,
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
