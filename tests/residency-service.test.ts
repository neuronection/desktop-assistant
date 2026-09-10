import { describe, it, expect, vi, beforeEach } from 'vitest';

const setLoginItemSettings = vi.fn();

vi.mock('electron', () => ({
  app: {
    setLoginItemSettings: (...args: unknown[]) => setLoginItemSettings(...args),
  },
}));

const freshService = async () => {
  const mod = await import('@main/services/ResidencyService');
  (mod.ResidencyService as unknown as { instance: unknown }).instance = undefined;
  return mod.ResidencyService.getInstance();
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ResidencyService', () => {
  it('applies autostart to the OS login items', async () => {
    const service = await freshService();
    service.apply(true);
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it('applies disabling and does not rewrite unchanged state', async () => {
    const service = await freshService();
    service.apply(true);
    service.apply(true);
    expect(setLoginItemSettings).toHaveBeenCalledTimes(1);
    service.apply(false);
    expect(setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false });
    expect(setLoginItemSettings).toHaveBeenCalledTimes(2);
  });

  it('fails soft when the OS refuses the login item', async () => {
    setLoginItemSettings.mockImplementation(() => {
      throw new Error('not supported');
    });
    const service = await freshService();
    expect(() => service.apply(true)).not.toThrow();
  });
});
