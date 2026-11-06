import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  safeStorage: { isEncryptionAvailable: () => false },
  Tray: class {},
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createFromPath: vi.fn(() => ({ resize: () => ({}) })) },
}));

const { TrayManager } = await import('@main/tray');

describe('tray unread badge (plan 42 S2)', () => {
  it('states honestly what each platform shows', () => {
    expect(TrayManager.badgeSupport('darwin')).toMatchObject({ native: true });
    expect(TrayManager.badgeSupport('win32')).toMatchObject({ native: false });
    expect(TrayManager.badgeSupport('linux')).toMatchObject({ native: false });
    expect(TrayManager.badgeSupport('linux').description).toMatch(/tooltip/i);
  });

  it('tracks the unread count and rides the tooltip', () => {
    const manager = new TrayManager();
    const tray = { setToolTip: vi.fn(), setTitle: vi.fn(), setContextMenu: vi.fn(), destroy: vi.fn() };
    (manager as unknown as { tray: unknown }).tray = tray;
    manager.setUnreadBadge(3);
    expect(manager.getUnreadBadge()).toBe(3);
    expect(tray.setToolTip).toHaveBeenCalledWith(expect.stringContaining('3 unread'));
    manager.setUnreadBadge(0);
    expect(tray.setToolTip).toHaveBeenLastCalledWith(expect.not.stringContaining('unread'));
    expect(manager.getUnreadBadge()).toBe(0);
  });
});
