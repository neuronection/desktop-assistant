import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ appPath: process.cwd() }));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  app: {
    isPackaged: false,
    getAppPath: () => state.appPath,
  },
}));

const { verifyProviderCatalog } = await import('@main/smoke');

describe('packaged smoke verifies the vendored provider catalog (2026-11-06)', () => {
  it('reports ok when the calendar catalog loads', () => {
    state.appPath = process.cwd();
    expect(verifyProviderCatalog()).toBe('ok');
  });

  it('reports the missing path instead of throwing', () => {
    state.appPath = '/nonexistent-desktop-assistant';
    expect(verifyProviderCatalog()).toContain('Vendored provider catalog missing');
  });
});
