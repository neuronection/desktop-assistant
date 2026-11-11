// @vitest-environment jsdom
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { ElectronAPI } from '@shared/types';
import type { OnboardingStatus } from '@shared/onboarding';
import { OnboardingSection } from '@renderer/settings-react/tabs/OnboardingSection';

afterEach(cleanup);

const status: OnboardingStatus = {
  platform: 'darwin',
  hotkey: 'Control+Space',
  permissions: [
    { kind: 'microphone', status: 'granted' },
    { kind: 'screen', status: 'denied' },
    { kind: 'accessibility', status: 'unknown' },
  ],
  clipboardEnabled: false,
  providerConfigured: true,
  completed: false,
};

describe('OnboardingSection', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: Partial<ElectronAPI> }).electronAPI = {
      getOnboardingStatus: vi.fn(async () => status),
      requestOnboardingPermission: vi.fn(async () => status),
      openOnboardingPermissionSettings: vi.fn(async () => true),
      resetOnboarding: vi.fn(async () => true),
    };
  });

  it('shows the three permissions and resets the card in main', async () => {
    const onChange = vi.fn();
    render(<OnboardingSection config={DEFAULT_CONFIG} onChange={onChange} />);
    expect(await screen.findByText('Microphone (dictation)')).toBeTruthy();
    expect(screen.getByText('not granted')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request' })).toBeTruthy();
    screen.getByRole('button', { name: 'Show the welcome card again' }).click();
    await waitFor(() => expect(window.electronAPI.resetOnboarding).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith({ onboarding: { completed: false, completedAt: null } });
  });

  it('has no axe violations with the permission rows', async () => {
    const { container } = render(<OnboardingSection config={DEFAULT_CONFIG} onChange={vi.fn()} />);
    await screen.findByText('Microphone (dictation)');
    const results = await axe.run(container);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
