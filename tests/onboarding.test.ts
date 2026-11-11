import { describe, expect, it, vi } from 'vitest';
import { OnboardingService } from '@main/services/OnboardingService';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';

const baseConfig = { ...DEFAULT_CONFIG };

function makeService(platform: NodeJS.Platform = 'darwin') {
  const updateConfig = vi.fn(async () => undefined);
  const openExternal = vi.fn(async () => undefined);
  const prefs = {
    getMediaAccessStatus: vi.fn((type: string) => (type === 'microphone' ? 'granted' : 'denied')),
    isTrustedAccessibilityClient: vi.fn(() => false),
    askForMediaAccess: vi.fn(async () => true),
  };
  const service = new OnboardingService({
    getConfig: () => baseConfig,
    updateConfig,
    toggleHotkey: () => 'Control+Space',
    platform,
    preferences: prefs,
    openExternal,
    captureScreen: vi.fn(async () => []),
  });
  return { service, updateConfig, openExternal, prefs };
}

describe('OnboardingService', () => {
  it('reports hotkey, permissions and setup state', () => {
    const { service } = makeService();
    const status = service.status();
    expect(status).toMatchObject({
      platform: 'darwin',
      hotkey: 'Control+Space',
      completed: false,
      providerConfigured: false,
    });
    expect(status.permissions).toEqual([
      { kind: 'microphone', status: 'granted' },
      { kind: 'screen', status: 'denied' },
      { kind: 'accessibility', status: 'denied' },
    ]);
  });

  it('asks for the microphone and opens the right privacy pane', async () => {
    const { service, prefs, openExternal } = makeService();
    await service.request('microphone');
    expect(prefs.askForMediaAccess).toHaveBeenCalledWith('microphone');
    expect(await service.openSettings('accessibility')).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  });

  it('marks onboarding complete and can reset it', async () => {
    const { service, updateConfig } = makeService();
    await service.complete();
    expect(updateConfig).toHaveBeenCalledWith({ onboarding: expect.objectContaining({ completed: true }) });
    await service.reset();
    expect(updateConfig).toHaveBeenCalledWith({ onboarding: { completed: false, completedAt: null } });
  });
});
