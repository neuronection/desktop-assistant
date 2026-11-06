import { describe, expect, it, vi } from 'vitest';

const getAllWindows = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows },
}));

const { verifyRendererBridge } = await import('@main/smoke');

function fakeWindow(url: string, bridgeExists: boolean) {
  return {
    webContents: {
      getURL: () => url,
      isLoading: () => false,
      executeJavaScript: vi.fn().mockResolvedValue(bridgeExists),
      once: vi.fn(),
    },
  };
}

describe('packaged smoke verifies the renderer preload bridge (2026-11-03)', () => {
  it('reports ok when the launcher exposes window.electronAPI', async () => {
    getAllWindows.mockReturnValue([fakeWindow('file:///app/dist/renderer/index.html', true)]);
    await expect(verifyRendererBridge()).resolves.toBe('ok');
  });

  it('falls back to the only open window when no launcher URL matches', async () => {
    getAllWindows.mockReturnValue([fakeWindow('file:///app/dist/renderer/settings.html', true)]);
    await expect(verifyRendererBridge()).resolves.toBe('ok');
  });

  it('fails with a preload diagnostic when the bridge is missing', async () => {
    getAllWindows.mockReturnValue([fakeWindow('file:///app/dist/renderer/index.html', false)]);
    await expect(verifyRendererBridge()).resolves.toContain('preload did not load');
  });

  it('fails when no window exists at all', async () => {
    getAllWindows.mockReturnValue([]);
    await expect(verifyRendererBridge()).resolves.toContain('no launcher window');
  });
});
